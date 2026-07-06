import { createHash, randomInt } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';
import { logger } from '../logger.js';
import type {
  CachedTriviaQuestion,
  Difficulty,
  TriviaQuestion,
  TriviaSource,
} from '../types.js';
import {
  categoryByKey,
  categoryByOpenTdbName,
  categoryKeysForTheTrivia,
  normalizeUserTag,
  questionMatchesCategory,
  theTriviaCategoryLabel,
  theTriviaRequestCategories,
  theTriviaRequestTags,
} from './catalog.js';

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

export interface QuestionCacheStore {
  getCachedQuestions(input: {
    sources: TriviaSource[];
    categoryKey: string | null;
    difficulty: Difficulty;
    limit: number;
    tags?: string[];
  }): CachedTriviaQuestion[];
  upsertCachedQuestions(questions: CachedTriviaQuestion[]): void;
}

export interface QuestionProviderOptions {
  cache?: QuestionCacheStore;
  primaryEnabled?: boolean;
  fallbackEnabled?: boolean;
  fetchFn?: typeof fetch;
}

export class QuestionProvider {
  private readonly localQuestions: TriviaQuestion[] = [];
  private readonly cacheStore: QuestionCacheStore | undefined;
  private readonly primaryEnabled: boolean;
  private readonly fallbackEnabled: boolean;
  private readonly fetchFn: typeof fetch;
  private openTdbToken: string | null = null;
  private primaryTail: Promise<void> = Promise.resolve();
  private fallbackTail: Promise<void> = Promise.resolve();
  private lastPrimaryAt = 0;
  private lastFallbackAt = 0;
  private initialized = false;

  constructor(options: QuestionProviderOptions | boolean = {}) {
    if (typeof options === 'boolean') {
      this.primaryEnabled = options;
      this.fallbackEnabled = options;
      this.cacheStore = undefined;
      this.fetchFn = fetch;
      return;
    }
    this.cacheStore = options.cache;
    this.primaryEnabled = options.primaryEnabled ?? config.theTriviaApiEnabled;
    this.fallbackEnabled = options.fallbackEnabled ?? config.openTdbEnabled;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    const localPath = fileURLToPath(new URL('../../data/questions.json', import.meta.url));
    const raw = JSON.parse(await readFile(localPath, 'utf8')) as Array<Record<string, unknown>>;
    this.localQuestions.push(...raw.map((item, index) => this.formatLocal(item, index)));
    logger.info(
      {
        localQuestions: this.localQuestions.length,
        primaryProvider: this.primaryEnabled ? 'the-trivia-api' : 'disabled',
        fallbackProvider: this.fallbackEnabled ? 'opentdb' : 'disabled',
        durableCache: Boolean(this.cacheStore),
      },
      'Question provider ready',
    );

    if (!this.fallbackEnabled) return;
    try {
      const response = await this.serializedJsonCall<OpenTdbResponse>(
        'fallback',
        'https://opentdb.com/api_token.php?command=request',
      );
      if (response.response_code === 0 && response.token) this.openTdbToken = response.token;
    } catch (error) {
      logger.warn({ err: error }, 'Could not initialize OpenTDB token; other question sources remain available');
    }
  }

