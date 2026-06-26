import { createHash, randomInt } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { logger } from '../logger.js';
import type { Difficulty, TriviaQuestion } from '../types.js';
import { categoryByKey } from './catalog.js';

interface OpenTdbResponse {
  response_code: number;
  token?: string;
  results?: Array<{
    category: string;
    difficulty: 'easy' | 'medium' | 'hard';
    question: string;
    correct_answer: string;
    incorrect_answers: string[];
  }>;
}

interface CacheEntry {
  expiresAt: number;
  questions: TriviaQuestion[];
}

export class QuestionProvider {
  private readonly localQuestions: TriviaQuestion[] = [];
  private readonly cache = new Map<string, CacheEntry>();
  private sessionToken: string | null = null;
  private apiTail: Promise<void> = Promise.resolve();
  private lastApiAt = 0;

  async initialize(): Promise<void> {
    const localPath = fileURLToPath(new URL('../../data/questions.json', import.meta.url));
    const raw = JSON.parse(await readFile(localPath, 'utf8')) as Array<Record<string, unknown>>;
    this.localQuestions.push(...raw.map((item, index) => this.formatLocal(item, index)));
    logger.info({ localQuestions: this.localQuestions.length }, 'Question provider ready');
    if (config.triviaApiEnabled) {
      try {
        const response = await this.serializedApiCall(
          'https://opentdb.com/api_token.php?command=request',
        );
        if (response.response_code === 0 && response.token) this.sessionToken = response.token;
      } catch (error) {
        logger.warn({ err: error }, 'Could not initialize OpenTDB token; local fallback remains available');
      }
    }
  }

  async getQuestions(input: {
    count: number;
    category: string | null;
    difficulty: Difficulty;
    excludeHashes: Set<string>;
  }): Promise<TriviaQuestion[]> {
    const count = Math.max(3, Math.min(30, input.count));
    const category = categoryByKey(input.category);
    const cacheKey = `${category?.key ?? 'mixed'}:${input.difficulty}`;
    const candidates: TriviaQuestion[] = [];

    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) candidates.push(...cached.questions);

    if (config.triviaApiEnabled && uniqueAvailable(candidates, input.excludeHashes) < count) {
      try {
        const fresh = await this.fetchBatch(category?.apiId ?? null, input.difficulty);
        this.cache.set(cacheKey, {
          expiresAt: Date.now() + config.triviaCacheTtlMinutes * 60_000,
          questions: fresh,
        });
        candidates.push(...fresh);
      } catch (error) {
        logger.warn({ err: error, cacheKey }, 'OpenTDB request failed; using local questions');
      }
    }

    candidates.push(
      ...this.localQuestions.filter((question) => {
        if (category && normalize(question.category) !== normalize(category.name)) return false;
        if (input.difficulty !== 'mixed' && question.difficulty !== input.difficulty) return false;
        return true;
      }),
    );

    let selected = pickUnique(candidates, count, input.excludeHashes);
    if (selected.length < count) {
      selected = pickUnique([...selected, ...this.localQuestions], count, new Set());
    }
    if (selected.length < 3) {
      throw new Error('Not enough trivia questions are currently available');
    }
    return selected.slice(0, count).map(shuffleQuestion);
  }

  private async fetchBatch(categoryId: number | null, difficulty: Difficulty): Promise<TriviaQuestion[]> {
    const params = new URLSearchParams({ amount: '50', encode: 'url3986' });
    if (categoryId) params.set('category', String(categoryId));
    if (difficulty !== 'mixed') params.set('difficulty', difficulty);
    if (this.sessionToken) params.set('token', this.sessionToken);

    let response = await this.serializedApiCall(`https://opentdb.com/api.php?${params}`);
    if (response.response_code === 4 && this.sessionToken) {
      await this.serializedApiCall(
        `https://opentdb.com/api_token.php?command=reset&token=${encodeURIComponent(this.sessionToken)}`,
      );
      response = await this.serializedApiCall(`https://opentdb.com/api.php?${params}`);
    }
    if (response.response_code !== 0 || !response.results?.length) {
      throw new Error(`OpenTDB returned response code ${response.response_code}`);
    }
    return response.results.map((item, index) => {
      const correct = safeDecode(item.correct_answer);
      const options = [correct, ...item.incorrect_answers.map(safeDecode)];
      const prompt = safeDecode(item.question);
      return {
        sourceId: `opentdb:${hash(`${prompt}:${correct}`)}:${index}`,
        category: safeDecode(item.category),
        difficulty: item.difficulty,
        prompt,
        options,
        correctIndex: 0,
        hash: hash(`${prompt}\u0000${correct}`),
      };
    });
  }

  private serializedApiCall(url: string): Promise<OpenTdbResponse> {
    const task = this.apiTail.then(async () => {
      const wait = Math.max(0, config.triviaApiMinIntervalMs - (Date.now() - this.lastApiAt));
      if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
      this.lastApiAt = Date.now();
      const response = await fetch(url, { signal: AbortSignal.timeout(config.triviaApiTimeoutMs) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return (await response.json()) as OpenTdbResponse;
    });
    this.apiTail = task.then(() => undefined, () => undefined);
    return task;
  }

  private formatLocal(item: Record<string, unknown>, index: number): TriviaQuestion {
    const options = (item.options as string[]).map(String);
    const correctIndex = Number(item.correct);
    const prompt = String(item.question);
    const correct = options[correctIndex] ?? '';
    return {
      sourceId: `local:${String(item.id ?? index + 1)}`,
      category: String(item.category ?? 'General Knowledge'),
      difficulty: normalizeDifficulty(item.difficulty),
      prompt,
      options,
      correctIndex,
      hash: hash(`${prompt}\u0000${correct}`),
    };
  }
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 24);
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function normalizeDifficulty(value: unknown): 'easy' | 'medium' | 'hard' {
  return value === 'hard' || value === 'medium' ? value : 'easy';
}

function uniqueAvailable(questions: TriviaQuestion[], excluded: Set<string>): number {
  return new Set(questions.filter((question) => !excluded.has(question.hash)).map((q) => q.hash)).size;
}

function pickUnique(
  questions: TriviaQuestion[],
  count: number,
  excluded: Set<string>,
): TriviaQuestion[] {
  const pool = questions.filter((question) => !excluded.has(question.hash));
  const byHash = new Map(pool.map((question) => [question.hash, question]));
  const unique = [...byHash.values()];
  for (let i = unique.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [unique[i], unique[j]] = [unique[j]!, unique[i]!];
  }
  return unique.slice(0, count);
}

function shuffleQuestion(question: TriviaQuestion): TriviaQuestion {
  const indexed = question.options.map((value, index) => ({ value, correct: index === question.correctIndex }));
  for (let i = indexed.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [indexed[i], indexed[j]] = [indexed[j]!, indexed[i]!];
  }
  return {
    ...question,
    options: indexed.map((item) => item.value),
    correctIndex: indexed.findIndex((item) => item.correct),
  };
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
