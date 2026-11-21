'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { tx } = require('./db');
const D = require('./dates');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const TOKEN_TTL_MS = 60 * 24 * 3600 * 1000; // 60 jours
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon',
};

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, msg) => { throw new HttpError(status, msg); };

// ---------- Mots de passe ----------
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}
function verifyPassword(pw, stored) {
  const [, saltHex, hashHex] = String(stored).split('$');
  if (!saltHex || !hashHex) return false;
  const hash = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), 64);
  return crypto.timingSafeEqual(hash, Buffer.from(hashHex, 'hex'));
}

// ---------- Utilitaires HTTP ----------
function send(res, status, body, headers = {}) {
  const data = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 1e6) { reject(new HttpError(413, 'Requête trop volumineuse')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new HttpError(400, 'JSON invalide')); }
    });
    req.on('error', reject);
  });
}

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const int = (v, min, max, name) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) fail(400, `${name} invalide`);
  return n;
};
const reqDate = (v, name) => { if (!D.isValidDate(v)) fail(400, `${name} invalide`); return v; };
const reqTime = (v, name) => { if (!D.isValidTime(v)) fail(400, `${name} invalide`); return v; };
const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

function createApp(db, opts = {}) {
  const cookieSecure = !!opts.cookieSecure;
  const now = opts.now || (() => new Date());

  const q = (sql) => db.prepare(sql);
  const settings = () => Object.fromEntries(q('SELECT key, value FROM settings').all().map((r) => [r.key, r.value]));
  const settingNum = (k) => Number(settings()[k] || 0);

  function publicUser(u) {
    return u && { id: u.id, email: u.email, name: u.name, phone: u.phone, role: u.role, active: !!u.active, created_at: u.created_at };
  }

  function currentUser(req) {
    const token = parseCookies(req).na_session;
    if (!token) return null;
    const row = q(`SELECT u.* FROM auth_tokens t JOIN users u ON u.id = t.user_id
                   WHERE t.token = ? AND t.expires_at > ? AND u.active = 1`).get(token, Date.now());
    return row || null;
  }

  function issueToken(res, userId) {
    const token = crypto.randomBytes(32).toString('hex');
    q('INSERT INTO auth_tokens(token, user_id, expires_at) VALUES (?,?,?)').run(token, userId, Date.now() + TOKEN_TTL_MS);
    q('DELETE FROM auth_tokens WHERE expires_at < ?').run(Date.now());
    res.setHeader('Set-Cookie', `na_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${TOKEN_TTL_MS / 1000}${cookieSecure ? '; Secure' : ''}`);
  }

  // ---------- Séances ----------
  const SESSION_SELECT = `
    SELECT s.*,
      (SELECT COUNT(*) FROM bookings b WHERE b.session_id = s.id AND b.status = 'booked') AS booked_count
    FROM sessions s`;

  function decorateSession(s, user) {
    const start = D.sessionStart(s.date, s.start_time);
    const out = {
      ...s,
      cancelled: !!s.cancelled,
      spots_left: Math.max(0, s.capacity - s.booked_count),
      is_past: start <= now(),
    };
    if (user) {
      const b = q("SELECT id FROM bookings WHERE session_id = ? AND user_id = ? AND status = 'booked'").get(s.id, user.id);
      out.my_booking_id = b ? b.id : null;
    }
    return out;
  }

  function getSession(id) {
    const s = q(`${SESSION_SELECT} WHERE s.id = ?`).get(id);
    if (!s) fail(404, 'Séance introuvable');
    return s;
  }

  // Vérifie qu'un membre peut réserver cette séance
  function assertBookable(s, user, { ignoreHorizon = false } = {}) {
    if (s.cancelled) fail(409, 'Cette séance est annulée');
    const start = D.sessionStart(s.date, s.start_time);
    if (start <= now()) fail(409, 'Cette séance est déjà passée');
    const horizon = settingNum('booking_horizon_days');
    if (!ignoreHorizon && horizon > 0 && start - now() > horizon * 86400000) {
      fail(409, `Les réservations ouvrent ${horizon} jours avant la séance`);
    }
    if (s.booked_count >= s.capacity) fail(409, 'Cette séance est complète');
    const mine = q("SELECT 1 FROM bookings WHERE session_id = ? AND user_id = ? AND status = 'booked'").get(s.id, user.id);
    if (mine) fail(409, 'Vous êtes déjà inscrit·e à cette séance');
  }

  function assertChangeable(s, isAdmin) {
    if (isAdmin) return;
    const hours = settingNum('cancel_deadline_hours');
    const start = D.sessionStart(s.date, s.start_time);
    if (start - now() < hours * 3600000) {
      fail(409, `Les modifications ne sont plus possibles moins de ${hours} h avant la séance`);
    }
  }

  function assertQuota(user, excludingBookingId = 0) {
    const max = settingNum('max_active_bookings');
    if (max <= 0) return;
    const today = D.toISO(now());
    const { n } = q(`SELECT COUNT(*) n FROM bookings b JOIN sessions s ON s.id = b.session_id
                     WHERE b.user_id = ? AND b.status = 'booked' AND s.date >= ? AND s.cancelled = 0 AND b.id != ?`)
      .get(user.id, today, excludingBookingId);
    if (n >= max) fail(409, `Vous avez atteint la limite de ${max} réservations à venir`);
  }

  // ---------- Génération du planning ----------
  function closureFor(date) {
    return q('SELECT * FROM closures WHERE ? BETWEEN start_date AND end_date LIMIT 1').get(date);
  }

  function generate(from, to, templateId = null) {
    const skipHolidays = settings().skip_public_holidays === '1';
    const templates = templateId
      ? q('SELECT * FROM templates WHERE id = ? AND active = 1').all(templateId)
      : q('SELECT * FROM templates WHERE active = 1').all();
    const insert = q(`INSERT OR IGNORE INTO sessions
      (template_id, title, description, date, start_time, duration_min, capacity, location, color)
      VALUES (?,?,?,?,?,?,?,?,?)`);
    let created = 0, skipped = 0;
    tx(db, () => {
      for (const t of templates) {
        let d = from > t.start_date ? from : t.start_date;
        const end = to < t.end_date ? to : t.end_date;
        // avance jusqu'au bon jour de la semaine
        while (d <= end && D.weekday(d) !== t.weekday) d = D.addDays(d, 1);
        for (; d <= end; d = D.addDays(d, 7)) {
          if (closureFor(d) || (skipHolidays && D.publicHolidayName(d))) { skipped++; continue; }
          const r = insert.run(t.id, t.title, t.description, d, t.start_time, t.duration_min, t.capacity, t.location, t.color);
          created += Number(r.changes);
        }
      }
    });
    return { created, skipped };
  }

  // Applique une fermeture aux séances existantes
  function applyClosure(c) {
    const r = q(`UPDATE sessions SET cancelled = 1, cancel_reason = ?, closure_id = ?
                 WHERE date BETWEEN ? AND ? AND cancelled = 0`).run(c.label, c.id, c.start_date, c.end_date);
    const { n } = q(`SELECT COUNT(*) n FROM bookings b JOIN sessions s ON s.id = b.session_id
                     WHERE s.closure_id = ? AND b.status = 'booked'`).get(c.id);
    return { sessions_cancelled: Number(r.changes), bookings_affected: n };
  }

  // ---------- Routes ----------
  const routes = [];
  const route = (method, pattern, handler, access = 'public') => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '(\\d+)'; }) + '$');
    routes.push({ method, re, keys, handler, access });
  };

  // Auth
  route('POST', '/api/register', async ({ body, res }) => {
    const name = str(body.name, 100), email = str(body.email, 200).toLowerCase(), phone = str(body.phone, 30);
    const password = typeof body.password === 'string' ? body.password : '';
    if (!name) fail(400, 'Le nom est obligatoire');
    if (!isEmail(email)) fail(400, 'Adresse e-mail invalide');
    if (password.length < 8) fail(400, 'Le mot de passe doit contenir au moins 8 caractères');
    if (q('SELECT 1 FROM users WHERE email = ?').get(email)) fail(409, 'Un compte existe déjà avec cette adresse');
    // Le tout premier compte créé devient administrateur (la professeure)
    const isFirst = q('SELECT COUNT(*) n FROM users').get().n === 0;
    const r = q('INSERT INTO users(email, name, phone, password_hash, role) VALUES (?,?,?,?,?)')
      .run(email, name, phone, hashPassword(password), isFirst ? 'admin' : 'member');
    issueToken(res, Number(r.lastInsertRowid));
    return { user: publicUser(q('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid)) };
  });

  route('POST', '/api/login', async ({ body, res }) => {
    const email = str(body.email, 200).toLowerCase();
    const u = q('SELECT * FROM users WHERE email = ?').get(email);
    if (!u || !u.active || !verifyPassword(String(body.password || ''), u.password_hash)) {
      fail(401, 'E-mail ou mot de passe incorrect');
    }
    issueToken(res, u.id);
    return { user: publicUser(u) };
  });

  route('POST', '/api/logout', async ({ req, res }) => {
    const token = parseCookies(req).na_session;
    if (token) q('DELETE FROM auth_tokens WHERE token = ?').run(token);
    res.setHeader('Set-Cookie', 'na_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
    return { ok: true };
  });

  route('GET', '/api/me', async ({ user }) => ({
    user: publicUser(user),
    settings: (({ studio_name, cancel_deadline_hours, booking_horizon_days, max_active_bookings }) =>
      ({ studio_name, cancel_deadline_hours: Number(cancel_deadline_hours), booking_horizon_days: Number(booking_horizon_days), max_active_bookings: Number(max_active_bookings) }))(settings()),
  }));

  route('PUT', '/api/me', async ({ user, body }) => {
    const name = str(body.name, 100) || user.name;
    const phone = body.phone === undefined ? user.phone : str(body.phone, 30);
    q('UPDATE users SET name = ?, phone = ? WHERE id = ?').run(name, phone, user.id);
    if (body.new_password) {
      if (!verifyPassword(String(body.current_password || ''), user.password_hash)) fail(400, 'Mot de passe actuel incorrect');
      if (String(body.new_password).length < 8) fail(400, 'Le nouveau mot de passe doit contenir au moins 8 caractères');
      q('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(String(body.new_password)), user.id);
    }
    return { user: publicUser(q('SELECT * FROM users WHERE id = ?').get(user.id)) };
  }, 'user');

  // Planning public (visible même sans compte)
  route('GET', '/api/sessions', async ({ query, user }) => {
    const from = D.isValidDate(query.from) ? query.from : D.toISO(now());
    const to = D.isValidDate(query.to) ? query.to : D.addDays(from, 6);
    if (to < from || D.parseISO(to) - D.parseISO(from) > 400 * 86400000) fail(400, 'Période invalide');
    const rows = q(`${SESSION_SELECT} WHERE s.date BETWEEN ? AND ? ORDER BY s.date, s.start_time`).all(from, to);
    const closures = q('SELECT * FROM closures WHERE end_date >= ? AND start_date <= ? ORDER BY start_date').all(from, to);
    return { from, to, sessions: rows.map((s) => decorateSession(s, user)), closures };
  });

  // Réservations du membre
  route('GET', '/api/my/bookings', async ({ user }) => {
    const rows = q(`SELECT b.id AS booking_id, b.created_at AS booked_at, s.*,
        (SELECT COUNT(*) FROM bookings x WHERE x.session_id = s.id AND x.status = 'booked') AS booked_count
      FROM bookings b JOIN sessions s ON s.id = b.session_id
      WHERE b.user_id = ? AND b.status = 'booked'
      ORDER BY s.date, s.start_time`).all(user.id);
    return { bookings: rows.map((s) => ({ ...decorateSession(s), booking_id: s.booking_id })) };
  }, 'user');

  route('POST', '/api/sessions/:id/book', async ({ params, user }) => {
    return tx(db, () => {
      const s = getSession(params.id);
      assertBookable(s, user);
      assertQuota(user);
      const r = q("INSERT INTO bookings(session_id, user_id) VALUES (?, ?)").run(s.id, user.id);
      return { booking_id: Number(r.lastInsertRowid), session: decorateSession(getSession(s.id), user) };
    });
  }, 'user');

  function ownBooking(id, user) {
    const b = q("SELECT * FROM bookings WHERE id = ? AND status = 'booked'").get(id);
    if (!b || (b.user_id !== user.id && user.role !== 'admin')) fail(404, 'Réservation introuvable');
    return b;
  }

  route('POST', '/api/bookings/:id/cancel', async ({ params, user }) => {
    return tx(db, () => {
      const b = ownBooking(params.id, user);
      const s = getSession(b.session_id);
      if (!s.cancelled) assertChangeable(s, user.role === 'admin');
      q("UPDATE bookings SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?").run(b.id);
      return { ok: true };
    });
  }, 'user');

  // Déplacer un rendez-vous vers une autre séance (atomique)
  route('POST', '/api/bookings/:id/move', async ({ params, user, body }) => {
    return tx(db, () => {
      const b = ownBooking(params.id, user);
      const from = getSession(b.session_id);
      const target = getSession(int(body.target_session_id, 1, 1e12, 'Séance cible'));
      if (target.id === from.id) fail(400, 'Choisissez une autre séance');
      if (!from.cancelled) assertChangeable(from, user.role === 'admin');
      const owner = q('SELECT * FROM users WHERE id = ?').get(b.user_id);
      assertBookable(target, owner);
      q("UPDATE bookings SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?").run(b.id);
      const r = q('INSERT INTO bookings(session_id, user_id) VALUES (?, ?)').run(target.id, owner.id);
      return { booking_id: Number(r.lastInsertRowid), session: decorateSession(getSession(target.id), owner) };
    });
  }, 'user');

  // ---------- Administration ----------
  function templateFields(body, existing = {}) {
    const t = { ...existing, ...body };
    return {
      title: str(t.title, 100) || fail(400, 'Le titre est obligatoire'),
      description: str(t.description, 1000),
      weekday: int(t.weekday, 0, 6, 'Jour'),
      start_time: reqTime(t.start_time, 'Heure'),
      duration_min: int(t.duration_min, 5, 600, 'Durée'),
      capacity: int(t.capacity, 1, 500, 'Nombre de places'),
      location: str(t.location, 200),
      color: /^#[0-9a-fA-F]{6}$/.test(t.color || '') ? t.color : '#8e3b6b',
      start_date: reqDate(t.start_date, 'Date de début'),
      end_date: reqDate(t.end_date, 'Date de fin'),
      active: t.active === false || t.active === 0 ? 0 : 1,
    };
  }

  route('GET', '/api/admin/templates', async () => ({
    templates: q(`SELECT t.*, (SELECT COUNT(*) FROM sessions s WHERE s.template_id = t.id AND s.date >= ?) AS upcoming_sessions
                  FROM templates t ORDER BY t.weekday, t.start_time`).all(D.toISO(now())),
  }), 'admin');

  route('POST', '/api/admin/templates', async ({ body }) => {
    const f = templateFields(body);
    if (f.end_date < f.start_date) fail(400, 'La date de fin doit être après la date de début');
    const r = q(`INSERT INTO templates(title, description, weekday, start_time, duration_min, capacity, location, color, start_date, end_date, active)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(f.title, f.description, f.weekday, f.start_time, f.duration_min, f.capacity, f.location, f.color, f.start_date, f.end_date, f.active);
    const id = Number(r.lastInsertRowid);
    const gen = body.generate === false ? { created: 0, skipped: 0 } : generate(f.start_date, f.end_date, id);
    return { template: q('SELECT * FROM templates WHERE id = ?').get(id), generated: gen };
  }, 'admin');

  route('PUT', '/api/admin/templates/:id', async ({ params, body }) => {
    const existing = q('SELECT * FROM templates WHERE id = ?').get(params.id) || fail(404, 'Cours introuvable');
    const f = templateFields(body, existing);
    if (f.end_date < f.start_date) fail(400, 'La date de fin doit être après la date de début');
    q(`UPDATE templates SET title=?, description=?, weekday=?, start_time=?, duration_min=?, capacity=?, location=?, color=?, start_date=?, end_date=?, active=? WHERE id=?`)
      .run(f.title, f.description, f.weekday, f.start_time, f.duration_min, f.capacity, f.location, f.color, f.start_date, f.end_date, f.active, existing.id);
    // Répercute les changements sur les séances futures (hors changement de jour)
    let updated = 0;
    if (body.apply_to_future !== false) {
      const r = q(`UPDATE sessions SET title=?, description=?, start_time=?, duration_min=?, capacity=?, location=?, color=?
                   WHERE template_id = ? AND date >= ?`)
        .run(f.title, f.description, f.start_time, f.duration_min, f.capacity, f.location, f.color, existing.id, D.toISO(now()));
      updated = Number(r.changes);
    }
    return { template: q('SELECT * FROM templates WHERE id = ?').get(existing.id), sessions_updated: updated };
  }, 'admin');

  route('DELETE', '/api/admin/templates/:id', async ({ params, query }) => {
    const t = q('SELECT * FROM templates WHERE id = ?').get(params.id) || fail(404, 'Cours introuvable');
    return tx(db, () => {
      let removed = 0;
      if (query.delete_future === '1') {
        // supprime les séances futures sans inscrits, annule celles qui en ont
        const today = D.toISO(now());
        removed = Number(q(`DELETE FROM sessions WHERE template_id = ? AND date >= ?
               AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.session_id = sessions.id AND b.status = 'booked')`).run(t.id, today).changes);
        q(`UPDATE sessions SET cancelled = 1, cancel_reason = 'Cours supprimé' WHERE template_id = ? AND date >= ?`).run(t.id, today);
      }
      q('DELETE FROM templates WHERE id = ?').run(t.id);
      return { ok: true, sessions_removed: removed };
    });
  }, 'admin');

  route('POST', '/api/admin/generate', async ({ body }) => {
    const from = reqDate(body.from, 'Date de début'), to = reqDate(body.to, 'Date de fin');
    if (to < from) fail(400, 'Période invalide');
    return generate(from, to, body.template_id ? int(body.template_id, 1, 1e12, 'Cours') : null);
  }, 'admin');

  // Fermetures / vacances
  route('GET', '/api/admin/closures', async () => ({
    closures: q(`SELECT c.*, (SELECT COUNT(*) FROM sessions s WHERE s.closure_id = c.id) AS sessions_cancelled
                 FROM closures c ORDER BY start_date`).all(),
  }), 'admin');

  route('POST', '/api/admin/closures', async ({ body }) => {
    const label = str(body.label, 100) || 'Fermeture';
    const start = reqDate(body.start_date, 'Date de début'), end = reqDate(body.end_date, 'Date de fin');
    if (end < start) fail(400, 'La date de fin doit être après la date de début');
    return tx(db, () => {
      const r = q('INSERT INTO closures(label, start_date, end_date) VALUES (?,?,?)').run(label, start, end);
      const c = q('SELECT * FROM closures WHERE id = ?').get(r.lastInsertRowid);
      return { closure: c, ...applyClosure(c) };
    });
  }, 'admin');

  route('DELETE', '/api/admin/closures/:id', async ({ params }) => {
    const c = q('SELECT * FROM closures WHERE id = ?').get(params.id) || fail(404, 'Fermeture introuvable');
    return tx(db, () => {
      // rétablit les séances annulées par cette fermeture
      const r = q(`UPDATE sessions SET cancelled = 0, cancel_reason = '', closure_id = NULL WHERE closure_id = ?`).run(c.id);
      q('DELETE FROM closures WHERE id = ?').run(c.id);
      return { ok: true, sessions_restored: Number(r.changes) };
    });
  }, 'admin');

  route('GET', '/api/admin/public-holidays', async ({ query }) => {
    const year = int(query.year || now().getFullYear(), 2000, 2100, 'Année');
    const h = D.frenchPublicHolidays(year);
    return { holidays: Object.keys(h).sort().map((date) => ({ date, label: h[date] })) };
  }, 'admin');

  // Vacances scolaires officielles (API data.education.gouv.fr)
  route('GET', '/api/admin/school-holidays', async ({ query }) => {
    const zone = ['A', 'B', 'C'].includes(query.zone) ? query.zone : 'A';
    const year = /^\d{4}-\d{4}$/.test(query.year || '') ? query.year : (() => {
      const y = now().getMonth() >= 7 ? now().getFullYear() : now().getFullYear() - 1;
      return `${y}-${y + 1}`;
    })();
    const where = `annee_scolaire="${year}" AND zones="Zone ${zone}"`;
    const url = 'https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets/fr-en-calendrier-scolaire/records?limit=100&where='
      + encodeURIComponent(where);
    let data;
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!r.ok) throw new Error(String(r.status));
      data = await r.json();
    } catch {
      fail(502, "Impossible de joindre le calendrier scolaire officiel. Ajoutez les vacances à la main.");
    }
    const seen = new Map();
    for (const rec of data.results || []) {
      if (rec.population && !/lèves|^-$/i.test(rec.population)) continue; // ignore « Enseignants »
      if (!rec.start_date || !rec.end_date) continue;
      // L'API donne des horodatages UTC de minuit heure locale : début = 1er jour de vacances,
      // fin = jour de reprise des cours (exclu).
      const start = D.toISO(new Date(rec.start_date));
      const end = D.addDays(D.toISO(new Date(rec.end_date)), -1);
      if (end < start) continue;
      const key = `${rec.description}|${start}`;
      if (!seen.has(key)) seen.set(key, { label: rec.description, start_date: start, end_date: end });
    }
    return { zone, year, holidays: [...seen.values()].sort((a, b) => a.start_date.localeCompare(b.start_date)) };
  }, 'admin');

  // Séances
  route('GET', '/api/admin/sessions/:id', async ({ params }) => {
    const s = decorateSession(getSession(params.id));
    const attendees = q(`SELECT b.id AS booking_id, b.created_at AS booked_at, u.id, u.name, u.email, u.phone
                         FROM bookings b JOIN users u ON u.id = b.user_id
                         WHERE b.session_id = ? AND b.status = 'booked' ORDER BY b.created_at`).all(s.id);
    return { session: s, attendees };
  }, 'admin');

  route('POST', '/api/admin/sessions', async ({ body }) => {
    const title = str(body.title, 100) || fail(400, 'Le titre est obligatoire');
    const r = q(`INSERT INTO sessions(title, description, date, start_time, duration_min, capacity, location, color)
                 VALUES (?,?,?,?,?,?,?,?)`).run(
      title, str(body.description, 1000), reqDate(body.date, 'Date'), reqTime(body.start_time, 'Heure'),
      int(body.duration_min, 5, 600, 'Durée'), int(body.capacity, 1, 500, 'Nombre de places'),
      str(body.location, 200), /^#[0-9a-fA-F]{6}$/.test(body.color || '') ? body.color : '#8e3b6b');
    return { session: decorateSession(getSession(r.lastInsertRowid)) };
  }, 'admin');

  route('PUT', '/api/admin/sessions/:id', async ({ params, body }) => {
    const s = getSession(params.id);
    const f = {
      title: body.title !== undefined ? (str(body.title, 100) || fail(400, 'Le titre est obligatoire')) : s.title,
      description: body.description !== undefined ? str(body.description, 1000) : s.description,
      date: body.date !== undefined ? reqDate(body.date, 'Date') : s.date,
      start_time: body.start_time !== undefined ? reqTime(body.start_time, 'Heure') : s.start_time,
      duration_min: body.duration_min !== undefined ? int(body.duration_min, 5, 600, 'Durée') : s.duration_min,
      capacity: body.capacity !== undefined ? int(body.capacity, 1, 500, 'Nombre de places') : s.capacity,
      location: body.location !== undefined ? str(body.location, 200) : s.location,
      cancelled: body.cancelled !== undefined ? (body.cancelled ? 1 : 0) : s.cancelled,
    };
    const reason = f.cancelled ? (body.cancel_reason !== undefined ? str(body.cancel_reason, 200) : s.cancel_reason) : '';
    q(`UPDATE sessions SET title=?, description=?, date=?, start_time=?, duration_min=?, capacity=?, location=?, cancelled=?, cancel_reason=?,
       closure_id = CASE WHEN ? = 0 THEN NULL ELSE closure_id END WHERE id=?`)
      .run(f.title, f.description, f.date, f.start_time, f.duration_min, f.capacity, f.location, f.cancelled, reason, f.cancelled, s.id);
    return { session: decorateSession(getSession(s.id)) };
  }, 'admin');

  route('DELETE', '/api/admin/sessions/:id', async ({ params }) => {
    const s = getSession(params.id);
    if (s.booked_count > 0) fail(409, 'Des personnes sont inscrites : annulez la séance plutôt que de la supprimer');
    q('DELETE FROM sessions WHERE id = ?').run(s.id);
    return { ok: true };
  }, 'admin');

  // L'admin inscrit quelqu'un (ignore le délai d'ouverture des réservations)
  route('POST', '/api/admin/sessions/:id/attendees', async ({ params, body }) => {
    return tx(db, () => {
      const s = getSession(params.id);
      const u = q('SELECT * FROM users WHERE id = ?').get(int(body.user_id, 1, 1e12, 'Membre')) || fail(404, 'Membre introuvable');
      assertBookable(s, u, { ignoreHorizon: true });
      const r = q('INSERT INTO bookings(session_id, user_id) VALUES (?, ?)').run(s.id, u.id);
      return { booking_id: Number(r.lastInsertRowid) };
    });
  }, 'admin');

  // Membres
  route('GET', '/api/admin/users', async () => ({
    users: q(`SELECT u.*, (SELECT COUNT(*) FROM bookings b JOIN sessions s ON s.id = b.session_id
                WHERE b.user_id = u.id AND b.status = 'booked' AND s.date >= ?) AS upcoming
              FROM users u ORDER BY u.name COLLATE NOCASE`).all(D.toISO(now()))
      .map((u) => ({ ...publicUser(u), upcoming: u.upcoming })),
  }), 'admin');

  route('PUT', '/api/admin/users/:id', async ({ params, body, user }) => {
    const u = q('SELECT * FROM users WHERE id = ?').get(params.id) || fail(404, 'Membre introuvable');
    const role = body.role === 'admin' || body.role === 'member' ? body.role : u.role;
    const active = body.active === undefined ? u.active : (body.active ? 1 : 0);
    if (u.id === user.id && (role !== 'admin' || !active)) fail(400, 'Vous ne pouvez pas retirer vos propres droits');
    q('UPDATE users SET role = ?, active = ? WHERE id = ?').run(role, active, u.id);
    if (!active) q('DELETE FROM auth_tokens WHERE user_id = ?').run(u.id);
    return { user: publicUser(q('SELECT * FROM users WHERE id = ?').get(u.id)) };
  }, 'admin');

  route('GET', '/api/admin/users/:id/bookings', async ({ params }) => ({
    bookings: q(`SELECT b.id AS booking_id, s.id, s.title, s.date, s.start_time, s.cancelled
                 FROM bookings b JOIN sessions s ON s.id = b.session_id
                 WHERE b.user_id = ? AND b.status = 'booked' ORDER BY s.date DESC, s.start_time DESC LIMIT 200`).all(params.id),
  }), 'admin');

  // Réglages
  route('GET', '/api/admin/settings', async () => ({ settings: settings() }), 'admin');
  route('PUT', '/api/admin/settings', async ({ body }) => {
    const up = q('UPDATE settings SET value = ? WHERE key = ?');
    if (body.studio_name !== undefined) up.run(str(body.studio_name, 100) || 'Nada Atma', 'studio_name');
    if (body.cancel_deadline_hours !== undefined) up.run(String(int(body.cancel_deadline_hours, 0, 720, 'Délai')), 'cancel_deadline_hours');
    if (body.booking_horizon_days !== undefined) up.run(String(int(body.booking_horizon_days, 0, 800, 'Ouverture')), 'booking_horizon_days');
    if (body.max_active_bookings !== undefined) up.run(String(int(body.max_active_bookings, 0, 1000, 'Limite')), 'max_active_bookings');
    if (body.skip_public_holidays !== undefined) up.run(body.skip_public_holidays ? '1' : '0', 'skip_public_holidays');
    return { settings: settings() };
  }, 'admin');

  // ---------- Fichiers statiques ----------
  function serveStatic(req, res, pathname) {
    let rel = decodeURIComponent(pathname);
    if (rel === '/' || !path.extname(rel)) rel = '/index.html'; // SPA
    const file = path.normalize(path.join(PUBLIC_DIR, rel));
    if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Introuvable'); }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': rel === '/index.html' || rel === '/sw.js' ? 'no-cache' : 'public, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(buf);
    });
  }

  // ---------- Dispatcher ----------
  return async function handler(req, res) {
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
      return serveStatic(req, res, url.pathname);
    }
    try {
      // Protection CSRF : les requêtes qui modifient doivent être en JSON
      if (req.method !== 'GET' && !(req.headers['content-type'] || '').includes('application/json')) {
        fail(415, 'Content-Type application/json requis');
      }
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = r.re.exec(url.pathname);
        if (!m) continue;
        const params = Object.fromEntries(r.keys.map((k, i) => [k, Number(m[i + 1])]));
        const user = currentUser(req);
        if (r.access !== 'public' && !user) fail(401, 'Veuillez vous connecter');
        if (r.access === 'admin' && user.role !== 'admin') fail(403, 'Accès réservé à l\'administration');
        const body = req.method === 'GET' ? {} : await readBody(req);
        const result = await r.handler({ req, res, params, user, body, query: Object.fromEntries(url.searchParams) });
        return send(res, 200, result);
      }
      fail(404, 'Route inconnue');
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.message });
      if (String(e.message).includes('UNIQUE constraint failed: bookings')) return send(res, 409, { error: 'Déjà inscrit·e à cette séance' });
      console.error(e);
      return send(res, 500, { error: 'Erreur interne' });
    }
  };
}

module.exports = { createApp, hashPassword, verifyPassword };
