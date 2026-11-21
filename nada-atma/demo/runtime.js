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
    timingSafeEqual(a, b) { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]; return d === 0; },
  };
  const nodePath = {
    sep: '/',
    join: (...a) => a.join('/').replace(/\/+/g, '/'),
    dirname: (p) => p.replace(/\/[^/]*$/, '') || '/',
    extname: (p) => (p.match(/\.[^./]*$/) || [''])[0],
    normalize: (p) => p,
  };

  // node:sqlite (DatabaseSync) au-dessus de sql.js
  let SQL = null, initialBytes = null;
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
      return {
        sent: [],
        async send(m) { DEMO.outbox.push({ ...m, at: Date.now() }); },
        sendLater(list) { for (const m of list) DEMO.outbox.push({ ...m, at: Date.now() }); saveSoon(); },
      };
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
        return { live: true, sent: [], async send(m) { DEMO.outbox.push({ kind: 'sms', to: real.toInternational(m.to), text: real.gsmText(m.text), at: Date.now() }); },
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
  const KEY = 'nada-atma-demo-v4';
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
        weekday: wd, start_time: h, duration_min: 60, capacity: 12, location: 'L’espace des possibles, Miribel', start_date: start, end_date: end })).template;
    }
    const people = {
      ma19: ['Claire Dupont', 'Marie Bernard', 'Sophie Laurent', 'Thomas Roux', 'Anne Fontaine', 'Julie Morel', 'Paul Garnier', 'Léa Petit', 'Camille Faure', 'Hugo Martin', 'Emma Girard'],
      ma12: ['Nina Blanc', 'Lucas Henry', 'Inès Moreau', 'Jules Lambert', 'Chloé Simon', 'Louis Michel'],
      ma20: ['Manon Lefèvre', 'Adam Rousseau', 'Zoé Vincent', 'Gabriel Muller', 'Alice Fournier', 'Arthur Bonnet', 'Rose Dupuis', 'Victor Lemoine'],
      je12: ['Lina Mercier', 'Tom Guerin'],
      je18: ['Jade Boyer', 'Noé Garcia', 'Eva Chevalier', 'Sacha Robin', 'Mila Clément', 'Ethan Morin', 'Lou Nicolas', 'Clara Perrin', 'Maël Roche', 'Anna Gauthier', 'Liam Dumas', 'Sarah Brun'],
      je19: ['Enzo Blanchard', 'Lola Giraud', 'Timéo Joly', 'Margot Rivière', 'Robin Colin'],
      ve9: ['Agathe Lemaire', 'Simone Carré', 'Bernard Picard'],
    };
    const tok = {}; let n = 0;
    for (const [slot, names] of Object.entries(people)) for (const name of names) {
      n++; DEMO.cookie = DEMO.tokens.prof;
      const email = name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]+/g, '.') + '@exemple.fr';
      const r = await api('POST', '/api/admin/users', { name, email, phone: `06 ${pad(10 + n)} 34 56 ${pad(10 + n)}`, template_id: T[slot].id, send_email: false });
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
    if (je18) await as('Jade Boyer', `/api/sessions/${je18.id}/release`);
    DEMO.outbox = DEMO.outbox.filter((m) => /katia|prof@|^33612345678$|^33600000000$/.test(m.to)); // garder les messages des deux personnes de la démo
    DEMO.cookie = '';
    DEMO.seededOn = today;
  }

  DEMO.api = api;
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
    DEMO.handler = createApp(DEMO.db, { appUrl: '' });
    if (!saved) { onProgress && onProgress(); await seed(); save(); }
  };
  DEMO.reset = async function reset() {
    clearSaved();
    initialBytes = null;
    Object.assign(DEMO, { outbox: [], tokens: {}, role: '', cookie: '' });
    const { openDb } = requireMod('./db');
    const { createApp } = requireMod('./app');
    DEMO.db = openDb(':memory:');
    DEMO.handler = createApp(DEMO.db, { appUrl: '' });
    await seed(); save();
  };
  DEMO.save = save;
})();
