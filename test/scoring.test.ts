import assert from 'node:assert/strict';
import test from 'node:test';
import { scoreAnswer } from '../src/game/scoring.js';
import type { ActiveGame, TriviaQuestion } from '../src/types.js';

const question: TriviaQuestion = {
  sourceId: 'test:1',
  category: 'General Knowledge',
  difficulty: 'medium',
  prompt: 'Question?',
  options: ['A', 'B', 'C', 'D'],
  correctIndex: 0,
  hash: 'hash',
};

const game: ActiveGame = {
  id: 'game',
  chatId: 'chat',
  isGroup: false,
  hostPlayerId: 1,
  mode: 'classic',
  status: 'active',
  phase: 'open',
  questions: [question],
  currentIndex: 0,
  questionOpenedAt: Date.now(),
  questionDeadlineAt: Date.now() + 25_000,
  timeoutSeconds: 25,
  revealDelayMs: 500,
  hintsEnabled: true,
  answeredPlayerIds: new Set(),
  hintedPlayerIds: new Set(),
  timer: null,
};

test('fast answers score more than slow answers', () => {
  const fast = scoreAnswer({ game, question, responseMs: 1000, usedHint: false });
  const slow = scoreAnswer({ game, question, responseMs: 20_000, usedHint: false });
  assert.ok(fast > slow);
});

test('a hint applies a point penalty', () => {
  const normal = scoreAnswer({ game, question, responseMs: 5000, usedHint: false });
  const hinted = scoreAnswer({ game, question, responseMs: 5000, usedHint: true });
  assert.ok(hinted < normal);
});

test('sprint mode has a score multiplier', () => {
  const classic = scoreAnswer({ game, question, responseMs: 1000, usedHint: false });
  const sprint = scoreAnswer({ game: { ...game, mode: 'sprint' }, question, responseMs: 1000, usedHint: false });
  assert.ok(sprint > classic);
});
