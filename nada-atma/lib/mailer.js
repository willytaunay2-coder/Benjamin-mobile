'use strict';
// Envoi d'e-mails via une API HTTP (aucune dépendance) :
//  - Brevo  : BREVO_API_KEY
//  - Resend : RESEND_API_KEY
// Sans clé, les e-mails sont seulement affichés dans la console (mode développement).
// MAIL_FROM = adresse d'expédition (ex. "Nada Atma <reservations@nada-atma.com>")

function parseFrom(from) {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from || '');
  return m ? { name: m[1] || 'Nada Atma', email: m[2] } : { name: 'Nada Atma', email: from || 'no-reply@example.com' };
}

function createMailer(env = process.env) {
  const from = parseFrom(env.MAIL_FROM);
  const sent = []; // gardé pour les tests

  async function send({ to, subject, text }) {
    sent.push({ to, subject, text });
    try {
      if (env.BREVO_API_KEY) {
        const r = await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ sender: from, to: [{ email: to }], subject, textContent: text }),
          signal: AbortSignal.timeout(15000),
        });
        if (!r.ok) console.error('E-mail non envoyé (Brevo)', r.status, await r.text());
      } else if (env.RESEND_API_KEY) {
        const r = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: `${from.name} <${from.email}>`, to: [to], subject, text }),
          signal: AbortSignal.timeout(15000),
        });
        if (!r.ok) console.error('E-mail non envoyé (Resend)', r.status, await r.text());
      } else if (!env.MAIL_SILENT) {
        console.log(`[e-mail simulé] à ${to} — ${subject}`);
      }
    } catch (e) {
      console.error('E-mail non envoyé :', e.message);
    }
  }

  // Envoi en arrière-plan, un par un (ne bloque jamais la requête)
  function sendLater(messages) {
    if (!messages.length) return;
    setImmediate(async () => { for (const m of messages) await send(m); });
  }

  // live : un service d'envoi est branché (sinon les e-mails ne partent pas vraiment)
  return { send, sendLater, sent, live: !!(env.BREVO_API_KEY || env.RESEND_API_KEY) };
}

module.exports = { createMailer };
