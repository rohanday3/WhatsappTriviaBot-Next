import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Database } from '../src/db/database.js';
import { Repository } from '../src/db/repository.js';
import { GameEngine } from '../src/game/game-engine.js';
import type { TriviaQuestion } from '../src/types.js';
import type { QuestionProvider } from '../src/trivia/question-provider.js';

const question: TriviaQuestion = {
  sourceId: 'fake:1', category: 'General Knowledge', difficulty: 'easy',
  prompt: '2 + 2?', options: ['4', '3', '5', '6'], correctIndex: 0, hash: 'fake-q1',
};

class FakeProvider {
  async getQuestions(input: { count: number }): Promise<TriviaQuestion[]> {
    return Array.from({ length: input.count }, (_, index) => ({
      ...question,
      sourceId: `fake:${index}`,
      hash: `fake-q${index}`,
    }));
  }
}

test('runs games concurrently across chats but refuses a second game in the same chat', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'trivia-engine-'));
  const db = new Database(join(directory, 'game.db'));
  const repository = new Repository(db);
  const sent: Array<{ chatId: string; text: string }> = [];
  const engine = new GameEngine(
    repository,
    new FakeProvider() as unknown as QuestionProvider,
    async (chatId, text) => { sent.push({ chatId, text }); },
  );
  engine.initialize();
  try {
    repository.touchChat('a@s.whatsapp.net', false);
    repository.touchChat('b@s.whatsapp.net', false);
    const alice = repository.upsertPlayer('a@s.whatsapp.net', undefined, 'Alice');
    const bob = repository.upsertPlayer('b@s.whatsapp.net', undefined, 'Bob');

    await Promise.all([
      engine.startGame('a@s.whatsapp.net', false, alice, { mode: 'classic', questions: 3, difficulty: 'mixed', category: null }),
      engine.startGame('b@s.whatsapp.net', false, bob, { mode: 'classic', questions: 3, difficulty: 'mixed', category: null }),
    ]);
    assert.equal(engine.activeGameCount, 2);

    await engine.startGame('a@s.whatsapp.net', false, alice, { mode: 'classic', questions: 3, difficulty: 'mixed', category: null });
    assert.equal(engine.activeGameCount, 2);
    assert.ok(sent.some((message) => message.chatId === 'a@s.whatsapp.net' && message.text.includes('already running')));

    assert.equal(await engine.answer('a@s.whatsapp.net', alice, 'A'), true);
    assert.equal(repository.getGameScores(engine.gameForChat('a@s.whatsapp.net')!.id)[0]?.score > 0, true);

    await engine.stopGame('a@s.whatsapp.net');
    await engine.stopGame('b@s.whatsapp.net');
    assert.equal(engine.activeGameCount, 0);
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
