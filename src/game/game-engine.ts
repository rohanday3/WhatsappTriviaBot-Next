import { randomInt } from 'node:crypto';
import { config } from '../config.js';
import { Repository } from '../db/repository.js';
import { logger } from '../logger.js';
import type { ActiveGame, PlayOptions, Player, TriviaQuestion } from '../types.js';
import { KeyedQueue } from '../util/keyed-queue.js';
import { answerIndex, answerLetter, formatDuration } from '../util/text.js';
import { QuestionProvider } from '../trivia/question-provider.js';
import { ACHIEVEMENTS, checkAnswerAchievements, checkGameAchievements } from './achievements.js';
import { scoreAnswer } from './scoring.js';

export class GameEngine {
  private readonly games = new Map<string, ActiveGame>();
  private readonly recoveredGameIds = new Set<string>();
  private readonly queue = new KeyedQueue(100);

  constructor(
    private readonly repository: Repository,
    private readonly questions: QuestionProvider,
    private readonly sendText: (chatId: string, text: string) => Promise<void>,
  ) {}

  initialize(): void {
    for (const game of this.repository.loadActiveGames()) {
      this.games.set(game.chatId, game);
      this.recoveredGameIds.add(game.id);
    }
    logger.info({ recoveredGames: this.recoveredGameIds.size }, 'Game engine ready');
  }

  get activeGameCount(): number {
    return this.games.size;
  }

  get queueStats(): { activeKeys: number; pendingTasks: number; maxDepth: number } {
    return this.queue.stats;
  }

  gameForChat(chatId: string): ActiveGame | null {
    return this.games.get(chatId) ?? null;
  }

  async resumeRecoveredGames(): Promise<void> {
    const recovered = [...this.games.values()].filter((game) => this.recoveredGameIds.has(game.id));
    this.recoveredGameIds.clear();
    for (const game of recovered) {
      void this.queue.run(game.chatId, async () => {
        if (game.phase === 'open') {
          if ((game.questionDeadlineAt ?? 0) <= Date.now()) {
            await this.revealQuestion(game, '⏱️ The question expired while the bot was reconnecting.');
          } else {
            const remaining = Math.max(1, Math.ceil(((game.questionDeadlineAt ?? 0) - Date.now()) / 1000));
            await this.sendText(
              game.chatId,
              `🔄 *Game recovered after restart*\n${this.formatQuestion(game, remaining)}`,
            );
            this.scheduleReveal(game, remaining * 1000);
          }
        } else if (game.phase === 'revealing') {
          await this.advance(game);
        } else if (game.phase === 'waiting') {
          await this.openQuestion(game);
        } else if (game.currentIndex >= game.questions.length) {
          await this.finishGame(game);
        }
      });
    }
  }

  startGame(
    chatId: string,
    isGroup: boolean,
    player: Player,
    options: PlayOptions,
    dailyDate?: string,
  ): Promise<void> {
    return this.queue.run(chatId, async () => {
      if (this.games.has(chatId) || this.repository.activeGameForChat(chatId)) {
        await this.sendText(chatId, '🎮 A game is already running here. Use */score* or */stop*.');
        return;
      }
      if (this.games.size >= config.maxConcurrentGames) {
        await this.sendText(chatId, '🚦 The bot is at its concurrent game limit. Please try again shortly.');
        return;
      }
      if (options.mode === 'daily' && dailyDate && this.repository.hasDailyAttempt(dailyDate, player.id)) {
        await this.sendText(chatId, '📅 You have already completed today’s Daily Run. Come back tomorrow!');
        return;
      }

      const settings = this.repository.getSettings(chatId);
      const categoryLabel = options.category
        ? `*${options.category}* `
        : options.categories?.length
          ? `*${options.categories.join('/')}* mix `
          : '';
      await this.sendText(chatId, `🧠 Preparing fresh ${categoryLabel}questions…`);
      const excluded = this.repository.recentQuestionHashes(
        chatId,
        settings.questionCooldownHours,
      );
      let questionSet: TriviaQuestion[];
      try {
        questionSet = await this.fetchQuestionSet(options, excluded);
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Questions are unavailable';
        await this.sendText(chatId, `⚠️ ${detail}`);
        return;
      }
      if (questionSet.length < options.questions) {
        await this.sendText(
          chatId,
          `ℹ️ Starting with *${questionSet.length}* matching fresh questions instead of ` +
            `*${options.questions}*; no unrelated or cooldown-blocked questions were added.`,
        );
      }
      const timeoutSeconds = options.mode === 'sprint' ? Math.min(12, settings.timeoutSeconds) : settings.timeoutSeconds;
      const gameId = this.repository.createGame({
        chatId,
        isGroup,
        hostPlayerId: player.id,
        mode: options.mode,
        category: options.category,
        difficulty: options.difficulty,
        timeoutSeconds,
        revealDelayMs: settings.revealDelayMs,
        hintsEnabled: settings.hintsEnabled,
        questions: questionSet,
        ...(dailyDate ? { dailyDate } : {}),
      });
      const game: ActiveGame = {
        id: gameId,
        chatId,
        isGroup,
        hostPlayerId: player.id,
        mode: options.mode,
        status: 'active',
        phase: 'waiting',
        questions: questionSet,
        currentIndex: 0,
        questionOpenedAt: null,
        questionDeadlineAt: null,
        timeoutSeconds,
        revealDelayMs: settings.revealDelayMs,
        hintsEnabled: settings.hintsEnabled,
        answeredPlayerIds: new Set(),
        hintedPlayerIds: new Set(),
        pendingAchievements: new Map(),
        expectedAnswererCount: 0,
        timer: null,
      };
      this.games.set(chatId, game);
      const modeName = options.mode === 'sprint' ? 'Sprint' : options.mode === 'daily' ? 'Daily Run' : 'Classic';
      await this.sendText(
        chatId,
        `🎮 *${modeName} game started!*\n` +
          `• ${questionSet.length} questions\n` +
          `• ${timeoutSeconds}s per question\n` +
          `• Reply with A, B, C or D\n` +
          `${isGroup ? '• Everyone in the group can join by answering' : '• Faster correct answers earn more points'}`,
      );
      await this.openQuestion(game);
    });
  }

