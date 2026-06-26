import { TriviaApplication } from './app.js';
import { logger } from './logger.js';

const application = new TriviaApplication();
let shuttingDown = false;

async function shutdown(signal: string, exitCode = 0): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Graceful shutdown started');
  const forceExit = setTimeout(() => {
    logger.fatal('Graceful shutdown timed out');
    process.exit(1);
  }, 15_000);
  forceExit.unref();
  try {
    await application.stop();
    clearTimeout(forceExit);
    process.exit(exitCode);
  } catch (error) {
    logger.fatal({ err: error }, 'Shutdown failed');
    process.exit(1);
  }
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('uncaughtException', (error) => {
  logger.fatal({ err: error }, 'Uncaught exception');
  void shutdown('uncaughtException', 1);
});
process.on('unhandledRejection', (error) => {
  logger.fatal({ err: error }, 'Unhandled rejection');
  void shutdown('unhandledRejection', 1);
});

application.start().catch((error) => {
  logger.fatal({ err: error }, 'Application failed to start');
  process.exit(1);
});
