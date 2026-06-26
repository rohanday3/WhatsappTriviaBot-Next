import { loadavg, platform } from 'node:os';
import type { HealthSnapshot } from '../types.js';

export interface QueueSnapshot {
  activeKeys: number;
  pendingTasks: number;
  maxDepth: number;
}

export interface RecentServiceError {
  at: number;
  label: string;
}

export interface AdminHealthDiagnostics {
  checkedAt: number;
  checkDurationMs: number;
  connectionState: string;
  maxConcurrentGames: number;
  outboundQueue: QueueSnapshot;
  gameQueue: QueueSnapshot;
  reconnectAttempts: number;
  rssBytes: number;
  heapUsedBytes: number;
  heapTotalBytes: number;
  cpuAveragePercent: number;
  loadAverage1m: number | null;
  databaseBytes: number | null;
  diskFreeBytes: number | null;
  nodeVersion: string;
  recentErrors: RecentServiceError[];
}

export function formatAdminHealthReport(
  botName: string,
  health: HealthSnapshot,
  diagnostics: AdminHealthDiagnostics,
  timezone: string,
  full = false,
): string {
  const status = health.ready
    ? '🟢 READY'
    : health.live
      ? '🟠 DEGRADED'
      : '🔴 STOPPING';
  const lines = [
    `🩺 *${botName} server health*`,
    `Status: *${status}*`,
    `Checked: ${formatTimestamp(diagnostics.checkedAt, timezone)} (${diagnostics.checkDurationMs}ms)`,
    '',
    `📱 WhatsApp: *${diagnostics.connectionState}*`,
    `🗄️ Database: *${health.databaseReady ? 'healthy' : 'unhealthy'}*${diagnostics.databaseBytes === null ? '' : ` (${formatBytes(diagnostics.databaseBytes)})`}`,
    `🎮 Games: *${health.activeGames}/${diagnostics.maxConcurrentGames}* active`,
    `📤 Outbound queue: *${diagnostics.outboundQueue.pendingTasks}* task(s) across *${diagnostics.outboundQueue.activeKeys}* chat(s)`,
    `🧠 Game queue: *${diagnostics.gameQueue.pendingTasks}* task(s) across *${diagnostics.gameQueue.activeKeys}* chat(s)`,
    '',
    `⏱️ Uptime: *${formatLongDuration(health.uptimeSeconds)}*`,
    `💾 Memory: *${formatBytes(diagnostics.rssBytes)} RSS* | ${formatBytes(diagnostics.heapUsedBytes)}/${formatBytes(diagnostics.heapTotalBytes)} heap`,
    `⚙️ CPU average: *${diagnostics.cpuAveragePercent.toFixed(1)}% of one core*${diagnostics.loadAverage1m === null ? '' : ` | host load 1m: ${diagnostics.loadAverage1m.toFixed(2)}`}`,
    `💿 Disk free: *${diagnostics.diskFreeBytes === null ? 'unavailable' : formatBytes(diagnostics.diskFreeBytes)}*`,
    `🔁 Reconnect attempts: *${diagnostics.reconnectAttempts}*`,
    '',
    `💬 Last inbound activity: *${formatRelativeTime(health.lastMessageAt, diagnostics.checkedAt)}*`,
    `⚠️ Last error: *${formatRelativeTime(health.lastErrorAt, diagnostics.checkedAt, 'none since startup')}*`,
  ];

  if (full) {
    lines.push('', '🧾 *Recent error summaries*');
    if (!diagnostics.recentErrors.length) {
      lines.push('• None recorded since startup');
    } else {
      for (const error of diagnostics.recentErrors.slice(-5).reverse()) {
        lines.push(`• ${formatRelativeTime(error.at, diagnostics.checkedAt)} — ${sanitizeLabel(error.label)}`);
      }
    }
    lines.push('', `Runtime: Node ${diagnostics.nodeVersion}`);
  }

  lines.push('', '_Sensitive paths, IP addresses and credentials are intentionally omitted._');
  return lines.join('\n');
}

export function processCpuAveragePercent(): number {
  const uptimeSeconds = process.uptime();
  if (uptimeSeconds <= 0) return 0;
  const usage = process.cpuUsage();
  return ((usage.user + usage.system) / 1_000_000 / uptimeSeconds) * 100;
}

export function oneMinuteLoadAverage(): number | null {
  if (platform() === 'win32') return null;
  const value = loadavg()[0] ?? Number.NaN;
  return Number.isFinite(value) ? value : null;
}

function formatTimestamp(timestamp: number, timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-ZA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(new Date(timestamp));
  } catch {
    return new Date(timestamp).toISOString();
  }
}

function formatRelativeTime(timestamp: number | null, now: number, empty = 'not yet'): string {
  if (timestamp === null) return empty;
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatLongDuration(totalSeconds: number): string {
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const parts: string[] = [];
  if (days) parts.push(`${days}d`);
  if (hours || days) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return parts.join(' ');
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return 'unavailable';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  const precision = index === 0 || value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(precision)} ${units[index]}`;
}

function sanitizeLabel(label: string): string {
  return label.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 120) || 'Unlabelled error';
}
