CREATE TABLE IF NOT EXISTS players (
  account TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
  account TEXT NOT NULL REFERENCES players(account),
  started_at INTEGER NOT NULL,
  ended_at INTEGER NOT NULL,
  stake REAL NOT NULL,
  pnl REAL NOT NULL,
  return_pct REAL NOT NULL,
  fills INTEGER NOT NULL,
  shield REAL NOT NULL DEFAULT 0,
  skr_burned REAL NOT NULL DEFAULT 0,
  skr_burn_sig TEXT,
  PRIMARY KEY (account, started_at)
);

CREATE INDEX IF NOT EXISTS runs_by_end ON runs (ended_at);
CREATE UNIQUE INDEX IF NOT EXISTS runs_by_burn ON runs (skr_burn_sig);
