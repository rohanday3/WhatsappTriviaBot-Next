import assert from 'node:assert/strict';
import test from 'node:test';
import { KeyedQueue } from '../src/util/keyed-queue.js';

test('serializes work for the same key while allowing different keys', async () => {
  const queue = new KeyedQueue();
  const events: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });

  const first = queue.run('chat-a', async () => {
    events.push('a1-start');
    await gate;
    events.push('a1-end');
  });
  const second = queue.run('chat-a', async () => {
    events.push('a2');
  });
  const other = queue.run('chat-b', async () => {
    events.push('b1');
  });

  await other;
  assert.deepEqual(events, ['a1-start', 'b1']);
  assert.deepEqual(queue.stats, { activeKeys: 1, pendingTasks: 2, maxDepth: 2 });
  release();
  await Promise.all([first, second]);
  assert.deepEqual(events, ['a1-start', 'b1', 'a1-end', 'a2']);
  assert.equal(queue.depth('chat-a'), 0);
  assert.deepEqual(queue.stats, { activeKeys: 0, pendingTasks: 0, maxDepth: 0 });
});