  async getQuestions(input: {
    count: number;
    category: string | null;
    difficulty: Difficulty;
    excludeHashes: Set<string>;
    tags?: string[] | null;
  }): Promise<TriviaQuestion[]> {
    const count = Math.max(3, Math.min(30, input.count));
    const category = categoryByKey(input.category);
    const categoryKey = category?.key ?? null;
    // User-supplied tags (e.g. `/play tag:renaissance`) are an explicit, specific
    // ask that OpenTDB and the bundled local bank have no way to honor, so those
    // sources are skipped entirely rather than silently returning unrelated
    // questions. Curated per-category tags narrow the primary request too, but
    // are just an internal precision improvement, so they don't disable fallback.
    const userTags = (input.tags ?? []).map(normalizeUserTag).filter(Boolean);
    const requestTags = userTags.length ? userTags : theTriviaRequestTags(categoryKey ?? '');
    const cacheLimit = Math.max(200, Math.min(2000, count * 30));
    const primaryCandidates: CachedTriviaQuestion[] = [];
    const fallbackCandidates: CachedTriviaQuestion[] = [];

    if (this.cacheStore && this.primaryEnabled) {
      primaryCandidates.push(
        ...this.cacheStore.getCachedQuestions({
          sources: ['the-trivia-api'],
          categoryKey,
          difficulty: input.difficulty,
          limit: cacheLimit,
          tags: requestTags,
        }),
      );
    }

    if (this.primaryEnabled && uniqueAvailable(primaryCandidates, input.excludeHashes) < count) {
      const attempts = Math.max(1, Math.min(3, Math.ceil(count / config.triviaFetchBatchSize) + 1));
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        if (uniqueAvailable(primaryCandidates, input.excludeHashes) >= count) break;
        try {
          const fresh = await this.fetchPrimaryBatch(
            categoryKey,
            input.difficulty,
            config.triviaFetchBatchSize,
            requestTags,
          );
          if (!fresh.length) break;
          this.cacheStore?.upsertCachedQuestions(fresh);
          primaryCandidates.push(...fresh);
        } catch (error) {
          logger.warn(
            { err: error, category: categoryKey, difficulty: input.difficulty, tags: requestTags },
            'The Trivia API request failed; trying cached and fallback questions',
          );
          break;
        }
      }
    }

    if (!userTags.length) {
      if (this.cacheStore && this.fallbackEnabled) {
        fallbackCandidates.push(
          ...this.cacheStore.getCachedQuestions({
            sources: ['opentdb'],
            categoryKey,
            difficulty: input.difficulty,
            limit: cacheLimit,
          }),
        );
      }

      const availableBeforeFallback = uniqueAvailable(
        [...primaryCandidates, ...fallbackCandidates],
        input.excludeHashes,
      );
      if (this.fallbackEnabled && availableBeforeFallback < count) {
        try {
          const fresh = await this.fetchOpenTdbBatch(category?.apiId ?? null, categoryKey, input.difficulty);
          this.cacheStore?.upsertCachedQuestions(fresh);
          fallbackCandidates.push(...fresh);
        } catch (error) {
          logger.warn(
            { err: error, category: categoryKey, difficulty: input.difficulty },
            'OpenTDB fallback request failed; using durable cache and bundled questions',
          );
        }
      }
    }

    const localCandidates = userTags.length ? [] : this.localQuestions.filter((question) => {
      if (category && !questionMatchesCategory(question.category, category.key)) return false;
      if (input.difficulty !== 'mixed' && question.difficulty !== input.difficulty) return false;
      return true;
    });

