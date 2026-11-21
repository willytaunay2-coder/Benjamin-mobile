'use strict';
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT NOT NULL,
  phone         TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member','admin')),
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS auth_tokens (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

-- Cours récurrents (ex : "Hatha yoga, mardi 18h30, 12 places")
CREATE TABLE IF NOT EXISTS templates (
  id           INTEGER PRIMARY KEY,
  title        TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  weekday      INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_time   TEXT NOT NULL,
  duration_min INTEGER NOT NULL DEFAULT 60,
  capacity     INTEGER NOT NULL DEFAULT 12,
  location     TEXT NOT NULL DEFAULT '',
  color        TEXT NOT NULL DEFAULT '#8e3b6b',
  start_date   TEXT NOT NULL,
  end_date     TEXT NOT NULL,
  active       INTEGER NOT NULL DEFAULT 1
);

-- Périodes sans cours (vacances, stages, fermetures)
CREATE TABLE IF NOT EXISTS closures (
  id         INTEGER PRIMARY KEY,
  label      TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date   TEXT NOT NULL
);

-- Séances datées (générées depuis les cours récurrents, ou ponctuelles)
CREATE TABLE IF NOT EXISTS sessions (
  id            INTEGER PRIMARY KEY,
  template_id   INTEGER REFERENCES templates(id) ON DELETE SET NULL,
  title         TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  date          TEXT NOT NULL,
  start_time    TEXT NOT NULL,
  duration_min  INTEGER NOT NULL,
  capacity      INTEGER NOT NULL,
  location      TEXT NOT NULL DEFAULT '',
  color         TEXT NOT NULL DEFAULT '#8e3b6b',
  cancelled     INTEGER NOT NULL DEFAULT 0,
  cancel_reason TEXT NOT NULL DEFAULT '',
  closure_id    INTEGER REFERENCES closures(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_sessions_template_date ON sessions(template_id, date) WHERE template_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_sessions_date ON sessions(date);

CREATE TABLE IF NOT EXISTS bookings (
  id         INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status     TEXT NOT NULL DEFAULT 'booked' CHECK (status IN ('booked','cancelled')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_bookings_active ON bookings(session_id, user_id) WHERE status = 'booked';
CREATE INDEX IF NOT EXISTS ix_bookings_user ON bookings(user_id);

-- Inscription à l'année sur un créneau (cours régulier)
CREATE TABLE IF NOT EXISTS enrollments (
  id          INTEGER PRIMARY KEY,
  template_id INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_date  TEXT NOT NULL,
  end_date    TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_enrollments_active ON enrollments(template_id, user_id) WHERE end_date IS NULL;
CREATE INDEX IF NOT EXISTS ix_enrollments_user ON enrollments(user_id);

-- « Je ne viens pas » : place libérée par un·e inscrit·e à l'année
CREATE TABLE IF NOT EXISTS absences (
  id          INTEGER PRIMARY KEY,
  session_id  INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  with_credit INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (session_id, user_id)
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT OR IGNORE INTO settings(key, value) VALUES
  ('studio_name', 'Nada Atma'),
  ('cancel_deadline_hours', '12'),
  ('booking_horizon_days', '120'),
  ('max_active_bookings', '0'),
  ('skip_public_holidays', '1'),
  ('makeup_requires_credit', '1'),
  ('allow_self_enroll', '1');
`;

function migrate(db) {
  const cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!cols.includes('credit_adjust')) db.exec('ALTER TABLE users ADD COLUMN credit_adjust INTEGER NOT NULL DEFAULT 0');
}

function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

// Transaction simple (node:sqlite n'a pas de helper intégré)
function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

module.exports = { openDb, tx };
