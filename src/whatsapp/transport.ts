import qrcode from 'qrcode-terminal';
import makeWASocket, {
  Browsers,
  DisconnectReason,
  extractMessageContent,
  fetchLatestBaileysVersion,
  jidNormalizedUser,
  normalizeMessageContent,
  type GroupMetadata,
  type WASocket,
  type WAMessage,
  type WAMessageContent,
} from 'baileys';
import { config } from '../config.js';
import { Database } from '../db/database.js';
import { logger } from '../logger.js';
import type { IncomingMessage } from '../types.js';
import { KeyedQueue } from '../util/keyed-queue.js';
import { safeName } from '../util/text.js';
import { useSqliteAuthState } from './sqlite-auth.js';

export type ConnectionState = 'starting' | 'connecting' | 'connected' | 'disconnected' | 'logged_out';

interface CachedMetadata {
  value: GroupMetadata;
  expiresAt: number;
}

interface CachedSentMessage {
  content: WAMessageContent;
  expiresAt: number;
}

/** How long a sent message stays available to answer decryption-retry receipts (iOS "waiting for message" fix). */
const SENT_MESSAGE_TTL_MS = 10 * 60_000;
/** Upper bound on the outbound retry cache so it can't grow without limit. */
const SENT_MESSAGE_CACHE_MAX = 2_000;

/** Persisted so a service restart cannot reset an in-progress backoff back to its fast rungs. */
const RECONNECT_STATE_KEY = 'whatsapp.reconnect';

interface PersistedReconnectState {
  attempts: number;
  lastFailureAt: number;
}

/**
 * The session is gone; reconnecting can never succeed and the operator must re-pair.
 * 401 loggedOut, 403 forbidden.
 */
const TERMINAL_STATUS = new Set<number>([DisconnectReason.loggedOut, 403]);

/**
 * The server will keep refusing until something outside this process changes: a retired
 * WhatsApp Web client version (405), another connection holding the session (440), or session
 * state the server rejects (500). These are not transient, so they get a far longer ceiling —
 * retrying 405 on the ordinary ladder produced ~700 pointless attempts in 12 hours before the
 * server escalated the refusal to an outright 401 logout.
 */
const HARD_FAILURE_STATUS = new Set<number>([405, 440, 500]);

/** The session is dead; only re-pairing can recover it. */
export function isTerminalStatus(statusCode: number | undefined): boolean {
  return statusCode !== undefined && TERMINAL_STATUS.has(statusCode);
}

/** Retrying may eventually work, but not soon and not on the fast ladder. */
export function isHardFailureStatus(statusCode: number | undefined): boolean {
  return statusCode !== undefined && HARD_FAILURE_STATUS.has(statusCode);
}

/** Backoff before jitter. Exported for testing. */
export function reconnectBaseDelayMs(attempt: number, statusCode: number | undefined): number {
  const ceiling = isHardFailureStatus(statusCode)
    ? config.reconnectHardFailureDelayMs
    : config.reconnectMaxDelayMs;
  // Exponent capped high enough that the hard-failure ceiling is actually reachable.
  return Math.min(ceiling, 1000 * 2 ** Math.min(Math.max(attempt, 1) - 1, 10));
}

export class WhatsAppTransport {
  private socket: WASocket | null = null;
  private state: ConnectionState = 'starting';
  private stopped = false;
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pairingRequested = false;
  private readonly sendQueue = new KeyedQueue(config.maxOutboundQueuePerChat);
  private readonly metadataCache = new Map<string, CachedMetadata>();
  private readonly sentMessages = new Map<string, CachedSentMessage>();

  constructor(
    private readonly db: Database,
    private readonly onMessage: (message: IncomingMessage) => Promise<void>,
    private readonly onStateChange: (state: ConnectionState) => void,
    private readonly onOperationalError: (error: unknown, label: string) => void = () => undefined,
  ) {}

  get connectionState(): ConnectionState {
    return this.state;
  }

  get connected(): boolean {
    return this.state === 'connected';
  }

  get queueStats(): { activeKeys: number; pendingTasks: number; maxDepth: number } {
    return this.sendQueue.stats;
  }

  get reconnectAttemptCount(): number {
    return this.reconnectAttempts;
  }

