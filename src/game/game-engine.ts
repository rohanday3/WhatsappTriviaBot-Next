import { randomInt } from 'node:crypto';
import { config } from '../config.js';
import { Repository } from '../db/repository.js';
import { logger } from '../logger.js';
import type { ActiveGame, PlayOptions, Player, TriviaQuestion } from '../types.js';
import { KeyedQueue } from '../util/keyed-queue.js';
import { answerIndex, answerLetter, formatDuration } from '../util/text.js';
import { QuestionProvider } from '../trivia/question-provider.js';
import { ACHIEVEMENTS, checkAnswerAchievements, checkGameAchievements } from './achievements.js';
import { difficultyWeightsForCorrect, splitCountByWeights, type DifficultyWeights } from './difficulty.js';
import { scoreAnswer } from './scoring.js';

/** Duel ends as soon as either player reaches this many correct answers, rather than a fixed question count. */
const DUEL_WIN_CORRECT_ANSWERS = 5;

const MODE_LABELS: Record<ActiveGame['mode'], string> = {
  classic: 'Classic',
  sprint: 'Sprint',
  daily: 'Daily Run',
  rapidfire: 'Rapid Fire',
  zen: 'Zen',
  survival: 'Survival',
  duel: 'Duel',
};

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
        if (game.phase === 'open' && game.mode === 'zen') {
          await this.sendText(game.chatId, `🔄 *Game resumed*\n${this.formatQuestion(game, 0)}`);
        } else if (game.phase === 'open') {
          if ((game.questionDeadlineAt ?? 0) <= Date.now()) {
            await this.revealQuestion(game, '⏱️ Time ran out on that question while the bot was briefly offline.');
          } else {
            const remaining = Math.max(1, Math.ceil(((game.questionDeadlineAt ?? 0) - Date.now()) / 1000));
            await this.sendText(
              game.chatId,
              `🔄 *Game resumed*\n${this.formatQuestion(game, remaining)}`,
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
        await this.sendText(chatId, '🚦 Too many games are running right now. Please try again in a moment.');
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
      const tagLabel = options.tags?.length ? `(tag: ${options.tags.join(', ')}) ` : '';
      await this.sendText(chatId, `🧠 Preparing fresh ${categoryLabel}${tagLabel}questions…`);
      const excluded = this.repository.recentQuestionHashes(
        chatId,
        settings.questionCooldownHours,
      );
      let questionSet: TriviaQuestion[];
      try {
        questionSet = await this.fetchQuestionSet(options, excluded, player.id);
      } catch (error) {
        const detail = error instanceof Error ? error.message : 'Questions are unavailable';
        await this.sendText(chatId, `⚠️ ${detail}`);
        return;
      }
      if (questionSet.length < options.questions) {
        await this.sendText(
          chatId,
          `ℹ️ Starting with *${questionSet.length}* questions instead of *${options.questions}* — ` +
            `that's all the fresh, matching ones available right now.`,
        );
      }
      const timeoutSeconds = options.mode === 'sprint'
        ? Math.min(12, settings.timeoutSeconds)
        : options.mode === 'rapidfire'
          ? Math.min(7, settings.timeoutSeconds)
          : settings.timeoutSeconds;
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
        eliminatedPlayerIds: new Set(),
        timer: null,
      };
      this.games.set(chatId, game);
      const modeName = MODE_LABELS[options.mode];
      const modeBlurb = options.mode === 'survival'
        ? '\n• One wrong answer and you\'re out'
        : options.mode === 'duel'
          ? `\n• First to ${DUEL_WIN_CORRECT_ANSWERS} correct answers wins`
          : '';
      const paceLine = isGroup
        ? '• Everyone in the group can join by answering'
        : options.mode === 'zen'
          ? '• Take your time — there is no speed bonus'
          : '• Faster correct answers earn more points';
      await this.sendText(
        chatId,
        `🎮 *${modeName} game started!*\n` +
          `• ${questionSet.length} questions\n` +
          `• ${options.mode === 'zen' ? 'No time limit' : `${timeoutSeconds}s per question`}\n` +
          `• Reply with A, B, C or D` +
          modeBlurb +
          `\n${paceLine}`,
      );
      await this.openQuestion(game);
    });
  }

  private async fetchQuestionSet(
    options: PlayOptions,
    excluded: Set<string>,
    hostPlayerId: number,
  ): Promise<TriviaQuestion[]> {
    const categories = options.categories?.length ? options.categories : null;
    const singleCategory = categories && categories.length === 1
      ? categories[0] ?? null
      : categories
        ? null
        : options.category;
    const tags = options.tags ?? null;
    const weights = options.difficulty === 'adaptive'
      ? difficultyWeightsForCorrect(this.repository.difficultyLevelCorrectCount(hostPlayerId, singleCategory))
      : null;

    if (!categories || categories.length <= 1) {
      const category = categories?.[0] ?? options.category;
      if (weights) return this.fetchAdaptiveBatch(weights, options.questions, category, tags, excluded);
      return this.questions.getQuestions({
        count: options.questions,
        category,
        difficulty: options.difficulty,
        excludeHashes: excluded,
        tags,
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
        const batch = weights
          ? await this.fetchAdaptiveBatch(weights, want, category, tags, seen)
          : await this.questions.getQuestions({
              count: want,
              category,
              difficulty: options.difficulty,
              excludeHashes: seen,
              tags,
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

  /** Splits `count` across easy/medium/hard per `weights` and fetches each tier separately, so the level-based mix is exact. */
  private async fetchAdaptiveBatch(
    weights: DifficultyWeights,
    count: number,
    category: string | null,
    tags: string[] | null,
    excluded: Set<string>,
  ): Promise<TriviaQuestion[]> {
    const counts = splitCountByWeights(count, weights);
    const seen = new Set(excluded);
    const collected: TriviaQuestion[] = [];
    for (const difficulty of ['easy', 'medium', 'hard'] as const) {
      const want = counts[difficulty];
      if (want <= 0) continue;
      try {
        const batch = await this.questions.getQuestions({
          count: want,
          category,
          difficulty,
          excludeHashes: seen,
          tags,
        });
        for (const question of batch.slice(0, want)) {
          seen.add(question.hash);
          collected.push(question);
        }
      } catch (error) {
        logger.warn({ err: error, category, difficulty }, 'Skipping an adaptive difficulty tier with too few fresh questions');
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
      if (game.mode === 'survival' && game.eliminatedPlayerIds.has(player.id)) {
        await this.sendText(chatId, `💀 ${player.displayName}, you're already eliminated from this Survival round.`);
        return true;
      }
      if (game.mode === 'duel') {
        const roster = this.repository.getGameScores(game.id).map((entry) => entry.playerId);
        if (roster.length >= 2 && !roster.includes(player.id)) {
          await this.sendText(chatId, `🔒 This Duel is already between the first two players. Start a new game to join in.`);
          return true;
        }
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
        // Zen has no timer to fall back on, so it must reveal as soon as at least one
        // answer is in rather than waiting for expectedAnswererCount (which starts at 0
        // on the first question, since there is no prior round to compare against).
        const revealThreshold = game.mode === 'zen' ? Math.max(1, game.expectedAnswererCount) : game.expectedAnswererCount;
        if (revealThreshold > 0 && game.answeredPlayerIds.size >= revealThreshold) {
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
    // Zen has no timeout, so there is nothing to schedule — the round only ends when
    // an answer comes in (see the early-reveal check in answer()).
    if (game.mode !== 'zen') this.scheduleReveal(game, game.timeoutSeconds * 1000);
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
      `${game.mode === 'zen' ? '⏱️ No time limit' : `⏱️ ${seconds}s`}\n\n` +
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
    // Survival eliminations are only decided at reveal time, alongside the correct answer,
    // so a wrong "locked in" message can never leak that a player is about to be eliminated.
    const eliminatedNow = game.mode === 'survival'
      ? round.filter((item) => !item.isCorrect && !game.eliminatedPlayerIds.has(item.playerId))
      : [];
    for (const item of eliminatedNow) game.eliminatedPlayerIds.add(item.playerId);
    const lines = [
      prefix,
      `✅ *Answer: ${answerLetter(question.correctIndex)}) ${question.options[question.correctIndex]}*`,
      game.isGroup
        ? correct.length
          ? `\n⚡ *Fastest correct*\n${fastest.join('\n')}`
          : '\nNo correct answers this round.'
        : '',
      eliminatedNow.length ? `\n💀 *Eliminated*\n${eliminatedNow.map((item) => item.name).join(', ')}` : '',
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
    if (this.shouldEndEarly(game)) {
      await this.finishGame(game);
      return;
    }
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

  /** Survival and Duel can end a game before every fetched question is used up. */
  private shouldEndEarly(game: ActiveGame): boolean {
    if (game.mode === 'survival') {
      const roster = this.repository.getGameScores(game.id);
      return roster.length > 0 && roster.every((entry) => game.eliminatedPlayerIds.has(entry.playerId));
    }
    if (game.mode === 'duel') {
      return this.repository.getGameScores(game.id).some((entry) => entry.correct >= DUEL_WIN_CORRECT_ANSWERS);
    }
    return false;
  }

  private async finishGame(game: ActiveGame): Promise<void> {
    this.clearTimer(game);
    game.phase = 'finished';
    game.status = 'completed';
    const results = this.repository.completeGame(game);
    this.games.delete(game.chatId);
    if (!results.length) return;
    const scores = this.repository.getGameScores(game.id);
    // Survival/Duel can finish before every fetched question is used, so "how many
    // questions were actually played" is derived from where the game stopped rather
    // than the full fetched set (which is what perfect_game/perfect_10 compare against).
    const totalQuestionsPlayed = Math.min(game.currentIndex + 1, game.questions.length);
    const achievementMessages: string[] = [];
    for (const result of results) {
      const score = scores.find((item) => item.playerId === result.playerId);
      const unlocked = checkGameAchievements(
        this.repository,
        result.playerId,
        game.id,
        result.rank === 1,
        score?.correct ?? 0,
        totalQuestionsPlayed,
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