    const selected = pickPrioritizedUnique(
      [primaryCandidates, fallbackCandidates, localCandidates],
      count,
      input.excludeHashes,
    );
    if (selected.length < 3) {
      const categoryLabel = category?.name ?? 'the selected filters';
      const tagSuffix = userTags.length ? ` with tag "${userTags.join(', ')}"` : '';
      throw new Error(
        `Only ${selected.length} fresh question${selected.length === 1 ? '' : 's'} ` +
          `are available for ${categoryLabel}${tagSuffix}. Try fewer questions, a different category or tag, ` +
          `or turn down the repeat-question cooldown with */set cooldown*.`,
      );
    }
    // The Trivia API's cached `category` label is overwritten by whichever
    // category last fetched a question, but a question can legitimately match
    // several categoryKeys (e.g. an arts_and_literature question tagged both
    // "art" and "books"), so a stale label from an earlier request can leak
    // into a later one for a different category. Once we know which category
    // this request actually asked for, that's the label that must be shown.
    // (Local/OpenTDB questions are excluded: their category is unambiguous
    // and local ones intentionally keep their own display aliases, e.g.
    // "Movies" for the `film` category.)
    const labeled = category
      ? selected.map((question) =>
          'source' in question && question.source === 'the-trivia-api'
            ? { ...question, category: category.name }
            : question,
        )
      : selected;
    return labeled.map(shuffleQuestion);
  }

  private async fetchPrimaryBatch(
    requestedCategoryKey: string | null,
    difficulty: Difficulty,
    limit: number,
    tags: string[],
  ): Promise<CachedTriviaQuestion[]> {
    const params = new URLSearchParams({ limit: String(Math.max(1, Math.min(20, limit))) });
    if (requestedCategoryKey) {
      const apiCategories = theTriviaRequestCategories(requestedCategoryKey);
      if (apiCategories.length) params.set('categories', apiCategories.join(','));
    }
    if (difficulty !== 'mixed') params.set('difficulties', difficulty);
    if (tags.length) params.set('tags', tags.join(','));

    const headers: Record<string, string> = { accept: 'application/json' };
    if (config.theTriviaApiKey) headers['x-api-key'] = config.theTriviaApiKey;
    const payload = await this.serializedJsonCall<unknown>(
      'primary',
      `https://the-trivia-api.com/v2/questions?${params}`,
      headers,
    );
    const rawQuestions = extractQuestionArray(payload);
    const parsed = rawQuestions
      .map((item, index) => this.formatPrimary(item, requestedCategoryKey, index))
      .filter((question): question is CachedTriviaQuestion => Boolean(question));
    if (!parsed.length) {
      throw new Error('The Trivia API returned no compatible text-choice questions');
    }
    return deduplicateQuestions(parsed);
  }

  private formatPrimary(
    value: unknown,
    requestedCategoryKey: string | null,
    index: number,
  ): CachedTriviaQuestion | null {
    const item = asRecord(value);
    if (!item) return null;
    const type = stringValue(item.type);
    if (type && !['text_choice', 'multiple', 'multiple_choice'].includes(normalizeApiValue(type))) {
      return null;
    }

    const prompt = questionText(item.question);
    const correct = stringValue(item.correctAnswer ?? item.correct_answer ?? item.answer);
    const incorrect = stringArray(item.incorrectAnswers ?? item.incorrect_answers ?? item.wrongAnswers);
    const sourceCategory = stringValue(item.category) || 'general_knowledge';
    const tags = stringArray(item.tags);
    if (!prompt || !correct || incorrect.length < 1) return null;

    const options = [correct, ...incorrect.slice(0, 3)].map(cleanText);
    if (options.length < 2 || options.length > 4 || new Set(options.map(normalizeAnswer)).size !== options.length) {
      return null;
    }

    const categoryKeys = categoryKeysForTheTrivia(sourceCategory, tags);
    if (requestedCategoryKey && !categoryKeys.some((key) => key === requestedCategoryKey)) return null;
    const requestedCategory = categoryByKey(requestedCategoryKey);
    const externalId = stringValue(item.id) || hash(`${prompt}\u0000${correct}`);
    const questionHash = hash(`${cleanText(prompt)}\u0000${cleanText(correct)}`);
    return {
      sourceId: `the-trivia-api:${externalId || index}`,
      source: 'the-trivia-api',
      categoryKeys,
      tags,
      category: requestedCategory?.name ?? theTriviaCategoryLabel(sourceCategory),
      difficulty: normalizeDifficulty(item.difficulty),
      prompt: cleanText(prompt),
      options,
      correctIndex: 0,
      hash: questionHash,
    };
  }

  private async fetchOpenTdbBatch(
    categoryId: number | null,
    requestedCategoryKey: string | null,
    difficulty: Difficulty,
  ): Promise<CachedTriviaQuestion[]> {
    // OpenTDB errors with response_code 1 ("No Results") if `amount` exceeds the
    // pool size for the category/difficulty, rather than just returning fewer
    // results. Narrow categories (e.g. Gadgets, Musicals) can have well under 50
    // questions in a single difficulty bucket, so step the amount down on that
    // specific error instead of giving up.
    let response: OpenTdbResponse | null = null;
    for (const amount of [50, 20, 10, 5]) {
      const params = new URLSearchParams({ amount: String(amount), encode: 'url3986' });
      if (categoryId) params.set('category', String(categoryId));
      if (difficulty !== 'mixed') params.set('difficulty', difficulty);
      if (this.openTdbToken) params.set('token', this.openTdbToken);

      let attempt = await this.serializedJsonCall<OpenTdbResponse>(
        'fallback',
        `https://opentdb.com/api.php?${params}`,
      );
      if (attempt.response_code === 4 && this.openTdbToken) {
        await this.serializedJsonCall<OpenTdbResponse>(
          'fallback',
          `https://opentdb.com/api_token.php?command=reset&token=${encodeURIComponent(this.openTdbToken)}`,
        );
        attempt = await this.serializedJsonCall<OpenTdbResponse>(
          'fallback',
          `https://opentdb.com/api.php?${params}`,
        );
      }
      response = attempt;
      if (attempt.response_code === 0 && attempt.results?.length) break;
      if (attempt.response_code !== 1) break;
    }
    if (!response || response.response_code !== 0 || !response.results?.length) {
      throw new Error(`OpenTDB returned response code ${response?.response_code ?? 'unknown'}`);
    }

    return deduplicateQuestions(response.results.map((item) => {
      const correct = safeDecode(item.correct_answer);
      const options = [correct, ...item.incorrect_answers.map(safeDecode)];
      const prompt = safeDecode(item.question);
      const decodedCategory = safeDecode(item.category);
      const mappedCategoryKey = requestedCategoryKey ?? categoryByOpenTdbName(decodedCategory)?.key;
      return {
        sourceId: `opentdb:${hash(`${prompt}\u0000${correct}`)}`,
        source: 'opentdb' as const,
        categoryKeys: mappedCategoryKey ? [mappedCategoryKey] : [],
        tags: [],
        category: decodedCategory,
        difficulty: item.difficulty,
        prompt,
        options,
        correctIndex: 0,
        hash: hash(`${prompt}\u0000${correct}`),
      };
    }));
  }

  private serializedJsonCall<T>(
    provider: 'primary' | 'fallback',
    url: string,
    headers: Record<string, string> = {},
  ): Promise<T> {
    const previous = provider === 'primary' ? this.primaryTail : this.fallbackTail;
    const task = previous.then(async () => {
      const now = Date.now();
      const lastAt = provider === 'primary' ? this.lastPrimaryAt : this.lastFallbackAt;
      const interval = provider === 'primary'
        ? config.theTriviaApiMinIntervalMs
        : config.openTdbMinIntervalMs;
      const wait = Math.max(0, interval - (now - lastAt));
      if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
      if (provider === 'primary') this.lastPrimaryAt = Date.now();
      else this.lastFallbackAt = Date.now();

      const response = await this.fetchFn(url, {
        headers,
        signal: AbortSignal.timeout(config.triviaApiTimeoutMs),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return (await response.json()) as T;
    });
    const settled = task.then(() => undefined, () => undefined);
    if (provider === 'primary') this.primaryTail = settled;
    else this.fallbackTail = settled;
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

function normalizeDifficulty(value: unknown): 'easy' | 'medium' | 'hard' {
  return value === 'hard' || value === 'medium' ? value : 'easy';
}

function uniqueAvailable(questions: TriviaQuestion[], excluded: Set<string>): number {
  return new Set(questions.filter((question) => !excluded.has(question.hash)).map((q) => q.hash)).size;
}

function pickPrioritizedUnique(
  groups: TriviaQuestion[][],
  count: number,
  excluded: Set<string>,
): TriviaQuestion[] {
  const selected: TriviaQuestion[] = [];
  const seen = new Set(excluded);
  for (const group of groups) {
    const unique = [...new Map(group.map((question) => [question.hash, question])).values()];
    shuffleInPlace(unique);
    for (const question of unique) {
      if (seen.has(question.hash)) continue;
      seen.add(question.hash);
      selected.push(question);
      if (selected.length >= count) return selected;
    }
  }
  return selected;
}

function shuffleInPlace<T>(items: T[]): void {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
}

function shuffleQuestion(question: TriviaQuestion): TriviaQuestion {
  const indexed = question.options.map((value, index) => ({ value, correct: index === question.correctIndex }));
  shuffleInPlace(indexed);
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

function extractQuestionArray(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  const record = asRecord(payload);
  if (!record) return [];
  if (Array.isArray(record.questions)) return record.questions;
  if (Array.isArray(record.results)) return record.results;
  return [];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function questionText(value: unknown): string {
  if (typeof value === 'string') return value;
  const record = asRecord(value);
  return record ? stringValue(record.text ?? record.value) : '';
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === 'string') return item.trim();
      const record = asRecord(item);
      return record ? stringValue(record.text ?? record.value ?? record.name) : '';
    })
    .filter(Boolean);
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeAnswer(value: string): string {
  return cleanText(value).toLowerCase();
}

function normalizeApiValue(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function deduplicateQuestions<T extends TriviaQuestion>(questions: T[]): T[] {
  return [...new Map(questions.map((question) => [question.hash, question])).values()];
}
