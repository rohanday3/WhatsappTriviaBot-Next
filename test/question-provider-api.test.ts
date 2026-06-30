import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Database } from '../src/db/database.js';
import { Repository } from '../src/db/repository.js';
import { QuestionProvider } from '../src/trivia/question-provider.js';

test('uses The Trivia API as primary and rejects broad-category tag mismatches', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'trivia-primary-'));
  const db = new Database(join(directory, 'test.db'));
  const repository = new Repository(db);
  const requestedUrls: string[] = [];
  const fetchFn: typeof fetch = async (input) => {
    requestedUrls.push(String(input));
    return new Response(JSON.stringify([
      primaryQuestion('film-1', 'film', 'Who directed Film One?'),
      primaryQuestion('film-2', 'movies', 'Who starred in Film Two?'),
      primaryQuestion('film-3', 'cinema', 'When was Film Three released?'),
      primaryQuestion('tv-1', 'television', 'Which network aired This TV Show?'),
    ]), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const provider = new QuestionProvider({
      cache: repository,
      primaryEnabled: true,
      fallbackEnabled: false,
      fetchFn,
    });
    await provider.initialize();
    const questions = await provider.getQuestions({
      count: 3,
      category: 'film',
      difficulty: 'easy',
      excludeHashes: new Set(),
    });

    assert.equal(questions.length, 3);
    assert.ok(questions.every((question) => question.sourceId.startsWith('the-trivia-api:')));
    assert.ok(questions.every((question) => question.category === 'Film'));
    assert.ok(questions.every((question) => !question.prompt.includes('TV Show')));
    assert.match(requestedUrls[0] ?? '', /categories=film_and_tv/);
    assert.match(requestedUrls[0] ?? '', /difficulties=easy/);

    const offlineProvider = new QuestionProvider({
      cache: repository,
      primaryEnabled: true,
      fallbackEnabled: false,
      fetchFn: async () => { throw new Error('network should not be used'); },
    });
    await offlineProvider.initialize();
    const cached = await offlineProvider.getQuestions({
      count: 3,
      category: 'film',
      difficulty: 'easy',
      excludeHashes: new Set(),
    });
    assert.equal(cached.length, 3);
    assert.ok(cached.every((question) => question.sourceId.startsWith('the-trivia-api:')));
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

function primaryQuestion(id: string, tag: string, text: string) {
  return {
    id,
    category: 'film_and_tv',
    tags: [tag],
    difficulty: 'easy',
    type: 'text_choice',
    question: { text },
    correctAnswer: `${id} correct`,
    incorrectAnswers: [`${id} wrong 1`, `${id} wrong 2`, `${id} wrong 3`],
  };
}
