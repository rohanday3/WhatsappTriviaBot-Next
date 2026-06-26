export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_creds (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  value_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_keys (
  category TEXT NOT NULL,
  key_id TEXT NOT NULL,
  value_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (category, key_id)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  jid TEXT NOT NULL UNIQUE,
  phone_jid TEXT,
  display_name TEXT NOT NULL,
  total_points INTEGER NOT NULL DEFAULT 0,
  games_played INTEGER NOT NULL DEFAULT 0,
  games_won INTEGER NOT NULL DEFAULT 0,
  questions_answered INTEGER NOT NULL DEFAULT 0,
  correct_answers INTEGER NOT NULL DEFAULT 0,
  current_streak INTEGER NOT NULL DEFAULT 0,
  best_streak INTEGER NOT NULL DEFAULT 0,
  best_game_score INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_players_phone_jid
  ON players(phone_jid) WHERE phone_jid IS NOT NULL;

CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('group', 'direct')),
  title TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS chat_settings (
  chat_id TEXT PRIMARY KEY REFERENCES chats(id) ON DELETE CASCADE,
  questions_per_game INTEGER NOT NULL,
  timeout_seconds INTEGER NOT NULL,
  reveal_delay_ms INTEGER NOT NULL,
  default_difficulty TEXT NOT NULL,
  default_category TEXT,
  show_round_leaderboard INTEGER NOT NULL DEFAULT 1,
  hints_enabled INTEGER NOT NULL DEFAULT 1,
  custom_groups_json TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS games (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  is_group INTEGER NOT NULL,
  host_player_id INTEGER NOT NULL REFERENCES players(id),
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  phase TEXT NOT NULL,
  category TEXT,
  difficulty TEXT NOT NULL,
  total_questions INTEGER NOT NULL,
  current_question_index INTEGER NOT NULL DEFAULT 0,
  timeout_seconds INTEGER NOT NULL,
  reveal_delay_ms INTEGER NOT NULL,
  hints_enabled INTEGER NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  question_opened_at INTEGER,
  question_deadline_at INTEGER,
  winner_player_id INTEGER REFERENCES players(id)
) WITHOUT ROWID;

CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_game_per_chat
  ON games(chat_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_games_status ON games(status, started_at);
CREATE INDEX IF NOT EXISTS idx_games_chat_ended ON games(chat_id, ended_at DESC);

CREATE TABLE IF NOT EXISTS game_players (
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  score INTEGER NOT NULL DEFAULT 0,
  correct_answers INTEGER NOT NULL DEFAULT 0,
  answers_count INTEGER NOT NULL DEFAULT 0,
  hints_used INTEGER NOT NULL DEFAULT 0,
  joined_at INTEGER NOT NULL,
  final_rank INTEGER,
  PRIMARY KEY (game_id, player_id)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_game_players_score ON game_players(game_id, score DESC);

CREATE TABLE IF NOT EXISTS game_questions (
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  source_id TEXT NOT NULL,
  question_hash TEXT NOT NULL,
  category TEXT NOT NULL,
  difficulty TEXT NOT NULL,
  prompt TEXT NOT NULL,
  options_json TEXT NOT NULL,
  correct_index INTEGER NOT NULL,
  opened_at INTEGER,
  closed_at INTEGER,
  PRIMARY KEY (game_id, position)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS answers (
  game_id TEXT NOT NULL,
  question_position INTEGER NOT NULL,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  answer_index INTEGER NOT NULL,
  is_correct INTEGER NOT NULL,
  response_ms INTEGER NOT NULL,
  points INTEGER NOT NULL,
  answered_at INTEGER NOT NULL,
  PRIMARY KEY (game_id, question_position, player_id),
  FOREIGN KEY (game_id, question_position)
    REFERENCES game_questions(game_id, position) ON DELETE CASCADE
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_answers_player_time ON answers(player_id, answered_at DESC);
CREATE INDEX IF NOT EXISTS idx_answers_time_points ON answers(answered_at, points DESC);

CREATE TABLE IF NOT EXISTS player_chat_stats (
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  points INTEGER NOT NULL DEFAULT 0,
  games_played INTEGER NOT NULL DEFAULT 0,
  games_won INTEGER NOT NULL DEFAULT 0,
  questions_answered INTEGER NOT NULL DEFAULT 0,
  correct_answers INTEGER NOT NULL DEFAULT 0,
  best_game_score INTEGER NOT NULL DEFAULT 0,
  current_streak INTEGER NOT NULL DEFAULT 0,
  best_streak INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (chat_id, player_id)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_chat_leaderboard
  ON player_chat_stats(chat_id, points DESC, correct_answers DESC);

CREATE TABLE IF NOT EXISTS player_achievements (
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  achievement_key TEXT NOT NULL,
  unlocked_at INTEGER NOT NULL,
  game_id TEXT REFERENCES games(id) ON DELETE SET NULL,
  PRIMARY KEY (player_id, achievement_key)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS question_history (
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  question_hash TEXT NOT NULL,
  last_used_at INTEGER NOT NULL,
  times_used INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (chat_id, question_hash)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_question_history_recent
  ON question_history(chat_id, last_used_at DESC);

CREATE TABLE IF NOT EXISTS daily_attempts (
  local_date TEXT NOT NULL,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  score INTEGER NOT NULL DEFAULT 0,
  completed INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (local_date, player_id)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS processed_messages (
  message_id TEXT PRIMARY KEY,
  received_at INTEGER NOT NULL
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_processed_messages_time ON processed_messages(received_at);
`;
