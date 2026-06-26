import 'dotenv/config';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const source = resolve(process.env.DATABASE_PATH || './var/trivia.db');
const backupDir = resolve(process.env.BACKUP_DIR || join(dirname(source), 'backups'));
const retention = Number.parseInt(process.env.BACKUP_RETENTION || '14', 10);
mkdirSync(backupDir, { recursive: true });

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const destination = join(backupDir, `trivia-${stamp}.db`);
const escaped = destination.replaceAll("'", "''");
const db = new DatabaseSync(source);
try {
  db.exec(`PRAGMA wal_checkpoint(PASSIVE); VACUUM INTO '${escaped}';`);
} finally {
  db.close();
}

const backups = readdirSync(backupDir)
  .filter((name) => /^trivia-.*\.db$/.test(name))
  .sort()
  .reverse();
for (const old of backups.slice(Math.max(1, retention))) rmSync(join(backupDir, old));
console.log(`Backup created: ${destination} (${basename(source)})`);
