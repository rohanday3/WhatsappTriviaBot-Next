import assert from 'node:assert/strict';
import test from 'node:test';
import { formatAdminHealthReport } from '../src/admin/health-report.js';
import type { HealthSnapshot } from '../src/types.js';

const health: HealthSnapshot = {
  live: true,
  ready: true,
  whatsappConnected: true,
  databaseReady: true,
  activeGames: 3,
  uptimeSeconds: 90_061,
  lastMessageAt: 1_999_995,
  lastErrorAt: null,
};

test('formats a compact admin-only server health report without sensitive paths', () => {
  const report = formatAdminHealthReport('Quizzy', health, {
    checkedAt: 2_000_000,
    checkDurationMs: 4,
    connectionState: 'connected',
    maxConcurrentGames: 250,
    outboundQueue: { activeKeys: 1, pendingTasks: 2, maxDepth: 2 },
    gameQueue: { activeKeys: 0, pendingTasks: 0, maxDepth: 0 },
    reconnectAttempts: 0,
    rssBytes: 128 * 1024 * 1024,
    heapUsedBytes: 32 * 1024 * 1024,
    heapTotalBytes: 64 * 1024 * 1024,
    cpuAveragePercent: 1.25,
    loadAverage1m: 0.42,
    databaseBytes: 2 * 1024 * 1024,
    diskFreeBytes: 20 * 1024 * 1024 * 1024,
    nodeVersion: 'v22.13.0',
    recentErrors: [],
  }, 'Africa/Johannesburg');

  assert.match(report, /READY/);
  assert.match(report, /Games: \*3\/250\*/);
  assert.match(report, /128 MB RSS/);
  assert.match(report, /Last error: \*none since startup\*/);
  assert.doesNotMatch(report, /\/opt\/|C:\\/i);
});

test('full report includes only recent error summaries', () => {
  const report = formatAdminHealthReport('Quizzy', { ...health, ready: false, lastErrorAt: 1_999_000 }, {
    checkedAt: 2_000_000,
    checkDurationMs: 3,
    connectionState: 'disconnected',
    maxConcurrentGames: 100,
    outboundQueue: { activeKeys: 0, pendingTasks: 0, maxDepth: 0 },
    gameQueue: { activeKeys: 1, pendingTasks: 1, maxDepth: 1 },
    reconnectAttempts: 2,
    rssBytes: 1,
    heapUsedBytes: 1,
    heapTotalBytes: 2,
    cpuAveragePercent: 0,
    loadAverage1m: null,
    databaseBytes: null,
    diskFreeBytes: null,
    nodeVersion: 'v22.13.0',
    recentErrors: [{ at: 1_999_000, label: 'Reconnect attempt failed\nsecret stack omitted' }],
  }, 'Africa/Johannesburg', true);

  assert.match(report, /DEGRADED/);
  assert.match(report, /Recent error summaries/);
  assert.match(report, /Reconnect attempt failed secret stack omitted/);
  assert.match(report, /Runtime: Node v22\.13\.0/);
});
