import { statfsSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { performance } from 'node:perf_hooks';
import { config } from './config.js';
import {
  formatAdminHealthReport,
  oneMinuteLoadAverage,
  processCpuAveragePercent,
  type RecentServiceError,
} from './admin/health-report.js';
import { Database } from './db/database.js';
import { Repository } from './db/repository.js';
import { ACHIEVEMENTS, ACHIEVEMENT_TIER_LABELS, type AchievementTier } from './game/achievements.js';
import { GameEngine } from './game/game-engine.js';
import { levelForCorrect, levelProgressBar } from './game/levels.js';
import { HealthServer } from './http/health-server.js';
import { logger } from './logger.js';
import type { ChatSettings, Difficulty, HealthSnapshot, IncomingMessage, PlayOptions, Player } from './types.js';
import { categoryByKey, CATEGORIES, CATEGORY_GROUPS, CATEGORY_SECTIONS } from './trivia/catalog.js';
import { QuestionProvider } from './trivia/question-provider.js';
import { localDateKey, startOfWeekMs } from './util/date.js';
import { clamp, percentage } from './util/text.js';
import { WhatsAppTransport, type ConnectionState } from './whatsapp/transport.js';
import { APP_VERSION } from './version.js';

export class TriviaApplication {
  private readonly db = new Database(config.databasePath);
  private readonly repository = new Repository(this.db);
  private readonly provider = new QuestionProvider({ cache: this.repository });
  private readonly transport: WhatsAppTransport;
  private readonly engine: GameEngine;
  private readonly healthServer: HealthServer;
  private readonly commandCooldowns = new Map<string, number>();
  private whatsappState: ConnectionState = 'starting';
  private databaseReady = true;
  private lastMessageAt: number | null = null;
  private lastErrorAt: number | null = null;
  private readonly recentErrors: RecentServiceError[] = [];
  private cleanupTimer: NodeJS.Timeout | null = null;
  private stopping = false;

  constructor() {
    this.transport = new WhatsAppTransport(
      this.db,
      (message) => this.handleMessage(message),
      (state) => this.handleConnectionState(state),
      (error, label) => this.recordError(error, label),
    );
    this.engine = new GameEngine(
      this.repository,
      this.provider,
      (chatId, text) => this.transport.sendText(chatId, text),
    );
    this.healthServer = new HealthServer(() => this.healthSnapshot());
  }

  async start(): Promise<void> {
    await this.provider.initialize();
    this.engine.initialize();
    await this.healthServer.start();
    this.cleanupTimer = setInterval(() => {
      try {
        this.repository.db.pruneOperationalData();
        this.repository.db.checkpoint();
      } catch (error) {
        this.recordError(error, 'Periodic database maintenance failed');
      }
    }, 60 * 60 * 1000);
    this.cleanupTimer.unref();
    await this.transport.start();
  }

  async stop(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    await this.transport.stop();
    await this.healthServer.stop();
    this.db.close();
  }

  healthSnapshot(): HealthSnapshot {
    const whatsappConnected = this.transport.connected;
    const databaseReady = this.databaseReady && this.db.isHealthy();
    return {
      live: !this.stopping,
      ready: !this.stopping && databaseReady && whatsappConnected,
      whatsappConnected,
      databaseReady,
      activeGames: this.engine.activeGameCount,
      uptimeSeconds: Math.floor(process.uptime()),
      lastMessageAt: this.lastMessageAt,
      lastErrorAt: this.lastErrorAt,
    };
  }

  private async handleMessage(message: IncomingMessage): Promise<void> {
    this.lastMessageAt = Date.now();
    if (this.repository.isMessageProcessed(message.messageId, message.timestampMs)) return;
    this.repository.touchChat(message.chatId, message.isGroup);
    const player = this.repository.upsertPlayer(
      message.senderId,
      message.senderPhoneId,
      message.pushName,
    );

    try {
      const text = message.text.trim();
      const lower = text.toLowerCase();
      if (lower === 'red pill' || lower === 'redpill') {
        await this.sendRedPill(message.chatId);
        return;
      }
      if (lower === 'blue pill' || lower === 'bluepill') {
        await this.sendBluePill(message.chatId);
        return;
      }

      if (!text.startsWith(config.commandPrefix)) {
        await this.engine.answer(message.chatId, player, text);
        return;
      }

      const [rawCommand = '', ...args] = text.slice(config.commandPrefix.length).trim().split(/\s+/);
      const command = rawCommand.toLowerCase();
      if (!command) return;
      if (!this.consumeCooldown(`${player.id}:${command}`, command === 'play' ? 3500 : 1000)) return;

      switch (command) {
        case 'play':
        case 'start':
          await this.handlePlay(message, player, args, 'classic');
          break;
        case 'sprint':
          await this.handlePlay(message, player, args, 'sprint');
          break;
        case 'daily':
          await this.handlePlay(message, player, args, 'daily');
          break;
        case 'stop':
          await this.handleStop(message, player);
          break;
        case 'skip':
        case 'next':
          await this.handleSkip(message, player);
          break;
        case 'hint':
          await this.engine.hint(message.chatId, player);
          break;
        case 'score':
          await this.handleScore(message.chatId);
          break;
        case 'leaderboard':
        case 'top':
          await this.handleLeaderboard(message, args);
          break;
        case 'stats':
        case 'profile':
          await this.handleStats(message.chatId, player);
          break;
        case 'achievements':
        case 'badges':
          await this.handleAchievements(message.chatId, player);
          break;
        case 'levels':
        case 'progress':
          await this.handleLevels(message.chatId, player);
          break;
        case 'categories':
          await this.handleCategories(message.chatId);
          break;
        case 'settings':
          await this.handleSettings(message.chatId);
          break;
        case 'set':
          await this.handleSet(message, player, args);
          break;
        case 'addgroup':
          await this.handleAddGroup(message, player, text);
          break;
        case 'removegroup':
          await this.handleRemoveGroup(message, player, args);
          break;
        case 'help':
        case 'commands':
          await this.sendHelp(message);
          break;
        case 'about':
          await this.sendAbout(message.chatId);
          break;
        case 'ping':
          await this.transport.sendText(
            message.chatId,
            `🏓 Pong! ${connectionStateLabel(this.transport.connectionState)}, ` +
              `${this.engine.activeGameCount} game${this.engine.activeGameCount === 1 ? '' : 's'} running right now.`,
          );
          break;
        case 'health':
        case 'serverhealth':
          await this.handleAdminHealth(message, args);
          break;
        case 'egg':
          await this.sendEgg(message.chatId);
          break;
        case 'glitch':
          await this.sendGlitch(message.chatId);
          break;
        default:
          if (!message.isGroup) {
            await this.transport.sendText(message.chatId, `Unknown command. Type *${config.commandPrefix}help*.`);
          }
      }
    } catch (error) {
      this.recordError(error, 'Message processing failed', message);
      try {
        await this.transport.sendText(
          message.chatId,
          '⚠️ Something went wrong with that action. The bot is still running; please try again.',
        );
      } catch (sendError) {
        this.recordError(sendError, 'Could not send command error message', message);
      }
    }
  }

  private async handlePlay(
    message: IncomingMessage,
    player: Player,
    args: string[],
    forcedMode: PlayOptions['mode'],
  ): Promise<void> {
    if (forcedMode === 'daily' && message.isGroup) {
      await this.transport.sendText(message.chatId, '📅 Daily Run is a personal challenge. Message the bot directly and use */daily*.');
      return;
    }
    const settings = this.repository.getSettings(message.chatId);
    const options = parsePlayOptions(args, settings, forcedMode);
    await this.engine.startGame(
      message.chatId,
      message.isGroup,
      player,
      options,
      forcedMode === 'daily' ? localDateKey(new Date(), config.timezone) : undefined,
    );
  }

  private async handleStop(message: IncomingMessage, player: Player): Promise<void> {
    if (!(await this.canManageCurrentGame(message, player))) {
      await this.transport.sendText(message.chatId, '🔐 Only the game host or a group admin can stop this game.');
      return;
    }
    if (!(await this.engine.stopGame(message.chatId))) {
      await this.transport.sendText(message.chatId, 'There is no active game to stop.');
    }
  }

  private async handleSkip(message: IncomingMessage, player: Player): Promise<void> {
    if (!(await this.canManageCurrentGame(message, player))) {
      await this.transport.sendText(message.chatId, '🔐 Only the game host or a group admin can skip a question.');
      return;
    }
    if (!(await this.engine.skipQuestion(message.chatId))) {
      await this.transport.sendText(message.chatId, 'There is no open question to skip.');
    }
  }

  private async handleScore(chatId: string): Promise<void> {
    const score = this.engine.currentScore(chatId);
    await this.transport.sendText(chatId, score ?? '📊 There is no active game here.');
  }

  private async handleLeaderboard(message: IncomingMessage, args: string[]): Promise<void> {
    const normalized = args.map((arg) => arg.toLowerCase());
    const scope = normalized.includes('global') ? 'global' : normalized.includes('group') || normalized.includes('chat')
      ? 'chat'
      : message.isGroup
        ? 'chat'
        : 'global';
    const weekly = normalized.includes('weekly') || normalized.includes('week');
    const entries = this.repository.leaderboard(
      scope,
      message.chatId,
      weekly ? startOfWeekMs(new Date(), config.timezone) : undefined,
    );
    if (!entries.length) {
      await this.transport.sendText(message.chatId, '🏆 No scores yet. Start the first game with */play*.');
      return;
    }
    const title = `🏆 *${weekly ? 'Weekly ' : ''}${scope === 'global' ? 'Global' : 'Group'} leaderboard*`;
    const lines = entries.map((entry, index) => {
      const medal = ['🥇', '🥈', '🥉'][index] ?? `${index + 1}.`;
      return `${medal} ${entry.name} — *${entry.points} pts* (${percentage(entry.correct, entry.answered)})`;
    });
    await this.transport.sendText(message.chatId, `${title}\n\n${lines.join('\n')}`);
  }

  private async handleStats(chatId: string, player: Player): Promise<void> {
    const stats = this.repository.playerStats(player.id, chatId);
    if (!stats) return;
    await this.transport.sendText(
      chatId,
      `👤 *${stats.display_name}*\n\n` +
        `🌍 Total points: *${stats.total_points}*\n` +
        `🎮 Games: *${stats.games_played}* | Wins: *${stats.games_won}*\n` +
        `✅ Accuracy: *${percentage(Number(stats.correct_answers), Number(stats.questions_answered))}*\n` +
        `🔥 Current streak: *${stats.current_streak}* | Best: *${stats.best_streak}*\n` +
        `⭐ Best game: *${stats.best_game_score}*\n\n` +
        `💬 This chat: *${stats.chat_points} pts* across *${stats.chat_games} games*`,
    );
  }

  private async handleAchievements(chatId: string, player: Player): Promise<void> {
    const unlocked = new Map(this.repository.achievements(player.id).map((item) => [item.key, item]));
    const tiers: AchievementTier[] = ['easy', 'moderate', 'hard'];
    const sections = tiers
      .map((tier) => {
        const lines = Object.entries(ACHIEVEMENTS)
          .filter(([, item]) => item.tier === tier)
          .map(([key, item]) =>
            unlocked.has(key)
              ? `✅ ${item.icon} *${item.name}* — ${item.description}`
              : `🔒 ${item.icon} ${item.name} — ${item.description}`,
          );
        return lines.length ? `*${ACHIEVEMENT_TIER_LABELS[tier]}*\n${lines.join('\n')}` : '';
      })
      .filter(Boolean);
    await this.transport.sendText(chatId, `🏅 *Achievements*\n\n${sections.join('\n\n')}`);
  }

  private async handleLevels(chatId: string, player: Player): Promise<void> {
    const stats = this.repository.playerStats(player.id, chatId);
    const overallCorrect = stats ? Number(stats.correct_answers) : 0;
    const overall = levelForCorrect(overallCorrect);
    const overallLine =
      `${overall.tier.icon} *Overall: Level ${overall.tier.level} – ${overall.tier.name}* (${overallCorrect} correct)\n` +
      `${levelProgressBar(overall)} ${overall.next ? `${overall.correct}/${overall.next.minCorrect} to ${overall.next.name}` : 'Max level!'}`;

    const categoryRows = this.repository.categoryStats(player.id).filter((row) => row.answered > 0);
    if (!categoryRows.length) {
      await this.transport.sendText(
        chatId,
        `📊 *Your Progress*\n\n${overallLine}\n\nPlay a game to start building category progress!`,
      );
      return;
    }

    const categoryLines = categoryRows.map((row) => {
      const name = categoryByKey(row.category)?.name ?? row.category;
      const progress = levelForCorrect(row.correct);
      const nextLabel = progress.next
        ? ` (${progress.correct}/${progress.next.minCorrect} to ${progress.next.name})`
        : ' (max level!)';
      return `${progress.tier.icon} *${progress.tier.name}* — ${name}: ${row.correct} correct${nextLabel}`;
    });

    await this.transport.sendText(
      chatId,
      `📊 *Your Progress*\n\n${overallLine}\n\n*By category*\n${categoryLines.join('\n')}`,
    );
  }

  private async handleCategories(chatId: string): Promise<void> {
    const settings = this.repository.getSettings(chatId);
    const categoriesByKey = new Map(CATEGORIES.map((item) => [item.key, item]));
    const sections = CATEGORY_SECTIONS.map((section) => {
      const lines = section.categories
        .map((key) => categoriesByKey.get(key))
        .filter((item): item is (typeof CATEGORIES)[number] => Boolean(item))
        .map((item) => `• *${item.key}* — ${item.name}`)
        .join('\n');
      return `*${section.title}*\n${lines}`;
    }).join('\n\n');
    const builtIn = Object.entries(CATEGORY_GROUPS)
      .map(([key, group]) => `• *group:${key}* — ${group.name}`)
      .join('\n');
    const custom = Object.entries(settings.customGroups)
      .map(([key, group]) => `• *group:${key}* — ${group.name} (custom)`)
      .join('\n');
    await this.transport.sendText(
      chatId,
      `🗂️ *Categories*\n_Type the bold word after */play*._\n\n${sections}\n\n` +
        `🎲 *Play a blend of topics*\n${builtIn}${custom ? `\n${custom}` : ''}\n\n` +
        `🏷️ *Want something specific?* Add *tag:word*, e.g. a topic, era, or person.\n\n` +
        `Examples:\n*/play sports hard 10*\n*/play group:entertainment*\n*/play art tag:renaissance*`,
    );
  }

  private async handleSettings(chatId: string): Promise<void> {
    const settings = this.repository.getSettings(chatId);
    await this.transport.sendText(
      chatId,
      `⚙️ *Chat settings*\n\n` +
        `Questions per game: *${settings.questionsPerGame}*\n` +
        `Time per question: *${settings.timeoutSeconds}s*\n` +
        `Pause before next question: *${(settings.revealDelayMs / 1000).toFixed(1)}s*\n` +
        `Difficulty: *${settings.defaultDifficulty}*\n` +
        `Category: *${settings.defaultCategory ?? 'mixed'}*\n` +
        `Repeat-question cooldown: *${formatCooldown(settings.questionCooldownHours)}*\n` +
        `Hints: *${settings.hintsEnabled ? 'on' : 'off'}*\n` +
        `Round standings: *${settings.showRoundLeaderboard ? 'on' : 'off'}*\n\n` +
        `Change any of these with */set <setting> <value>*, e.g.\n` +
        `*/set questions 10*, */set timeout 25*, */set difficulty hard*, ` +
        `*/set category sports*, */set cooldown 7d*, */set hints off* or */set roundscores off*.` ,
    );
  }

  private async handleSet(message: IncomingMessage, player: Player, args: string[]): Promise<void> {
    if (!(await this.canManageSettings(message, player))) {
      await this.transport.sendText(message.chatId, '🔐 Only a group admin can change group settings.');
      return;
    }
    const [fieldRaw, valueRaw] = args;
    if (!fieldRaw || !valueRaw) {
      await this.transport.sendText(
        message.chatId,
        'Usage: */set <setting> <value>*\nType */settings* to see the full list of settings and current values.',
      );
      return;
    }
    const field = fieldRaw.toLowerCase();
    const value = valueRaw.toLowerCase();
    const settings = this.repository.getSettings(message.chatId);
    try {
      switch (field) {
        case 'questions': {
          const parsed = Number.parseInt(value, 10);
          if (!Number.isFinite(parsed)) throw new Error('Questions must be a number');
          settings.questionsPerGame = clamp(parsed, 3, 30);
          break;
        }
        case 'timeout': {
          const parsed = Number.parseInt(value, 10);
          if (!Number.isFinite(parsed)) throw new Error('Timeout must be a number');
          settings.timeoutSeconds = clamp(parsed, 8, 90);
          break;
        }
        case 'delay':
        case 'revealdelay': {
          const parsed = Number.parseInt(value, 10);
          if (!Number.isFinite(parsed)) throw new Error('Delay must be a number');
          settings.revealDelayMs = clamp(parsed, 500, 10_000);
          break;
        }
        case 'difficulty':
          if (!isDifficulty(value)) throw new Error('Difficulty must be mixed, easy, medium or hard');
          settings.defaultDifficulty = value;
          break;
        case 'category':
          if (value === 'mixed' || value === 'any') settings.defaultCategory = null;
          else {
            const category = categoryByKey(value);
            if (!category) throw new Error('Unknown category. Use /categories');
            settings.defaultCategory = category.key;
          }
          break;
        case 'cooldown':
        case 'questioncooldown':
          settings.questionCooldownHours = parseCooldownHours(value);
          break;
        case 'hints':
          settings.hintsEnabled = parseOnOff(value);
          break;
        case 'roundscores':
        case 'roundstandings':
          settings.showRoundLeaderboard = parseOnOff(value);
          break;
        default:
          throw new Error('Unknown setting. Type */settings* to see what you can change.');
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Invalid setting';
      await this.transport.sendText(message.chatId, `❌ ${detail}`);
      return;
    }
    this.repository.saveSettings(message.chatId, settings);
    const label = SET_FIELD_LABELS[field] ?? field;
    await this.transport.sendText(message.chatId, `✅ ${label} is now *${value}*.`);
  }

  private async handleAddGroup(message: IncomingMessage, player: Player, rawText: string): Promise<void> {
    if (!(await this.canManageSettings(message, player))) {
      await this.transport.sendText(message.chatId, '🔐 Only a group admin can edit category mixes.');
      return;
    }
    const prefix = escapeRegExp(config.commandPrefix);
    const match = rawText.match(new RegExp(`^${prefix}addgroup\\s+([a-z0-9_-]+)\\s+(?:"([^"]+)"|(\\S+))\\s+(.+)$`, 'i'));
    if (!match) {
      await this.transport.sendText(
        message.chatId,
        'Usage: */addgroup <key> "<name>" category1,category2*\nExample: */addgroup mymix "My Mix" film,music,sports*',
      );
      return;
    }
    const key = match[1]!.toLowerCase();
    const name = (match[2] ?? match[3])!.trim();
    const requested = match[4]!.split(',').map((item) => item.trim()).filter(Boolean);
    const categories = requested.map(categoryByKey).filter(Boolean).map((item) => item!.key);
    if (!categories.length) throw new Error('No valid categories were supplied');
    const settings = this.repository.getSettings(message.chatId);
    settings.customGroups[key] = { name, categories: [...new Set(categories)] };
    this.repository.saveSettings(message.chatId, settings);
    await this.transport.sendText(message.chatId, `✅ Created *${name}*. Use */play group:${key}*.`);
  }

  private async handleRemoveGroup(message: IncomingMessage, player: Player, args: string[]): Promise<void> {
    if (!(await this.canManageSettings(message, player))) {
      await this.transport.sendText(message.chatId, '🔐 Only a group admin can edit category mixes.');
      return;
    }
    const key = args[0]?.toLowerCase();
    if (!key) {
      await this.transport.sendText(message.chatId, 'Usage: */removegroup <key>*');
      return;
    }
    const settings = this.repository.getSettings(message.chatId);
    if (!settings.customGroups[key]) {
      await this.transport.sendText(message.chatId, `No custom category mix called *${key}* exists.`);
      return;
    }
    delete settings.customGroups[key];
    this.repository.saveSettings(message.chatId, settings);
    await this.transport.sendText(message.chatId, `✅ Removed custom mix *${key}*.`);
  }

  private async handleAdminHealth(message: IncomingMessage, args: string[]): Promise<void> {
    if (!this.isBotAdmin(message)) {
      await this.transport.sendText(
        message.chatId,
        '🔐 Server health is restricted to configured bot administrators.',
      );
      return;
    }

    const startedAt = performance.now();
    const health = this.healthSnapshot();
    const memory = process.memoryUsage();
    let databaseBytes: number | null = null;
    let diskFreeBytes: number | null = null;

    try {
      databaseBytes = statSync(config.databasePath).size;
    } catch {
      // The database health result above remains the source of truth.
    }

    try {
      const disk = statfsSync(dirname(config.databasePath));
      diskFreeBytes = disk.bavail * disk.bsize;
    } catch {
      // Some platforms or filesystems do not provide statfs information.
    }

    const checkedAt = Date.now();
    const full = args.some((arg) => ['full', 'details', 'verbose'].includes(arg.toLowerCase()));
    const report = formatAdminHealthReport(
      config.botName,
      health,
      {
        checkedAt,
        checkDurationMs: Math.max(0, Math.round(performance.now() - startedAt)),
        connectionState: this.transport.connectionState,
        maxConcurrentGames: config.maxConcurrentGames,
        outboundQueue: this.transport.queueStats,
        gameQueue: this.engine.queueStats,
        reconnectAttempts: this.transport.reconnectAttemptCount,
        rssBytes: memory.rss,
        heapUsedBytes: memory.heapUsed,
        heapTotalBytes: memory.heapTotal,
        cpuAveragePercent: processCpuAveragePercent(),
        loadAverage1m: oneMinuteLoadAverage(),
        databaseBytes,
        diskFreeBytes,
        nodeVersion: process.version,
        recentErrors: [...this.recentErrors],
      },
      config.timezone,
      full,
    );
    await this.transport.sendText(message.chatId, report);
  }

  private async canManageCurrentGame(message: IncomingMessage, player: Player): Promise<boolean> {
    const game = this.engine.gameForChat(message.chatId);
    if (!game) return true;
    if (!message.isGroup || game.hostPlayerId === player.id || this.isBotAdmin(message)) return true;
    return this.transport.isGroupAdmin(message.chatId, message.senderId, message.senderPhoneId);
  }

  private async canManageSettings(message: IncomingMessage, _player: Player): Promise<boolean> {
    if (!message.isGroup || this.isBotAdmin(message)) return true;
    return this.transport.isGroupAdmin(message.chatId, message.senderId, message.senderPhoneId);
  }

  private isBotAdmin(message: IncomingMessage): boolean {
    return config.botAdmins.has(message.senderId) || Boolean(message.senderPhoneId && config.botAdmins.has(message.senderPhoneId));
  }

  private async sendHelp(message: IncomingMessage): Promise<void> {
    const hintCommand = message.isGroup
      ? ''
      : `*/hint* — remove two wrong answers (costs 25% of the points)\n`;
    const adminCommand = this.isBotAdmin(message)
      ? `*/health [full]* — server status (bot admins only)\n`
      : '';

    await this.transport.sendText(
      message.chatId,
      `🎮 *${config.botName} commands*\n\n` +
        `*Play*\n` +
        `*/play [category] [difficulty] [count]* — start a game\n` +
        `*/sprint* — fast 5-question game\n` +
        `*/daily* — one solo challenge per day\n` +
        hintCommand +
        `*/score* — see the standings so far\n` +
        `*/stop* | */skip* — stop or skip a question (host or admin)\n\n` +
        `*Progress*\n` +
        `*/leaderboard [group|global] [weekly]* — top players\n` +
        `*/stats* — your stats | */achievements* — your badges | */levels* — your levels by category\n\n` +
        `*Info*\n` +
        `*/categories* — topics you can play | */settings* — this chat's defaults\n` +
        `*/help* | */about* | */ping*\n` +
        adminCommand +
        `\n` +
        `Examples: */play sports hard 10*, */play group:entertainment*, */play art tag:renaissance*`,
    );
  }

  private async sendAbout(chatId: string): Promise<void> {
    await this.transport.sendText(
      chatId,
      `ℹ️ *${config.botName} v${APP_VERSION}*\n` +
        `A trivia game for WhatsApp — solo or group play, daily challenges, leaderboards and achievements.\n\n` +
        `Questions come from a live trivia service with backups, so the game keeps going even if one is down.\n` +
        `This runs over an unofficial WhatsApp connection, so please use a dedicated number and avoid sending it to people who haven't asked for it.\n\n` +
        `👤 Built by Rohan Dayaram\n` +
        `🔗 https://rohandayaram.co.za/`,
    );
  }

  private async sendEgg(chatId: string): Promise<void> {
    await this.transport.sendText(
      chatId,
      '🕶️ *Wake up, Neo…*\nThe Matrix has you.\nFollow the white rabbit.\n\n💊 Reply with *red pill* or *blue pill*.',
    );
  }

  private async sendRedPill(chatId: string): Promise<void> {
    await this.transport.sendText(
      chatId,
      '💊🔴 *You chose the red pill.*\nReality dissolves into green code.\n🕶️ You can now see the truth behind every trivia question.\n\nType */play* to test your abilities.',
    );
  }

  private async sendBluePill(chatId: string): Promise<void> {
    await this.transport.sendText(
      chatId,
      '💊🔵 *You chose the blue pill.*\nYou wake up in bed. Everything seems normal… except your phone says: “Want to play trivia?”\n\nType */play*.',
    );
  }

  private async sendGlitch(chatId: string): Promise<void> {
    await this.transport.sendText(
      chatId,
      '⚠️ `SYSTEM ANOMALY DETECTED`\n`ERROR: REALITY.MATRIX CORRUPTED`\n👤 Agent Smith detected\n🏃 Run */play* to escape\n🐇 Follow */egg* for answers',
    );
  }

  private handleConnectionState(state: ConnectionState): void {
    this.whatsappState = state;
    if (state === 'connected') {
      void this.engine.resumeRecoveredGames().catch((error) => {
        this.recordError(error, 'Could not resume recovered games');
      });
    }
  }

  private consumeCooldown(key: string, durationMs: number): boolean {
    const now = Date.now();
    const until = this.commandCooldowns.get(key) ?? 0;
    if (until > now) return false;
    this.commandCooldowns.set(key, now + durationMs);
    if (this.commandCooldowns.size > 10_000) {
      for (const [item, expiry] of this.commandCooldowns) {
        if (expiry <= now) this.commandCooldowns.delete(item);
      }
    }
    return true;
  }

  private recordError(error: unknown, message: string, context?: IncomingMessage): void {
    const at = Date.now();
    this.lastErrorAt = at;
    this.recentErrors.push({ at, label: message });
    if (this.recentErrors.length > 5) this.recentErrors.shift();
    logger.error(
      {
        err: error,
        ...(context ? { chatId: context.chatId, messageId: context.messageId, senderId: context.senderId } : {}),
      },
      message,
    );
  }
}

function parsePlayOptions(
  args: string[],
  settings: ChatSettings,
  forcedMode: PlayOptions['mode'],
): PlayOptions {
  let mode = forcedMode;
  let questions = forcedMode === 'daily' || forcedMode === 'sprint' ? 5 : settings.questionsPerGame;
  let difficulty = settings.defaultDifficulty;
  let category = settings.defaultCategory;
  let categories: string[] | null = null;
  const tags: string[] = [];
  const groups = { ...CATEGORY_GROUPS, ...settings.customGroups };

  for (const original of args) {
    const token = original.toLowerCase();
    if (token === 'sprint' || token === 'daily' || token === 'classic') {
      mode = token;
      if (token === 'sprint' || token === 'daily') questions = 5;
      continue;
    }
    if (isDifficulty(token)) {
      difficulty = token;
      continue;
    }
    const numeric = Number.parseInt(token, 10);
    if (/^\d+$/.test(token) && Number.isFinite(numeric) && mode !== 'daily') {
      questions = clamp(numeric, 3, 30);
      continue;
    }
    const tagValue = token.startsWith('tag:') ? token.slice(4) : token.startsWith('tags:') ? token.slice(5) : null;
    if (tagValue) {
      tags.push(...tagValue.split(',').map((value) => value.trim()).filter(Boolean));
      continue;
    }
    const groupKey = token.startsWith('group:') ? token.slice(6) : null;
    if (groupKey && groups[groupKey]?.categories.length) {
      // Draw questions from every category in the mix, rather than picking one at random.
      categories = groups[groupKey]!.categories;
      category = null;
      continue;
    }
    const matchedCategory = categoryByKey(token);
    if (matchedCategory) {
      category = matchedCategory.key;
      categories = null;
    }
  }
  if (mode === 'daily') {
    questions = 5;
    difficulty = 'mixed';
    category = null;
    categories = null;
    tags.length = 0;
  }
  return { mode, questions, difficulty, category, categories, tags: tags.length ? tags : null };
}

const SET_FIELD_LABELS: Record<string, string> = {
  questions: 'Questions per game',
  timeout: 'Time per question',
  delay: 'Pause before next question',
  revealdelay: 'Pause before next question',
  difficulty: 'Difficulty',
  category: 'Category',
  cooldown: 'Repeat-question cooldown',
  questioncooldown: 'Repeat-question cooldown',
  hints: 'Hints',
  roundscores: 'Round standings',
  roundstandings: 'Round standings',
};

function isDifficulty(value: string): value is Difficulty {
  return value === 'mixed' || value === 'easy' || value === 'medium' || value === 'hard';
}

function parseOnOff(value: string): boolean {
  if (['on', 'true', 'yes', '1'].includes(value)) return true;
  if (['off', 'false', 'no', '0'].includes(value)) return false;
  throw new Error('Value must be on or off');
}

function parseCooldownHours(value: string): number {
  if (['off', 'none', 'disabled'].includes(value)) return 0;
  const match = value.match(/^(\d+)(h|d)?$/);
  if (!match) throw new Error('Cooldown must be hours, such as 24 or 24h, days such as 7d, or off');
  const amount = Number.parseInt(match[1]!, 10);
  const hours = match[2] === 'd' ? amount * 24 : amount;
  if (hours < 0 || hours > 4320) throw new Error('Cooldown must be between 0 and 180 days');
  return hours;
}

function connectionStateLabel(state: ConnectionState): string {
  switch (state) {
    case 'connected': return 'WhatsApp is connected ✅';
    case 'connecting': return 'WhatsApp is connecting…';
    case 'starting': return 'WhatsApp is starting up…';
    case 'disconnected': return 'WhatsApp is disconnected ⚠️';
    case 'logged_out': return 'WhatsApp is logged out ⚠️ (needs re-linking)';
    default: return `WhatsApp: ${state}`;
  }
}

function formatCooldown(hours: number): string {
  if (hours <= 0) return 'off';
  if (hours % 24 === 0) {
    const days = hours / 24;
    return `${days} day${days === 1 ? '' : 's'}`;
  }
  return `${hours} hour${hours === 1 ? '' : 's'}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
