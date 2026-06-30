import 'dotenv/config';
import { resolve } from 'node:path';

function integer(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}`);
  }
  return value;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

function list(name: string): string[] {
  return (process.env[name] ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

const pairingMode = (process.env.PAIRING_MODE ?? 'qr').toLowerCase();
if (!['qr', 'code'].includes(pairingMode)) {
  throw new Error('PAIRING_MODE must be qr or code');
}

const triviaApiEnabled = bool('TRIVIA_API_ENABLED', true);

export const config = Object.freeze({
  botName: process.env.BOT_NAME?.trim() || 'Quizzy',
  commandPrefix: process.env.COMMAND_PREFIX?.trim() || '/',
  timezone: process.env.TIMEZONE?.trim() || 'Africa/Johannesburg',
  pairingMode: pairingMode as 'qr' | 'code',
  pairingNumber: (process.env.PAIRING_NUMBER ?? '').replace(/\D/g, ''),
  databasePath: resolve(process.env.DATABASE_PATH || './var/trivia.db'),
  logLevel: process.env.LOG_LEVEL || 'info',
  healthHost: process.env.HEALTH_HOST || '127.0.0.1',
  healthPort: integer('HEALTH_PORT', 8787, 1, 65535),
  defaultQuestions: integer('DEFAULT_QUESTIONS', 10, 3, 30),
  defaultTimeoutSeconds: integer('DEFAULT_TIMEOUT_SECONDS', 25, 8, 90),
  defaultRevealDelayMs: integer('DEFAULT_REVEAL_DELAY_MS', 2200, 500, 10_000),
  defaultQuestionCooldownHours: integer('DEFAULT_QUESTION_COOLDOWN_HOURS', 168, 0, 4320),
  maxConcurrentGames: integer('MAX_CONCURRENT_GAMES', 250, 1, 10_000),
  maxOutboundQueuePerChat: integer('MAX_OUTBOUND_QUEUE_PER_CHAT', 50, 5, 500),

  // TRIVIA_API_ENABLED remains as a master switch for backwards compatibility.
  triviaApiEnabled,
  theTriviaApiEnabled: triviaApiEnabled && bool('THE_TRIVIA_API_ENABLED', true),
  theTriviaApiKey: process.env.THE_TRIVIA_API_KEY?.trim() || '',
  theTriviaApiMinIntervalMs: integer('THE_TRIVIA_API_MIN_INTERVAL_MS', 250, 0, 60_000),
  openTdbEnabled: triviaApiEnabled && bool('OPENTDB_ENABLED', true),
  openTdbMinIntervalMs: integer('TRIVIA_API_MIN_INTERVAL_MS', 5500, 1000, 60_000),
  triviaApiTimeoutMs: integer('TRIVIA_API_TIMEOUT_MS', 8000, 1000, 30_000),
  triviaFetchBatchSize: integer('TRIVIA_FETCH_BATCH_SIZE', 20, 5, 20),
  triviaCacheMaxQuestions: integer('TRIVIA_CACHE_MAX_QUESTIONS', 20_000, 500, 200_000),
  // Retained so older environment files do not break; the durable SQLite cache no longer expires on this timer.
  triviaCacheTtlMinutes: integer('TRIVIA_CACHE_TTL_MINUTES', 360, 10, 10_080),

  botAdmins: new Set(list('BOT_ADMINS').map(normalizeAdmin)),
});

function normalizeAdmin(value: string): string {
  if (value.includes('@')) return value;
  return `${value.replace(/\D/g, '')}@s.whatsapp.net`;
}
