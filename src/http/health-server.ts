import { createServer, type Server } from 'node:http';
import { config } from '../config.js';
import { logger } from '../logger.js';
import type { HealthSnapshot } from '../types.js';

export class HealthServer {
  private server: Server | null = null;

  constructor(private readonly snapshot: () => HealthSnapshot) {}

  async start(): Promise<void> {
    if (this.server) return;
    this.server = createServer((request, response) => {
      const health = this.snapshot();
      if (request.url === '/health/live') {
        respondJson(response, 200, { status: 'ok', ...health });
        return;
      }
      if (request.url === '/health/ready') {
        respondJson(response, health.ready ? 200 : 503, {
          status: health.ready ? 'ready' : 'not_ready',
          ...health,
        });
        return;
      }
      if (request.url === '/metrics') {
        const memory = process.memoryUsage();
        const lines = [
          '# HELP trivia_ready Whether the bot is ready to accept work.',
          '# TYPE trivia_ready gauge',
          `trivia_ready ${health.ready ? 1 : 0}`,
          '# HELP trivia_whatsapp_connected WhatsApp connection state.',
          '# TYPE trivia_whatsapp_connected gauge',
          `trivia_whatsapp_connected ${health.whatsappConnected ? 1 : 0}`,
          '# HELP trivia_active_games Number of active games.',
          '# TYPE trivia_active_games gauge',
          `trivia_active_games ${health.activeGames}`,
          '# HELP process_resident_memory_bytes Resident memory size.',
          '# TYPE process_resident_memory_bytes gauge',
          `process_resident_memory_bytes ${memory.rss}`,
          '# HELP process_uptime_seconds Process uptime.',
          '# TYPE process_uptime_seconds counter',
          `process_uptime_seconds ${Math.floor(process.uptime())}`,
          '',
        ];
        response.writeHead(200, { 'content-type': 'text/plain; version=0.0.4' });
        response.end(lines.join('\n'));
        return;
      }
      respondJson(response, 404, { error: 'not_found' });
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(config.healthPort, config.healthHost, () => {
        this.server!.off('error', reject);
        resolve();
      });
    });
    logger.info(
      { host: config.healthHost, port: config.healthPort },
      'Health endpoint listening',
    );
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    const server = this.server;
    this.server = null;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function respondJson(
  response: import('node:http').ServerResponse,
  status: number,
  body: unknown,
): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}
