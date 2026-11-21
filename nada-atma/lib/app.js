'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { tx } = require('./db');
const D = require('./dates');
const { createMailer } = require('./mailer');
const { createSms, toInternational } = require('./sms');
const { createPush, createVapidKeys } = require('./push');

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
  const mailer = opts.mailer || createMailer();
  const sms = opts.sms || createSms();
  const appUrl = (opts.appUrl || process.env.APP_URL || '').replace(/\/$/, '');

  const q = (sql) => db.prepare(sql);
  const settings = () => Object.fromEntries(q("SELECT key, value FROM settings WHERE key NOT LIKE 'vapid%'").all().map((r) => [r.key, r.value]));
  const settingNum = (k) => Number(settings()[k] || 0);
  // Clés VAPID des notifications : créées une fois, gardées dans la base
  let vapid = null;
  const vapidKeys = () => {
    if (vapid) return vapid;
    const row = q("SELECT value FROM settings WHERE key = 'vapid_keys'").get();
    if (row) return (vapid = JSON.parse(row.value));
    vapid = createVapidKeys();
    q("INSERT OR REPLACE INTO settings(key, value) VALUES ('vapid_keys', ?)").run(JSON.stringify(vapid));
    return vapid;
  };
  const push = opts.push || createPush({
    keys: vapidKeys,
    subject: process.env.PUSH_SUBJECT || (appUrl.startsWith('https://') ? appUrl : 'mailto:contact@nada-atma.com'),
    onGone: (endpoint) => q('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint),
  });

  function publicUser(u) {
    return u && { id: u.id, email: u.email, name: u.name, phone: u.phone, role: u.role, active: !!u.active, created_at: u.created_at, notify_email: u.notify_email !== 0, notify_sms: u.notify_sms !== 0 };
  }

  // ---------- Alertes (cloche) + e-mails ----------
  const DAY_NAMES = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  const longDate = (d) => { const x = D.parseISO(d); return `${DAY_NAMES[x.getDay()]} ${x.getDate()} ${MONTHS[x.getMonth()]}`; };
  const firstName = (n) => String(n).trim().split(/\s+/)[0];
  const hhmm = (t) => t.replace(/^0(\d)/, '$1').replace(':', 'h').replace(/h00$/, 'h');

  // userIds : destinataires ; email : envoyer aussi un e-mail (si la personne l'accepte)
  function notify(userIds, { kind, title, body = '', link = '' }, email = true) {
    const ins = q('INSERT INTO notifications(user_id, kind, title, body, link) VALUES (?,?,?,?,?)');
    const mails = [], texts = [], pushes = [];
    const subsOf = q('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?');
    const st = settings();
    const studio = st.studio_name || 'Nada Atma';
    // SMS : toutes les alertes, seulement les changements de cours (pas les places libres), ou jamais
    const mode = st.sms_mode || 'all';
    const textOk = mode === 'all' || (mode === 'changes' && kind !== 'place');
    const url = appUrl ? ` ${appUrl}/${link}` : '';
    const smsText = kind === 'place' ? `${studio} : ${title}. Inscrivez-vous dans l'appli${url}` : `${studio} : ${title}.${url}`;
    for (const id of new Set(userIds)) {
      ins.run(id, kind, title, body, link);
      // Notification sur le téléphone (gratuite) pour chaque appareil où la personne l'a activée
      for (const sub of subsOf.all(id)) pushes.push({ sub, message: { title, body: body.length > 180 ? body.slice(0, 177) + '…' : body, url: '/' + link, tag: `${kind}:${title}` } });
      if (!email) continue;
      const u = q('SELECT email, name, phone, notify_email, notify_sms, active FROM users WHERE id = ?').get(id);
      if (!u || !u.active) continue;
      if (textOk && u.notify_sms && toInternational(u.phone)) texts.push({ to: u.phone, text: smsText });
      if (!u.notify_email) continue;
      mails.push({
        to: u.email,
        subject: `${studio} — ${title}`,
        text: `Bonjour ${firstName(u.name)},\n\n${body}\n\n${appUrl ? `${appUrl}/${link}\n\n` : ''}À bientôt sur le tapis,\n${studio}\n\n(Vous pouvez désactiver ces e-mails dans votre profil.)`,
      });
    }
    mailer.sendLater(mails);
    sms.sendLater(texts);
    push.sendLater(pushes);
  }
  const adminIds = () => q("SELECT id FROM users WHERE role = 'admin' AND active = 1").all().map((r) => r.id);

  // Une place vient de se libérer : on prévient tous les élèves qui ne sont pas déjà sur ce cours
  // La professeure est prévenue (cloche + notification) quand quelqu'un s'inscrit sur une séance
  function tellProf(userId, sessionId, verb = 's’inscrit') {
    const s = getSession(sessionId);
    const who = q('SELECT name, role FROM users WHERE id = ?').get(userId);
    if (!who || who.role === 'admin') return;
    const when = `${longDate(s.date)} à ${hhmm(s.start_time)}`;
    notify(adminIds(), { kind: 'admin', title: `${who.name} ${verb} ${when}`,
      body: `${s.title} : ${occupiedOf(s)} / ${s.capacity} places occupées.`, link: `#/admin/jour?date=${s.date}` }, false);
  }

  // ---------- Liste d'attente ----------
  const waitRows = (sessionId) => q('SELECT * FROM waitlist WHERE session_id = ? ORDER BY position, id').all(sessionId);
  function waitPosition(sessionId, userId) {
    const i = waitRows(sessionId).findIndex((w) => w.user_id === userId);
    return i < 0 ? null : i + 1;
  }
  // Inscrit·e ailleurs cette semaine : ses autres attentes de la semaine n'ont plus lieu d'être
  function clearWeekWaits(userId, date, exceptSessionId = 0) {
    const mon = D.addDays(date, -((D.weekday(date) + 6) % 7));
    q(`DELETE FROM waitlist WHERE user_id = ? AND session_id != ? AND session_id IN (SELECT id FROM sessions WHERE date BETWEEN ? AND ?)`)
      .run(userId, exceptSessionId, mon, D.addDays(mon, 6));
    q('DELETE FROM waitlist WHERE user_id = ? AND session_id = ?').run(userId, exceptSessionId);
  }
  // Une place se libère : la première personne de la liste (encore disponible cette semaine) est inscrite d'office
  function promoteWaitlist(sessionId) {
    let s = getSession(sessionId);
    if (s.cancelled || D.sessionStart(s.date, s.start_time) <= now()) return 0;
    let n = 0;
    for (const w of waitRows(s.id)) {
      s = getSession(s.id);
      if (s.capacity - occupiedOf(s) <= 0) break;
      const u = q('SELECT * FROM users WHERE id = ? AND active = 1').get(w.user_id);
      if (!u || statusOf(s, u.id).status || courseInWeek(u.id, s.date)) continue; // pas disponible : garde sa place dans la liste
      q('INSERT INTO bookings(session_id, user_id) VALUES (?, ?)').run(s.id, u.id);
      clearWeekWaits(u.id, s.date, s.id);
      const when = `${longDate(s.date)} à ${hhmm(s.start_time)}`;
      notify([u.id], { kind: 'waitlist', title: `Vous êtes inscrit·e ${when}`, link: weekLink(s.date),
        body: `Une place s’est libérée : vous passez de la liste d’attente au cours « ${s.title} » du ${when}. Si vous ne pouvez plus venir, annulez pour laisser la place à la personne suivante.` });
      tellProf(u.id, s.id, 'passe de la liste d’attente au cours du');
      n++;
    }
    return n;
  }

  function placeFreed(sessionId, byUserId) {
    let s = getSession(sessionId);
    if (s.cancelled || D.sessionStart(s.date, s.start_time) <= now()) return;
    if (promoteWaitlist(s.id)) s = getSession(s.id);
    const left = s.capacity - occupiedOf(s);
    if (left <= 0) { tellCancel(s, byUserId); return; }
    const when = `${longDate(s.date)} à ${hhmm(s.start_time)}`;
    const link = `#/planning?semaine=${D.addDays(s.date, -((D.weekday(s.date) + 6) % 7))}`;
    const recipients = q("SELECT id FROM users WHERE active = 1 AND role = 'member' AND id != ?").all(byUserId)
      .map((r) => r.id).filter((id) => !statusOf(s, id).status)
      .filter((id) => !courseInWeek(id, s.date)); // un cours par semaine : inutile de prévenir qui a déjà le sien
    notify(recipients, { kind: 'place', title: `Une place est libre ${when}`, link,
      body: `Une place vient de se libérer pour le cours « ${s.title} » du ${when}${left > 1 ? ` (${left} places libres)` : ''}. Le premier ou la première qui s’inscrit l’obtient.` });
    tellCancel(s, byUserId);
  }
  function tellCancel(s, byUserId) {
    const when = `${longDate(s.date)} à ${hhmm(s.start_time)}`;
    const who = q('SELECT name FROM users WHERE id = ?').get(byUserId)?.name || 'Quelqu\'un';
    notify(adminIds().filter((id) => id !== byUserId), { kind: 'admin', title: `${who} annule sa venue`, body: `${s.title}, ${when}.`, link: `#/admin/jour?date=${s.date}` }, false);
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
  // Une inscription à l'année « couvre » une séance si elle porte sur le même cours régulier
  // et que la date de la séance est dans sa période.
  const COVERS = `e.template_id = s.template_id AND e.start_date <= s.date AND (e.end_date IS NULL OR e.end_date >= s.date)`;
  const SESSION_SELECT = `
    SELECT s.*,
      (SELECT COUNT(*) FROM enrollments e WHERE ${COVERS}) AS enrolled_count,
      (SELECT COUNT(*) FROM absences a JOIN enrollments e ON e.user_id = a.user_id
         WHERE a.session_id = s.id AND ${COVERS}) AS absent_count,
      (SELECT COUNT(*) FROM bookings b WHERE b.session_id = s.id AND b.status = 'booked') AS booked_count,
      (SELECT COUNT(*) FROM waitlist w WHERE w.session_id = s.id) AS waiting_count
    FROM sessions s`;

  const occupiedOf = (s) => s.enrolled_count - s.absent_count + s.booked_count;

  function isEnrolledOn(s, userId) {
    return !!q(`SELECT 1 FROM enrollments e, sessions s WHERE s.id = ? AND e.user_id = ? AND ${COVERS}`).get(s.id, userId);
  }
  function absenceOf(s, userId) {
    return q('SELECT * FROM absences WHERE session_id = ? AND user_id = ?').get(s.id, userId);
  }

  // Statut d'une personne sur une séance : 'enrolled' (son créneau), 'released' (place libérée),
  // 'booked' (rattrapage / réservation ponctuelle) ou null.
  function statusOf(s, userId) {
    const b = q("SELECT id FROM bookings WHERE session_id = ? AND user_id = ? AND status = 'booked'").get(s.id, userId);
    if (b) return { status: 'booked', booking_id: b.id };
    if (isEnrolledOn(s, userId)) return { status: absenceOf(s, userId) ? 'released' : 'enrolled', booking_id: null };
    return { status: null, booking_id: null };
  }

  function decorateSession(s, user) {
    const start = D.sessionStart(s.date, s.start_time);
    const occupied = occupiedOf(s);
    const out = {
      ...s,
      cancelled: !!s.cancelled,
      occupied,
      spots_left: Math.max(0, s.capacity - occupied),
      is_past: start <= now(),
    };
    if (user) {
      const st = statusOf(s, user.id);
      out.my_status = st.status;
      out.my_booking_id = st.booking_id;
      out.my_waiting = !!waitPosition(s.id, user.id); // l'élève sait seulement qu'il ou elle attend, pas son rang
    }
    if (!user || user.role !== 'admin') delete out.waiting_count; // la taille de la liste reste côté professeure
    return out;
  }

  // Crédits de rattrapage = places libérées à temps + séances de son créneau annulées par la professeure
  //                        + ajustement manuel − rattrapages réservés (sur des séances non annulées)
  function creditsFor(userId) {
    const earned = q(`SELECT COUNT(*) n FROM sessions s JOIN enrollments e ON e.user_id = ? AND ${COVERS}
                      LEFT JOIN absences a ON a.session_id = s.id AND a.user_id = e.user_id
                      WHERE (a.id IS NOT NULL AND a.with_credit = 1)
                         OR (s.cancelled = 1 AND s.closure_id IS NULL)`).get(userId).n;
    const used = q(`SELECT COUNT(*) n FROM bookings b JOIN sessions s ON s.id = b.session_id
                    WHERE b.user_id = ? AND b.status = 'booked' AND s.cancelled = 0`).get(userId).n;
    const adj = q('SELECT credit_adjust FROM users WHERE id = ?').get(userId)?.credit_adjust || 0;
    return earned + adj - used;
  }

  function enrollmentsOf(userId) {
    return q(`SELECT e.id, e.template_id, e.start_date, e.end_date, e.status, t.title, t.weekday, t.start_time, t.duration_min, t.location, t.color
              FROM enrollments e JOIN templates t ON t.id = e.template_id
              WHERE e.user_id = ? AND (e.end_date IS NULL OR e.end_date >= ?) ORDER BY t.weekday, t.start_time`).all(userId, D.toISO(now()));
  }

  // Inscrit·es à l'année actuellement sur un créneau
  const activeEnrolledCount = (templateId) =>
    q('SELECT COUNT(*) n FROM enrollments WHERE template_id = ? AND end_date IS NULL').get(templateId).n;

  function enroll(t, userId, status = 'confirmed', from = null) {
    if (q('SELECT role FROM users WHERE id = ?').get(userId)?.role === 'admin') fail(403, 'La professeure ne s’inscrit pas aux cours');
    if (q('SELECT 1 FROM enrollments WHERE template_id = ? AND user_id = ? AND end_date IS NULL').get(t.id, userId)) {
      fail(409, 'Déjà inscrit·e sur ce créneau');
    }
    // Un abonnement = un cours par semaine
    const other = q(`SELECT t.weekday, t.start_time FROM enrollments e JOIN templates t ON t.id = e.template_id
                     WHERE e.user_id = ? AND e.end_date IS NULL`).get(userId);
    if (other) fail(409, `Un abonnement = un cours par semaine : déjà inscrit·e le ${DAY_NAMES[other.weekday]} à ${hhmm(other.start_time)}`);
    if (activeEnrolledCount(t.id) >= t.capacity) fail(409, 'Ce créneau est complet pour l\'année');
    // Démarre après la dernière séance déjà pleine (places libres déjà réservées), pour ne pas surbooker
    let start = [D.toISO(now()), t.start_date, from || ''].sort().pop();
    const future = q(`${SESSION_SELECT} WHERE s.template_id = ? AND s.date >= ? AND s.cancelled = 0 ORDER BY s.date`).all(t.id, start);
    for (const s of future) if (occupiedOf(s) >= s.capacity) start = D.addDays(s.date, 1);
    const r = q('INSERT INTO enrollments(template_id, user_id, start_date, status) VALUES (?,?,?,?)').run(t.id, userId, start, status);
    if (status === 'pending') {
      const slot = `${DAY_NAMES[t.weekday]} ${hhmm(t.start_time)}`;
      notify([userId], {
        kind: 'enrollment',
        title: `Votre créneau : ${slot}`,
        body: `Vous êtes inscrit·e sur le créneau « ${t.title} » du ${slot}, à partir du ${longDate(start)}. Merci de valider votre inscription dans l'application.`,
        link: '#/planning',
      });
    }
    return { enrollment_id: Number(r.lastInsertRowid), start_date: start, status };
  }

  function getSession(id) {
    const s = q(`${SESSION_SELECT} WHERE s.id = ?`).get(id);
    if (!s) fail(404, 'Séance introuvable');
    return s;
  }

  // Vérifie qu'un membre peut réserver cette séance
  // Un cours par semaine : la séance déjà prévue cette semaine-là (son cours non annulé, ou une place prise)
  function courseInWeek(userId, date) {
    const mon = D.addDays(date, -((D.weekday(date) + 6) % 7)), sun = D.addDays(mon, 6);
    const own = q(`SELECT s.* FROM sessions s JOIN enrollments e ON ${COVERS} AND e.user_id = ?
                   WHERE s.date BETWEEN ? AND ? AND s.cancelled = 0
                     AND NOT EXISTS (SELECT 1 FROM absences a WHERE a.session_id = s.id AND a.user_id = ?)
                   ORDER BY s.date, s.start_time`).get(userId, mon, sun, userId);
    if (own) return own;
    return q(`SELECT s.* FROM bookings b JOIN sessions s ON s.id = b.session_id
              WHERE b.user_id = ? AND b.status = 'booked' AND s.cancelled = 0 AND s.date BETWEEN ? AND ?
              ORDER BY s.date, s.start_time`).get(userId, mon, sun) || null;
  }
  const weekLimitMsg = (x) => `Un cours par semaine : vous êtes déjà inscrit·e le ${longDate(x.date)} à ${hhmm(x.start_time)}. Pour changer, annulez d'abord ce cours.`;

  function assertBookable(s, user, { ignoreHorizon = false, ignoreWeekLimit = false } = {}) {
    if (user.role === 'admin') fail(403, 'La professeure ne s’inscrit pas aux cours');
    if (s.cancelled) fail(409, 'Cette séance est annulée');
    const start = D.sessionStart(s.date, s.start_time);
    if (start <= now()) fail(409, 'Cette séance est déjà passée');
    const horizon = settingNum('booking_horizon_days');
    if (!ignoreHorizon && horizon > 0 && start - now() > horizon * 86400000) {
      fail(409, `Les réservations ouvrent ${horizon} jours avant la séance`);
    }
    const st = statusOf(s, user.id).status;
    if (st === 'booked') fail(409, 'Vous êtes déjà inscrit·e à cette séance');
    if (st === 'enrolled') fail(409, 'C\'est déjà votre créneau : votre place vous attend');
    if (occupiedOf(s) >= s.capacity) fail(409, 'Cette séance est complète');
    if (!ignoreWeekLimit) {
      const x = courseInWeek(user.id, s.date);
      if (x && x.id !== s.id) fail(409, weekLimitMsg(x));
    }
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

  route('GET', '/api/me', async ({ user }) => {
    const st = settings();
    return {
      user: publicUser(user),
      credits: user ? creditsFor(user.id) : 0,
      unread: user ? q('SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND read_at IS NULL').get(user.id).n : 0,
      enrollments: user ? enrollmentsOf(user.id) : [],
      settings: {
        studio_name: st.studio_name,
        cancel_deadline_hours: Number(st.cancel_deadline_hours),
        booking_horizon_days: Number(st.booking_horizon_days),
        max_active_bookings: Number(st.max_active_bookings),
        makeup_requires_credit: st.makeup_requires_credit === '1',
        allow_self_enroll: st.allow_self_enroll === '1',
        sms_enabled: (st.sms_mode || 'off') !== 'off',
      },
    };
  });

  // Créneaux à l'année proposés (pour choisir le sien)
  route('GET', '/api/templates', async ({ user }) => ({
    templates: q('SELECT * FROM templates WHERE active = 1 AND end_date >= ? ORDER BY weekday, start_time').all(D.toISO(now())).map((t) => {
      const enrolled = activeEnrolledCount(t.id);
      return {
        id: t.id, title: t.title, description: t.description, weekday: t.weekday, start_time: t.start_time,
        duration_min: t.duration_min, location: t.location, color: t.color, capacity: t.capacity,
        start_date: t.start_date, end_date: t.end_date, enrolled, free: Math.max(0, t.capacity - enrolled),
        mine: !!(user && q('SELECT 1 FROM enrollments WHERE template_id = ? AND user_id = ? AND end_date IS NULL').get(t.id, user.id)),
      };
    }),
  }));

  route('POST', '/api/templates/:id/enroll', async ({ params, user }) => {
    if (settings().allow_self_enroll !== '1') fail(403, 'L\'inscription à l\'année se fait auprès de la professeure');
    const t = q('SELECT * FROM templates WHERE id = ? AND active = 1').get(params.id) || fail(404, 'Créneau introuvable');
    return tx(db, () => enroll(t, user.id));
  }, 'user');

  // ---------- Préférences & répartition de l'année ----------
  const prefsOf = (userId) => q('SELECT rank, template_id, created_at FROM preferences WHERE user_id = ? ORDER BY rank').all(userId);

  route('GET', '/api/my/preferences', async ({ user }) => ({ preferences: prefsOf(user.id) }), 'user');

  route('PUT', '/api/my/preferences', async ({ user, body }) => {
    const ids = Array.isArray(body.template_ids) ? body.template_ids.map(Number).filter(Boolean) : [];
    if (!ids.length) fail(400, 'Choisissez au moins un créneau');
    if (ids.length > 3 || new Set(ids).size !== ids.length) fail(400, 'Jusqu\'à 3 créneaux différents');
    for (const id of ids) if (!q('SELECT 1 FROM templates WHERE id = ? AND active = 1').get(id)) fail(400, 'Créneau inconnu');
    tx(db, () => {
      // on garde la date de la première demande (ordre d'arrivée)
      const since = q('SELECT MIN(created_at) c FROM preferences WHERE user_id = ?').get(user.id).c;
      q('DELETE FROM preferences WHERE user_id = ?').run(user.id);
      const ins = q("INSERT INTO preferences(user_id, rank, template_id, created_at) VALUES (?,?,?, COALESCE(?, datetime('now')))");
      ids.forEach((id, i) => ins.run(user.id, i + 1, id, since));
    });
    if (!q('SELECT 1 FROM enrollments WHERE user_id = ? AND end_date IS NULL').get(user.id)) {
      notify(adminIds(), { kind: 'admin', title: `${user.name} a indiqué ses préférences`, body: 'À répartir dans Gestion › Répartition.', link: '#/admin/repartition' }, false);
    }
    return { preferences: prefsOf(user.id) };
  }, 'user');

  function assignmentState() {
    const templates = q('SELECT id, title, weekday, start_time, capacity FROM templates WHERE active = 1 ORDER BY weekday, start_time').all()
      .map((t) => ({ ...t, enrolled: activeEnrolledCount(t.id) }));
    const members = q("SELECT id, name, email, phone FROM users WHERE active = 1 AND role = 'member' ORDER BY name COLLATE NOCASE").all().map((u) => {
      const e = q('SELECT template_id, status FROM enrollments WHERE user_id = ? AND end_date IS NULL').get(u.id);
      const prefs = prefsOf(u.id);
      return { ...u, enrollment: e || null, prefs: prefs.map((p) => p.template_id), since: prefs[0]?.created_at || null };
    });
    return { templates, members };
  }
  route('GET', '/api/admin/assignments', async () => assignmentState(), 'admin');

  // Proposition automatique : par ordre d'arrivée des demandes, 1er choix si possible, sinon 2e, puis 3e
  route('POST', '/api/admin/assignments/propose', async () => {
    const { templates, members } = assignmentState();
    const left = Object.fromEntries(templates.map((t) => [t.id, t.capacity - t.enrolled]));
    const queue = members.filter((m) => !m.enrollment && m.prefs.length).sort((a, b) => a.since.localeCompare(b.since) || a.id - b.id);
    const proposals = queue.map((m) => {
      const i = m.prefs.findIndex((tid) => left[tid] > 0);
      if (i < 0) return { user_id: m.id, template_id: null, choice: null };
      left[m.prefs[i]]--;
      return { user_id: m.id, template_id: m.prefs[i], choice: i + 1 };
    });
    return { proposals };
  }, 'admin');

  // Appliquer : inscriptions d'office (à valider par chaque élève, qui est prévenu)
  route('POST', '/api/admin/assignments/apply', async ({ body }) => {
    const list = Array.isArray(body.assignments) ? body.assignments : [];
    const done = [], errors = [];
    for (const a of list) {
      const t = q('SELECT * FROM templates WHERE id = ?').get(Number(a.template_id));
      const u = q('SELECT id, name FROM users WHERE id = ?').get(Number(a.user_id));
      if (!t || !u) { errors.push({ user_id: a.user_id, error: 'Introuvable' }); continue; }
      try { tx(db, () => enroll(t, u.id, 'pending')); done.push(u.id); }
      catch (e) { errors.push({ user_id: u.id, name: u.name, error: e.message }); }
    }
    return { done: done.length, errors };
  }, 'admin');

  // Valider ou refuser un créneau attribué d'office par la professeure
  function ownPendingEnrollment(id, user) {
    const e = q("SELECT e.*, t.title, t.weekday, t.start_time FROM enrollments e JOIN templates t ON t.id = e.template_id WHERE e.id = ? AND e.user_id = ? AND e.end_date IS NULL").get(id, user.id);
    if (!e) fail(404, 'Inscription introuvable');
    if (e.status !== 'pending') fail(409, 'Cette inscription est déjà validée');
    return e;
  }
  route('POST', '/api/enrollments/:id/accept', async ({ params, user }) => {
    const e = ownPendingEnrollment(params.id, user);
    q("UPDATE enrollments SET status = 'confirmed' WHERE id = ?").run(e.id);
    notify(adminIds(), { kind: 'admin', title: `${user.name} valide son créneau`, body: `${e.title}, ${DAY_NAMES[e.weekday]} ${hhmm(e.start_time)}.`, link: '#/admin/cours' }, false);
    return { ok: true, enrollments: enrollmentsOf(user.id) };
  }, 'user');
  route('POST', '/api/enrollments/:id/decline', async ({ params, user }) => {
    const e = ownPendingEnrollment(params.id, user);
    tx(db, () => {
      q('DELETE FROM absences WHERE user_id = ? AND session_id IN (SELECT id FROM sessions WHERE template_id = ?)').run(user.id, e.template_id);
      q('DELETE FROM enrollments WHERE id = ?').run(e.id);
    });
    notify(adminIds(), { kind: 'admin', title: `${user.name} refuse son créneau`, body: `${e.title}, ${DAY_NAMES[e.weekday]} ${hhmm(e.start_time)} : une place à l'année est libre.`, link: '#/admin/cours' }, true);
    return { ok: true, enrollments: enrollmentsOf(user.id) };
  }, 'user');

  // Alertes
  route('GET', '/api/notifications', async ({ user }) => ({
    notifications: q('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 50').all(user.id),
    unread: q('SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND read_at IS NULL').get(user.id).n,
  }), 'user');
  route('POST', '/api/notifications/read', async ({ user }) => {
    q("UPDATE notifications SET read_at = datetime('now') WHERE user_id = ? AND read_at IS NULL").run(user.id);
    return { ok: true };
  }, 'user');

  // « Je ne viens pas » : libère sa place sur son créneau
  route('POST', '/api/sessions/:id/release', async ({ params, user }) => {
    return tx(db, () => {
      const s = getSession(params.id);
      if (s.cancelled) fail(409, 'Cette séance est annulée');
      if (D.sessionStart(s.date, s.start_time) <= now()) fail(409, 'Cette séance est déjà passée');
      const st = statusOf(s, user.id).status;
      if (st === 'released') fail(409, 'Ce cours est déjà annulé');
      if (st !== 'enrolled') fail(409, 'Ce n\'est pas votre créneau');
      const hours = settingNum('cancel_deadline_hours');
      const inTime = D.sessionStart(s.date, s.start_time) - now() >= hours * 3600000;
      q('INSERT INTO absences(session_id, user_id, with_credit) VALUES (?,?,?)').run(s.id, user.id, inTime ? 1 : 0);
      placeFreed(s.id, user.id);
      return { ok: true, with_credit: inTime, credits: creditsFor(user.id) };
    });
  }, 'user');

  // « Je viens finalement » : reprend sa place si elle n'a pas été prise
  route('POST', '/api/sessions/:id/unrelease', async ({ params, user }) => {
    return tx(db, () => {
      const s = getSession(params.id);
      const a = absenceOf(s, user.id) || fail(404, 'Aucune place libérée sur cette séance');
      if (D.sessionStart(s.date, s.start_time) <= now()) fail(409, 'Cette séance est déjà passée');
      if (occupiedOf(s) >= s.capacity) fail(409, 'Votre place a été prise entre-temps. Choisissez un autre créneau.');
      const other = courseInWeek(user.id, s.date);
      if (other) fail(409, weekLimitMsg(other));
      q('DELETE FROM absences WHERE id = ?').run(a.id);
      clearWeekWaits(user.id, s.date, s.id);
      tellProf(user.id, s.id, 'revient finalement');
      return { ok: true, credits: creditsFor(user.id) };
    });
  }, 'user');

  // Déplacer : libère sa place (créneau) ou sa réservation, et réserve une autre séance, en une fois
  route('POST', '/api/sessions/:id/swap', async ({ params, user, body }) => {
    return tx(db, () => {
      const from = getSession(params.id);
      const target = getSession(int(body.target_session_id, 1, 1e12, 'Séance cible'));
      if (target.id === from.id) fail(400, 'Choisissez une autre séance');
      const st = statusOf(from, user.id);
      if (st.status === 'booked') {
        if (!from.cancelled) assertChangeable(from, false);
        q("UPDATE bookings SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?").run(st.booking_id);
      } else if (st.status === 'enrolled' || st.status === 'released') {
        if (!from.cancelled && st.status === 'enrolled') assertChangeable(from, false);
        if (st.status === 'enrolled') q('INSERT INTO absences(session_id, user_id, with_credit) VALUES (?,?,1)').run(from.id, user.id);
      } else if (!(from.cancelled && isEnrolledOn(from, user.id))) {
        fail(409, 'Vous n\'êtes pas inscrit·e à cette séance');
      }
      const t2 = getSession(target.id);
      if (statusOf(t2, user.id).status === 'released') {
        // revenir sur son propre créneau
        if (occupiedOf(t2) >= t2.capacity) fail(409, 'Cette séance est complète');
        const other = courseInWeek(user.id, t2.date);
        if (other) fail(409, weekLimitMsg(other));
        q('DELETE FROM absences WHERE session_id = ? AND user_id = ?').run(t2.id, user.id);
        tellProf(user.id, t2.id, 'revient finalement');
      } else {
        assertBookable(t2, user);
        assertQuota(user);
        q('INSERT INTO bookings(session_id, user_id) VALUES (?, ?)').run(t2.id, user.id);
        clearWeekWaits(user.id, t2.date, t2.id);
        tellProf(user.id, t2.id);
      }
      placeFreed(from.id, user.id);
      return { session: decorateSession(getSession(t2.id), user), credits: creditsFor(user.id) };
    });
  }, 'user');

  route('PUT', '/api/me', async ({ user, body }) => {
    const name = str(body.name, 100) || user.name;
    const phone = body.phone === undefined ? user.phone : str(body.phone, 30);
    q('UPDATE users SET name = ?, phone = ? WHERE id = ?').run(name, phone, user.id);
    if (body.notify_email !== undefined) q('UPDATE users SET notify_email = ? WHERE id = ?').run(body.notify_email ? 1 : 0, user.id);
    if (body.notify_sms !== undefined) q('UPDATE users SET notify_sms = ? WHERE id = ?').run(body.notify_sms ? 1 : 0, user.id);
    if (body.new_password) {
      if (!verifyPassword(String(body.current_password || ''), user.password_hash)) fail(400, 'Mot de passe actuel incorrect');
      if (String(body.new_password).length < 8) fail(400, 'Le nouveau mot de passe doit contenir au moins 8 caractères');
      q('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(String(body.new_password)), user.id);
    }
    return { user: publicUser(q('SELECT * FROM users WHERE id = ?').get(user.id)) };
  }, 'user');

  // ---------- Liste d'attente (élèves) ----------
  route('POST', '/api/sessions/:id/waitlist', async ({ params, user }) => {
    return tx(db, () => {
      const s = getSession(params.id);
      if (user.role === 'admin') fail(403, 'La professeure ne s’inscrit pas aux cours');
      if (s.cancelled) fail(409, 'Cette séance est annulée');
      if (D.sessionStart(s.date, s.start_time) <= now()) fail(409, 'Cette séance est déjà passée');
      if (statusOf(s, user.id).status) fail(409, 'Vous avez déjà une place sur ce cours');
      if (occupiedOf(s) < s.capacity) fail(409, 'Il reste une place : inscrivez-vous directement');
      const x = courseInWeek(user.id, s.date);
      if (x) fail(409, weekLimitMsg(x));
      if (waitPosition(s.id, user.id)) fail(409, 'Vous êtes déjà sur la liste d’attente');
      const max = q('SELECT MAX(position) m FROM waitlist WHERE session_id = ?').get(s.id).m || 0;
      q('INSERT INTO waitlist(session_id, user_id, position) VALUES (?,?,?)').run(s.id, user.id, max + 1);
      const pos = waitPosition(s.id, user.id);
      const when = `${longDate(s.date)} à ${hhmm(s.start_time)}`;
      notify(adminIds(), { kind: 'admin', title: `${user.name} en liste d’attente ${when}`, body: `${s.title} : n° ${pos} sur la liste.`, link: `#/admin/jour?date=${s.date}` }, false);
      return { waiting: true, session: decorateSession(getSession(s.id), user) };
    });
  }, 'user');
  route('POST', '/api/sessions/:id/waitlist/leave', async ({ params, user }) => {
    q('DELETE FROM waitlist WHERE session_id = ? AND user_id = ?').run(params.id, user.id);
    return { ok: true };
  }, 'user');

  // ---------- Liste d'attente (professeure) : ajouter, retirer, changer l'ordre ----------
  route('POST', '/api/admin/sessions/:id/waitlist', async ({ params, body }) => {
    return tx(db, () => {
      const s = getSession(params.id);
      const u = q("SELECT * FROM users WHERE id = ? AND role = 'member'").get(int(body.user_id, 1, 1e12, 'Élève')) || fail(404, 'Élève introuvable');
      if (statusOf(s, u.id).status === 'enrolled' || statusOf(s, u.id).status === 'booked') fail(409, `${u.name} a déjà une place sur ce cours`);
      if (waitPosition(s.id, u.id)) fail(409, `${u.name} est déjà sur la liste`);
      const max = q('SELECT MAX(position) m FROM waitlist WHERE session_id = ?').get(s.id).m || 0;
      q('INSERT INTO waitlist(session_id, user_id, position) VALUES (?,?,?)').run(s.id, u.id, max + 1);
      return { waiting: attendeesOf(s.id).waiting };
    });
  }, 'admin');
  route('PUT', '/api/admin/sessions/:id/waitlist', async ({ params, body }) => {
    return tx(db, () => {
      const s = getSession(params.id);
      const ids = Array.isArray(body.user_ids) ? body.user_ids.map(Number) : fail(400, 'Ordre invalide');
      const cur = waitRows(s.id).map((w) => w.user_id);
      if (ids.length !== cur.length || !cur.every((id) => ids.includes(id))) fail(409, 'La liste a changé entre-temps : rechargez');
      const up = q('UPDATE waitlist SET position = ? WHERE session_id = ? AND user_id = ?');
      ids.forEach((id, i) => up.run(i + 1, s.id, id));
      promoteWaitlist(s.id); // s'il reste une place, la nouvelle première personne en profite
      return { waiting: attendeesOf(s.id).waiting };
    });
  }, 'admin');
  route('POST', '/api/admin/sessions/:id/waitlist/remove', async ({ params, body }) => {
    q('DELETE FROM waitlist WHERE session_id = ? AND user_id = ?').run(params.id, int(body.user_id, 1, 1e12, 'Élève'));
    return { waiting: attendeesOf(Number(params.id)).waiting };
  }, 'admin');

  // ---------- Notifications sur le téléphone ----------
  route('GET', '/api/push/key', async () => ({ publicKey: vapidKeys().publicKey }), 'user');
  route('POST', '/api/push/subscribe', async ({ user, body }) => {
    const endpoint = str(body.endpoint, 1000), p256dh = str(body.keys && body.keys.p256dh, 200), auth = str(body.keys && body.keys.auth, 100);
    if (!/^https:\/\//.test(endpoint) && !(process.env.NODE_ENV === 'test' && /^http:\/\/127\.0\.0\.1/.test(endpoint))) fail(400, 'Abonnement invalide');
    if (!p256dh || !auth) fail(400, 'Abonnement invalide');
    q(`INSERT INTO push_subscriptions(user_id, endpoint, p256dh, auth) VALUES (?,?,?,?)
       ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`).run(user.id, endpoint, p256dh, auth);
    return { ok: true };
  }, 'user');
  route('POST', '/api/push/unsubscribe', async ({ user, body }) => {
    q('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?').run(str(body.endpoint, 1000), user.id);
    return { ok: true };
  }, 'user');
  route('POST', '/api/push/test', async ({ user }) => {
    const subs = q('SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?').all(user.id);
    push.sendLater(subs.map((sub) => ({ sub, message: { title: 'Les notifications fonctionnent', body: 'Vous serez prévenu·e ici dès qu’une place se libère ou qu’un cours change.', url: '/#/planning', tag: 'test' } })));
    return { devices: subs.length };
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

  // Séances du membre (son créneau + rattrapages) sur une période
  route('GET', '/api/my/sessions', async ({ user, query }) => {
    const from = D.isValidDate(query.from) ? query.from : D.addDays(D.toISO(now()), -60);
    const to = D.isValidDate(query.to) ? query.to : D.addDays(D.toISO(now()), 70);
    const rows = q(`${SESSION_SELECT} WHERE s.date BETWEEN ? AND ? AND (
        EXISTS (SELECT 1 FROM bookings b WHERE b.session_id = s.id AND b.user_id = ? AND b.status = 'booked')
        OR EXISTS (SELECT 1 FROM enrollments e WHERE e.user_id = ? AND ${COVERS}))
      ORDER BY s.date, s.start_time`).all(from, to, user.id, user.id);
    return { sessions: rows.map((s) => decorateSession(s, user)), credits: creditsFor(user.id), enrollments: enrollmentsOf(user.id) };
  }, 'user');

  route('POST', '/api/sessions/:id/book', async ({ params, user }) => {
    return tx(db, () => {
      const s = getSession(params.id);
      if (statusOf(s, user.id).status === 'released') fail(409, 'C\'est votre créneau : utilisez « Me réinscrire »');
      assertBookable(s, user);
      assertQuota(user);
      const r = q("INSERT INTO bookings(session_id, user_id) VALUES (?, ?)").run(s.id, user.id);
      clearWeekWaits(user.id, s.date, s.id);
      tellProf(user.id, s.id);
      return { booking_id: Number(r.lastInsertRowid), session: decorateSession(getSession(s.id), user), credits: creditsFor(user.id) };
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
      placeFreed(s.id, b.user_id);
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
      q("UPDATE bookings SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?").run(b.id);
      assertBookable(target, owner, { ignoreWeekLimit: user.role === 'admin' });
      const r = q('INSERT INTO bookings(session_id, user_id) VALUES (?, ?)').run(target.id, owner.id);
      if (user.role !== 'admin') tellProf(owner.id, target.id);
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
    templates: q(`SELECT t.*, (SELECT COUNT(*) FROM sessions s WHERE s.template_id = t.id AND s.date >= ?) AS upcoming_sessions,
                    (SELECT COUNT(*) FROM enrollments e WHERE e.template_id = t.id AND e.end_date IS NULL) AS enrolled
                  FROM templates t ORDER BY t.weekday, t.start_time`).all(D.toISO(now())),
  }), 'admin');

  // Inscrit·es à l'année d'un créneau
  route('GET', '/api/admin/templates/:id/enrollments', async ({ params }) => ({
    enrollments: q(`SELECT e.id, e.start_date, e.status, u.id AS user_id, u.name, u.email, u.phone
                    FROM enrollments e JOIN users u ON u.id = e.user_id
                    WHERE e.template_id = ? AND e.end_date IS NULL ORDER BY u.name COLLATE NOCASE`).all(params.id),
  }), 'admin');

  route('POST', '/api/admin/templates/:id/enrollments', async ({ params, body }) => {
    const t = q('SELECT * FROM templates WHERE id = ?').get(params.id) || fail(404, 'Cours introuvable');
    const u = q('SELECT * FROM users WHERE id = ?').get(int(body.user_id, 1, 1e12, 'Membre')) || fail(404, 'Membre introuvable');
    return tx(db, () => enroll(t, u.id, body.pending ? 'pending' : 'confirmed'));
  }, 'admin');

  // Fin d'inscription à l'année (l'historique est conservé)
  function endEnrollment(e, from = null) {
    const today = from && from > D.toISO(now()) ? from : D.toISO(now());
    const end = e.start_date > D.addDays(today, -1) ? null : D.addDays(today, -1);
    if (end) q('UPDATE enrollments SET end_date = ? WHERE id = ?').run(end, e.id);
    else q('DELETE FROM enrollments WHERE id = ?').run(e.id); // jamais commencée
    q(`DELETE FROM absences WHERE user_id = ? AND session_id IN (SELECT id FROM sessions WHERE template_id = ? AND date >= ?)`)
      .run(e.user_id, e.template_id, today);
  }
  route('DELETE', '/api/admin/enrollments/:id', async ({ params }) => {
    const e = q('SELECT * FROM enrollments WHERE id = ? AND end_date IS NULL').get(params.id) || fail(404, 'Inscription introuvable');
    return tx(db, () => { endEnrollment(e); return { ok: true }; });
  }, 'admin');

  // L'admin note une absence (avec crédit) ou l'annule
  route('POST', '/api/admin/sessions/:id/absences', async ({ params, body }) => {
    const s = getSession(params.id);
    const uid = int(body.user_id, 1, 1e12, 'Membre');
    if (statusOf(s, uid).status !== 'enrolled') fail(409, 'Cette personne n\'est pas attendue sur cette séance');
    q('INSERT INTO absences(session_id, user_id, with_credit) VALUES (?,?,1)').run(s.id, uid);
    placeFreed(s.id, uid);
    return { ok: true };
  }, 'admin');

  route('DELETE', '/api/admin/sessions/:id/absences/:uid', async ({ params }) => {
    const s = getSession(params.id);
    if (occupiedOf(s) >= s.capacity) fail(409, 'La place a été reprise par quelqu\'un d\'autre');
    q('DELETE FROM absences WHERE session_id = ? AND user_id = ?').run(s.id, params.uid);
    return { ok: true };
  }, 'admin');

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
  function attendeesOf(sessionId) {
    const s = decorateSession(getSession(sessionId));
    // Inscrit·es à l'année (présent·es ou absent·es) + rattrapages / réservations ponctuelles
    const regulars = q(`SELECT u.id, u.name, u.email, u.phone, a.id AS absence_id
                        FROM enrollments e JOIN sessions s ON s.id = ? JOIN users u ON u.id = e.user_id
                        LEFT JOIN absences a ON a.session_id = s.id AND a.user_id = u.id
                        WHERE ${COVERS} ORDER BY u.name COLLATE NOCASE`).all(s.id);
    const makeups = q(`SELECT b.id AS booking_id, u.id, u.name, u.email, u.phone
                       FROM bookings b JOIN users u ON u.id = b.user_id
                       WHERE b.session_id = ? AND b.status = 'booked' ORDER BY b.created_at`).all(s.id);
    const attendees = [
      ...regulars.filter((r) => !r.absence_id).map((r) => ({ ...r, kind: 'regular' })),
      ...makeups.map((m) => ({ ...m, kind: 'makeup' })),
    ];
    const absent = regulars.filter((r) => r.absence_id).map((r) => ({ ...r, kind: 'absent' }));
    const waiting = q(`SELECT w.user_id AS id, w.created_at, u.name, u.email, u.phone FROM waitlist w JOIN users u ON u.id = w.user_id
                       WHERE w.session_id = ? ORDER BY w.position, w.id`).all(s.id);
    return { session: s, attendees, absent, waiting };
  }
  route('GET', '/api/admin/sessions/:id', async ({ params }) => attendeesOf(params.id), 'admin');

  // Feuille d'appel : toutes les séances d'une journée avec leurs participant·es
  route('GET', '/api/admin/day', async ({ query }) => {
    const date = reqDate(query.date, 'Date');
    const ids = q('SELECT id FROM sessions WHERE date = ? ORDER BY start_time').all(date).map((r) => r.id);
    return { date, sessions: ids.map(attendeesOf) };
  }, 'admin');

  // Prévenir les élèves d'un changement de planning (alerte + e-mail)
  const memberIds = () => q("SELECT id FROM users WHERE active = 1 AND role = 'member'").all().map((r) => r.id);
  const weekLink = (date) => `#/planning?semaine=${D.addDays(date, -((D.weekday(date) + 6) % 7))}`;
  function announce(ids, kind, title, body, link) { if (ids.length) notify(ids, { kind, title, body, link }); }

  route('POST', '/api/admin/sessions', async ({ body }) => {
    const title = str(body.title, 100) || fail(400, 'Le titre est obligatoire');
    const r = q(`INSERT INTO sessions(title, description, date, start_time, duration_min, capacity, location, color)
                 VALUES (?,?,?,?,?,?,?,?)`).run(
      title, str(body.description, 1000), reqDate(body.date, 'Date'), reqTime(body.start_time, 'Heure'),
      int(body.duration_min, 5, 600, 'Durée'), int(body.capacity, 1, 500, 'Nombre de places'),
      str(body.location, 200), /^#[0-9a-fA-F]{6}$/.test(body.color || '') ? body.color : '#8e3b6b');
    const ns = getSession(r.lastInsertRowid);
    let notified = 0;
    if (body.notify !== false) {
      const ids = memberIds(); notified = ids.length;
      const when = `${longDate(ns.date)} à ${hhmm(ns.start_time)}`;
      announce(ids, 'new', `Nouvelle séance ${when}`,
        `Une séance « ${ns.title} » est ajoutée le ${when}${ns.location ? ` (${ns.location})` : ''}. ${ns.capacity} places : inscrivez-vous dans l'application.`, weekLink(ns.date));
    }
    return { session: decorateSession(ns), notified };
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
    // Personnes concernées avant la modification (créneau, place libérée, rattrapage)
    const before = memberIds().filter((id) => statusOf(s, id).status);
    const beforeAll = q('SELECT id FROM users WHERE active = 1').all().map((r) => r.id).filter((id) => statusOf(s, id).status);
    if (f.date !== s.date && s.template_id && q('SELECT 1 FROM sessions WHERE template_id = ? AND date = ? AND id != ?').get(s.template_id, f.date, s.id)) {
      fail(409, 'Ce créneau a déjà une séance ce jour-là');
    }
    q(`UPDATE sessions SET title=?, description=?, date=?, start_time=?, duration_min=?, capacity=?, location=?, cancelled=?, cancel_reason=?,
       closure_id = CASE WHEN ? = 0 THEN NULL ELSE closure_id END WHERE id=?`)
      .run(f.title, f.description, f.date, f.start_time, f.duration_min, f.capacity, f.location, f.cancelled, reason, f.cancelled, s.id);
    const oldWhen = `${longDate(s.date)} à ${hhmm(s.start_time)}`;
    const newWhen = `${longDate(f.date)} à ${hhmm(f.start_time)}`;
    let notified = 0;
    if (body.notify !== false) {
      if (f.cancelled && !s.cancelled) {
        announce(beforeAll, 'cancel', `Séance annulée ${oldWhen}`,
          `La séance « ${s.title} » du ${oldWhen} est annulée${reason ? ` : ${reason}` : ''}.`, '#/planning');
        notified = beforeAll.length;
      } else if (!f.cancelled && s.cancelled) {
        announce(beforeAll, 'restore', `Séance rétablie ${newWhen}`, `Bonne nouvelle : la séance « ${f.title} » du ${newWhen} est maintenue.`, weekLink(f.date));
        notified = beforeAll.length;
      } else if (!f.cancelled && (f.date !== s.date || f.start_time !== s.start_time)) {
        const all = memberIds();
        const others = all.filter((id) => !before.includes(id));
        announce(before, 'move', `Votre séance est déplacée : ${newWhen}`,
          `La séance « ${f.title} » prévue le ${oldWhen} est déplacée au ${newWhen}. Votre place y est conservée ; si vous ne pouvez pas venir, libérez-la dans l'application.`, weekLink(f.date));
        announce(others, 'move', `Séance déplacée : ${newWhen}`,
          `La séance « ${f.title} » du ${oldWhen} est déplacée au ${newWhen}.`, weekLink(f.date));
        notified = all.length;
      }
    }
    if (!f.cancelled) promoteWaitlist(s.id); // plus de places : la liste d'attente en profite
    return { session: decorateSession(getSession(s.id)), notified };
  }, 'admin');

  route('DELETE', '/api/admin/sessions/:id', async ({ params }) => {
    const s = getSession(params.id);
    if (occupiedOf(s) > 0) fail(409, 'Des personnes sont inscrites : annulez la séance plutôt que de la supprimer');
    q('DELETE FROM sessions WHERE id = ?').run(s.id);
    return { ok: true };
  }, 'admin');

  // L'admin inscrit quelqu'un (ignore le délai d'ouverture des réservations)
  route('POST', '/api/admin/sessions/:id/attendees', async ({ params, body }) => {
    return tx(db, () => {
      const s = getSession(params.id);
      const u = q('SELECT * FROM users WHERE id = ?').get(int(body.user_id, 1, 1e12, 'Membre')) || fail(404, 'Membre introuvable');
      assertBookable(s, u, { ignoreHorizon: true, ignoreWeekLimit: true }); // la professeure peut faire une exception
      const r = q('INSERT INTO bookings(session_id, user_id) VALUES (?, ?)').run(s.id, u.id);
      return { booking_id: Number(r.lastInsertRowid) };
    });
  }, 'admin');

  // Membres
  route('GET', '/api/admin/users', async () => ({
    users: q(`SELECT u.*, (SELECT COUNT(*) FROM bookings b JOIN sessions s ON s.id = b.session_id
                WHERE b.user_id = u.id AND b.status = 'booked' AND s.date >= ?) AS upcoming
              FROM users u ORDER BY u.name COLLATE NOCASE`).all(D.toISO(now()))
      .map((u) => ({
        ...publicUser(u), upcoming: u.upcoming, credits: creditsFor(u.id),
        slot_ids: enrollmentsOf(u.id).map((e) => e.template_id),
        enrollments: enrollmentsOf(u.id).map((e) => ({ template_id: e.template_id, start_date: e.start_date, end_date: e.end_date })),
        slots: enrollmentsOf(u.id).map((e) => `${['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'][e.weekday]} ${e.start_time.replace(':', 'h')} ${e.title}`),
      })),
  }), 'admin');

  // Mot de passe provisoire lisible (sans caractères ambigus)
  const tempPassword = () => {
    const A = 'abcdefghjkmnpqrstuvwxyz23456789';
    const b = crypto.randomBytes(10);
    let p = ''; for (let i = 0; i < 10; i++) p += A[b[i] % A.length];
    return `${p.slice(0, 5)}-${p.slice(5)}`;
  };
  function welcomeMail(u, pw, slotText) {
    const studio = settings().studio_name || 'Nada Atma';
    mailer.sendLater([{
      to: u.email,
      subject: `${studio} — votre compte est prêt`,
      text: `Bonjour ${firstName(u.name)},\n\nVotre compte ${studio} est créé.${slotText ? `\nVotre cours de la semaine : ${slotText}.` : ''}\n\nPour vous connecter${appUrl ? ` : ${appUrl}/` : ''}\nE-mail : ${u.email}\nMot de passe provisoire : ${pw}\n\nVous pourrez le changer dans votre profil. Si vous ne pouvez pas venir à un cours, annulez-le dans l'application : votre place sera proposée aux autres élèves.\n\nÀ bientôt sur le tapis,\n${studio}`,
    }]);
    // Et par SMS, si un numéro est connu et que les SMS sont activés
    if ((settings().sms_mode || 'all') !== 'off' && toInternational(u.phone)) {
      sms.sendLater([{ to: u.phone, text: `${studio} : bonjour ${firstName(u.name)}, votre compte est pret.${slotText ? ` Votre cours : ${slotText.split(',')[0]}.` : ''} Connexion${appUrl ? ` ${appUrl}/` : ''} avec ${u.email}, mot de passe provisoire ${pw}` }]);
    }
  }
  const slotLabel = (t) => `${DAY_NAMES[t.weekday]} ${hhmm(t.start_time)}`;

  // La professeure crée un compte élève, avec son créneau à l'année
  route('POST', '/api/admin/users', async ({ body }) => {
    const name = str(body.name, 100), email = str(body.email, 200).toLowerCase(), phone = str(body.phone, 30);
    if (!name) fail(400, 'Le nom est obligatoire');
    if (!isEmail(email)) fail(400, 'Adresse e-mail invalide');
    if (q('SELECT 1 FROM users WHERE email = ?').get(email)) fail(409, 'Un compte existe déjà avec cette adresse');
    const t = body.template_id ? (q('SELECT * FROM templates WHERE id = ? AND active = 1').get(body.template_id) || fail(404, 'Créneau introuvable')) : null;
    const pw = tempPassword();
    const out = tx(db, () => {
      const r = q("INSERT INTO users(email, name, phone, password_hash, role) VALUES (?,?,?,?,'member')").run(email, name, phone, hashPassword(pw));
      const id = Number(r.lastInsertRowid);
      const en = t ? enroll(t, id, 'confirmed') : null;
      return { id, en };
    });
    const u = q('SELECT * FROM users WHERE id = ?').get(out.id);
    if (body.send_email !== false) welcomeMail(u, pw, t ? `${slotLabel(t)}, à partir du ${longDate(out.en.start_date)}` : '');
    return { user: publicUser(u), temp_password: pw, start_date: out.en?.start_date || null };
  }, 'admin');

  // Changer le créneau à l'année d'un·e élève (ou le retirer avec template_id null)
  route('PUT', '/api/admin/users/:id/slot', async ({ params, body }) => {
    const u = q('SELECT * FROM users WHERE id = ?').get(params.id) || fail(404, 'Membre introuvable');
    const t = body.template_id ? (q('SELECT * FROM templates WHERE id = ? AND active = 1').get(body.template_id) || fail(404, 'Créneau introuvable')) : null;
    return tx(db, () => {
      const from = body.from ? reqDate(body.from, 'Date de début') : null;
      const cur = q('SELECT * FROM enrollments WHERE user_id = ? AND end_date IS NULL').all(u.id);
      if (t && cur.length === 1 && cur[0].template_id === t.id) return { ok: true, unchanged: true };
      cur.forEach((e) => endEnrollment(e, from));
      const en = t ? enroll(t, u.id, 'confirmed', from) : null;
      if (t) notify([u.id], { kind: 'enrollment', title: `Votre cours de la semaine : ${slotLabel(t)}`, body: `Vous êtes inscrit·e le ${slotLabel(t)} à partir du ${longDate(en.start_date)}.`, link: '#/planning' });
      return { ok: true, start_date: en?.start_date || null };
    });
  }, 'admin');

  // Nouveau mot de passe provisoire (élève qui a oublié le sien)
  route('POST', '/api/admin/users/:id/password', async ({ params, body }) => {
    const u = q('SELECT * FROM users WHERE id = ?').get(params.id) || fail(404, 'Membre introuvable');
    const pw = tempPassword();
    q('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(pw), u.id);
    q('DELETE FROM auth_tokens WHERE user_id = ?').run(u.id);
    if (body.send_email !== false) welcomeMail(u, pw, '');
    return { temp_password: pw };
  }, 'admin');

  // Ajuster les crédits de rattrapage d'un membre (+1 / −1, carnet offert…)
  route('POST', '/api/admin/users/:id/credits', async ({ params, body }) => {
    const u = q('SELECT * FROM users WHERE id = ?').get(params.id) || fail(404, 'Membre introuvable');
    const delta = int(body.delta, -100, 100, 'Ajustement');
    q('UPDATE users SET credit_adjust = credit_adjust + ? WHERE id = ?').run(delta, u.id);
    return { credits: creditsFor(u.id) };
  }, 'admin');

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
  route('GET', '/api/admin/settings', async () => ({
    settings: settings(), sms_ready: !!sms.live,
    push_users: q("SELECT COUNT(DISTINCT p.user_id) n FROM push_subscriptions p JOIN users u ON u.id = p.user_id WHERE u.active = 1 AND u.role = 'member'").get().n,
  }), 'admin');
  route('PUT', '/api/admin/settings', async ({ body }) => {
    const up = q('UPDATE settings SET value = ? WHERE key = ?');
    if (body.studio_name !== undefined) up.run(str(body.studio_name, 100) || 'Nada Atma', 'studio_name');
    if (body.cancel_deadline_hours !== undefined) up.run(String(int(body.cancel_deadline_hours, 0, 720, 'Délai')), 'cancel_deadline_hours');
    if (body.booking_horizon_days !== undefined) up.run(String(int(body.booking_horizon_days, 0, 800, 'Ouverture')), 'booking_horizon_days');
    if (body.max_active_bookings !== undefined) up.run(String(int(body.max_active_bookings, 0, 1000, 'Limite')), 'max_active_bookings');
    if (body.skip_public_holidays !== undefined) up.run(body.skip_public_holidays ? '1' : '0', 'skip_public_holidays');
    if (body.makeup_requires_credit !== undefined) up.run(body.makeup_requires_credit ? '1' : '0', 'makeup_requires_credit');
    if (body.allow_self_enroll !== undefined) up.run(body.allow_self_enroll ? '1' : '0', 'allow_self_enroll');
    if (['all', 'changes', 'off'].includes(body.sms_mode)) up.run(body.sms_mode, 'sms_mode');
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
  const handler = async function handler(req, res) {
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
  handler.generate = generate; // utilisé par les scripts d'initialisation
  return handler;
}

module.exports = { createApp, hashPassword, verifyPassword };
