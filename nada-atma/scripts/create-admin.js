'use strict';
// Crée (ou réinitialise) le compte de la professeure et affiche un mot de passe provisoire.
// Usage : npm run admin -- prof@exemple.fr "Prénom Nom"
const path = require('node:path');
const crypto = require('node:crypto');
const { openDb } = require('../lib/db');
const { hashPassword } = require('../lib/app');

const [email = '', name = 'Professeure'] = process.argv.slice(2);
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error('Usage : npm run admin -- prof@exemple.fr "Prénom Nom"');
  process.exit(1);
}
const db = openDb(process.env.DB_FILE || path.join(__dirname, '..', 'data', 'nada-atma.db'));
const A = 'abcdefghjkmnpqrstuvwxyz23456789';
const pw = Array.from(crypto.randomBytes(12), (b) => A[b % A.length]).join('').replace(/(.{4})(?=.)/g, '$1-');
const mail = email.trim().toLowerCase();
const u = db.prepare('SELECT id FROM users WHERE email = ?').get(mail);
if (u) {
  db.prepare("UPDATE users SET role = 'admin', active = 1, password_hash = ? WHERE id = ?").run(hashPassword(pw), u.id);
  db.prepare('DELETE FROM auth_tokens WHERE user_id = ?').run(u.id);
  console.log(`Compte existant passé professeure, nouveau mot de passe.`);
} else {
  db.prepare("INSERT INTO users(email, name, password_hash, role) VALUES (?, ?, ?, 'admin')").run(mail, name, hashPassword(pw));
  console.log('Compte de la professeure créé.');
}
console.log(`\n  E-mail       : ${mail}\n  Mot de passe : ${pw}\n\nÀ changer dans « Profil » après la première connexion.`);
db.close();