  private async fetchQuestionSet(
    options: PlayOptions,
    excluded: Set<string>,
  ): Promise<TriviaQuestion[]> {
    const categories = options.categories?.length ? options.categories : null;
    if (!categories || categories.length <= 1) {
      return this.questions.getQuestions({
        count: options.questions,
        category: categories?.[0] ?? options.category,
        difficulty: options.difficulty,
        excludeHashes: excluded,
      });
    }
    const perCategory = Math.floor(options.questions / categories.length);
    const remainder = options.questions - perCategory * categories.length;
    const seen = new Set(excluded);
    const collected: TriviaQuestion[] = [];
    for (const [index, category] of categories.entries()) {
      const want = perCategory + (index < remainder ? 1 : 0);
      if (want <= 0) continue;
      try {
        const batch = await this.questions.getQuestions({
          count: want,
          category,
          difficulty: options.difficulty,
          excludeHashes: seen,
        });
        for (const question of batch.slice(0, want)) {
          seen.add(question.hash);
          collected.push(question);
        }
      } catch (error) {
        logger.warn({ err: error, category }, 'Skipping a category mix entry with too few fresh questions');
      }
    }
    shuffleInPlace(collected);
    return collected;
  }

  answer(chatId: string, player: Player, rawAnswer: string): Promise<boolean> {
    return this.queue.run(chatId, async () => {
      const game = this.games.get(chatId);
      if (!game || game.phase !== 'open') return false;
      const question = game.questions[game.currentIndex];
      if (!question) return false;
      const selected = answerIndex(rawAnswer, question.options.length);
      if (selected === null) return false;
      if (game.answeredPlayerIds.has(player.id) || this.repository.hasAnswered(game.id, game.currentIndex, player.id)) {
        await this.sendText(chatId, `🔒 ${player.displayName}, your answer is already locked in.`);
        return true;
      }
      const openedAt = game.questionOpenedAt ?? Date.now();
      const responseMs = Math.max(0, Date.now() - openedAt);
      const correct = selected === question.correctIndex;
      const usedHint = game.hintedPlayerIds.has(player.id);
      const points = correct ? scoreAnswer({ game, question, responseMs, usedHint }) : 0;
      const inserted = this.repository.recordAnswer({
        game,
        playerId: player.id,
        answerIndex: selected,
        isCorrect: correct,
        responseMs,
        points,
      });
      if (!inserted) return true;
      game.answeredPlayerIds.add(player.id);
      const unlocked = checkAnswerAchievements(
        this.repository,
        player.id,
        game.id,
        correct,
        responseMs,
      );

      if (game.isGroup) {
        // Achievements like "first correct" or a streak are only unlocked when the
        // answer was correct, so announcing them now would leak the correct answer
        // before the reveal. Stash them and announce alongside the reveal instead.
        if (unlocked.length) game.pendingAchievements.set(player.id, unlocked);
        await this.sendText(chatId, `🔒 ${player.displayName} locked in an answer.`);
        if (game.expectedAnswererCount > 0 && game.answeredPlayerIds.size >= game.expectedAnswererCount) {
          await this.revealQuestion(game);
        }
      } else {
        await this.sendText(
          chatId,
          `${correct ? `✅ Correct! *+${points} points*` : '❌ Answer locked in.'}` +
            `${unlocked.length ? `\n${formatAchievements(unlocked)}` : ''}`,
        );
        await this.revealQuestion(game);
      }
      return true;
    });
  }

