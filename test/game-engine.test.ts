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


test('offers hints only when they can remove two wrong options without revealing the answer', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'trivia-hint-'));
  const db = new Database(join(directory, 'game.db'));
  const repository = new Repository(db);
  const sent: Array<{ chatId: string; text: string }> = [];

  class FixedProvider {
    constructor(private readonly fixedQuestion: TriviaQuestion) {}
    async getQuestions(input: { count: number }): Promise<TriviaQuestion[]> {
      return Array.from({ length: input.count }, (_, index) => ({
        ...this.fixedQuestion,
        sourceId: `${this.fixedQuestion.sourceId}:${index}`,
        hash: `${this.fixedQuestion.hash}:${index}`,
      }));
    }
  }

  try {
    repository.touchChat('solo@s.whatsapp.net', false);
    const player = repository.upsertPlayer('solo@s.whatsapp.net', undefined, 'Solo');
    const multipleChoiceEngine = new GameEngine(
      repository,
      new FixedProvider(question) as unknown as QuestionProvider,
      async (chatId, text) => { sent.push({ chatId, text }); },
    );
    multipleChoiceEngine.initialize();
    await multipleChoiceEngine.startGame('solo@s.whatsapp.net', false, player, {
      mode: 'classic', questions: 1, difficulty: 'mixed', category: null,
    });
    await multipleChoiceEngine.hint('solo@s.whatsapp.net', player);
    const hint = sent.at(-1)?.text ?? '';
    assert.match(hint, /two wrong options removed/i);
    assert.equal(hint.split('\n').filter((line) => /^[A-D]\)/.test(line)).length, 2);
    await multipleChoiceEngine.stopGame('solo@s.whatsapp.net');

    const binaryQuestion: TriviaQuestion = {
      ...question,
      sourceId: 'fake:boolean',
      prompt: 'The sky is blue.',
      options: ['True', 'False'],
      correctIndex: 0,
      hash: 'fake-boolean',
    };
    const binaryEngine = new GameEngine(
      repository,
      new FixedProvider(binaryQuestion) as unknown as QuestionProvider,
      async (chatId, text) => { sent.push({ chatId, text }); },
    );
    binaryEngine.initialize();
    await binaryEngine.startGame('solo@s.whatsapp.net', false, player, {
      mode: 'classic', questions: 1, difficulty: 'mixed', category: null,
    });
    await binaryEngine.hint('solo@s.whatsapp.net', player);
    assert.match(sent.at(-1)?.text ?? '', /not available for two-choice questions/i);
    await binaryEngine.stopGame('solo@s.whatsapp.net');
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
