'use strict';
// Crée les créneaux hebdomadaires de Nada Atma et génère les séances de la saison.
// Usage : npm run creneaux -- [places=12] [fin=2027-06-30]
process.env.TZ = process.env.STUDIO_TZ || 'Europe/Paris';
const path = require('node:path');
const { openDb } = require('../lib/db');
const { createApp } = require('../lib/app');
const D = require('../lib/dates');

const args = Object.fromEntries(process.argv.slice(2).map((a) => a.split('=')));
const capacity = Number(args.places || 12);
const end = args.fin || '2027-06-30';
const start = args.debut || D.toISO(new Date());
const db = openDb(process.env.DB_FILE || path.join(__dirname, '..', 'data', 'nada-atma.db'));
const app = createApp(db);

const TITLE = 'Cours de yoga';
const DESCRIPTION = 'Un doux mélange de Yin yoga, Yoga thérapie, Hatha yoga et Yoga du son, saupoudré de sonothérapie.';
const LOCATION = 'L’espace des possibles, Miribel';
// [jour (0 = dimanche), heure, durée en minutes]
const SLOTS = [
  [2, '12:15', 60], [2, '19:00', 60], [2, '20:15', 60],
  [4, '12:15', 60], [4, '18:30', 60], [4, '19:45', 60],
  [5, '09:00', 60],
];

const exists = db.prepare('SELECT 1 FROM templates WHERE weekday = ? AND start_time = ?');
const insert = db.prepare(`INSERT INTO templates(title, description, weekday, start_time, duration_min, capacity, location, color, start_date, end_date)
  VALUES (?,?,?,?,?,?,?,?,?,?)`);
let n = 0;
for (const [wd, time, dur] of SLOTS) {
  if (exists.get(wd, time)) continue;
  insert.run(TITLE, DESCRIPTION, wd, time, dur, capacity, LOCATION, '#8e3b6b', start, end);
  n++;
}
const r = app.generate(start, end);
console.log(`${n} créneau(x) ajouté(s), ${r.created} séance(s) créée(s) du ${start} au ${end} (${r.skipped} jours sautés : vacances ou fériés).`);
console.log('Pensez à importer les vacances scolaires (zone A) dans Gestion › Vacances avant ou après : les séances concernées seront retirées.');
