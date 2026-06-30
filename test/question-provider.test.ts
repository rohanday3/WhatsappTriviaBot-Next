import assert from 'node:assert/strict';
import test from 'node:test';
import { QuestionProvider } from '../src/trivia/question-provider.js';

test('keeps category selection strict when only the local fallback is available', async () => {
  const provider = new QuestionProvider(false);
  await provider.initialize();

  const questions = await provider.getQuestions({
    count: 10,
    category: 'film',
    difficulty: 'mixed',
    excludeHashes: new Set(),
  });

  assert.equal(questions.length, 4);
  assert.ok(questions.every((question) => question.category === 'Movies'));
});

test('maps local category aliases without leaking unrelated questions', async () => {
  const provider = new QuestionProvider(false);
  await provider.initialize();

  const questions = await provider.getQuestions({
    count: 10,
    category: 'computers',
    difficulty: 'mixed',
    excludeHashes: new Set(),
  });

  assert.equal(questions.length, 4);
  assert.ok(questions.every((question) => question.category === 'Technology'));
});

test('does not bypass excluded question hashes when too few fresh questions remain', async () => {
  const provider = new QuestionProvider(false);
  await provider.initialize();

  const first = await provider.getQuestions({
    count: 4,
    category: 'sports',
    difficulty: 'mixed',
    excludeHashes: new Set(),
  });

  await assert.rejects(
    provider.getQuestions({
      count: 4,
      category: 'sports',
      difficulty: 'mixed',
      excludeHashes: new Set(first.slice(0, 2).map((question) => question.hash)),
    }),
    /Only 2 fresh questions are available for Sports/,
  );
});
