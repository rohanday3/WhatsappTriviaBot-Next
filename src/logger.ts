import { pino } from 'pino';
import { config } from './config.js';
import { APP_VERSION } from './version.js';

const transport = process.env.NODE_ENV !== 'production' && process.stdout.isTTY
  ? pino.transport({
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:standard', singleLine: true },
    })
  : undefined;

export const logger = pino(
  {
    level: config.logLevel,
    base: { service: 'whatsapp-trivia-next', version: APP_VERSION },
    redact: {
      paths: ['pairingCode', 'qr', 'auth', '*.advSecretKey', '*.noiseKey'],
      censor: '[REDACTED]',
    },
  },
  transport,
);
