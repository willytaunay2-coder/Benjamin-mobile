/* Version d'essai : écran d'accueil, changement de côté, boîte mail de démonstration */
(function () {
  'use strict';
  const D = window.NADA_DEMO;
  const $ = (id) => document.getElementById(id);
  const PERSONAS = {
    katia: { who: 'Katia Picquet · élève', email: 'katia.picquet@exemple.fr', home: '#/planning', other: 'prof', switchTo: 'Côté professeure' },
    prof: { who: 'Professeure', email: 'prof@nada-atma.demo', home: '#/admin', other: 'katia', switchTo: 'Côté élève' },
  };
  let app = null;
  D.seen = D.seen || {};

  // Liens internes de l'application (#/planning…) : navigation dans la page
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#/"]');
    if (!a) return;
    e.preventDefault();
    NAV.hash = a.getAttribute('href');
    window.scrollTo(0, 0);
  }, true);

  // L'impression n'est pas possible dans l'aperçu
  window.print = () => app && app.toast('Dans l’application installée, ce bouton imprime la feuille d’appel.');

  // « Se déconnecter » ramène à l'écran d'accueil de la démo
  const pageFetch = window.fetch;
  window.fetch = async (input, opts = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url === '/api/logout') { setTimeout(showStart, 0); return new Response('{"ok":true}', { status: 200, headers: { 'Content-Type': 'application/json' } }); }
    const r = await pageFetch(input, opts);
    if ((opts.method || 'GET') !== 'GET') setTimeout(updateMail, 50);
    return r;
  };

  // Jeton de connexion de la personne (recréé si la professeure a changé le mot de passe de Katia)
  function ensureToken(role) {
    const email = PERSONAS[role].email;
    const ok = D.db.prepare(`SELECT 1 FROM auth_tokens t JOIN users u ON u.id = t.user_id WHERE t.token = ? AND u.email = ? AND t.expires_at > ?`).get(D.tokens[role] || '', email, Date.now());
    if (ok) return;
    const u = D.db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (!u) return;
    const b = new Uint8Array(32); crypto.getRandomValues(b);
    const token = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    D.db.prepare('UPDATE users SET active = 1 WHERE id = ?').run(u.id);
    D.db.prepare('INSERT INTO auth_tokens(token, user_id, expires_at) VALUES (?,?,?)').run(token, u.id, Date.now() + 60 * 864e5);
    D.tokens[role] = token;
  }

  async function enter(role) {
    const p = PERSONAS[role];
    ensureToken(role);
    D.role = role; D.cookie = D.tokens[role];
    NAV.h = p.home;
    $('demo-start').hidden = true;
    $('demo-bar').hidden = false;
    $('demo-who').textContent = p.who;
    $('demo-switch').textContent = p.switchTo;
    closeMail();
    $('toast').className = 'toast';
    document.getElementById('modal-root').innerHTML = '';
    window.scrollTo(0, 0);
    if (!app) app = window.startNadaApp();
    else { await app.refreshMe(); app.renderNav(); await app.router(); }
    updateMail();
    D.save();
  }

  function showStart() {
    $('demo-start').hidden = false;
    $('demo-bar').hidden = true;
    closeMail();
    D.role = '';
    D.save();
  }

  // ---------- Boîte mail ----------
  const mails = () => D.role ? D.outbox.filter((m) => m.to === PERSONAS[D.role].email) : [];
  function updateMail() {
    const n = mails().length - (D.seen[D.role] || 0);
    const el = $('demo-mail-n');
    el.hidden = n <= 0; el.textContent = String(n);
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const when = (t) => {
    const d = new Date(t); const min = Math.round((Date.now() - t) / 60000);
    if (min < 1) return 'à l’instant';
    if (min < 60) return `il y a ${min} min`;
    return d.toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  };
  function openMail() {
    const list = mails().slice().reverse();
    const fresh = list.length - (D.seen[D.role] || 0);
    $('demo-mail-to').textContent = `Reçus par ${PERSONAS[D.role].email}`;
    $('demo-mail-list').innerHTML = list.length
      ? list.map((m, i) => `<details class="demo-mail" ${i < Math.max(fresh, 1) && i === 0 ? 'open' : ''}><summary><span class="demo-mail-s">${esc(m.subject)}</span><span class="demo-mail-t">${when(m.at)}${i < fresh ? ' · nouveau' : ''}</span></summary><pre>${esc(m.text)}</pre></details>`).join('')
      : `<p class="demo-mail-empty">Aucun e-mail pour l’instant. ${D.role === 'katia' ? 'Passez côté professeure et déplacez ou ajoutez un cours : Katia sera prévenue ici.' : 'Les e-mails des élèves arrivent dans leur propre boîte.'}</p>`;
    D.seen[D.role] = mails().length;
    updateMail();
    $('demo-mailbox').hidden = false;
    $('demo-mail-close').focus();
  }
  function closeMail() { $('demo-mailbox').hidden = true; }
  $('demo-mail').onclick = openMail;
  $('demo-mail-close').onclick = closeMail;
  $('demo-mailbox').onclick = (e) => { if (e.target.id === 'demo-mailbox') closeMail(); };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMail(); });

  $('demo-switch').onclick = () => enter(PERSONAS[D.role].other);
  $('demo-as-katia').onclick = () => enter('katia');
  $('demo-as-prof').onclick = () => enter('prof');

  let resetArmed = false;
  $('demo-reset').onclick = async () => {
    const b = $('demo-reset');
    if (!resetArmed) { resetArmed = true; b.textContent = 'Toucher encore pour tout effacer et repartir de zéro'; return; }
    resetArmed = false; b.disabled = true;
    $('demo-status').textContent = 'Remise à zéro…';
    await D.reset();
    D.seen = {};
    $('demo-status').textContent = 'La démo est repartie de zéro.';
    b.textContent = 'Remettre la démo à zéro'; b.disabled = false;
  };

  (async () => {
    try {
      await D.boot(() => { $('demo-status').textContent = 'Création des cours et des élèves de démonstration…'; });
    } catch (e) {
      $('demo-status').textContent = 'La démo n’a pas pu démarrer. Rechargez la page. (' + e.message + ')';
      return;
    }
    $('demo-status').textContent = '';
    $('demo-as-katia').disabled = false;
    $('demo-as-prof').disabled = false;
    $('demo-reset').hidden = false;
  })();
})();
