import { pino } from 'pino';
import { config } from './config.js';

const transport = process.env.NODE_ENV !== 'production' && process.stdout.isTTY
  ? pino.transport({
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:standard', singleLine: true },
    })
  : undefined;

export const logger = pino(
  {
    level: config.logLevel,
    base: { service: 'whatsapp-trivia-next', version: '3.0.0' },
    redact: {
      paths: ['pairingCode', 'qr', 'auth', '*.advSecretKey', '*.noiseKey'],
      censor: '[REDACTED]',
    },
  },
  transport,
);
