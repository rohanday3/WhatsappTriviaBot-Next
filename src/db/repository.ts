import { randomUUID } from 'node:crypto';
import type { SQLInputValue } from 'node:sqlite';
import { config } from '../config.js';
import type {
  ActiveGame,
  CachedTriviaQuestion,
  ChatSettings,
  Difficulty,
  GameMode,
  LeaderboardEntry,
  Player,
  TriviaQuestion,
  TriviaSource,
} from '../types.js';
import { safeName } from '../util/text.js';
import { categoryByKey } from '../trivia/catalog.js';
import { Database } from './database.js';

interface PlayerRow extends Record<string, unknown> {
  id: number;
  jid: string;
  display_name: string;
}

interface GameRow extends Record<string, unknown> {
  id: string;
  chat_id: string;
  is_group: number;
  host_player_id: number;
  mode: GameMode;
  status: 'active';
  phase: ActiveGame['phase'];
  current_question_index: number;
  timeout_seconds: number;
  reveal_delay_ms: number;
  hints_enabled: number;
  question_opened_at: number | null;
  question_deadline_at: number | null;
}

interface QuestionRow extends Record<string, unknown> {
  source_id: string;
  category: string;
  difficulty: 'easy' | 'medium' | 'hard';
  prompt: string;
  options_json: string;
  correct_index: number;
  question_hash: string;
}

interface CachedQuestionRow extends Record<string, unknown> {
  question_hash: string;
  source_id: string;
  source: TriviaSource;
  category: string;
  difficulty: 'easy' | 'medium' | 'hard';
  prompt: string;
  options_json: string;
  correct_index: number;
  category_keys: string | null;
  tags: string | null;
}

const DEFAULT_SETTINGS: ChatSettings = {
  questionsPerGame: config.defaultQuestions,
  timeoutSeconds: config.defaultTimeoutSeconds,
  revealDelayMs: config.defaultRevealDelayMs,
  defaultDifficulty: 'mixed',
  defaultCategory: null,
  questionCooldownHours: config.defaultQuestionCooldownHours,
  showRoundLeaderboard: true,
  hintsEnabled: true,
  customGroups: {},
};

export class Repository {
  constructor(readonly db: Database) {}

  isMessageProcessed(messageId: string, receivedAt = Date.now()): boolean {
    const result = this.db.run(
      'INSERT OR IGNORE INTO processed_messages(message_id, received_at) VALUES (?, ?)',
      [messageId, receivedAt],
    );
    return Number(result.changes) === 0;
  }

  touchChat(chatId: string, isGroup: boolean, title: string | null = null): void {
    const now = Date.now();
    this.db.run(
      `INSERT INTO chats(id, kind, title, created_at, updated_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         kind = excluded.kind,
         title = COALESCE(excluded.title, chats.title),
         updated_at = excluded.updated_at,
         last_seen_at = excluded.last_seen_at`,
      [chatId, isGroup ? 'group' : 'direct', title, now, now, now],
    );
  }