  async start(): Promise<void> {
    this.stopped = false;
    this.reconnectAttempts = this.loadReconnectAttempts();
    if (this.reconnectAttempts > 0) {
      logger.warn(
        { attempt: this.reconnectAttempts },
        'Resuming a reconnect backoff carried over from the previous run',
      );
    }
    await this.connect();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.setState('disconnected');
    this.discardSocket();
  }

  async sendText(chatId: string, text: string): Promise<void> {
    await this.sendQueue.run(chatId, async () => {
      const socket = this.socket;
      if (!socket || !this.connected) throw new Error('WhatsApp is not connected');
      let lastError: unknown;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          const sent = await socket.sendMessage(chatId, { text });
          if (sent?.key.id && sent.message) this.rememberSentMessage(sent.key.id, sent.message);
          return;
        } catch (error) {
          lastError = error;
          if (attempt < 3) await sleep(300 * 2 ** (attempt - 1));
        }
      }
      throw lastError instanceof Error ? lastError : new Error('Message send failed');
    });
  }

  /** Number of human participants in the group (the bot's own linked account is excluded), or null if it can't be determined right now. */
  async groupParticipantCount(chatId: string): Promise<number | null> {
    if (!chatId.endsWith('@g.us')) return null;
    try {
      const metadata = await this.groupMetadata(chatId);
      const selfId = this.socket?.user?.id ? jidNormalizedUser(this.socket.user.id) : null;
      return metadata.participants.filter((participant) => {
        if (!selfId) return true;
        const ids = [participant.id, participant.phoneNumber].filter(Boolean).map(jidNormalizedUser);
        return !ids.includes(selfId);
      }).length;
    } catch (error) {
      logger.warn({ err: error, chatId }, 'Could not determine group participant count');
      return null;
    }
  }

  async isGroupAdmin(chatId: string, senderId: string, alternateId?: string): Promise<boolean> {
    if (!chatId.endsWith('@g.us')) return true;
    const metadata = await this.groupMetadata(chatId);
    const candidates = new Set(
      [senderId, alternateId].filter(Boolean).map((jid) => jidNormalizedUser(jid as string)),
    );
    return metadata.participants.some((participant) => {
      const ids = [participant.id, participant.phoneNumber].filter(Boolean).map(jidNormalizedUser);
      return ids.some((id) => candidates.has(id)) && Boolean(participant.admin);
    });
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    this.setState('connecting');
    this.discardSocket();
    const { state, saveCreds } = useSqliteAuthState(this.db);
    const version = await this.resolveVersion();
    // The version lookup is a network round trip; a shutdown may have landed while it was in flight.
    if (this.stopped) return;
    const socket = makeWASocket({
      auth: state,
      ...(version ? { version } : {}),
      browser: Browsers.macOS('Google Chrome'),
      logger: logger.child({ component: 'baileys' }),
      markOnlineOnConnect: false,
      syncFullHistory: false,
      emitOwnEvents: false,
      generateHighQualityLinkPreview: false,
      getMessage: async (key) => this.recallSentMessage(key.id),
    });
    this.socket = socket;

    // Guarded like every other handler below: a superseded socket must never write its stale
    // in-memory credentials over the live session's.
    socket.ev.on('creds.update', async () => {
      if (socket !== this.socket) return;
      await saveCreds();
    });
    socket.ev.on('connection.update', async (update) => {
      if (socket !== this.socket || this.stopped) return;
      const { connection, lastDisconnect, qr } = update;
      if (qr && config.pairingMode === 'qr') {
        logger.info('Scan the QR code in WhatsApp → Linked devices');
        qrcode.generate(qr, { small: true });
      }
      if (
        config.pairingMode === 'code' &&
        !state.creds.registered &&
        !this.pairingRequested &&
        (connection === 'connecting' || Boolean(qr))
      ) {
        this.pairingRequested = true;
        if (!config.pairingNumber) {
          logger.error('PAIRING_NUMBER is required when PAIRING_MODE=code');
        } else {
          try {
            const code = await socket.requestPairingCode(config.pairingNumber);
            logger.info({ pairingCode: code }, `Enter pairing code: ${code}`);
          } catch (error) {
            this.pairingRequested = false;
            logger.error({ err: error }, 'Could not request pairing code');
            this.onOperationalError(error, 'Could not request WhatsApp pairing code');
          }
        }
      }
      if (connection === 'open') {
        this.reconnectAttempts = 0;
        this.clearReconnectState();
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
        this.pairingRequested = false;
        this.setState('connected');
        logger.info('WhatsApp connected');
      }
      if (connection === 'close') {
        const statusCode = disconnectStatus(lastDisconnect?.error);
        if (isTerminalStatus(statusCode)) {
          this.setState('logged_out');
          this.clearReconnectState();
          logger.error(
            { statusCode },
            'WhatsApp session is no longer valid. Clear auth tables or use a fresh database to pair again.',
          );
          this.onOperationalError(lastDisconnect?.error, `WhatsApp session logged out (code ${statusCode})`);
          return;
        }
        if (statusCode === 405) {
          logger.error(
            { statusCode },
            'WhatsApp refused the connection (405). This usually means the WhatsApp Web client version is retired; retrying slowly to avoid the session being invalidated.',
          );
        }
        this.setState('disconnected');
        this.onOperationalError(lastDisconnect?.error, `WhatsApp connection closed${statusCode ? ` (code ${statusCode})` : ''}`);
        if (!this.stopped) this.scheduleReconnect(statusCode);
      }
    });

    socket.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify' || socket !== this.socket) return;
      for (const raw of messages) {
        const message = toIncomingMessage(raw);
        if (!message) continue;
        void this.onMessage(message).catch((error) => {
          logger.error(
            { err: error, chatId: message.chatId, messageId: message.messageId },
            'Message handler failed',
          );
        });
      }
    });

    socket.ev.on('groups.update', (updates) => {
      for (const update of updates) {
        if (update.id) this.metadataCache.delete(update.id);
      }
    });
    socket.ev.on('group-participants.update', ({ id }) => this.metadataCache.delete(id));
  }

  private scheduleReconnect(statusCode: number | undefined): void {
    if (this.reconnectTimer || this.stopped) return;
    this.reconnectAttempts += 1;
    this.saveReconnectState();
    const hardFailure = isHardFailureStatus(statusCode);
    const base = reconnectBaseDelayMs(this.reconnectAttempts, statusCode);
    const delay = base + Math.floor(Math.random() * Math.max(1000, base * 0.1));
    logger.warn(
      { statusCode, delay, attempt: this.reconnectAttempts, hardFailure },
      'WhatsApp disconnected; reconnect scheduled',
    );
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.stopped && this.state !== 'connected') {
        void this.connect().catch((error) => {
          logger.error({ err: error }, 'Reconnect attempt failed');
          this.onOperationalError(error, 'WhatsApp reconnect attempt failed');
          this.scheduleReconnect(undefined);
        });
      }
    }, delay);
    this.reconnectTimer.unref();
  }

  /**
   * Baileys bundles a hardcoded WhatsApp Web version that WhatsApp retires every few weeks.
   * Once retired, every edge node refuses the handshake with 405. Returns null to fall back to
   * the bundled version when the lookup is disabled or unreachable.
   */
  private async resolveVersion(): Promise<[number, number, number] | null> {
    if (!config.whatsappVersionCheck) return null;
    try {
      const result = await Promise.race([
        fetchLatestBaileysVersion(),
        new Promise<never>((_resolve, reject) => {
          setTimeout(
            () => reject(new Error('Version lookup timed out')),
            config.whatsappVersionTimeoutMs,
          ).unref();
        }),
      ]);
      logger.info({ version: result.version, isLatest: result.isLatest }, 'WhatsApp Web version resolved');
      return result.version;
    } catch (error) {
      logger.warn({ err: error }, 'Could not fetch the current WhatsApp Web version; using the bundled one');
      return null;
    }
  }

  /** Ends the outgoing socket so a superseded connection cannot linger and emit events. */
  private discardSocket(): void {
    const previous = this.socket;
    this.socket = null;
    if (!previous) return;
    try {
      previous.end(new Error('Superseded by a new connection'));
    } catch {
      // The socket may already be closed.
    }
  }

  private loadReconnectAttempts(): number {
    const row = this.db.get<{ value: string }>(
      'SELECT value FROM service_state WHERE key = ?',
      [RECONNECT_STATE_KEY],
    );
    if (!row) return 0;
    try {
      const parsed = JSON.parse(row.value) as PersistedReconnectState;
      if (typeof parsed.attempts !== 'number' || typeof parsed.lastFailureAt !== 'number') return 0;
      // A long-quiet gap means the previous outage is over; start the ladder fresh.
      if (Date.now() - parsed.lastFailureAt > config.reconnectStateTtlMs) return 0;
      return Math.max(0, parsed.attempts);
    } catch {
      return 0;
    }
  }

  private saveReconnectState(): void {
    const value: PersistedReconnectState = {
      attempts: this.reconnectAttempts,
      lastFailureAt: Date.now(),
    };
    try {
      this.db.run(
        `INSERT INTO service_state(key, value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           value = excluded.value,
           updated_at = excluded.updated_at`,
        [RECONNECT_STATE_KEY, JSON.stringify(value), Date.now()],
      );
    } catch (error) {
      logger.warn({ err: error }, 'Could not persist reconnect backoff state');
    }
  }

  private clearReconnectState(): void {
    try {
      this.db.run('DELETE FROM service_state WHERE key = ?', [RECONNECT_STATE_KEY]);
    } catch (error) {
      logger.warn({ err: error }, 'Could not clear reconnect backoff state');
    }
  }

  private async groupMetadata(chatId: string): Promise<GroupMetadata> {
    const cached = this.metadataCache.get(chatId);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    if (!this.socket) throw new Error('WhatsApp is not connected');
    const value = await this.socket.groupMetadata(chatId);
    this.metadataCache.set(chatId, { value, expiresAt: Date.now() + 5 * 60_000 });
    return value;
  }

  /** Cache an outbound message so Baileys can re-send it if the recipient asks for a decryption retry. */
  private rememberSentMessage(id: string, content: WAMessageContent): void {
    if (this.sentMessages.size >= SENT_MESSAGE_CACHE_MAX) {
      const oldest = this.sentMessages.keys().next().value;
      if (oldest !== undefined) this.sentMessages.delete(oldest);
    }
    this.sentMessages.set(id, { content, expiresAt: Date.now() + SENT_MESSAGE_TTL_MS });
  }

  /** Look up a previously sent message to satisfy a retry receipt; returns undefined once it has expired. */
  private recallSentMessage(id: string | null | undefined): WAMessageContent | undefined {
    if (!id) return undefined;
    const entry = this.sentMessages.get(id);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.sentMessages.delete(id);
      return undefined;
    }
    return entry.content;
  }

  private setState(state: ConnectionState): void {
    if (this.state === state) return;
    this.state = state;
    this.onStateChange(state);
  }
}

