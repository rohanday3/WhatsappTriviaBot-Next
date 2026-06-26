import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Database } from '../src/db/database.js';
import { useSqliteAuthState } from '../src/whatsapp/sqlite-auth.js';

test('persists credentials and signal keys in SQLite', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'trivia-auth-'));
  const path = join(directory, 'auth.db');
  try {
    const db = new Database(path);
    const first = useSqliteAuthState(db);
    first.state.creds.registered = true;
    await first.state.keys.set({ 'lid-mapping': { example: '27820000000@s.whatsapp.net' } });
    await first.saveCreds();
    db.close();

    const reopened = new Database(path);
    const second = useSqliteAuthState(reopened);
    assert.equal(second.state.creds.registered, true);
    const keys = await second.state.keys.get('lid-mapping', ['example']);
    assert.equal(keys.example, '27820000000@s.whatsapp.net');
    reopened.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
