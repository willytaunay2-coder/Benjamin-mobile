'use strict';
// Notifications sur le téléphone (Web Push), gratuites, sans dépendance.
// Elles s'affichent comme un SMS (écran verrouillé, son), une fois l'application installée sur l'écran d'accueil.
//  - Chiffrement du message : RFC 8291 (aes128gcm, RFC 8188)
//  - Identification du serveur : VAPID (RFC 8292), clés créées automatiquement et gardées dans la base
const crypto = require('node:crypto');

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const fromB64u = (s) => Buffer.from(String(s), 'base64url');

// HKDF-SHA256 sur un seul bloc (longueur ≤ 32 octets)
function hkdf(salt, ikm, info, length) {
  const prk = crypto.createHmac('sha256', salt).update(ikm).digest();
  return crypto.createHmac('sha256', prk).update(Buffer.concat([info, Buffer.from([1])])).digest().subarray(0, length);
}

// Chiffre le message pour un abonnement (clés p256dh et auth fournies par le navigateur)
function encrypt(sub, payload, { salt = crypto.randomBytes(16), ecdh = null } = {}) {
  const uaPublic = fromB64u(sub.p256dh), authSecret = fromB64u(sub.auth);
  if (uaPublic.length !== 65 || authSecret.length < 16) throw new Error('Abonnement invalide');
  const local = ecdh || crypto.createECDH('prime256v1');
  if (!ecdh) local.generateKeys();
  const asPublic = local.getPublicKey();
  const shared = local.computeSecret(uaPublic);
  const ikm = hkdf(authSecret, shared, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]), 32);
  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header[20] = asPublic.length;
  return Buffer.concat([header, asPublic, body]);
}

// Clés VAPID : { publicKey (base64url, 65 octets), jwk (clé privée) }
function createVapidKeys() {
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = privateKey.export({ format: 'jwk' });
  const publicKey = b64u(Buffer.concat([Buffer.from([4]), fromB64u(jwk.x), fromB64u(jwk.y)]));
  return { publicKey, jwk };
}

function vapidHeader(endpoint, keys, subject, now = Date.now()) {
  const enc = (o) => b64u(JSON.stringify(o));
  const unsigned = `${enc({ typ: 'JWT', alg: 'ES256' })}.${enc({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })}`;
  const key = crypto.createPrivateKey({ key: keys.jwk, format: 'jwk' });
  const sig = crypto.sign('sha256', Buffer.from(unsigned), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${unsigned}.${b64u(sig)}, k=${keys.publicKey}`;
}

// keys : () => clés VAPID ; onGone(endpoint) : abonnement expiré à supprimer
function createPush({ keys, subject = 'mailto:contact@nada-atma.com', onGone = () => {} }) {
  const sent = []; // gardé pour les tests

  async function send(sub, message) {
    sent.push({ endpoint: sub.endpoint, message });
    try {
      const k = keys();
      const r = await fetch(sub.endpoint, {
        method: 'POST',
        headers: {
          TTL: '86400', Urgency: 'high', 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream',
          Authorization: vapidHeader(sub.endpoint, k, subject),
        },
        body: encrypt(sub, JSON.stringify(message)),
        signal: AbortSignal.timeout(15000),
      });
      if (r.status === 404 || r.status === 410) onGone(sub.endpoint);
      else if (!r.ok) console.error('Notification non envoyée', r.status, (await r.text()).slice(0, 200));
    } catch (e) {
      console.error('Notification non envoyée :', e.message);
    }
  }

  // Envoi en arrière-plan (ne bloque jamais la requête)
  function sendLater(list) {
    if (!list.length) return;
    setImmediate(async () => { for (const { sub, message } of list) await send(sub, message); });
  }

  return { send, sendLater, sent, publicKey: () => keys().publicKey };
}

module.exports = { createPush, createVapidKeys, encrypt, vapidHeader, hkdf };
