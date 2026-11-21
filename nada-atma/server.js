'use strict';
// Fuseau horaire du studio : doit être défini avant toute manipulation de date.
process.env.TZ = process.env.STUDIO_TZ || 'Europe/Paris';

const http = require('node:http');
const path = require('node:path');
const { openDb } = require('./lib/db');
const { createApp } = require('./lib/app');

const PORT = Number(process.env.PORT || 3000);
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'data', 'nada-atma.db');

const db = openDb(DB_FILE);
const app = createApp(db, { cookieSecure: process.env.COOKIE_SECURE === '1' });

http.createServer(app).listen(PORT, () => {
  console.log(`Nada Atma — réservations : http://localhost:${PORT}  (base : ${DB_FILE})`);
});