function toIncomingMessage(raw: WAMessage): IncomingMessage | null {
  if (!raw.key.id || raw.key.fromMe || !raw.key.remoteJid || !raw.message) return null;
  const chatId = raw.key.remoteJid;
  if (chatId === 'status@broadcast' || chatId.endsWith('@broadcast') || chatId.endsWith('@newsletter')) {
    return null;
  }
  const isGroup = chatId.endsWith('@g.us');
  const senderId = raw.key.participant ?? chatId;
  const senderPhoneId = raw.key.participantAlt ?? raw.key.remoteJidAlt ?? undefined;
  const text = extractText(raw);
  if (!text) return null;
  return {
    messageId: raw.key.id,
    chatId,
    senderId: jidNormalizedUser(senderId),
    ...(senderPhoneId ? { senderPhoneId: jidNormalizedUser(senderPhoneId) } : {}),
    pushName: safeName(raw.pushName ?? 'Player'),
    text,
    isGroup,
    timestampMs: Number(raw.messageTimestamp ?? Math.floor(Date.now() / 1000)) * 1000,
  };
}

function extractText(raw: WAMessage): string {
  const normalized = normalizeMessageContent(raw.message);
  const message = extractMessageContent(normalized) ?? normalized;
  if (!message) return '';
  return (
    message.conversation ??
    message.extendedTextMessage?.text ??
    message.imageMessage?.caption ??
    message.videoMessage?.caption ??
    message.buttonsResponseMessage?.selectedDisplayText ??
    message.listResponseMessage?.title ??
    message.templateButtonReplyMessage?.selectedDisplayText ??
    ''
  ).trim();
}

function disconnectStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const candidate = error as { output?: { statusCode?: number }; statusCode?: number };
  return candidate.output?.statusCode ?? candidate.statusCode;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
