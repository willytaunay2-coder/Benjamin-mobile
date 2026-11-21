'use strict';
// Envoi de SMS (textos) via l'API HTTP de Brevo, sans dépendance :
//  - BREVO_API_KEY : la même clé que pour les e-mails
//  - SMS_SENDER    : nom affiché à la place du numéro (11 caractères max, lettres et chiffres, ex. « NadaAtma »)
// Sans clé, les SMS sont seulement affichés dans la console (mode développement), sauf si SMS_SILENT ou MAIL_SILENT.

// Numéro français ou international → format international sans « + » (ex. 33612345678)
function toInternational(phone) {
  const raw = String(phone || '').trim();
  let d = raw.replace(/\D/g, '');
  if (!d) return '';
  if (raw.startsWith('+')) return d.length >= 8 && d.length <= 15 ? d : '';
  if (d.startsWith('00')) d = d.slice(2);
  else if (d.length === 10 && d.startsWith('0')) d = '33' + d.slice(1);
  return d.length >= 8 && d.length <= 15 ? d : '';
}

// Garde le texte dans l'alphabet SMS standard (sinon chaque SMS ne tient plus que 70 caractères)
const GSM = new Set('@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà');
function gsmText(s) {
  const swaps = { '’': "'", '‘': "'", '«': '"', '»': '"', '“': '"', '”': '"', '·': '-', '–': '-', '—': '-', '…': '...', ' ': ' ', ' ': ' ', 'ç': 'c' };
  let out = '';
  const src = String(s).replace(/«[\s\u00a0\u202f]*/g, '"').replace(/[\s\u00a0\u202f]*»/g, '"');
  for (const ch of src) {
    if (GSM.has(ch)) out += ch;
    else if (swaps[ch]) out += swaps[ch];
    else out += ch.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e]/g, '');
  }
  return out.replace(/ {2,}/g, ' ').trim();
}

function createSms(env = process.env) {
  const sender = gsmText(env.SMS_SENDER || 'NadaAtma').replace(/[^A-Za-z0-9 ]/g, '').slice(0, 11) || 'NadaAtma';
  const sent = []; // gardé pour les tests
  const live = !!env.BREVO_API_KEY;

  async function send({ to, text }) {
    const recipient = toInternational(to);
    if (!recipient) return;
    const content = gsmText(text);
    sent.push({ to: recipient, text: content });
    try {
      if (live) {
        const r = await fetch('https://api.brevo.com/v3/transactionalSMS/send', {
          method: 'POST',
          headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ sender, recipient, content, type: 'transactional' }),
          signal: AbortSignal.timeout(15000),
        });
        if (!r.ok) console.error('SMS non envoyé (Brevo)', r.status, await r.text());
      } else if (!env.SMS_SILENT && !env.MAIL_SILENT) {
        console.log(`[SMS simulé] à +${recipient} — ${content}`);
      }
    } catch (e) {
      console.error('SMS non envoyé :', e.message);
    }
  }

  // Envoi en arrière-plan, un par un (ne bloque jamais la requête)
  function sendLater(messages) {
    if (!messages.length) return;
    setImmediate(async () => { for (const m of messages) await send(m); });
  }

  return { send, sendLater, sent, live };
}

module.exports = { createSms, toInternational, gsmText };