  hint(chatId: string, player: Player): Promise<void> {
    return this.queue.run(chatId, async () => {
      const game = this.games.get(chatId);
      if (!game || game.phase !== 'open') {
        await this.sendText(chatId, '💡 There is no open question right now.');
        return;
      }
      if (game.isGroup) {
        await this.sendText(chatId, '💡 Hints are only available in one-player games. In a group, the clue would be shown to every player.');
        return;
      }
      if (!game.hintsEnabled) {
        await this.sendText(chatId, '💡 Hints are disabled for this chat.');
        return;
      }
      if (game.hintedPlayerIds.has(player.id)) {
        await this.sendText(chatId, '💡 You already used a hint on this question.');
        return;
      }
      const question = game.questions[game.currentIndex];
      if (!question) return;
      if (question.options.length < 4) {
        await this.sendText(chatId, '💡 A hint is not available for two-choice questions because it would reveal the answer.');
        return;
      }
      const wrong = question.options
        .map((_, index) => index)
        .filter((index) => index !== question.correctIndex);
      const removed = new Set<number>();
      while (removed.size < Math.min(2, wrong.length)) removed.add(wrong[randomInt(wrong.length)]!);
      const remaining = question.options
        .map((option, index) => ({ option, index }))
        .filter(({ index }) => !removed.has(index))
        .map(({ option, index }) => `${answerLetter(index)}) ${option}`)
        .join('\n');
      game.hintedPlayerIds.add(player.id);
      this.repository.markHintUsed(game.id, player.id);
      await this.sendText(chatId, `💡 *Hint* — two wrong options removed (25% point penalty)\n${remaining}`);
    });
  }

  stopGame(chatId: string): Promise<boolean> {
    return this.queue.run(chatId, async () => {
      const game = this.games.get(chatId);
      if (!game) return false;
      this.clearTimer(game);
      this.repository.stopGame(game.id);
      this.games.delete(chatId);
      await this.sendText(chatId, '🛑 Game stopped. Type */play* whenever you are ready again.');
      return true;
    });
  }

  skipQuestion(chatId: string): Promise<boolean> {
    return this.queue.run(chatId, async () => {
      const game = this.games.get(chatId);
      if (!game || game.phase !== 'open') return false;
      await this.revealQuestion(game, '⏭️ The host skipped this question.');
      return true;
    });
  }

  currentScore(chatId: string): string | null {
    const game = this.games.get(chatId);
    if (!game) return null;
    const scores = this.repository.getGameScores(game.id);
    if (!scores.length) return '📊 No answers have been recorded yet.';
    return formatStandings(scores, '📊 *Current standings*');
  }

  private async openQuestion(game: ActiveGame): Promise<void> {
    if (game.status !== 'active') return;
    if (game.currentIndex >= game.questions.length) {
      await this.finishGame(game);
      return;
    }
    const openedAt = Date.now();
    const deadlineAt = openedAt + game.timeoutSeconds * 1000;
    game.phase = 'open';
    game.questionOpenedAt = openedAt;
    game.questionDeadlineAt = deadlineAt;
    game.answeredPlayerIds.clear();
    game.hintedPlayerIds.clear();
    game.pendingAchievements.clear();
    // Reveal early once everyone who answered the previous question has answered this
    // one too, instead of always waiting for the full timeout. There is no prior round
    // to compare against for the first question, so it always runs the full timeout.
    game.expectedAnswererCount = game.isGroup && game.currentIndex > 0
      ? this.repository.getRoundResults(game.id, game.currentIndex - 1).length
      : 0;
    this.repository.setQuestionOpen(game.id, game.currentIndex, openedAt, deadlineAt);
    await this.sendText(game.chatId, this.formatQuestion(game, game.timeoutSeconds));
    this.scheduleReveal(game, game.timeoutSeconds * 1000);
  }

  private formatQuestion(game: ActiveGame, seconds: number): string {
    const question = game.questions[game.currentIndex];
    if (!question) return 'Question unavailable.';
    const options = question.options
      .map((option, index) => `${answerLetter(index)}) ${option}`)
      .join('\n');
    return (
      `❓ *Question ${game.currentIndex + 1}/${game.questions.length}*\n` +
      `_${question.category} • ${question.difficulty.toUpperCase()}_\n` +
      `⏱️ ${seconds}s\n\n` +
      `*${question.prompt}*\n\n${options}` +
      `${!game.isGroup && game.hintsEnabled && question.options.length >= 4 ? '\n\nType */hint* to remove two wrong options (25% point penalty).' : ''}`
    );
  }

