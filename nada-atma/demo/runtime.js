/* Démo navigateur : fait tourner le vrai serveur (lib/*.js) dans la page, avec SQLite (sql.js).
   Les modules du serveur sont injectés par scripts/build-demo.js dans DEMO_MODULES. */
(function () {
  'use strict';
  const G = globalThis;

  // ---------- Équivalents navigateur des modules Node ----------
  const hex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join('');
  class Buf extends Uint8Array {
    toString(enc) { return enc === 'hex' ? hex(this) : new TextDecoder().decode(this); }
    static from(v, enc) {
      if (typeof v === 'string') {
        if (enc === 'hex') { const a = new Buf(v.length / 2); for (let i = 0; i < a.length; i++) a[i] = parseInt(v.substr(i * 2, 2), 16); return a; }
        return new Buf(new TextEncoder().encode(v));
      }
      const a = new Buf(v.length); a.set(v); return a;
    }
    static concat(list) { const o = new Buf(list.reduce((n, b) => n + b.length, 0)); let k = 0; for (const b of list) { o.set(b, k); k += b.length; } return o; }
  }
  G.Buffer = Buf;
  G.process = G.process || { env: {} };
  G.setImmediate = G.setImmediate || ((f) => setTimeout(f, 0));

  const nodeCrypto = {
    randomBytes(n) { const b = new Buf(n); G.crypto.getRandomValues(b); return b; },
    // Démo uniquement : empreinte rapide (le vrai serveur utilise scrypt)
    scryptSync(pw, salt, len) {
      const s = String(pw) + '|' + hex(salt); const out = new Buf(len);
      let h1 = 0x811c9dc5, h2 = 0x01000193;
      for (let r = 0; r < 64; r++) for (let i = 0; i < s.length; i++) { h1 = Math.imul(h1 ^ s.charCodeAt(i), 16777619) >>> 0; h2 = Math.imul(h2 + h1 + r, 2246822507) >>> 0; }
      for (let i = 0; i < len; i++) { h1 = Math.imul(h1 ^ (h2 >>> (i % 24)), 16777619) >>> 0; out[i] = h1 & 255; }
      return out;
    },
    createHash() {
      let data = '';
      const h = { update(x) { data += String(x); return h; }, digest() { return sha256Hex(data); } };
      return h;
    },
    timingSafeEqual(a, b) { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]; return d === 0; },
  };
  // SHA-256 (empreinte des jetons, comme sur le serveur)
  function sha256Hex(str) {
    const bytes = new TextEncoder().encode(str);
    const K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
    const H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    const l = bytes.length, withPad = ((l + 9 + 63) >> 6) << 6, m = new Uint8Array(withPad);
    m.set(bytes); m[l] = 0x80; const bits = l * 8;
    m[withPad - 4] = bits >>> 24; m[withPad - 3] = bits >>> 16; m[withPad - 2] = bits >>> 8; m[withPad - 1] = bits;
    const w = new Uint32Array(64), r = (x, n) => (x >>> n) | (x << (32 - n));
    for (let o = 0; o < withPad; o += 64) {
      for (let i = 0; i < 16; i++) w[i] = (m[o + 4 * i] << 24) | (m[o + 4 * i + 1] << 16) | (m[o + 4 * i + 2] << 8) | m[o + 4 * i + 3];
      for (let i = 16; i < 64; i++) w[i] = (w[i - 16] + (r(w[i - 15], 7) ^ r(w[i - 15], 18) ^ (w[i - 15] >>> 3)) + w[i - 7] + (r(w[i - 2], 17) ^ r(w[i - 2], 19) ^ (w[i - 2] >>> 10))) | 0;
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const t1 = (h + (r(e, 6) ^ r(e, 11) ^ r(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
        const t2 = ((r(a, 2) ^ r(a, 13) ^ r(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    return H.map((x) => (x >>> 0).toString(16).padStart(8, '0')).join('');
  }

  const nodePath = {
    sep: '/',
    join: (...a) => a.join('/').replace(/\/+/g, '/'),
    dirname: (p) => p.replace(/\/[^/]*$/, '') || '/',
    extname: (p) => (p.match(/\.[^./]*$/) || [''])[0],
    normalize: (p) => p,
  };

  // node:sqlite (DatabaseSync) au-dessus de sql.js
  let SQL = null, initialBytes = null;
  const DEMO_SHA = sha256Hex;
  class DatabaseSync {
    constructor() { this.db = initialBytes ? new SQL.Database(initialBytes) : new SQL.Database(); this.cache = new Map(); }
    exec(sql) { this.db.exec(sql); }
    prepare(sql) { return new Statement(this, sql); }
    stmt(sql) { let s = this.cache.get(sql); if (!s) { s = this.db.prepare(sql); this.cache.set(sql, s); } return s; }
    export() { for (const s of this.cache.values()) s.free(); this.cache.clear(); return this.db.export(); }
  }
  const norm = (v) => (v === undefined ? null : v === true ? 1 : v === false ? 0 : v);
  class Statement {
    constructor(owner, sql) { this.o = owner; this.sql = sql; }
    exec(params, mode) {
      const st = this.o.stmt(this.sql);
      try {
        if (params.length) st.bind(params.map(norm)); else st.reset();
        if (mode === 'run') { st.step(); return null; }
        const rows = [];
        while (st.step()) { rows.push(st.getAsObject()); if (mode === 'get') break; }
        return rows;
      } finally { st.reset(); }
    }
    get(...p) { return this.exec(p, 'get')[0]; }
    all(...p) { return this.exec(p, 'all'); }
    run(...p) {
      this.exec(p, 'run');
      const id = this.o.db.exec('SELECT last_insert_rowid()')[0].values[0][0];
      return { changes: this.o.db.getRowsModified(), lastInsertRowid: id };
    }
  }

  // ---------- Boîte mail de démo ----------
  const DEMO = G.NADA_DEMO = { outbox: [], tokens: {}, role: '', cookie: '', db: null, handler: null };
  const mailerModule = {
    createMailer() {
      // Comme chez Nada Atma : pas de service d'e-mail, tout passe par l'application et les textos
      return { sent: [], live: false, async send() {}, sendLater() {} };
    },
  };

  // ---------- Chargeur de modules ----------
  const cache = {};
  function requireMod(name) {
    if (name === 'node:crypto') return nodeCrypto;
    if (name === 'node:path') return nodePath;
    if (name === 'node:fs') return {};
    if (name === 'node:sqlite') return { DatabaseSync };
    if (name === './mailer') return mailerModule;
    if (name === './push') {
      // Pas de vrai envoi dans la démo : la notification arrive dans « Messages »
      return {
        createVapidKeys: () => ({ publicKey: 'demo', jwk: {} }),
        createPush() {
          return { sent: [], publicKey: () => 'demo', async send() {},
            sendLater(list) { for (const { sub, message } of list) DEMO.outbox.push({ kind: 'push', to: sub.endpoint, title: message.title, body: message.body, at: Date.now() }); saveSoon(); } };
        },
      };
    }
    if (name === './sms') {
      // Le vrai module (format des numéros, alphabet SMS), avec un envoi simulé dans la boîte de démo
      const real = loadModule('./sms');
      return { ...real, createSms() {
        return { live: false, sent: [], async send(m) { DEMO.outbox.push({ kind: 'sms', to: real.toInternational(m.to), text: real.gsmText(m.text), at: Date.now() }); },
          sendLater(list) { for (const m of list) { const to = real.toInternational(m.to); if (to) DEMO.outbox.push({ kind: 'sms', to, text: real.gsmText(m.text), at: Date.now() }); } saveSoon(); } };
      } };
    }
    return loadModule(name);
  }
  function loadModule(name) {
    if (cache[name]) return cache[name].exports;
    const factory = G.DEMO_MODULES[name];
    if (!factory) throw new Error('Module absent de la démo : ' + name);
    const module = { exports: {} }; cache[name] = module;
    factory(module, module.exports, requireMod, '/lib');
    return module.exports;
  }

  // ---------- Requêtes /api/… servies dans la page ----------
  function callApi(method, url, body) {
    return new Promise((resolve) => {
      const headers = {}; let status = 200;
      const req = {
        method, url,
        headers: { cookie: DEMO.cookie ? `na_session=${DEMO.cookie}` : '', 'content-type': 'application/json' },
        on(ev, cb) {
          if (ev === 'data' && body) setTimeout(() => cb(Buf.from(body)), 0);
          if (ev === 'end') setTimeout(cb, 0);
        },
        destroy() {},
      };
      const res = {
        setHeader(k, v) { headers[k.toLowerCase()] = v; },
        writeHead(s, h = {}) { status = s; for (const k in h) headers[k.toLowerCase()] = h[k]; },
        end(data) {
          const sc = headers['set-cookie'];
          if (sc) { const m = /na_session=([^;]*)/.exec(sc); DEMO.cookie = m ? m[1] : ''; }
          resolve({ status, text: data == null ? '' : String(data) });
        },
      };
      DEMO.handler(req, res);
    });
  }
  const realFetch = G.fetch ? G.fetch.bind(G) : null;
  G.fetch = async (input, opts = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    if (!url.startsWith('/api/')) return realFetch(input, opts);
    const method = (opts.method || 'GET').toUpperCase();
    const r = await callApi(method, url, opts.body);
    if (method !== 'GET') saveSoon();
    return new Response(r.text, { status: r.status, headers: { 'Content-Type': 'application/json' } });
  };
  async function api(method, url, body) {
    const r = await callApi(method, url, body === undefined ? undefined : JSON.stringify(body));
    const data = r.text ? JSON.parse(r.text) : {};
    if (r.status >= 400) throw new Error(url + ' : ' + data.error);
    return data;
  }

  // ---------- Sauvegarde dans le navigateur ----------
  const KEY = 'nada-atma-demo-v10';
  let saveTimer = null;
  function saveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(save, 400); }
  function save() {
    try {
      const bytes = DEMO.db.export(); let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      localStorage.setItem(KEY, JSON.stringify({ db: btoa(bin), outbox: DEMO.outbox.slice(-80), tokens: DEMO.tokens, role: DEMO.role, cookie: DEMO.cookie, seededOn: DEMO.seededOn, seen: DEMO.seen || {} }));
    } catch { /* stockage indisponible : la démo marche quand même, sans mémoire */ }
  }
  function load() {
    try {
      const raw = localStorage.getItem(KEY); if (!raw) return null;
      const s = JSON.parse(raw); const bin = atob(s.db); const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      return { ...s, bytes: u8 };
    } catch { return null; }
  }
  function clearSaved() { try { localStorage.removeItem(KEY); } catch { /* rien */ } }

  // ---------- Données de démonstration ----------
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  async function seed() {
    const prof = await api('POST', '/api/register', { name: 'Professeure', email: 'prof@nada-atma.demo', phone: '06 00 00 00 00', password: 'demo-professeure' });
    DEMO.tokens.prof = DEMO.cookie;
    await api('PUT', '/api/admin/settings', { booking_horizon_days: 0 });
    for (const [label, a, b] of [['Vacances de la Toussaint', '2026-10-17', '2026-11-01'], ['Vacances de Noël', '2026-12-19', '2027-01-03'],
      ["Vacances d'hiver (zone A)", '2027-02-06', '2027-02-21'], ['Vacances de printemps (zone A)', '2027-04-03', '2027-04-18']]) {
      await api('POST', '/api/admin/closures', { label, start_date: a, end_date: b });
    }
    const today = iso(new Date());
    // Saison commencée en septembre, comme dans la réalité
    const now = new Date(); const sy = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
    const start = `${sy}-09-01`, end = `${sy + 1}-06-30`;
    const T = {};
    for (const [k, wd, h] of [['ma12', 2, '12:15'], ['ma19', 2, '19:00'], ['ma20', 2, '20:15'], ['je12', 4, '12:15'], ['je18', 4, '18:30'], ['je19', 4, '19:45'], ['ve9', 5, '09:00']]) {
      T[k] = (await api('POST', '/api/admin/templates', { title: 'Cours de yoga', description: 'Un doux mélange de Yin yoga, Yoga thérapie, Hatha yoga et Yoga du son, saupoudré de sonothérapie.',
        weekday: wd, start_time: h, duration_min: 60, capacity: 10, location: 'L’espace des possibles, Miribel', start_date: start, end_date: end })).template;
    }
    const people = {
      ma19: ['Claire Dupont', 'Marie Bernard', 'Sophie Laurent', 'Thomas Roux', 'Anne Fontaine', 'Julie Morel', 'Paul Garnier', 'Léa Petit', 'Camille Faure'],
      ma12: ['Nina Blanc', 'Lucas Henry', 'Inès Moreau', 'Jules Lambert', 'Chloé Simon', 'Louis Michel'],
      ma20: ['Manon Lefèvre', 'Adam Rousseau', 'Zoé Vincent', 'Gabriel Muller', 'Alice Fournier', 'Arthur Bonnet', 'Rose Dupuis', 'Victor Lemoine'],
      je12: ['Lina Mercier', 'Tom Guerin'],
      je18: ['Jade Boyer', 'Noé Garcia', 'Eva Chevalier', 'Sacha Robin', 'Mila Clément', 'Ethan Morin', 'Lou Nicolas', 'Clara Perrin', 'Maël Roche', 'Anna Gauthier'],
      je19: ['Enzo Blanchard', 'Lola Giraud', 'Timéo Joly', 'Margot Rivière', 'Robin Colin'],
      ve9: ['Agathe Lemaire', 'Simone Carré', 'Bernard Picard'],
      none: ['Inès Roy', 'Paul Vidal'], // pas encore de créneau : elles prennent les places libres
    };
    const tok = {}; let n = 0;
    for (const [slot, names] of Object.entries(people)) for (const name of names) {
      n++; DEMO.cookie = DEMO.tokens.prof;
      const email = name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]+/g, '.') + '@exemple.fr';
      const r = await api('POST', '/api/admin/users', { name, email, phone: `06 ${pad(10 + n)} 34 56 ${pad(10 + n)}`, template_id: T[slot] ? T[slot].id : null, send_email: false });
      DEMO.cookie = ''; await api('POST', '/api/login', { email, password: r.temp_password }); tok[name] = DEMO.cookie;
    }
    // Inscrit·es depuis la rentrée
    DEMO.db.prepare('UPDATE enrollments SET start_date = (SELECT t.start_date FROM templates t WHERE t.id = enrollments.template_id)').run();
    DEMO.cookie = DEMO.tokens.prof;
    const katia = await api('POST', '/api/admin/users', { name: 'Katia Picquet', email: 'katia.picquet@exemple.fr', phone: '06 12 34 56 78', template_id: T.ma19.id });
    DEMO.katiaPassword = katia.temp_password;
    DEMO.cookie = ''; await api('POST', '/api/login', { email: 'katia.picquet@exemple.fr', password: katia.temp_password }); DEMO.tokens.katia = DEMO.cookie;

    // Notifications activées sur le téléphone de Katia, de la professeure et d'environ deux élèves sur trois
    const addSub = DEMO.db.prepare("INSERT INTO push_subscriptions(user_id, endpoint, p256dh, auth) VALUES (?, ?, 'demo', 'demo')");
    for (const u of DEMO.db.prepare("SELECT id, email, role FROM users").all()) {
      if (u.email === 'katia.picquet@exemple.fr') addSub.run(u.id, 'demo://katia');
      else if (u.role === 'admin') addSub.run(u.id, 'demo://prof');
      else if (u.id % 3) addSub.run(u.id, 'demo://eleve-' + u.id);
    }

    // Une semaine vivante : des places libérées, une prise
    DEMO.cookie = DEMO.tokens.prof;
    const { sessions } = await api('GET', `/api/sessions?from=${today}&to=${iso(new Date(Date.now() + 13 * 864e5))}`);
    const next = (tid) => sessions.find((s) => s.template_id === tid && !s.cancelled && !s.is_past);
    const as = async (name, path) => { DEMO.cookie = tok[name]; try { await api('POST', path); } catch { /* séance trop proche */ } };
    const ma12 = next(T.ma12.id), je18 = next(T.je18.id), ma20 = next(T.ma20.id);
    if (ma12) await as('Nina Blanc', `/api/sessions/${ma12.id}/release`);
    if (ma20) { await as('Rose Dupuis', `/api/sessions/${ma20.id}/release`); await as('Lina Mercier', `/api/sessions/${ma20.id}/book`); }
    // Deux élèves à la séance, avec des séances passées et à venir
    DEMO.cookie = DEMO.tokens.prof;
    const dropIns = [['Hélène Garnier', 7, ['ma12', 'je19', 've9']], ['Marc Olivier', 4, ['ma20', 'je12']]];
    for (const [name, past, slots] of dropIns) {
      n++; DEMO.cookie = DEMO.tokens.prof;
      const email = name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z]+/g, '.') + '@exemple.fr';
      const r = await api('POST', '/api/admin/users', { name, email, phone: `06 ${pad(10 + n)} 34 56 ${pad(10 + n)}`, plan: 'drop_in', send_email: false });
      DEMO.cookie = ''; await api('POST', '/api/login', { email, password: r.temp_password }); tok[name] = DEMO.cookie;
      const ids = slots.map((k) => T[k].id).join(',');
      const olds = DEMO.db.prepare(`SELECT id FROM sessions WHERE template_id IN (${ids}) AND date < ? AND cancelled = 0 ORDER BY date DESC LIMIT ${past}`).all(today);
      for (const o of olds) DEMO.db.prepare('INSERT INTO bookings(session_id, user_id) VALUES (?, ?)').run(o.id, r.user.id);
    }
    const ve9 = next(T.ve9.id), je19 = next(T.je19.id);
    if (ve9) await as('Hélène Garnier', `/api/sessions/${ve9.id}/book`);
    if (je19) await as('Hélène Garnier', `/api/sessions/${je19.id}/book`); // deux cours la même semaine : possible à la séance

    // Le jeudi 18h30 reste complet : on peut y essayer la liste d'attente
    // Le mardi 19h de Katia est complet : deux élèves attendent une place
    const ma19 = next(T.ma19.id);
    if (ma19) { await as('Inès Roy', `/api/sessions/${ma19.id}/waitlist`); await as('Paul Vidal', `/api/sessions/${ma19.id}/waitlist`); }
    DEMO.outbox = DEMO.outbox.filter((m) => /katia|prof@|^33612345678$|^33600000000$/.test(m.to)); // garder les messages des deux personnes de la démo
    DEMO.cookie = '';
    DEMO.seededOn = today;
  }

  DEMO.api = api;
  DEMO.tokenHash = (t) => DEMO_SHA(String(t));
  DEMO.boot = async function boot(onProgress) {
    SQL = await G.initSqlJs();
    const saved = load();
    if (saved) {
      initialBytes = saved.bytes;
      Object.assign(DEMO, { outbox: saved.outbox || [], tokens: saved.tokens || {}, role: saved.role || '', cookie: saved.cookie || '', seededOn: saved.seededOn, seen: saved.seen || {} });
    }
    const { openDb } = requireMod('./db');
    const { createApp } = requireMod('./app');
    DEMO.db = openDb(':memory:');
    initialBytes = null;
    DEMO.handler = createApp(DEMO.db, { appUrl: '', limits: false });
    if (!saved) { onProgress && onProgress(); await seed(); save(); }
  };
  DEMO.reset = async function reset() {
    clearSaved();
    initialBytes = null;
    Object.assign(DEMO, { outbox: [], tokens: {}, role: '', cookie: '' });
    const { openDb } = requireMod('./db');
    const { createApp } = requireMod('./app');
    DEMO.db = openDb(':memory:');
    DEMO.handler = createApp(DEMO.db, { appUrl: '', limits: false });
    await seed(); save();
  };
  DEMO.save = save;
})();
