import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Database } from '../src/db/database.js';
import { Repository } from '../src/db/repository.js';
import type { ActiveGame, TriviaQuestion } from '../src/types.js';

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'trivia-repo-'));
  const db = new Database(join(directory, 'test.db'));
  const repository = new Repository(db);
  return {
    db,
    repository,
    close() {
      db.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}

const questions: TriviaQuestion[] = [{
  sourceId: 'local:1',
  category: 'General Knowledge',
  difficulty: 'easy',
  prompt: 'Capital of France?',
  options: ['Paris', 'London', 'Rome', 'Berlin'],
  correctIndex: 0,
  hash: 'q1',
}];

test('keeps simultaneous games isolated by chat and updates scoped leaderboards', () => {
  const f = fixture();
  try {
    f.repository.touchChat('group-a@g.us', true);
    f.repository.touchChat('group-b@g.us', true);
    const alice = f.repository.upsertPlayer('alice@s.whatsapp.net', undefined, 'Alice');
    const bob = f.repository.upsertPlayer('bob@s.whatsapp.net', undefined, 'Bob');

    const gameAId = f.repository.createGame({
      chatId: 'group-a@g.us', isGroup: true, hostPlayerId: alice.id, mode: 'classic',
      category: null, difficulty: 'mixed', timeoutSeconds: 20, revealDelayMs: 500,
      hintsEnabled: true, questions,
    });
    const gameBId = f.repository.createGame({
      chatId: 'group-b@g.us', isGroup: true, hostPlayerId: bob.id, mode: 'classic',
      category: null, difficulty: 'mixed', timeoutSeconds: 20, revealDelayMs: 500,
      hintsEnabled: true, questions,
    });

    const gameA = activeGame(gameAId, 'group-a@g.us', alice.id);
    const gameB = activeGame(gameBId, 'group-b@g.us', bob.id);
    f.repository.recordAnswer({ game: gameA, playerId: alice.id, answerIndex: 0, isCorrect: true, responseMs: 1000, points: 150 });
    f.repository.recordAnswer({ game: gameB, playerId: bob.id, answerIndex: 0, isCorrect: true, responseMs: 2000, points: 140 });
    f.repository.completeGame(gameA);
    f.repository.completeGame(gameB);

    assert.equal(f.repository.leaderboard('chat', 'group-a@g.us')[0]?.name, 'Alice');
    assert.equal(f.repository.leaderboard('chat', 'group-b@g.us')[0]?.name, 'Bob');
    assert.deepEqual(f.repository.leaderboard('global', 'unused').map((entry) => entry.name), ['Alice', 'Bob']);
  } finally {
    f.close();
  }
});

test('deduplicates messages durably', () => {
  const f = fixture();
  try {
    assert.equal(f.repository.isMessageProcessed('message-1'), false);
    assert.equal(f.repository.isMessageProcessed('message-1'), true);
  } finally {
    f.close();
  }
});

function activeGame(id: string, chatId: string, hostPlayerId: number): ActiveGame {
  return {
    id, chatId, isGroup: true, hostPlayerId, mode: 'classic', status: 'active', phase: 'open',
    questions, currentIndex: 0, questionOpenedAt: Date.now() - 1000,
    questionDeadlineAt: Date.now() + 19_000, timeoutSeconds: 20, revealDelayMs: 500,
    hintsEnabled: true, answeredPlayerIds: new Set(), hintedPlayerIds: new Set(),
    pendingAchievements: new Map(), expectedAnswererCount: 0, eliminatedPlayerIds: new Set(), timer: null,
  };
}

test('question cooldown is isolated per chat and expires by time', () => {
  const f = fixture();
  try {
    f.repository.touchChat('cooldown-a@g.us', true);
    f.repository.touchChat('cooldown-b@g.us', true);
    const player = f.repository.upsertPlayer('cooldown@s.whatsapp.net', undefined, 'Cooldown');
    f.repository.createGame({
      chatId: 'cooldown-a@g.us', isGroup: true, hostPlayerId: player.id, mode: 'classic',
      category: 'general', difficulty: 'mixed', timeoutSeconds: 20, revealDelayMs: 500,
      hintsEnabled: true, questions,
    });

    const now = Date.now();
    assert.equal(f.repository.recentQuestionHashes('cooldown-a@g.us', 24, now).has('q1'), true);
    assert.equal(f.repository.recentQuestionHashes('cooldown-b@g.us', 24, now).has('q1'), false);
    assert.equal(f.repository.recentQuestionHashes('cooldown-a@g.us', 0, now).size, 0);
    assert.equal(
      f.repository.recentQuestionHashes('cooldown-a@g.us', 24, now + 25 * 60 * 60 * 1000).has('q1'),
      false,
    );
  } finally {
    f.close();
  }
});

test('persists a per-chat question cooldown setting', () => {
  const f = fixture();
  try {
    f.repository.touchChat('settings@g.us', true);
    const settings = f.repository.getSettings('settings@g.us');
    settings.questionCooldownHours = 72;
    f.repository.saveSettings('settings@g.us', settings);
    assert.equal(f.repository.getSettings('settings@g.us').questionCooldownHours, 72);
  } finally {
    f.close();
  }
});