  upsertPlayer(jid: string, phoneJid: string | undefined, displayName: string): Player {
    const now = Date.now();
    const name = safeName(displayName);
    const aliases = [jid, phoneJid].filter(Boolean) as string[];
    const existing = this.db.get<PlayerRow & { phone_jid?: string }>(
      `SELECT id, jid, phone_jid, display_name FROM players
       WHERE jid IN (?, ?) OR phone_jid IN (?, ?) LIMIT 1`,
      [aliases[0] ?? '', aliases[1] ?? '', aliases[0] ?? '', aliases[1] ?? ''],
    );
    if (existing) {
      this.db.run(
        `UPDATE players SET
          phone_jid = COALESCE(phone_jid, ?),
          display_name = CASE WHEN ? <> 'Player' THEN ? ELSE display_name END,
          updated_at = ?, last_seen_at = ?
         WHERE id = ?`,
        [phoneJid ?? (jid.endsWith('@s.whatsapp.net') ? jid : null), name, name, now, now, existing.id],
      );
      return { id: existing.id, jid: existing.jid, displayName: name === 'Player' ? existing.display_name : name };
    }
    this.db.run(
      `INSERT INTO players(jid, phone_jid, display_name, created_at, updated_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [jid, phoneJid ?? (jid.endsWith('@s.whatsapp.net') ? jid : null), name, now, now, now],
    );
    const row = this.db.get<PlayerRow>(
      'SELECT id, jid, display_name FROM players WHERE jid = ?',
      [jid],
    );
    if (!row) throw new Error('Failed to create or load player');
    return { id: row.id, jid: row.jid, displayName: row.display_name };
  }

  getPlayerByJid(jid: string): Player | null {
    const row = this.db.get<PlayerRow>(
      'SELECT id, jid, display_name FROM players WHERE jid = ? OR phone_jid = ? LIMIT 1',
      [jid, jid],
    );
    return row ? { id: row.id, jid: row.jid, displayName: row.display_name } : null;
  }

  getSettings(chatId: string): ChatSettings {
    const row = this.db.get<Record<string, unknown>>(
      'SELECT * FROM chat_settings WHERE chat_id = ?',
      [chatId],
    );
    if (!row) return structuredClone(DEFAULT_SETTINGS);
    return {
      questionsPerGame: Number(row.questions_per_game),
      timeoutSeconds: Number(row.timeout_seconds),
      revealDelayMs: Number(row.reveal_delay_ms),
      defaultDifficulty: String(row.default_difficulty) as Difficulty,
      defaultCategory: row.default_category ? String(row.default_category) : null,
      questionCooldownHours: Number(
        row.question_cooldown_hours ?? config.defaultQuestionCooldownHours,
      ),
      showRoundLeaderboard: Boolean(row.show_round_leaderboard),
      hintsEnabled: Boolean(row.hints_enabled),
      customGroups: parseJson<Record<string, { name: string; categories: string[] }>>(
        String(row.custom_groups_json),
        {},
      ),
    };
  }

  saveSettings(chatId: string, settings: ChatSettings): void {
    this.db.run(
      `INSERT INTO chat_settings(
         chat_id, questions_per_game, timeout_seconds, reveal_delay_ms,
         default_difficulty, default_category, question_cooldown_hours,
         show_round_leaderboard, hints_enabled, custom_groups_json, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(chat_id) DO UPDATE SET
         questions_per_game = excluded.questions_per_game,
         timeout_seconds = excluded.timeout_seconds,
         reveal_delay_ms = excluded.reveal_delay_ms,
         default_difficulty = excluded.default_difficulty,
         default_category = excluded.default_category,
         question_cooldown_hours = excluded.question_cooldown_hours,
         show_round_leaderboard = excluded.show_round_leaderboard,
         hints_enabled = excluded.hints_enabled,
         custom_groups_json = excluded.custom_groups_json,
         updated_at = excluded.updated_at`,
      [
        chatId,
        settings.questionsPerGame,
        settings.timeoutSeconds,
        settings.revealDelayMs,
        settings.defaultDifficulty,
        settings.defaultCategory,
        settings.questionCooldownHours,
        settings.showRoundLeaderboard ? 1 : 0,
        settings.hintsEnabled ? 1 : 0,
        JSON.stringify(settings.customGroups),
        Date.now(),
      ],
    );
  }

  activeGameForChat(chatId: string): string | null {
    const row = this.db.get<{ id: string }>(
      "SELECT id FROM games WHERE chat_id = ? AND status = 'active' LIMIT 1",
      [chatId],
    );
    return row?.id ?? null;
  }

  countActiveGames(): number {
    return Number(
      this.db.get<{ count: number }>("SELECT COUNT(*) AS count FROM games WHERE status = 'active'")
        ?.count ?? 0,
    );
  }

  createGame(input: {
    chatId: string;
    isGroup: boolean;
    hostPlayerId: number;
    mode: GameMode;
    category: string | null;
    difficulty: Difficulty;
    timeoutSeconds: number;
    revealDelayMs: number;
    hintsEnabled: boolean;
    questions: TriviaQuestion[];
    dailyDate?: string;
  }): string {
    const id = randomUUID();
    const now = Date.now();
    this.db.transaction(() => {
      this.db.run(
        `INSERT INTO games(
          id, chat_id, is_group, host_player_id, mode, status, phase, category,
          difficulty, total_questions, current_question_index, timeout_seconds,
          reveal_delay_ms, hints_enabled, started_at
        ) VALUES (?, ?, ?, ?, ?, 'active', 'waiting', ?, ?, ?, 0, ?, ?, ?, ?)`,
        [
          id,
          input.chatId,
          input.isGroup ? 1 : 0,
          input.hostPlayerId,
          input.mode,
          input.category,
          input.difficulty,
          input.questions.length,
          input.timeoutSeconds,
          input.revealDelayMs,
          input.hintsEnabled ? 1 : 0,
          now,
        ],
      );
      this.db.run(
        `INSERT INTO game_players(game_id, player_id, joined_at)
         VALUES (?, ?, ?)`,
        [id, input.hostPlayerId, now],
      );
      this.db.run(
        `INSERT OR IGNORE INTO player_chat_stats(chat_id, player_id, updated_at)
         VALUES (?, ?, ?)`,
        [input.chatId, input.hostPlayerId, now],
      );
      const insertQuestion = this.db.raw.prepare(
        `INSERT INTO game_questions(
          game_id, position, source_id, question_hash, category, difficulty,
          prompt, options_json, correct_index
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      input.questions.forEach((question, index) => {
        insertQuestion.run(
          id,
          index,
          question.sourceId,
          question.hash,
          question.category,
          question.difficulty,
          question.prompt,
          JSON.stringify(question.options),
          question.correctIndex,
        );
        this.db.run(
          `INSERT INTO question_history(chat_id, question_hash, last_used_at, times_used)
           VALUES (?, ?, ?, 1)
           ON CONFLICT(chat_id, question_hash) DO UPDATE SET
             last_used_at = excluded.last_used_at,
             times_used = question_history.times_used + 1`,
          [input.chatId, question.hash, now],
        );
      });
      if (input.dailyDate) {
        this.db.run(
          `INSERT INTO daily_attempts(local_date, player_id, game_id, created_at)
           VALUES (?, ?, ?, ?)`,
          [input.dailyDate, input.hostPlayerId, id, now],
        );
      }
    });
    return id;
  }

  loadActiveGames(): ActiveGame[] {
    const games = this.db.all<GameRow>("SELECT * FROM games WHERE status = 'active'");
    return games.map((row) => {
      const questions = this.db
        .all<QuestionRow>(
          'SELECT * FROM game_questions WHERE game_id = ? ORDER BY position',
          [row.id],
        )
        .map(toQuestion);
      const answered = this.db.all<{ player_id: number }>(
        `SELECT player_id FROM answers
         WHERE game_id = ? AND question_position = ?`,
        [row.id, row.current_question_index],
      );
      return {
        id: row.id,
        chatId: row.chat_id,
        isGroup: Boolean(row.is_group),
        hostPlayerId: row.host_player_id,
        mode: row.mode,
        status: row.status,
        phase: row.phase,
        questions,
        currentIndex: row.current_question_index,
        questionOpenedAt: row.question_opened_at,
        questionDeadlineAt: row.question_deadline_at,
        timeoutSeconds: row.timeout_seconds,
        revealDelayMs: row.reveal_delay_ms,
        hintsEnabled: Boolean(row.hints_enabled),
        answeredPlayerIds: new Set(answered.map((item) => item.player_id)),
        hintedPlayerIds: new Set<number>(),
        pendingAchievements: new Map<number, string[]>(),
        expectedAnswererCount: 0,
        timer: null,
      };
    });
  }

  setQuestionOpen(gameId: string, index: number, openedAt: number, deadlineAt: number): void {
    this.db.transaction(() => {
      this.db.run(
        `UPDATE games SET phase = 'open', current_question_index = ?,
          question_opened_at = ?, question_deadline_at = ?
         WHERE id = ? AND status = 'active'`,
        [index, openedAt, deadlineAt, gameId],
      );
      this.db.run(
        'UPDATE game_questions SET opened_at = ? WHERE game_id = ? AND position = ?',
        [openedAt, gameId, index],
      );
    });
  }

  setQuestionRevealing(gameId: string, index: number, closedAt = Date.now()): void {
    this.db.transaction(() => {
      this.db.run(
        "UPDATE games SET phase = 'revealing' WHERE id = ? AND status = 'active'",
        [gameId],
      );
      this.db.run(
        'UPDATE game_questions SET closed_at = ? WHERE game_id = ? AND position = ?',
        [closedAt, gameId, index],
      );
    });
  }

  setWaiting(gameId: string, nextIndex: number): void {
    this.db.run(
      `UPDATE games SET phase = 'waiting', current_question_index = ?,
       question_opened_at = NULL, question_deadline_at = NULL
       WHERE id = ? AND status = 'active'`,
      [nextIndex, gameId],
    );
  }

  joinGame(gameId: string, playerId: number): void {
    const now = Date.now();
    this.db.run(
      `INSERT OR IGNORE INTO game_players(game_id, player_id, joined_at)
       VALUES (?, ?, ?)`,
      [gameId, playerId, now],
    );
    const game = this.db.get<{ chat_id: string }>('SELECT chat_id FROM games WHERE id = ?', [gameId]);
    if (game) {
      this.db.run(
        `INSERT OR IGNORE INTO player_chat_stats(chat_id, player_id, updated_at)
         VALUES (?, ?, ?)`,
        [game.chat_id, playerId, now],
      );
    }
  }

  hasAnswered(gameId: string, questionIndex: number, playerId: number): boolean {
    return Boolean(
      this.db.get<{ found: number }>(
        `SELECT 1 AS found FROM answers
         WHERE game_id = ? AND question_position = ? AND player_id = ?`,
        [gameId, questionIndex, playerId],
      ),
    );
  }

  recordAnswer(input: {
    game: ActiveGame;
    playerId: number;
    answerIndex: number;
    isCorrect: boolean;
    responseMs: number;
    points: number;
  }): boolean {
    const now = Date.now();
    return this.db.transaction(() => {
      const result = this.db.run(
        `INSERT OR IGNORE INTO answers(
          game_id, question_position, player_id, answer_index, is_correct,
          response_ms, points, answered_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          input.game.id,
          input.game.currentIndex,
          input.playerId,
          input.answerIndex,
          input.isCorrect ? 1 : 0,
          input.responseMs,
          input.points,
          now,
        ],
      );
      if (Number(result.changes) === 0) return false;

      this.joinGame(input.game.id, input.playerId);
      this.db.run(
        `UPDATE game_players SET
          score = score + ?,
          correct_answers = correct_answers + ?,
          answers_count = answers_count + 1
         WHERE game_id = ? AND player_id = ?`,
        [input.points, input.isCorrect ? 1 : 0, input.game.id, input.playerId],
      );
      this.db.run(
        `UPDATE players SET
          total_points = total_points + ?,
          questions_answered = questions_answered + 1,
          correct_answers = correct_answers + ?,
          current_streak = CASE WHEN ? = 1 THEN current_streak + 1 ELSE 0 END,
          best_streak = CASE
            WHEN ? = 1 AND current_streak + 1 > best_streak THEN current_streak + 1
            ELSE best_streak END,
          updated_at = ?, last_seen_at = ?
         WHERE id = ?`,
        [
          input.points,
          input.isCorrect ? 1 : 0,
          input.isCorrect ? 1 : 0,
          input.isCorrect ? 1 : 0,
          now,
          now,
          input.playerId,
        ],
      );
      this.db.run(
        `INSERT INTO player_chat_stats(
          chat_id, player_id, points, questions_answered, correct_answers,
          current_streak, best_streak, updated_at
        ) VALUES (?, ?, ?, 1, ?, ?, ?, ?)
        ON CONFLICT(chat_id, player_id) DO UPDATE SET
          points = player_chat_stats.points + excluded.points,
          questions_answered = player_chat_stats.questions_answered + 1,
          correct_answers = player_chat_stats.correct_answers + excluded.correct_answers,
          current_streak = CASE
            WHEN excluded.correct_answers = 1 THEN player_chat_stats.current_streak + 1
            ELSE 0 END,
          best_streak = CASE
            WHEN excluded.correct_answers = 1
              AND player_chat_stats.current_streak + 1 > player_chat_stats.best_streak
            THEN player_chat_stats.current_streak + 1
            ELSE player_chat_stats.best_streak END,
          updated_at = excluded.updated_at`,
        [
          input.game.chatId,
          input.playerId,
          input.points,
          input.isCorrect ? 1 : 0,
          input.isCorrect ? 1 : 0,
          input.isCorrect ? 1 : 0,
          now,
        ],
      );
      const questionCategory = input.game.questions[input.game.currentIndex]?.category;
      const category = questionCategory ? categoryByKey(questionCategory)?.key ?? questionCategory : undefined;
      if (category) {
        this.db.run(
          `INSERT INTO player_category_stats(
            player_id, category_key, questions_answered, correct_answers, points, updated_at
          ) VALUES (?, ?, 1, ?, ?, ?)
          ON CONFLICT(player_id, category_key) DO UPDATE SET
            questions_answered = player_category_stats.questions_answered + 1,
            correct_answers = player_category_stats.correct_answers + excluded.correct_answers,
            points = player_category_stats.points + excluded.points,
            updated_at = excluded.updated_at`,
          [input.playerId, category, input.isCorrect ? 1 : 0, input.points, now],
        );
      }
      return true;
    });
  }

  categoryStats(playerId: number): Array<{ category: string; answered: number; correct: number; points: number }> {
    return this.db.all<{ category_key: string; questions_answered: number; correct_answers: number; points: number }>(
      `SELECT category_key, questions_answered, correct_answers, points
       FROM player_category_stats
       WHERE player_id = ?
       ORDER BY correct_answers DESC`,
      [playerId],
    ).map((row) => ({
      category: row.category_key,
      answered: Number(row.questions_answered),
      correct: Number(row.correct_answers),
      points: Number(row.points),
    }));
  }

  markHintUsed(gameId: string, playerId: number): void {
    this.joinGame(gameId, playerId);
    this.db.run(
      'UPDATE game_players SET hints_used = hints_used + 1 WHERE game_id = ? AND player_id = ?',
      [gameId, playerId],
    );
  }

  getRoundResults(gameId: string, questionIndex: number): Array<{
    playerId: number;
    name: string;
    isCorrect: boolean;
    responseMs: number;
    points: number;
  }> {
    return this.db.all<Record<string, unknown>>(
      `SELECT a.player_id, p.display_name, a.is_correct, a.response_ms, a.points
       FROM answers a
       JOIN players p ON p.id = a.player_id
       WHERE a.game_id = ? AND a.question_position = ?
       ORDER BY a.is_correct DESC, a.response_ms ASC`,
      [gameId, questionIndex],
    ).map((row) => ({
      playerId: Number(row.player_id),
      name: String(row.display_name),
      isCorrect: Boolean(row.is_correct),
      responseMs: Number(row.response_ms),
      points: Number(row.points),
    }));
  }

  getGameScores(gameId: string): Array<{
    playerId: number;
    name: string;
    score: number;
    correct: number;
    answers: number;
  }> {
    return this.db.all<Record<string, unknown>>(
      `SELECT gp.player_id, p.display_name, gp.score, gp.correct_answers, gp.answers_count
       FROM game_players gp
       JOIN players p ON p.id = gp.player_id
       WHERE gp.game_id = ?
       ORDER BY gp.score DESC, gp.correct_answers DESC, gp.joined_at ASC`,
      [gameId],
    ).map((row) => ({
      playerId: Number(row.player_id),
      name: String(row.display_name),
      score: Number(row.score),
      correct: Number(row.correct_answers),
      answers: Number(row.answers_count),
    }));
  }

  completeGame(game: ActiveGame): Array<{ playerId: number; name: string; score: number; rank: number }> {
    return this.db.transaction(() => {
      const state = this.db.get<{ status: string }>('SELECT status FROM games WHERE id = ?', [game.id]);
      if (!state || state.status !== 'active') return [];
      const scores = this.getGameScores(game.id);
      const winnerId = scores[0]?.playerId ?? null;
      const endedAt = Date.now();
      this.db.run(
        `UPDATE games SET status = 'completed', phase = 'finished', ended_at = ?,
         winner_player_id = ?, question_opened_at = NULL, question_deadline_at = NULL
         WHERE id = ?`,
        [endedAt, winnerId, game.id],
      );
      scores.forEach((entry, index) => {
        const rank = index + 1;
        this.db.run(
          'UPDATE game_players SET final_rank = ? WHERE game_id = ? AND player_id = ?',
          [rank, game.id, entry.playerId],
        );
        this.db.run(
          `UPDATE players SET games_played = games_played + 1,
           games_won = games_won + ?,
           best_game_score = MAX(best_game_score, ?), updated_at = ?
           WHERE id = ?`,
          [rank === 1 ? 1 : 0, entry.score, endedAt, entry.playerId],
        );
        this.db.run(
          `UPDATE player_chat_stats SET
           games_played = games_played + 1,
           games_won = games_won + ?,
           best_game_score = MAX(best_game_score, ?), updated_at = ?
           WHERE chat_id = ? AND player_id = ?`,
          [rank === 1 ? 1 : 0, entry.score, endedAt, game.chatId, entry.playerId],
        );
      });
      if (game.mode === 'daily') {
        for (const entry of scores) {
          this.db.run(
            `UPDATE daily_attempts SET score = ?, completed = 1
             WHERE player_id = ? AND game_id = ?`,
            [entry.score, entry.playerId, game.id],
          );
        }
      }
      return scores.map((entry, index) => ({
        playerId: entry.playerId,
        name: entry.name,
        score: entry.score,
        rank: index + 1,
      }));
    });
  }

  stopGame(gameId: string): void {
    this.db.run(
      `UPDATE games SET status = 'stopped', phase = 'finished', ended_at = ?,
       question_opened_at = NULL, question_deadline_at = NULL
       WHERE id = ? AND status = 'active'`,
      [Date.now(), gameId],
    );
  }

  interruptAllActiveGames(): number {
    const result = this.db.run(
      `UPDATE games SET status = 'interrupted', phase = 'finished', ended_at = ?
       WHERE status = 'active'`,
      [Date.now()],
    );
    return Number(result.changes);
  }

  recentQuestionHashes(
    chatId: string,
    cooldownHours = config.defaultQuestionCooldownHours,
    now = Date.now(),
  ): Set<string> {
    if (cooldownHours <= 0) return new Set();
    const cutoff = now - cooldownHours * 60 * 60 * 1000;
    const rows = this.db.all<{ question_hash: string }>(
      `SELECT question_hash FROM question_history
       WHERE chat_id = ? AND last_used_at >= ?
       ORDER BY last_used_at DESC`,
      [chatId, cutoff],
    );
    return new Set(rows.map((row) => row.question_hash));
  }

  getCachedQuestions(input: {
    sources: TriviaSource[];
    categoryKey: string | null;
    difficulty: Difficulty;
    limit: number;
    tags?: string[];
  }): CachedTriviaQuestion[] {
    if (!input.sources.length || input.limit <= 0) return [];
    const where: string[] = ['q.disabled = 0'];
    const params: SQLInputValue[] = [];
    const sourcePlaceholders = input.sources.map(() => '?').join(', ');
    where.push(`q.source IN (${sourcePlaceholders})`);
    params.push(...input.sources);
    if (input.difficulty !== 'mixed') {
      where.push('q.difficulty = ?');
      params.push(input.difficulty);
    }
    if (input.categoryKey) {
      where.push(
        `EXISTS (
          SELECT 1 FROM trivia_question_categories filter_category
          WHERE filter_category.question_hash = q.question_hash
            AND filter_category.category_key = ?
        )`,
      );
      params.push(input.categoryKey);
    }
    if (input.tags?.length) {
      const tagPlaceholders = input.tags.map(() => '?').join(', ');
      where.push(
        `EXISTS (
          SELECT 1 FROM trivia_question_tags filter_tag
          WHERE filter_tag.question_hash = q.question_hash
            AND filter_tag.tag IN (${tagPlaceholders})
        )`,
      );
      params.push(...input.tags);
    }
    params.push(Math.max(1, Math.min(2000, input.limit)));

    return this.db.all<CachedQuestionRow>(
      `SELECT q.*,
        (SELECT GROUP_CONCAT(category_key)
         FROM trivia_question_categories all_categories
         WHERE all_categories.question_hash = q.question_hash) AS category_keys,
        (SELECT GROUP_CONCAT(tag)
         FROM trivia_question_tags all_tags
         WHERE all_tags.question_hash = q.question_hash) AS tags
       FROM trivia_question_cache q
       WHERE ${where.join(' AND ')}
       ORDER BY q.updated_at DESC
       LIMIT ?`,
      params,
    ).map((row) => ({
      sourceId: row.source_id,
      source: row.source,
      categoryKeys: row.category_keys ? row.category_keys.split(',').filter(Boolean) : [],
      tags: row.tags ? row.tags.split(',').filter(Boolean) : [],
      category: row.category,
      difficulty: row.difficulty,
      prompt: row.prompt,
      options: JSON.parse(row.options_json) as string[],
      correctIndex: Number(row.correct_index),
      hash: row.question_hash,
    }));
  }

  upsertCachedQuestions(questions: CachedTriviaQuestion[], now = Date.now()): void {
    if (!questions.length) return;
    this.db.transaction(() => {
      const upsertQuestion = this.db.raw.prepare(
        `INSERT INTO trivia_question_cache(
          question_hash, source_id, source, category, difficulty, prompt,
          options_json, correct_index, fetched_at, updated_at, disabled
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
        ON CONFLICT(question_hash) DO UPDATE SET
          source_id = CASE
            WHEN trivia_question_cache.source = 'the-trivia-api'
              AND excluded.source <> 'the-trivia-api'
            THEN trivia_question_cache.source_id ELSE excluded.source_id END,
          source = CASE
            WHEN trivia_question_cache.source = 'the-trivia-api'
              AND excluded.source <> 'the-trivia-api'
            THEN trivia_question_cache.source ELSE excluded.source END,
          category = CASE
            WHEN trivia_question_cache.source = 'the-trivia-api'
              AND excluded.source <> 'the-trivia-api'
            THEN trivia_question_cache.category ELSE excluded.category END,
          difficulty = CASE
            WHEN trivia_question_cache.source = 'the-trivia-api'
              AND excluded.source <> 'the-trivia-api'
            THEN trivia_question_cache.difficulty ELSE excluded.difficulty END,
          prompt = CASE
            WHEN trivia_question_cache.source = 'the-trivia-api'
              AND excluded.source <> 'the-trivia-api'
            THEN trivia_question_cache.prompt ELSE excluded.prompt END,
          options_json = CASE
            WHEN trivia_question_cache.source = 'the-trivia-api'
              AND excluded.source <> 'the-trivia-api'
            THEN trivia_question_cache.options_json ELSE excluded.options_json END,
          correct_index = CASE
            WHEN trivia_question_cache.source = 'the-trivia-api'
              AND excluded.source <> 'the-trivia-api'
            THEN trivia_question_cache.correct_index ELSE excluded.correct_index END,
          updated_at = excluded.updated_at,
          disabled = 0`,
      );
      const insertCategory = this.db.raw.prepare(
        `INSERT OR IGNORE INTO trivia_question_categories(question_hash, category_key)
         VALUES (?, ?)`,
      );
      const insertTag = this.db.raw.prepare(
        `INSERT OR IGNORE INTO trivia_question_tags(question_hash, tag)
         VALUES (?, ?)`,
      );
      for (const question of questions) {
        upsertQuestion.run(
          question.hash,
          question.sourceId,
          question.source,
          question.category,
          question.difficulty,
          question.prompt,
          JSON.stringify(question.options),
          question.correctIndex,
          now,
          now,
        );
        for (const categoryKey of new Set(question.categoryKeys)) {
          if (categoryKey) insertCategory.run(question.hash, categoryKey);
        }
        for (const tag of new Set(question.tags)) {
          if (tag) insertTag.run(question.hash, tag);
        }
      }
    });
  }

  leaderboard(scope: 'global' | 'chat', chatId: string, sinceMs?: number): LeaderboardEntry[] {
    const limit = 10;
    if (sinceMs !== undefined) {
      const whereChat = scope === 'chat' ? 'AND g.chat_id = ?' : '';
      const params: SQLInputValue[] = [sinceMs];
      if (scope === 'chat') params.push(chatId);
      params.push(limit);
      return this.db.all<Record<string, unknown>>(
        `SELECT p.id AS player_id, p.display_name,
          SUM(a.points) AS points,
          SUM(a.is_correct) AS correct,
          COUNT(*) AS answered,
          COUNT(DISTINCT a.game_id) AS games,
          0 AS wins
         FROM answers a
         JOIN players p ON p.id = a.player_id
         JOIN games g ON g.id = a.game_id
         WHERE a.answered_at >= ? ${whereChat}
         GROUP BY p.id, p.display_name
         ORDER BY points DESC, correct DESC, answered ASC
         LIMIT ?`,
        params,
      ).map(toLeaderboardEntry);
    }

    if (scope === 'chat') {
      return this.db.all<Record<string, unknown>>(
        `SELECT p.id AS player_id, p.display_name, s.points, s.correct_answers AS correct,
          s.questions_answered AS answered, s.games_played AS games, s.games_won AS wins
         FROM player_chat_stats s
         JOIN players p ON p.id = s.player_id
         WHERE s.chat_id = ?
         ORDER BY s.points DESC, s.correct_answers DESC, s.questions_answered ASC
         LIMIT ?`,
        [chatId, limit],
      ).map(toLeaderboardEntry);
    }

    return this.db.all<Record<string, unknown>>(
      `SELECT id AS player_id, display_name, total_points AS points,
        correct_answers AS correct, questions_answered AS answered,
        games_played AS games, games_won AS wins
       FROM players
       ORDER BY total_points DESC, correct_answers DESC, questions_answered ASC
       LIMIT ?`,
      [limit],
    ).map(toLeaderboardEntry);
  }

  playerStats(playerId: number, chatId: string): Record<string, number | string> | null {
    const row = this.db.get<Record<string, unknown>>(
      `SELECT p.display_name, p.total_points, p.games_played, p.games_won,
        p.questions_answered, p.correct_answers, p.current_streak, p.best_streak,
        p.best_game_score,
        COALESCE(s.points, 0) AS chat_points,
        COALESCE(s.games_played, 0) AS chat_games,
        COALESCE(s.games_won, 0) AS chat_wins
       FROM players p
       LEFT JOIN player_chat_stats s ON s.player_id = p.id AND s.chat_id = ?
       WHERE p.id = ?`,
      [chatId, playerId],
    );
    if (!row) return null;
    return Object.fromEntries(
      Object.entries(row).map(([key, value]) => [key, typeof value === 'bigint' ? Number(value) : value]),
    ) as Record<string, number | string>;
  }

  hasDailyAttempt(localDate: string, playerId: number): boolean {
    return Boolean(
      this.db.get<{ found: number }>(
        'SELECT 1 AS found FROM daily_attempts WHERE local_date = ? AND player_id = ?',
        [localDate, playerId],
      ),
    );
  }

  unlockAchievement(playerId: number, key: string, gameId: string): boolean {
    const result = this.db.run(
      `INSERT OR IGNORE INTO player_achievements(player_id, achievement_key, unlocked_at, game_id)
       VALUES (?, ?, ?, ?)`,
      [playerId, key, Date.now(), gameId],
    );
    return Number(result.changes) > 0;
  }

  achievements(playerId: number): Array<{ key: string; unlockedAt: number }> {
    return this.db.all<{ achievement_key: string; unlocked_at: number }>(
      `SELECT achievement_key, unlocked_at FROM player_achievements
       WHERE player_id = ? ORDER BY unlocked_at`,
      [playerId],
    ).map((row) => ({ key: row.achievement_key, unlockedAt: row.unlocked_at }));
  }

  achievementFacts(playerId: number): Record<string, number> {
    const row = this.db.get<Record<string, unknown>>(
      `SELECT total_points, games_played, games_won, questions_answered,
        correct_answers, current_streak, best_streak, best_game_score
       FROM players WHERE id = ?`,
      [playerId],
    );
    if (!row) return {};
    return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value)]));
  }
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function toQuestion(row: QuestionRow): TriviaQuestion {
  return {
    sourceId: row.source_id,
    category: row.category,
    difficulty: row.difficulty,
    prompt: row.prompt,
    options: parseJson<string[]>(row.options_json, []),
    correctIndex: row.correct_index,
    hash: row.question_hash,
  };
}

function toLeaderboardEntry(row: Record<string, unknown>): LeaderboardEntry {
  return {
    playerId: Number(row.player_id),
    name: String(row.display_name),
    points: Number(row.points ?? 0),
    correct: Number(row.correct ?? 0),
    answered: Number(row.answered ?? 0),
    games: Number(row.games ?? 0),
    wins: Number(row.wins ?? 0),
  };
}
