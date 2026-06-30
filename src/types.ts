export type Difficulty = 'mixed' | 'easy' | 'medium' | 'hard';
export type GameMode = 'classic' | 'sprint' | 'daily';
export type GameStatus = 'active' | 'completed' | 'stopped' | 'interrupted';
export type QuestionPhase = 'waiting' | 'open' | 'revealing' | 'finished';

export type TriviaSource = 'the-trivia-api' | 'opentdb';

export interface TriviaQuestion {
  sourceId: string;
  category: string;
  difficulty: Exclude<Difficulty, 'mixed'>;
  prompt: string;
  options: string[];
  correctIndex: number;
  hash: string;
}

export interface CachedTriviaQuestion extends TriviaQuestion {
  source: TriviaSource;
  categoryKeys: string[];
}

export interface IncomingMessage {
  messageId: string;
  chatId: string;
  senderId: string;
  senderPhoneId?: string;
  pushName: string;
  text: string;
  isGroup: boolean;
  timestampMs: number;
}

export interface ChatSettings {
  questionsPerGame: number;
  timeoutSeconds: number;
  revealDelayMs: number;
  defaultDifficulty: Difficulty;
  defaultCategory: string | null;
  questionCooldownHours: number;
  showRoundLeaderboard: boolean;
  hintsEnabled: boolean;
  customGroups: Record<string, { name: string; categories: string[] }>;
}

export interface PlayOptions {
  mode: GameMode;
  questions: number;
  difficulty: Difficulty;
  category: string | null;
}

export interface ActiveGame {
  id: string;
  chatId: string;
  isGroup: boolean;
  hostPlayerId: number;
  mode: GameMode;
  status: GameStatus;
  phase: QuestionPhase;
  questions: TriviaQuestion[];
  currentIndex: number;
  questionOpenedAt: number | null;
  questionDeadlineAt: number | null;
  timeoutSeconds: number;
  revealDelayMs: number;
  hintsEnabled: boolean;
  answeredPlayerIds: Set<number>;
  hintedPlayerIds: Set<number>;
  timer: NodeJS.Timeout | null;
}

export interface Player {
  id: number;
  jid: string;
  displayName: string;
}

export interface LeaderboardEntry {
  playerId: number;
  name: string;
  points: number;
  correct: number;
  answered: number;
  games: number;
  wins: number;
}

export interface HealthSnapshot {
  live: boolean;
  ready: boolean;
  whatsappConnected: boolean;
  databaseReady: boolean;
  activeGames: number;
  uptimeSeconds: number;
  lastMessageAt: number | null;
  lastErrorAt: number | null;
}
