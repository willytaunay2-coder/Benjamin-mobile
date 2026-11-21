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

-- Cours récurrents (ex : "Hatha yoga, mardi 19h, 10 places")
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

-- Préférences de créneau (1er, 2e, 3e choix) pour la répartition de l'année
CREATE TABLE IF NOT EXISTS preferences (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rank        INTEGER NOT NULL CHECK (rank BETWEEN 1 AND 3),
  template_id INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, rank)
);

-- Alertes dans l'application (cloche)
CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  link       TEXT NOT NULL DEFAULT '',
  read_at    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_notifications_user ON notifications(user_id, id);

-- Liste d'attente d'une séance complète (ordre modifiable par la professeure)
CREATE TABLE IF NOT EXISTS waitlist (
  id         INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  position   REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (session_id, user_id)
);

-- Notifications sur le téléphone (Web Push) : un abonnement par appareil
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint   TEXT NOT NULL UNIQUE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS ix_push_user ON push_subscriptions(user_id);

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
  ('makeup_requires_credit', '0'),
  ('allow_self_enroll', '0'),
  ('sms_mode', 'off');
`;

function migrate(db) {
  const cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!cols.includes('credit_adjust')) db.exec('ALTER TABLE users ADD COLUMN credit_adjust INTEGER NOT NULL DEFAULT 0');
  if (!cols.includes('notify_email')) db.exec('ALTER TABLE users ADD COLUMN notify_email INTEGER NOT NULL DEFAULT 1');
  if (!cols.includes('notify_sms')) db.exec('ALTER TABLE users ADD COLUMN notify_sms INTEGER NOT NULL DEFAULT 1');
  const ecols = db.prepare('PRAGMA table_info(enrollments)').all().map((c) => c.name);
  // 'pending' : inscrit·e d'office par la professeure, en attente de validation par l'élève
  if (!ecols.includes('status')) db.exec("ALTER TABLE enrollments ADD COLUMN status TEXT NOT NULL DEFAULT 'confirmed'");
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
