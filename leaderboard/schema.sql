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
  PRIMARY KEY (account, started_at)
);

CREATE INDEX IF NOT EXISTS runs_by_end ON runs (ended_at);
