import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { Database } from '../src/db/database.js';

test('adds the question cooldown column to an existing database', () => {
  const directory = mkdtempSync(join(tmpdir(), 'trivia-migration-'));
  const path = join(directory, 'old.db');
  const old = new DatabaseSync(path);
  old.exec(`
    CREATE TABLE chat_settings (
      chat_id TEXT PRIMARY KEY,
      questions_per_game INTEGER NOT NULL,
      timeout_seconds INTEGER NOT NULL,
      reveal_delay_ms INTEGER NOT NULL,
      default_difficulty TEXT NOT NULL,
      default_category TEXT,
      show_round_leaderboard INTEGER NOT NULL DEFAULT 1,
      hints_enabled INTEGER NOT NULL DEFAULT 1,
      custom_groups_json TEXT NOT NULL DEFAULT '{}',
      updated_at INTEGER NOT NULL
    ) WITHOUT ROWID;
  `);
  old.close();

  const db = new Database(path);
  try {
    const columns = db.all<{ name: string }>('PRAGMA table_info(chat_settings)');
    assert.ok(columns.some((column) => column.name === 'question_cooldown_hours'));
    const cacheTable = db.get<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'trivia_question_cache'",
    );
    assert.equal(cacheTable?.name, 'trivia_question_cache');
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
