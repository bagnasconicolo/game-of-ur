-- Schema iniziale del Gioco reale di Ur.
PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,                       -- identificativo interno (UUID), mai mostrato come nome
  username TEXT NOT NULL,                    -- username pubblico (maiuscole conservate)
  username_norm TEXT NOT NULL UNIQUE,        -- forma normalizzata per l'univocità
  password_hash TEXT NOT NULL,               -- scrypt$N$r$p$salt$hash
  created_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,               -- SHA-256 del token; il token in chiaro esiste solo nel cookie
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE friendships (
  user_low TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_high TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requester_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_low, user_high),
  CHECK (user_low < user_high)
);

CREATE TABLE games (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL CHECK (mode IN ('online', 'local')),
  source TEXT NOT NULL CHECK (source IN ('invite', 'room', 'match', 'rematch', 'local')),
  room_code TEXT UNIQUE,
  board_id TEXT NOT NULL,
  board_version INTEGER NOT NULL,
  ruleset_id TEXT NOT NULL,
  ruleset_version INTEGER NOT NULL,
  config_key TEXT NOT NULL,
  category TEXT NOT NULL,                    -- competitiva | sperimentale | personalizzata | locale
  status TEXT NOT NULL CHECK (status IN ('waiting', 'active', 'finished', 'aborted')),
  player0 TEXT REFERENCES users(id),
  player1 TEXT REFERENCES users(id),
  local_players TEXT,                        -- JSON per le partite locali: nomi e verifica d'identità
  state_json TEXT NOT NULL,
  state_version INTEGER NOT NULL,
  initial_state_json TEXT NOT NULL,
  turn_deadline INTEGER,
  rematch_of TEXT REFERENCES games(id),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE INDEX games_p0 ON games(player0, status);
CREATE INDEX games_p1 ON games(player1, status);
CREATE INDEX games_creator ON games(created_by, mode);

CREATE TABLE game_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,                      -- = versione dello stato dopo l'azione
  action_id TEXT NOT NULL,                   -- identificativo idempotente scelto dal client
  actor_user_id TEXT,
  action_json TEXT NOT NULL,                 -- azione completa, con l'esito del lancio estratto dal server
  events_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (game_id, action_id),
  UNIQUE (game_id, seq)
);

CREATE TABLE invites (
  id TEXT PRIMARY KEY,
  from_user TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  board_id TEXT NOT NULL,
  board_version INTEGER NOT NULL,
  ruleset_id TEXT NOT NULL,
  ruleset_version INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'declined', 'expired', 'cancelled')),
  rematch_of TEXT REFERENCES games(id),
  game_id TEXT REFERENCES games(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  responded_at INTEGER
);
CREATE INDEX invites_to ON invites(to_user, status);
CREATE INDEX invites_from ON invites(from_user, status);

CREATE TABLE match_queue (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  config_key TEXT NOT NULL,
  board_id TEXT NOT NULL,
  board_version INTEGER NOT NULL,
  ruleset_id TEXT NOT NULL,
  ruleset_version INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE game_results (
  game_id TEXT PRIMARY KEY REFERENCES games(id),   -- un solo risultato per partita
  config_key TEXT NOT NULL,
  category TEXT NOT NULL,
  ranked INTEGER NOT NULL,
  winner_user TEXT REFERENCES users(id),
  loser_user TEXT REFERENCES users(id),
  winner_seat INTEGER NOT NULL,
  reason TEXT NOT NULL,
  rating_winner_before REAL,
  rating_winner_after REAL,
  rating_loser_before REAL,
  rating_loser_after REAL,
  created_at INTEGER NOT NULL
);
CREATE INDEX results_winner ON game_results(winner_user);
CREATE INDEX results_loser ON game_results(loser_user);

CREATE TABLE ratings (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  config_key TEXT NOT NULL,
  category TEXT NOT NULL,
  rating REAL NOT NULL,
  games INTEGER NOT NULL,
  wins INTEGER NOT NULL,
  losses INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, config_key)
);
CREATE INDEX ratings_board ON ratings(config_key, rating DESC);

CREATE TABLE local_attestations (
  token_hash TEXT PRIMARY KEY,
  host_user TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  verified_user TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_game_id TEXT REFERENCES games(id)
);
