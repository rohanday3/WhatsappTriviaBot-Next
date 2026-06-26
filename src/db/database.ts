import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type SQLInputValue, type StatementResultingChanges } from 'node:sqlite';
import { SCHEMA_SQL } from './schema.js';
import { logger } from '../logger.js';

export class Database {
  readonly raw: DatabaseSync;
  private closed = false;

  constructor(readonly path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.raw = new DatabaseSync(path);
    this.raw.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      PRAGMA temp_store = MEMORY;
      PRAGMA wal_autocheckpoint = 1000;
    `);
    this.raw.exec(SCHEMA_SQL);
    this.run(
      'INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES (?, ?)',
      [1, Date.now()],
    );
    logger.info({ databasePath: path }, 'Database ready');
  }

  run(sql: string, params: SQLInputValue[] = []): StatementResultingChanges {
    this.assertOpen();
    return this.raw.prepare(sql).run(...params);
  }

  get<T extends Record<string, unknown>>(sql: string, params: SQLInputValue[] = []): T | undefined {
    this.assertOpen();
    return this.raw.prepare(sql).get(...params) as T | undefined;
  }

  all<T extends Record<string, unknown>>(sql: string, params: SQLInputValue[] = []): T[] {
    this.assertOpen();
    return this.raw.prepare(sql).all(...params) as T[];
  }

  exec(sql: string): void {
    this.assertOpen();
    this.raw.exec(sql);
  }

  transaction<T>(fn: () => T): T {
    this.assertOpen();
    this.raw.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.raw.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        this.raw.exec('ROLLBACK');
      } catch {
        // Preserve the original error.
      }
      throw error;
    }
  }

  isHealthy(): boolean {
    try {
      return this.get<{ ok: number }>('SELECT 1 AS ok')?.ok === 1;
    } catch {
      return false;
    }
  }

  checkpoint(): void {
    if (!this.closed) this.raw.exec('PRAGMA wal_checkpoint(PASSIVE)');
  }

  pruneOperationalData(now = Date.now()): void {
    const processedCutoff = now - 24 * 60 * 60 * 1000;
    const historyCutoff = now - 180 * 24 * 60 * 60 * 1000;
    this.transaction(() => {
      this.run('DELETE FROM processed_messages WHERE received_at < ?', [processedCutoff]);
      this.run('DELETE FROM question_history WHERE last_used_at < ?', [historyCutoff]);
    });
  }

  close(): void {
    if (this.closed) return;
    this.checkpoint();
    this.raw.close();
    this.closed = true;
    logger.info('Database closed');
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('Database is closed');
  }
}
