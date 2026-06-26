import 'dotenv/config';
import { existsSync, mkdirSync, accessSync, constants } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const checks = [];
const [major, minor] = process.versions.node.split('.').map(Number);
checks.push(['Node.js >= 22.13', major > 22 || (major === 22 && minor >= 13), process.version]);

const dbPath = resolve(process.env.DATABASE_PATH || './var/trivia.db');
mkdirSync(dirname(dbPath), { recursive: true });
let writable = true;
try { accessSync(dirname(dbPath), constants.W_OK); } catch { writable = false; }
checks.push(['Database directory writable', writable, dirname(dbPath)]);
checks.push(['Local question bank exists', existsSync(resolve('./data/questions.json')), resolve('./data/questions.json')]);

let integrity = 'not-created';
try {
  const db = new DatabaseSync(dbPath);
  const row = db.prepare('PRAGMA integrity_check').get();
  integrity = String(row?.integrity_check ?? 'unknown');
  db.close();
} catch (error) {
  integrity = `error: ${error.message}`;
}
checks.push(['SQLite integrity', integrity === 'ok' || integrity === 'not-created', integrity]);

for (const [name, ok, detail] of checks) {
  console.log(`${ok ? '✅' : '❌'} ${name}: ${detail}`);
}
if (checks.some(([, ok]) => !ok)) process.exit(1);