  private scheduleReveal(game: ActiveGame, delayMs: number): void {
    this.clearTimer(game);
    game.timer = setTimeout(() => {
      void this.queue.run(game.chatId, async () => {
        const current = this.games.get(game.chatId);
        if (current?.id === game.id && current.phase === 'open') await this.revealQuestion(current);
      });
    }, Math.max(1, delayMs));
    game.timer.unref();
  }

  private async revealQuestion(game: ActiveGame, prefix?: string): Promise<void> {
    if (game.phase !== 'open') return;
    this.clearTimer(game);
    game.phase = 'revealing';
    this.repository.setQuestionRevealing(game.id, game.currentIndex);
    const question = game.questions[game.currentIndex];
    if (!question) return;
    const round = this.repository.getRoundResults(game.id, game.currentIndex);
    const correct = round.filter((item) => item.isCorrect);
    const fastest = correct.slice(0, 3).map((item, index) => {
      const medal = ['🥇', '🥈', '🥉'][index] ?? '•';
      return `${medal} ${item.name} +${item.points} (${formatDuration(item.responseMs)})`;
    });
    const achievementLines = round
      .filter((item) => game.pendingAchievements.has(item.playerId))
      .map((item) => `🏅 ${item.name}: ${formatAchievements(game.pendingAchievements.get(item.playerId)!)}`);
    game.pendingAchievements.clear();
    const lines = [
      prefix,
      `✅ *Answer: ${answerLetter(question.correctIndex)}) ${question.options[question.correctIndex]}*`,
      game.isGroup
        ? correct.length
          ? `\n⚡ *Fastest correct*\n${fastest.join('\n')}`
          : '\nNo correct answers this round.'
        : '',
      achievementLines.length ? `\n${achievementLines.join('\n')}` : '',
    ].filter(Boolean);
    if (game.isGroup && this.repository.getSettings(game.chatId).showRoundLeaderboard) {
      const standings = this.repository.getGameScores(game.id).slice(0, 5);
      if (standings.length) lines.push(`\n${formatStandings(standings, '📊 *Standings*')}`);
    }
    await this.sendText(game.chatId, lines.join('\n'));

    game.timer = setTimeout(() => {
      void this.queue.run(game.chatId, () => this.advance(game));
    }, game.revealDelayMs);
    game.timer.unref();
  }

  private async advance(game: ActiveGame): Promise<void> {
    const current = this.games.get(game.chatId);
    if (!current || current.id !== game.id || current.phase !== 'revealing') return;
    game.currentIndex += 1;
    if (game.currentIndex >= game.questions.length) {
      await this.finishGame(game);
      return;
    }
    game.phase = 'waiting';
    game.questionOpenedAt = null;
    game.questionDeadlineAt = null;
    this.repository.setWaiting(game.id, game.currentIndex);
    await this.openQuestion(game);
  }

  private async finishGame(game: ActiveGame): Promise<void> {
    this.clearTimer(game);
    game.phase = 'finished';
    game.status = 'completed';
    const results = this.repository.completeGame(game);
    this.games.delete(game.chatId);
    if (!results.length) return;
    const scores = this.repository.getGameScores(game.id);
    const achievementMessages: string[] = [];
    for (const result of results) {
      const score = scores.find((item) => item.playerId === result.playerId);
      const unlocked = checkGameAchievements(
        this.repository,
        result.playerId,
        game.id,
        result.rank === 1,
        score?.correct ?? 0,
        game.questions.length,
      );
      if (unlocked.length) achievementMessages.push(`${result.name}: ${formatAchievements(unlocked)}`);
    }
    const podium = results.slice(0, 10).map((entry) => {
      const medal = ['🥇', '🥈', '🥉'][entry.rank - 1] ?? `${entry.rank}.`;
      return `${medal} ${entry.name} — *${entry.score} pts*`;
    });
    await this.sendText(
      game.chatId,
      `🏁 *Game complete!*\n\n${podium.join('\n')}` +
        `${achievementMessages.length ? `\n\n🏅 *Achievements*\n${achievementMessages.join('\n')}` : ''}` +
        '\n\nType */play* for a rematch.',
    );
  }

  private clearTimer(game: ActiveGame): void {
    if (game.timer) clearTimeout(game.timer);
    game.timer = null;
  }
}

function formatStandings(
  scores: Array<{ name: string; score: number; correct: number }>,
  title: string,
): string {
  return `${title}\n${scores
    .slice(0, 10)
    .map((item, index) => `${index + 1}. ${item.name} — *${item.score}* (${item.correct} correct)`)
    .join('\n')}`;
}

function formatAchievements(keys: string[]): string {
  return keys
    .map((key) => {
      const achievement = ACHIEVEMENTS[key];
      return achievement ? `${achievement.icon} *${achievement.name} unlocked!*` : key;
    })
    .join(' ');
}

function shuffleInPlace<T>(items: T[]): void {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
}
