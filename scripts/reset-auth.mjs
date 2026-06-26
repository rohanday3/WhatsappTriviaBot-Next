import 'dotenv/config';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

if (!process.argv.includes('--yes')) {
  console.error('This removes the linked WhatsApp session. Re-run with: node scripts/reset-auth.mjs --yes');
  process.exit(2);
}
const path = resolve(process.env.DATABASE_PATH || './var/trivia.db');
const db = new DatabaseSync(path);
try {
  db.exec('BEGIN IMMEDIATE; DELETE FROM auth_keys; DELETE FROM auth_creds; COMMIT;');
  console.log('WhatsApp authentication cleared. Restart the bot and pair again.');
} catch (error) {
  try { db.exec('ROLLBACK'); } catch {}
  throw error;
} finally {
  db.close();
}
