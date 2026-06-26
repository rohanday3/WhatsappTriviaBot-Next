import qrcode from 'qrcode-terminal';
import makeWASocket, {
  Browsers,
  DisconnectReason,
  extractMessageContent,
  jidNormalizedUser,
  normalizeMessageContent,
  type GroupMetadata,
  type WASocket,
  type WAMessage,
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

export class WhatsAppTransport {
  private socket: WASocket | null = null;
  private state: ConnectionState = 'starting';
  private stopped = false;
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pairingRequested = false;
  private readonly sendQueue = new KeyedQueue(config.maxOutboundQueuePerChat);
  private readonly metadataCache = new Map<string, CachedMetadata>();

  constructor(
    private readonly db: Database,
    private readonly onMessage: (message: IncomingMessage) => Promise<void>,
    private readonly onStateChange: (state: ConnectionState) => void,
  ) {}

  get connectionState(): ConnectionState {
    return this.state;
  }

  get connected(): boolean {
    return this.state === 'connected';
  }

  async start(): Promise<void> {
    this.stopped = false;
    await this.connect();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.setState('disconnected');
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      try {
        socket.end(new Error('Service shutting down'));
      } catch {
        // The socket may already be closed.
      }
    }
  }

  async sendText(chatId: string, text: string): Promise<void> {
    await this.sendQueue.run(chatId, async () => {
      const socket = this.socket;
      if (!socket || !this.connected) throw new Error('WhatsApp is not connected');
      let lastError: unknown;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          await socket.sendMessage(chatId, { text });
          return;
        } catch (error) {
          lastError = error;
          if (attempt < 3) await sleep(300 * 2 ** (attempt - 1));
        }
      }
      throw lastError instanceof Error ? lastError : new Error('Message send failed');
    });
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
    const { state, saveCreds } = useSqliteAuthState(this.db);
    const socket = makeWASocket({
      auth: state,
      browser: Browsers.macOS('Google Chrome'),
      logger: logger.child({ component: 'baileys' }),
      markOnlineOnConnect: false,
      syncFullHistory: false,
      emitOwnEvents: false,
      generateHighQualityLinkPreview: false,
      getMessage: async () => undefined,
    });
    this.socket = socket;

    socket.ev.on('creds.update', saveCreds);
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
          }
        }
      }
      if (connection === 'open') {
        this.reconnectAttempts = 0;
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
        this.pairingRequested = false;
        this.setState('connected');
        logger.info('WhatsApp connected');
      }
      if (connection === 'close') {
        const statusCode = disconnectStatus(lastDisconnect?.error);
        if (statusCode === DisconnectReason.loggedOut) {
          this.setState('logged_out');
          logger.error('WhatsApp session logged out. Clear auth tables or use a fresh database to pair again.');
          return;
        }
        this.setState('disconnected');
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
    const base = Math.min(60_000, 1000 * 2 ** Math.min(this.reconnectAttempts - 1, 6));
    const delay = base + Math.floor(Math.random() * 1000);
    logger.warn({ statusCode, delay, attempt: this.reconnectAttempts }, 'WhatsApp disconnected; reconnect scheduled');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.stopped && this.state !== 'connected') {
        void this.connect().catch((error) => {
          logger.error({ err: error }, 'Reconnect attempt failed');
          this.scheduleReconnect(undefined);
        });
      }
    }, delay);
    this.reconnectTimer.unref();
  }

  private async groupMetadata(chatId: string): Promise<GroupMetadata> {
    const cached = this.metadataCache.get(chatId);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    if (!this.socket) throw new Error('WhatsApp is not connected');
    const value = await this.socket.groupMetadata(chatId);
    this.metadataCache.set(chatId, { value, expiresAt: Date.now() + 5 * 60_000 });
    return value;
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
