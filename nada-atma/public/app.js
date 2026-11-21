'use strict';
/* Nada Atma — application de réservation (SPA sans dépendance) */

const state = { user: null, settings: {}, filter: '' };
const $view = document.getElementById('view');

// ---------- Utilitaires ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, 12); };
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
const today = () => iso(new Date());
const mondayOf = (s) => { const d = parse(s); const wd = (d.getDay() + 6) % 7; return addDays(s, -wd); };
const DAYS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
const fmt = (s, o) => parse(s).toLocaleDateString('fr-FR', o);
const fmtLong = (s) => fmt(s, { weekday: 'long', day: 'numeric', month: 'long' });
const fmtFull = (s) => fmt(s, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const fmtShort = (s) => fmt(s, { day: 'numeric', month: 'short' });
const endTime = (t, min) => { const [h, m] = t.split(':').map(Number); const x = h * 60 + m + min; return `${pad(Math.floor(x / 60) % 24)}:${pad(x % 60)}`; };
const isAdmin = () => state.user && state.user.role === 'admin';
const plural = (n, w) => `${n} ${w}${n > 1 ? 's' : ''}`;

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body !== undefined || method !== 'GET' ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : method !== 'GET' ? '{}' : undefined,
    credentials: 'same-origin',
  });
  let data = {};
  try { data = await res.json(); } catch { /* vide */ }
  if (!res.ok) {
    if (res.status === 401 && state.user) { state.user = null; renderNav(); }
    throw new Error(data.error || `Erreur ${res.status}`);
  }
  return data;
}

let toastTimer;
function toast(msg, isError = false) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show' + (isError ? ' error' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.className = 'toast'; }, 3200);
}

function modal(html, onMount) {
  const root = document.getElementById('modal-root');
  root.innerHTML = `<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true">${html}</div></div>`;
  const backdrop = root.firstChild;
  const close = () => { root.innerHTML = ''; document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop || e.target.closest('[data-close]')) close(); });
  if (onMount) onMount(backdrop.querySelector('.modal'), close);
  return close;
}

function confirmBox(message, okLabel = 'Confirmer', danger = false) {
  return new Promise((resolve) => {
    let answered = false;
    const close = modal(`
      <div class="modal-head"><h2>Confirmation</h2></div>
      <p>${message}</p>
      <div class="btn-row" style="justify-content:flex-end">
        <button class="btn ghost" data-close>Retour</button>
        <button class="btn ${danger ? 'danger' : ''}" id="ok">${esc(okLabel)}</button>
      </div>`, (m) => {
      m.querySelector('#ok').onclick = () => { answered = true; close(); resolve(true); };
    });
    const root = document.getElementById('modal-root');
    const obs = new MutationObserver(() => { if (!root.innerHTML) { obs.disconnect(); if (!answered) resolve(false); } });
    obs.observe(root, { childList: true });
  });
}

function formData(form) {
  const o = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') o[el.name] = el.checked;
    else if (el.type === 'number') o[el.name] = el.value === '' ? '' : Number(el.value);
    else o[el.name] = el.value;
  }
  return o;
}

const loading = () => { $view.innerHTML = '<div class="spinner"></div>'; };

// ---------- Icônes ----------
const ICON = {
  cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  mine: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 11l3 3 8-8"/><path d="M20 12v6a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3h9"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>',
  admin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  login: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M15 3h3a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3h-3M10 17l5-5-5-5M15 12H3"/></svg>',
};

// ---------- Navigation ----------
function navItems() {
  const items = [{ href: '#/planning', label: 'Planning', icon: ICON.cal }];
  if (state.user) {
    items.push({ href: '#/mes-reservations', label: 'Mes séances', icon: ICON.mine });
    if (isAdmin()) items.push({ href: '#/admin', label: 'Gestion', icon: ICON.admin });
    items.push({ href: '#/profil', label: 'Profil', icon: ICON.user });
  } else {
    items.push({ href: '#/connexion', label: 'Connexion', icon: ICON.login });
  }
  return items;
}

function renderNav() {
  const cur = location.hash.split('?')[0] || '#/planning';
  const active = (h) => cur === h || (h !== '#/planning' && cur.startsWith(h));
  const items = navItems();
  document.getElementById('topnav').innerHTML = items.map((i) => `<a href="${i.href}" class="${active(i.href) ? 'active' : ''}">${i.label}</a>`).join('');
  document.getElementById('tabbar').innerHTML = items.map((i) => `<a href="${i.href}" class="${active(i.href) ? 'active' : ''}">${i.icon}<span>${i.label}</span></a>`).join('');
}

function hashParams() {
  const q = location.hash.split('?')[1] || '';
  return Object.fromEntries(new URLSearchParams(q));
}
function setHashParams(base, params) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== '')).toString();
  const h = base + (qs ? '?' + qs : '');
  if (location.hash !== h) history.replaceState(null, '', h);
}

const ROUTES = {
  '#/planning': viewPlanning,
  '#/connexion': viewLogin,
  '#/inscription': viewRegister,
  '#/mes-reservations': viewMyBookings,
  '#/profil': viewProfile,
  '#/admin': viewAdminSessions,
  '#/admin/annee': viewAdminYear,
  '#/admin/cours': viewAdminTemplates,
  '#/admin/fermetures': viewAdminClosures,
  '#/admin/membres': viewAdminUsers,
  '#/admin/reglages': viewAdminSettings,
};

async function router() {
  const path = location.hash.split('?')[0] || '#/planning';
  renderNav();
  document.getElementById('modal-root').innerHTML = '';
  const needUser = ['#/mes-reservations', '#/profil'].includes(path) || path.startsWith('#/admin');
  if (needUser && !state.user) { location.hash = '#/connexion'; return; }
  if (path.startsWith('#/admin') && !isAdmin()) { location.hash = '#/planning'; return; }
  const fn = ROUTES[path] || viewPlanning;
  try { await fn(); } catch (e) { $view.innerHTML = `<div class="card error">${esc(e.message)}</div>`; }
  window.scrollTo(0, 0);
}

// ---------- Composants séance ----------
function spotsHtml(s) {
  const pct = Math.min(100, Math.round((s.booked_count / s.capacity) * 100));
  return `<span class="spots"><span class="spots-bar"><i style="width:${pct}%"></i></span>${s.spots_left > 0 ? plural(s.spots_left, 'place') : 'Complet'}</span>`;
}

function sessionCard(s, { admin = false } = {}) {
  const meta = [
    `${s.duration_min} min`,
    s.location && `📍 ${esc(s.location)}`,
    admin ? `👥 ${s.booked_count}/${s.capacity}` : (!s.cancelled && !s.is_past ? spotsHtml(s) : ''),
  ].filter(Boolean).map((m) => `<span>${m}</span>`).join('');

  let action = '';
  if (admin) {
    action = s.cancelled ? '<span class="badge danger">Annulée</span>'
      : s.booked_count >= s.capacity ? '<span class="badge plum">Complet</span>' : '';
  } else if (s.cancelled) {
    action = `<span class="badge danger">Annulée</span>${s.my_booking_id ? '<div class="small muted">Vous étiez inscrit·e</div>' : ''}`;
  } else if (s.my_booking_id) {
    action = `<span class="badge ok">✓ Inscrit·e</span>${s.is_past ? '' : `<button class="btn ghost small" data-manage="${s.my_booking_id}">Gérer</button>`}`;
  } else if (s.is_past) {
    action = '<span class="badge">Passée</span>';
  } else if (s.spots_left <= 0) {
    action = '<span class="badge plum">Complet</span>';
  } else {
    action = `<button class="btn small" data-book="${s.id}">Réserver</button>`;
  }

  const cls = ['session', s.cancelled && 'cancelled', s.my_booking_id && !admin && 'mine', admin && 'clickable'].filter(Boolean).join(' ');
  return `<div class="${cls}" style="--c:${esc(s.color)}" ${admin ? `data-session="${s.id}"` : ''}>
    <div class="s-time">${s.start_time.replace(':', 'h')}<small>${endTime(s.start_time, s.duration_min).replace(':', 'h')}</small></div>
    <div class="s-body">
      <div class="s-title">${esc(s.title)}</div>
      <div class="s-meta">${meta}</div>
      ${s.cancelled && s.cancel_reason ? `<div class="small muted">${esc(s.cancel_reason)}</div>` : ''}
      ${s.description && !admin ? `<div class="small muted">${esc(s.description)}</div>` : ''}
    </div>
    <div class="s-action">${action}</div>
  </div>`;
}

function weekHtml(from, data, { admin = false } = {}) {
  const byDay = {};
  for (const s of data.sessions) {
    if (state.filter && s.title !== state.filter) continue;
    (byDay[s.date] ||= []).push(s);
  }
  let html = '';
  for (let i = 0; i < 7; i++) {
    const d = addDays(from, i);
    const closure = data.closures.find((c) => c.start_date <= d && c.end_date >= d);
    // côté élèves, les séances annulées par une fermeture sont remplacées par le bandeau
    const list = (byDay[d] || []).filter((s) => admin || !(s.cancelled && s.closure_id && !s.my_booking_id));
    if (!list.length && !closure && !admin && (i >= 5)) continue; // masque le week-end vide
    html += `<section class="day"><h3 class="day-title ${d === today() ? 'today' : ''}">${fmtLong(d)}</h3>`;
    if (closure) html += `<div class="closure-banner">🌿 ${esc(closure.label)} — pas de cours</div>`;
    if (list.length) html += list.map((s) => sessionCard(s, { admin })).join('');
    else if (!closure) html += '<div class="day-empty">Pas de séance</div>';
    html += '</section>';
  }
  return html;
}

function filtersHtml(sessions) {
  const titles = [...new Set(sessions.map((s) => s.title))].sort();
  if (titles.length < 2) return '';
  return `<div class="filters">
    <button class="chip ${!state.filter ? 'active' : ''}" data-filter="">Tous les cours</button>
    ${titles.map((t) => `<button class="chip ${state.filter === t ? 'active' : ''}" data-filter="${esc(t)}">${esc(t)}</button>`).join('')}
  </div>`;
}

// ---------- Réservation / déplacement ----------
async function book(sessionId, after) {
  if (!state.user) { toast('Connectez-vous pour réserver'); location.hash = '#/connexion'; return; }
  try {
    const r = await api(`/api/sessions/${sessionId}/book`, { method: 'POST' });
    toast(`Réservé : ${r.session.title}, ${fmtLong(r.session.date)} à ${r.session.start_time.replace(':', 'h')} ✨`);
    after && after();
  } catch (e) { toast(e.message, true); }
}

function deadlineInfo(s) {
  const h = state.settings.cancel_deadline_hours || 0;
  const [y, m, d] = s.date.split('-').map(Number);
  const [hh, mm] = s.start_time.split(':').map(Number);
  const start = new Date(y, m - 1, d, hh, mm);
  return { locked: !s.cancelled && !isAdmin() && start - new Date() < h * 3600000, hours: h };
}

async function manageBooking(bookingId, s, after) {
  const { locked, hours } = deadlineInfo(s);
  modal(`
    <div class="modal-head"><h2>${esc(s.title)}</h2><button class="icon-btn" data-close aria-label="Fermer">✕</button></div>
    <p><strong>${fmtFull(s.date)}</strong><br>${s.start_time.replace(':', 'h')} – ${endTime(s.start_time, s.duration_min).replace(':', 'h')}${s.location ? ` · ${esc(s.location)}` : ''}</p>
    ${s.cancelled ? `<p class="badge danger">Séance annulée${s.cancel_reason ? ` : ${esc(s.cancel_reason)}` : ''}</p><p class="small">Vous pouvez déplacer votre réservation vers une autre séance.</p>` : ''}
    ${locked ? `<p class="badge warn">Modification impossible moins de ${hours} h avant la séance</p><p class="small muted">Contactez directement votre professeure si besoin.</p>` : ''}
    <div class="btn-row" style="margin-top:14px">
      <button class="btn" id="move" ${locked ? 'disabled' : ''}>↔ Déplacer</button>
      <button class="btn danger" id="cancel" ${locked ? 'disabled' : ''}>Annuler ma place</button>
    </div>`, (m, close) => {
    m.querySelector('#move').onclick = () => { close(); moveBooking(bookingId, s, after); };
    m.querySelector('#cancel').onclick = async () => {
      close();
      if (!(await confirmBox(`Annuler votre place pour <strong>${esc(s.title)}</strong> du ${fmtLong(s.date)} ?`, 'Oui, annuler', true))) return;
      try { await api(`/api/bookings/${bookingId}/cancel`, { method: 'POST' }); toast('Réservation annulée'); after && after(); }
      catch (e) { toast(e.message, true); }
    };
  });
}

async function moveBooking(bookingId, from, after) {
  let horizon = 28;
  const close = modal(`
    <div class="modal-head"><h2>Déplacer ma séance</h2><button class="icon-btn" data-close aria-label="Fermer">✕</button></div>
    <p class="small muted">Actuellement : ${esc(from.title)} — ${fmtLong(from.date)} à ${from.start_time.replace(':', 'h')}</p>
    <div class="filters"><button class="chip active" data-same="1">Même cours</button><button class="chip" data-same="0">Tous les cours</button></div>
    <div id="alts"><div class="spinner"></div></div>`, (m) => {
    let same = true;
    const load = async () => {
      const alts = m.querySelector('#alts');
      alts.innerHTML = '<div class="spinner"></div>';
      try {
        const data = await api(`/api/sessions?from=${today()}&to=${addDays(today(), horizon)}`);
        const list = data.sessions.filter((s) => !s.cancelled && !s.is_past && s.spots_left > 0 && !s.my_booking_id && s.id !== from.id && (!same || s.title === from.title));
        if (!list.length) {
          alts.innerHTML = `<div class="empty">Aucune autre séance disponible sur les ${horizon} prochains jours.</div>`;
        } else {
          let last = '';
          alts.innerHTML = list.map((s) => {
            const head = s.date !== last ? `<h3 class="day-title">${fmtLong(s.date)}</h3>` : '';
            last = s.date;
            return `${head}<div class="session" style="--c:${esc(s.color)}">
              <div class="s-time">${s.start_time.replace(':', 'h')}</div>
              <div class="s-body"><div class="s-title">${esc(s.title)}</div><div class="s-meta">${spotsHtml(s)}</div></div>
              <div class="s-action"><button class="btn small" data-target="${s.id}">Choisir</button></div></div>`;
          }).join('');
        }
        if (horizon < 180) alts.insertAdjacentHTML('beforeend', '<div class="center"><button class="btn ghost" id="more">Voir plus loin</button></div>');
      } catch (e) { alts.innerHTML = `<p class="error">${esc(e.message)}</p>`; }
    };
    m.addEventListener('click', async (e) => {
      const chip = e.target.closest('[data-same]');
      if (chip) { same = chip.dataset.same === '1'; m.querySelectorAll('[data-same]').forEach((c) => c.classList.toggle('active', c === chip)); load(); }
      if (e.target.id === 'more') { horizon += 42; load(); }
      const t = e.target.closest('[data-target]');
      if (t) {
        t.disabled = true;
        try {
          const r = await api(`/api/bookings/${bookingId}/move`, { method: 'POST', body: { target_session_id: Number(t.dataset.target) } });
          close();
          toast(`Déplacé vers ${fmtLong(r.session.date)} à ${r.session.start_time.replace(':', 'h')} ✨`);
          after && after();
        } catch (err) { t.disabled = false; toast(err.message, true); }
      }
    });
    load();
  });
  return close;
}

// ---------- Vues membres ----------
async function viewPlanning() {
  const p = hashParams();
  let from = mondayOf(p.semaine || today());
  loading();
  let data = await api(`/api/sessions?from=${from}&to=${addDays(from, 6)}`);
  // Vue par défaut : si plus aucune séance à venir cette semaine (ex. le week-end), afficher la suivante
  if (!p.semaine && !data.sessions.some((s) => !s.is_past)) {
    from = addDays(from, 7);
    data = await api(`/api/sessions?from=${from}&to=${addDays(from, 6)}`);
  }
  setHashParams('#/planning', { semaine: p.semaine ? from : '' });
  const to = addDays(from, 6);
  $view.innerHTML = `
    ${!state.user ? `<div class="hero"><p class="script">Nada Atma</p><p class="tag">En harmonies…</p>
      <p class="muted">Consultez le planning et <a href="#/inscription">créez votre compte</a> pour réserver vos séances.</p></div>` : ''}
    <div class="week-head">
      <button class="icon-btn" id="prev" aria-label="Semaine précédente">‹</button>
      <h1>${fmt(from, { day: 'numeric', month: 'short' })} – ${fmt(to, { day: 'numeric', month: 'short', year: 'numeric' })}</h1>
      <button class="icon-btn" id="next" aria-label="Semaine suivante">›</button>
      <button class="btn secondary small" id="now">Aujourd'hui</button>
      <input type="date" id="jump" value="${from}" style="width:auto" aria-label="Aller à la date">
    </div>
    ${filtersHtml(data.sessions)}
    ${weekHtml(from, data)}
    ${!data.sessions.length && !data.closures.length ? '<div class="empty"><div class="big">🪷</div>Aucune séance cette semaine.</div>' : ''}
  `;
  const go = (d) => { location.hash = `#/planning?semaine=${mondayOf(d)}`; };
  $view.querySelector('#prev').onclick = () => go(addDays(from, -7));
  $view.querySelector('#next').onclick = () => go(addDays(from, 7));
  $view.querySelector('#now').onclick = () => go(today());
  $view.querySelector('#jump').onchange = (e) => e.target.value && go(e.target.value);
  $view.onclick = (e) => {
    const f = e.target.closest('[data-filter]');
    if (f) { state.filter = f.dataset.filter; viewPlanning(); return; }
    const b = e.target.closest('[data-book]');
    if (b) { b.disabled = true; book(b.dataset.book, viewPlanning); return; }
    const g = e.target.closest('[data-manage]');
    if (g) {
      const s = data.sessions.find((x) => String(x.my_booking_id) === g.dataset.manage);
      manageBooking(g.dataset.manage, s, viewPlanning);
    }
  };
}

async function viewMyBookings() {
  loading();
  const { bookings } = await api('/api/my/bookings');
  const upcoming = bookings.filter((b) => !b.is_past);
  const past = bookings.filter((b) => b.is_past).reverse();
  const h = state.settings.cancel_deadline_hours;
  const row = (b, withActions) => `
    <div class="session ${b.cancelled ? 'cancelled' : ''}" style="--c:${esc(b.color)}">
      <div class="s-time">${fmt(b.date, { day: 'numeric' })}<small>${fmt(b.date, { month: 'short' })}</small></div>
      <div class="s-body">
        <div class="s-title">${esc(b.title)}</div>
        <div class="s-meta"><span style="text-transform:capitalize">${fmt(b.date, { weekday: 'long' })}</span><span>${b.start_time.replace(':', 'h')} – ${endTime(b.start_time, b.duration_min).replace(':', 'h')}</span>${b.location ? `<span>📍 ${esc(b.location)}</span>` : ''}</div>
        ${b.cancelled ? `<div class="small" style="color:var(--danger)">Séance annulée${b.cancel_reason ? ` : ${esc(b.cancel_reason)}` : ''} — déplacez votre réservation</div>` : ''}
      </div>
      ${withActions ? `<div class="s-action"><button class="btn small ${b.cancelled ? '' : 'secondary'}" data-manage="${b.booking_id}">${b.cancelled ? 'Déplacer' : 'Gérer'}</button></div>` : ''}
    </div>`;
  $view.innerHTML = `
    <h1>Mes séances</h1>
    <p class="muted small">Vous pouvez déplacer ou annuler une séance jusqu'à ${h} h avant son début.</p>
    ${upcoming.length ? upcoming.map((b) => row(b, true)).join('') : `<div class="empty"><div class="big">🧘</div>Aucune séance réservée.<br><br><a class="btn" href="#/planning">Voir le planning</a></div>`}
    ${past.length ? `<h2 style="margin-top:28px">Historique</h2>${past.slice(0, 30).map((b) => row(b, false)).join('')}` : ''}
  `;
  $view.onclick = (e) => {
    const g = e.target.closest('[data-manage]');
    if (!g) return;
    const b = bookings.find((x) => String(x.booking_id) === g.dataset.manage);
    if (b.cancelled) moveBooking(b.booking_id, b, viewMyBookings);
    else manageBooking(b.booking_id, b, viewMyBookings);
  };
}

function viewLogin() {
  if (state.user) { location.hash = '#/planning'; return; }
  $view.innerHTML = `
    <div class="auth">
      <div class="hero"><p class="script">Nada Atma</p><p class="tag">En harmonies…</p></div>
      <form class="card" id="f">
        <h2>Connexion</h2>
        <div class="field"><label for="email">E-mail</label><input id="email" name="email" type="email" autocomplete="email" required></div>
        <div class="field"><label for="password">Mot de passe</label><input id="password" name="password" type="password" autocomplete="current-password" required></div>
        <div class="error" id="err"></div>
        <button class="btn block">Se connecter</button>
        <p class="center small" style="margin-top:14px">Pas encore de compte ? <a href="#/inscription">Créer un compte</a></p>
      </form>
    </div>`;
  const f = $view.querySelector('#f');
  f.onsubmit = async (e) => {
    e.preventDefault();
    try {
      const r = await api('/api/login', { method: 'POST', body: formData(f) });
      state.user = r.user;
      await refreshMe();
      location.hash = '#/planning';
    } catch (err) { f.querySelector('#err').textContent = err.message; }
  };
}

function viewRegister() {
  if (state.user) { location.hash = '#/planning'; return; }
  $view.innerHTML = `
    <div class="auth">
      <div class="hero"><p class="script">Nada Atma</p><p class="tag">En harmonies…</p></div>
      <form class="card" id="f">
        <h2>Créer mon compte</h2>
        <div class="field"><label for="name">Prénom et nom</label><input id="name" name="name" autocomplete="name" required></div>
        <div class="field"><label for="email">E-mail</label><input id="email" name="email" type="email" autocomplete="email" required></div>
        <div class="field"><label for="phone">Téléphone <span class="muted">(facultatif)</span></label><input id="phone" name="phone" type="tel" autocomplete="tel"></div>
        <div class="field"><label for="password">Mot de passe <span class="muted">(8 caractères min.)</span></label><input id="password" name="password" type="password" minlength="8" autocomplete="new-password" required></div>
        <div class="error" id="err"></div>
        <button class="btn block">Créer mon compte</button>
        <p class="center small" style="margin-top:14px">Déjà inscrit·e ? <a href="#/connexion">Se connecter</a></p>
      </form>
    </div>`;
  const f = $view.querySelector('#f');
  f.onsubmit = async (e) => {
    e.preventDefault();
    try {
      const r = await api('/api/register', { method: 'POST', body: formData(f) });
      state.user = r.user;
      await refreshMe();
      toast(r.user.role === 'admin' ? 'Compte administrateur créé 🙏' : 'Bienvenue ! Vous pouvez réserver vos séances 🙏');
      location.hash = r.user.role === 'admin' ? '#/admin/cours' : '#/planning';
    } catch (err) { f.querySelector('#err').textContent = err.message; }
  };
}

function viewProfile() {
  const u = state.user;
  $view.innerHTML = `
    <h1>Mon profil</h1>
    <form class="card" id="f">
      <div class="field"><label>E-mail</label><input value="${esc(u.email)}" disabled></div>
      <div class="grid2">
        <div class="field"><label for="name">Nom</label><input id="name" name="name" value="${esc(u.name)}" required></div>
        <div class="field"><label for="phone">Téléphone</label><input id="phone" name="phone" type="tel" value="${esc(u.phone)}"></div>
      </div>
      <h3>Changer de mot de passe</h3>
      <div class="grid2">
        <div class="field"><label for="cp">Mot de passe actuel</label><input id="cp" name="current_password" type="password" autocomplete="current-password"></div>
        <div class="field"><label for="np">Nouveau mot de passe</label><input id="np" name="new_password" type="password" minlength="8" autocomplete="new-password"></div>
      </div>
      <div class="error" id="err"></div>
      <button class="btn">Enregistrer</button>
    </form>
    <button class="btn danger" id="logout">Se déconnecter</button>
    <div class="install-tip">📱 <strong>Installer l'application</strong> : sur iPhone, ouvrez ce site dans Safari, touchez « Partager » puis « Sur l'écran d'accueil ». Sur Android, menu ⋮ puis « Installer l'application ».</div>`;
  const f = $view.querySelector('#f');
  f.onsubmit = async (e) => {
    e.preventDefault();
    try {
      const body = formData(f);
      if (!body.new_password) { delete body.new_password; delete body.current_password; }
      const r = await api('/api/me', { method: 'PUT', body });
      state.user = r.user; f.querySelector('#cp').value = ''; f.querySelector('#np').value = '';
      f.querySelector('#err').textContent = '';
      toast('Profil mis à jour');
    } catch (err) { f.querySelector('#err').textContent = err.message; }
  };
  $view.querySelector('#logout').onclick = async () => {
    await api('/api/logout', { method: 'POST' });
    state.user = null; location.hash = '#/planning';
  };
}

// ---------- Administration ----------
function adminNav(active) {
  const tabs = [
    ['#/admin', 'Semaine'], ['#/admin/annee', 'Année'], ['#/admin/cours', 'Cours réguliers'],
    ['#/admin/fermetures', 'Vacances'], ['#/admin/membres', 'Membres'], ['#/admin/reglages', 'Réglages'],
  ];
  return `<div class="subnav">${tabs.map(([h, l]) => `<a href="${h}" class="chip ${h === active ? 'active' : ''}">${l}</a>`).join('')}</div>`;
}

async function viewAdminSessions() {
  const p = hashParams();
  const from = mondayOf(p.semaine || today());
  setHashParams('#/admin', { semaine: from === mondayOf(today()) ? '' : from });
  loading();
  const data = await api(`/api/sessions?from=${from}&to=${addDays(from, 6)}`);
  const total = data.sessions.filter((s) => !s.cancelled).reduce((a, s) => a + s.booked_count, 0);
  $view.innerHTML = `
    ${adminNav('#/admin')}
    <div class="week-head">
      <button class="icon-btn" id="prev" aria-label="Semaine précédente">‹</button>
      <h1>${fmt(from, { day: 'numeric', month: 'short' })} – ${fmt(addDays(from, 6), { day: 'numeric', month: 'short', year: 'numeric' })}</h1>
      <button class="icon-btn" id="next" aria-label="Semaine suivante">›</button>
      <button class="btn secondary small" id="now">Aujourd'hui</button>
      <button class="btn small" id="add">+ Séance ponctuelle</button>
    </div>
    <p class="muted small">${plural(data.sessions.filter((s) => !s.cancelled).length, 'séance')} · ${plural(total, 'inscription')} cette semaine. Touchez une séance pour voir les inscrit·es.</p>
    ${weekHtml(from, data, { admin: true })}`;
  const go = (d) => { location.hash = `#/admin?semaine=${mondayOf(d)}`; };
  $view.querySelector('#prev').onclick = () => go(addDays(from, -7));
  $view.querySelector('#next').onclick = () => go(addDays(from, 7));
  $view.querySelector('#now').onclick = () => go(today());
  $view.querySelector('#add').onclick = () => editSessionModal(null, viewAdminSessions, from);
  $view.onclick = (e) => {
    const s = e.target.closest('[data-session]');
    if (s) sessionDetailModal(Number(s.dataset.session), viewAdminSessions);
  };
}

async function sessionDetailModal(id, after) {
  const [{ session: s, attendees }, { users }] = await Promise.all([api(`/api/admin/sessions/${id}`), api('/api/admin/users')]);
  const others = users.filter((u) => u.active && !attendees.some((a) => a.id === u.id));
  modal(`
    <div class="modal-head"><h2>${esc(s.title)}</h2><button class="icon-btn" data-close aria-label="Fermer">✕</button></div>
    <p><strong style="text-transform:capitalize">${fmtFull(s.date)}</strong><br>
      ${s.start_time.replace(':', 'h')} – ${endTime(s.start_time, s.duration_min).replace(':', 'h')}${s.location ? ` · ${esc(s.location)}` : ''}<br>
      ${s.cancelled ? `<span class="badge danger">Annulée${s.cancel_reason ? ` : ${esc(s.cancel_reason)}` : ''}</span>` : `<span class="badge plum">${s.booked_count} / ${s.capacity} inscrit·es</span>`}</p>
    <h3>Participant·es</h3>
    ${attendees.length ? attendees.map((a) => `
      <div class="list-item"><div class="grow"><strong>${esc(a.name)}</strong><div class="small muted">${esc(a.email)}${a.phone ? ` · <a href="tel:${esc(a.phone)}">${esc(a.phone)}</a>` : ''}</div></div>
      <button class="btn ghost small" data-unbook="${a.booking_id}">Retirer</button></div>`).join('') : '<p class="muted small">Personne pour le moment.</p>'}
    ${!s.cancelled && !s.is_past && s.spots_left > 0 && others.length ? `
      <div class="btn-row" style="margin:10px 0 18px">
        <select id="adduser" style="flex:1"><option value="">Inscrire un membre…</option>${others.map((u) => `<option value="${u.id}">${esc(u.name)}</option>`).join('')}</select>
        <button class="btn small" id="addbtn">Inscrire</button>
      </div>` : ''}
    ${attendees.length ? `<p class="small"><a href="mailto:?bcc=${encodeURIComponent(attendees.map((a) => a.email).join(','))}&subject=${encodeURIComponent(`${s.title} — ${fmtLong(s.date)}`)}">✉ Écrire à tous les inscrit·es</a></p>` : ''}
    <div class="btn-row" style="margin-top:16px">
      <button class="btn secondary small" id="edit">Modifier</button>
      ${s.cancelled ? '<button class="btn ok small" id="restore">Rétablir la séance</button>' : '<button class="btn danger small" id="cancel">Annuler la séance</button>'}
      ${!attendees.length ? '<button class="btn ghost small" id="del">Supprimer</button>' : ''}
    </div>`, (m, close) => {
    const reopen = () => { after && after(); sessionDetailModal(id, after); };
    m.addEventListener('click', async (e) => {
      const u = e.target.closest('[data-unbook]');
      if (u) {
        try { await api(`/api/bookings/${u.dataset.unbook}/cancel`, { method: 'POST' }); toast('Participant·e retiré·e'); reopen(); }
        catch (err) { toast(err.message, true); }
      }
    });
    const addbtn = m.querySelector('#addbtn');
    if (addbtn) addbtn.onclick = async () => {
      const uid = m.querySelector('#adduser').value;
      if (!uid) return;
      try { await api(`/api/admin/sessions/${id}/attendees`, { method: 'POST', body: { user_id: Number(uid) } }); toast('Inscription ajoutée'); reopen(); }
      catch (err) { toast(err.message, true); }
    };
    m.querySelector('#edit').onclick = () => { close(); editSessionModal(s, after); };
    const cancel = m.querySelector('#cancel');
    if (cancel) cancel.onclick = async () => {
      const reason = prompt(`Annuler cette séance ?${attendees.length ? `\n${plural(attendees.length, 'personne')} inscrite(s) seront informée(s) dans l'application.` : ''}\n\nMotif (facultatif) :`, '');
      if (reason === null) return;
      try { await api(`/api/admin/sessions/${id}`, { method: 'PUT', body: { cancelled: true, cancel_reason: reason || 'Séance annulée' } }); toast('Séance annulée'); reopen(); }
      catch (err) { toast(err.message, true); }
    };
    const restore = m.querySelector('#restore');
    if (restore) restore.onclick = async () => {
      try { await api(`/api/admin/sessions/${id}`, { method: 'PUT', body: { cancelled: false } }); toast('Séance rétablie'); reopen(); }
      catch (err) { toast(err.message, true); }
    };
    const del = m.querySelector('#del');
    if (del) del.onclick = async () => {
      try { await api(`/api/admin/sessions/${id}`, { method: 'DELETE' }); close(); toast('Séance supprimée'); after && after(); }
      catch (err) { toast(err.message, true); }
    };
  });
}

function editSessionModal(s, after, defaultDate) {
  const v = s || { title: '', description: '', date: defaultDate && defaultDate > today() ? defaultDate : today(), start_time: '18:30', duration_min: 75, capacity: 12, location: '', color: '#8e3b6b' };
  modal(`
    <div class="modal-head"><h2>${s ? 'Modifier la séance' : 'Séance ponctuelle'}</h2><button class="icon-btn" data-close aria-label="Fermer">✕</button></div>
    ${!s ? '<p class="small muted">Atelier, stage, cours exceptionnel… Pour un cours qui revient chaque semaine, utilisez « Cours réguliers ».</p>' : ''}
    <form id="f">
      <div class="field"><label>Titre</label><input name="title" value="${esc(v.title)}" required></div>
      <div class="grid3">
        <div class="field"><label>Date</label><input name="date" type="date" value="${v.date}" required></div>
        <div class="field"><label>Heure</label><input name="start_time" type="time" value="${v.start_time}" required></div>
        <div class="field"><label>Durée (min)</label><input name="duration_min" type="number" min="5" value="${v.duration_min}" required></div>
        <div class="field"><label>Places</label><input name="capacity" type="number" min="1" value="${v.capacity}" required></div>
        <div class="field" style="grid-column:span 2"><label>Lieu</label><input name="location" value="${esc(v.location)}"></div>
      </div>
      <div class="field"><label>Description</label><textarea name="description" rows="2">${esc(v.description)}</textarea></div>
      ${!s ? `<div class="field"><label>Couleur</label><input name="color" type="color" value="${v.color}"></div>` : ''}
      <div class="error" id="err"></div>
      <button class="btn block">${s ? 'Enregistrer' : 'Créer la séance'}</button>
    </form>`, (m, close) => {
    const f = m.querySelector('#f');
    f.onsubmit = async (e) => {
      e.preventDefault();
      try {
        if (s) await api(`/api/admin/sessions/${s.id}`, { method: 'PUT', body: formData(f) });
        else await api('/api/admin/sessions', { method: 'POST', body: formData(f) });
        close(); toast('Séance enregistrée'); after && after();
      } catch (err) { f.querySelector('#err').textContent = err.message; }
    };
  });
}

// Vue annuelle (année scolaire de septembre à août)
async function viewAdminYear() {
  const p = hashParams();
  const now = new Date();
  const startYear = Number(p.annee) || (now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1);
  setHashParams('#/admin/annee', { annee: startYear });
  loading();
  const from = `${startYear}-09-01`, to = `${startYear + 1}-08-31`;
  const data = await api(`/api/sessions?from=${from}&to=${to}`);
  const byDay = {};
  for (const s of data.sessions) if (!s.cancelled) (byDay[s.date] ||= []).push(s);
  const closedDay = (d) => data.closures.find((c) => c.start_date <= d && c.end_date >= d);
  const active = data.sessions.filter((s) => !s.cancelled);
  let months = '';
  for (let i = 0; i < 12; i++) {
    const first = new Date(startYear, 8 + i, 1, 12);
    const y = first.getFullYear(), mo = first.getMonth();
    const days = new Date(y, mo + 1, 0).getDate();
    const offset = (first.getDay() + 6) % 7;
    let cells = ['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((d) => `<div class="dow">${d}</div>`).join('');
    cells += '<div></div>'.repeat(offset);
    for (let d = 1; d <= days; d++) {
      const ds = `${y}-${pad(mo + 1)}-${pad(d)}`;
      const list = byDay[ds] || [];
      const c = closedDay(ds);
      const full = list.length && list.every((s) => s.booked_count >= s.capacity);
      const cls = ['d', list.length && 'has', full && 'full', !list.length && c && 'closed', ds === today() && 'today'].filter(Boolean).join(' ');
      const tip = c ? c.label : list.map((s) => `${s.start_time} ${s.title} (${s.booked_count}/${s.capacity})`).join('\n');
      cells += `<div class="${cls}" data-day="${ds}" title="${esc(tip)}">${d}</div>`;
    }
    months += `<div class="month"><h3>${first.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}</h3><div class="month-grid">${cells}</div></div>`;
  }
  $view.innerHTML = `
    ${adminNav('#/admin/annee')}
    <div class="week-head">
      <button class="icon-btn" id="prev" aria-label="Année précédente">‹</button>
      <h1>Saison ${startYear}–${startYear + 1}</h1>
      <button class="icon-btn" id="next" aria-label="Année suivante">›</button>
    </div>
    <p class="muted small">${plural(active.length, 'séance')} programmée${active.length > 1 ? 's' : ''} · ${plural(active.reduce((a, s) => a + s.booked_count, 0), 'réservation')} · ${plural(data.closures.length, 'période')} de fermeture</p>
    <div class="legend"><span class="l-has">Cours</span><span class="l-full">Complet</span><span class="l-closed">Vacances / fermeture</span></div>
    <div class="year-grid">${months}</div>`;
  $view.querySelector('#prev').onclick = () => { location.hash = `#/admin/annee?annee=${startYear - 1}`; };
  $view.querySelector('#next').onclick = () => { location.hash = `#/admin/annee?annee=${startYear + 1}`; };
  $view.onclick = (e) => {
    const d = e.target.closest('[data-day]');
    if (d) location.hash = `#/admin?semaine=${mondayOf(d.dataset.day)}`;
  };
}

function seasonDefaults() {
  const now = new Date();
  const y = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  const start = `${y}-09-01` > today() ? `${y}-09-01` : today();
  return { start, end: `${y + 1}-07-04` };
}

async function viewAdminTemplates() {
  loading();
  const { templates } = await api('/api/admin/templates');
  $view.innerHTML = `
    ${adminNav('#/admin/cours')}
    <div class="section-title"><h1 style="margin:0">Cours réguliers</h1><button class="btn" id="add">+ Nouveau cours</button></div>
    <p class="muted small">Un cours régulier crée automatiquement une séance chaque semaine sur la période choisie, en sautant les vacances et jours fériés.</p>
    ${templates.length ? `<div class="card">${templates.map((t) => `
      <div class="list-item">
        <span class="dot" style="background:${esc(t.color)}"></span>
        <div class="grow">
          <strong>${esc(t.title)}</strong> ${t.active ? '' : '<span class="badge">Inactif</span>'}
          <div class="small muted">${DAYS[t.weekday]} ${t.start_time.replace(':', 'h')} · ${t.duration_min} min · ${t.capacity} places${t.location ? ` · ${esc(t.location)}` : ''}</div>
          <div class="small muted">Du ${fmtShort(t.start_date)} ${t.start_date.slice(0, 4)} au ${fmtShort(t.end_date)} ${t.end_date.slice(0, 4)} · ${plural(t.upcoming_sessions, 'séance')} à venir</div>
        </div>
        <button class="btn secondary small" data-edit="${t.id}">Modifier</button>
      </div>`).join('')}</div>` : `<div class="empty card"><div class="big">🪷</div>Aucun cours pour l'instant.<br>Commencez par créer vos cours de la semaine (ex. « Hatha yoga — mardi 18h30 »).</div>`}
    ${templates.length ? `
    <div class="card">
      <h2>Prolonger le planning</h2>
      <p class="small muted">Recrée les séances manquantes sur une période (utile après avoir prolongé la date de fin d'un cours ou supprimé une fermeture). Les séances existantes ne sont pas dupliquées.</p>
      <form id="gen" class="grid3">
        <div class="field"><label>Du</label><input type="date" name="from" value="${today()}" required></div>
        <div class="field"><label>Au</label><input type="date" name="to" value="${addDays(today(), 365)}" required></div>
        <div class="field"><label>&nbsp;</label><button class="btn block">Générer</button></div>
      </form>
    </div>` : ''}`;
  $view.querySelector('#add').onclick = () => templateModal(null, viewAdminTemplates);
  const gen = $view.querySelector('#gen');
  if (gen) gen.onsubmit = async (e) => {
    e.preventDefault();
    try { const r = await api('/api/admin/generate', { method: 'POST', body: formData(gen) }); toast(`${plural(r.created, 'séance')} créée${r.created > 1 ? 's' : ''}`); viewAdminTemplates(); }
    catch (err) { toast(err.message, true); }
  };
  $view.onclick = (e) => {
    const b = e.target.closest('[data-edit]');
    if (b) templateModal(templates.find((t) => String(t.id) === b.dataset.edit), viewAdminTemplates);
  };
}

function templateModal(t, after) {
  const d = seasonDefaults();
  const v = t || { title: '', description: '', weekday: 2, start_time: '18:30', duration_min: 75, capacity: 12, location: '', color: '#8e3b6b', start_date: d.start, end_date: d.end, active: 1 };
  modal(`
    <div class="modal-head"><h2>${t ? 'Modifier le cours' : 'Nouveau cours régulier'}</h2><button class="icon-btn" data-close aria-label="Fermer">✕</button></div>
    <form id="f">
      <div class="field"><label>Nom du cours</label><input name="title" value="${esc(v.title)}" placeholder="Hatha yoga, Yoga doux, Méditation…" required></div>
      <div class="grid3">
        <div class="field"><label>Jour</label><select name="weekday" ${t ? 'disabled' : ''}>${[1, 2, 3, 4, 5, 6, 0].map((i) => `<option value="${i}" ${i === v.weekday ? 'selected' : ''}>${DAYS[i]}</option>`).join('')}</select></div>
        <div class="field"><label>Heure</label><input name="start_time" type="time" value="${v.start_time}" required></div>
        <div class="field"><label>Durée (min)</label><input name="duration_min" type="number" min="5" value="${v.duration_min}" required></div>
        <div class="field"><label>Places</label><input name="capacity" type="number" min="1" value="${v.capacity}" required></div>
        <div class="field" style="grid-column:span 2"><label>Lieu</label><input name="location" value="${esc(v.location)}" placeholder="Salle, adresse…"></div>
      </div>
      <div class="grid2">
        <div class="field"><label>Premier cours à partir du</label><input name="start_date" type="date" value="${v.start_date}" required></div>
        <div class="field"><label>Jusqu'au</label><input name="end_date" type="date" value="${v.end_date}" required></div>
      </div>
      <div class="field"><label>Description <span class="muted">(visible par les élèves)</span></label><textarea name="description" rows="2">${esc(v.description)}</textarea></div>
      <div class="grid2">
        <div class="field"><label>Couleur</label><input name="color" type="color" value="${v.color}"></div>
        ${t ? `<div class="field"><label>&nbsp;</label><label class="check"><input type="checkbox" name="active" ${v.active ? 'checked' : ''}>Cours actif</label></div>` : ''}
      </div>
      ${t ? '<p class="small muted">Les modifications (heure, places, lieu…) s\'appliquent aussi aux séances à venir déjà créées. Pour changer de jour, créez un nouveau cours.</p>' : '<p class="small muted">Les séances sont créées automatiquement sur toute la période, hors vacances et jours fériés.</p>'}
      <div class="error" id="err"></div>
      <div class="btn-row">
        <button class="btn" style="flex:1">${t ? 'Enregistrer' : 'Créer le cours et le planning'}</button>
        ${t ? '<button type="button" class="btn danger" id="del">Supprimer</button>' : ''}
      </div>
    </form>`, (m, close) => {
    const f = m.querySelector('#f');
    f.onsubmit = async (e) => {
      e.preventDefault();
      const body = formData(f);
      body.weekday = Number(body.weekday ?? v.weekday);
      if (t) { body.weekday = v.weekday; if (body.active === undefined) body.active = true; }
      try {
        if (t) {
          const r = await api(`/api/admin/templates/${t.id}`, { method: 'PUT', body });
          // prolonge si la date de fin a été repoussée
          if (body.active && body.end_date > t.end_date) await api('/api/admin/generate', { method: 'POST', body: { from: t.end_date, to: body.end_date, template_id: t.id } });
          toast(`Cours mis à jour (${plural(r.sessions_updated, 'séance')} à venir modifiée${r.sessions_updated > 1 ? 's' : ''})`);
        } else {
          const r = await api('/api/admin/templates', { method: 'POST', body });
          toast(`Cours créé : ${plural(r.generated.created, 'séance')} programmée${r.generated.created > 1 ? 's' : ''}`);
        }
        close(); after && after();
      } catch (err) { f.querySelector('#err').textContent = err.message; }
    };
    const del = m.querySelector('#del');
    if (del) del.onclick = async () => {
      close();
      if (!(await confirmBox(`Supprimer le cours <strong>${esc(t.title)}</strong> ?<br><span class="small muted">Les séances à venir sans inscrit·es seront supprimées, celles avec inscrit·es seront annulées. L'historique est conservé.</span>`, 'Supprimer', true))) return;
      try { await api(`/api/admin/templates/${t.id}?delete_future=1`, { method: 'DELETE' }); toast('Cours supprimé'); after && after(); }
      catch (err) { toast(err.message, true); }
    };
  });
}

async function viewAdminClosures() {
  loading();
  const [{ closures }, { settings }] = await Promise.all([api('/api/admin/closures'), api('/api/admin/settings')]);
  const upcoming = closures.filter((c) => c.end_date >= today());
  const past = closures.filter((c) => c.end_date < today());
  const y = new Date().getMonth() >= 7 ? new Date().getFullYear() : new Date().getFullYear() - 1;
  const row = (c) => `
    <div class="list-item">
      <div class="grow"><strong>${esc(c.label)}</strong>
        <div class="small muted">${c.start_date === c.end_date ? fmtFull(c.start_date) : `Du ${fmtFull(c.start_date)} au ${fmtFull(c.end_date)}`}${c.sessions_cancelled ? ` · ${plural(c.sessions_cancelled, 'séance')} annulée${c.sessions_cancelled > 1 ? 's' : ''}` : ''}</div></div>
      <button class="btn ghost small" data-del="${c.id}">Supprimer</button>
    </div>`;
  $view.innerHTML = `
    ${adminNav('#/admin/fermetures')}
    <h1>Vacances & fermetures</h1>
    <p class="muted small">Aucune séance n'est proposée pendant ces périodes. Ajouter une période annule les séances déjà créées ; la supprimer les rétablit.</p>
    <form class="card" id="f">
      <h2>Ajouter une période</h2>
      <div class="field"><label>Nom</label><input name="label" placeholder="Vacances de Noël, stage, congés…" required></div>
      <div class="grid2">
        <div class="field"><label>Premier jour sans cours</label><input type="date" name="start_date" required></div>
        <div class="field"><label>Dernier jour sans cours</label><input type="date" name="end_date" required></div>
      </div>
      <div class="error" id="err"></div>
      <button class="btn">Ajouter</button>
    </form>
    <div class="card">
      <h2>Vacances scolaires</h2>
      <p class="small muted">Importez le calendrier officiel de l'Éducation nationale.</p>
      <div class="btn-row">
        <select id="zone" style="width:auto"><option value="A">Zone A</option><option value="B">Zone B</option><option value="C">Zone C</option></select>
        <select id="year" style="width:auto">${[y, y + 1].map((x) => `<option>${x}-${x + 1}</option>`).join('')}</select>
        <button class="btn secondary" id="import">Voir les dates</button>
      </div>
      <div id="sh"></div>
      <hr style="border:0;border-top:1px solid var(--line);margin:16px 0">
      <label class="check"><input type="checkbox" id="ph" ${settings.skip_public_holidays === '1' ? 'checked' : ''}>Ne pas programmer de cours les jours fériés</label>
    </div>
    <div class="card"><h2>Périodes à venir</h2>${upcoming.length ? upcoming.map(row).join('') : '<p class="muted small">Aucune.</p>'}</div>
    ${past.length ? `<details class="card"><summary class="muted">Périodes passées (${past.length})</summary>${past.map(row).join('')}</details>` : ''}`;

  const f = $view.querySelector('#f');
  f.onsubmit = async (e) => {
    e.preventDefault();
    try {
      const r = await api('/api/admin/closures', { method: 'POST', body: formData(f) });
      toast(`Période ajoutée${r.sessions_cancelled ? ` · ${plural(r.sessions_cancelled, 'séance')} annulée${r.sessions_cancelled > 1 ? 's' : ''}` : ''}${r.bookings_affected ? ` (${plural(r.bookings_affected, 'réservation')} concernée${r.bookings_affected > 1 ? 's' : ''})` : ''}`);
      viewAdminClosures();
    } catch (err) { f.querySelector('#err').textContent = err.message; }
  };
  $view.querySelector('#ph').onchange = async (e) => {
    await api('/api/admin/settings', { method: 'PUT', body: { skip_public_holidays: e.target.checked } });
    toast(e.target.checked ? 'Les jours fériés seront ignorés lors de la création des séances' : 'Les jours fériés seront programmés');
  };
  $view.querySelector('#import').onclick = async () => {
    const box = $view.querySelector('#sh');
    box.innerHTML = '<div class="spinner"></div>';
    try {
      const r = await api(`/api/admin/school-holidays?zone=${$view.querySelector('#zone').value}&year=${$view.querySelector('#year').value}`);
      const already = (h) => closures.some((c) => c.start_date === h.start_date && c.end_date === h.end_date);
      box.innerHTML = r.holidays.length ? `<div style="margin-top:10px">${r.holidays.map((h, i) => `
        <label class="check list-item"><input type="checkbox" data-i="${i}" ${already(h) ? 'disabled' : 'checked'}>
          <span class="grow">${esc(h.label)}<br><span class="small muted">${fmtShort(h.start_date)} → ${fmtShort(h.end_date)} ${h.end_date.slice(0, 4)}${already(h) ? ' · déjà ajoutée' : ''}</span></span></label>`).join('')}
        <button class="btn" id="doimport" style="margin-top:10px">Ajouter la sélection</button></div>` : '<p class="muted small">Aucune date trouvée pour cette année.</p>';
      const btn = box.querySelector('#doimport');
      if (btn) btn.onclick = async () => {
        const picked = [...box.querySelectorAll('input[data-i]:checked:not(:disabled)')].map((i) => r.holidays[Number(i.dataset.i)]);
        btn.disabled = true;
        let n = 0;
        for (const h of picked) { const x = await api('/api/admin/closures', { method: 'POST', body: h }); n += x.sessions_cancelled; }
        toast(`${plural(picked.length, 'période')} ajoutée${picked.length > 1 ? 's' : ''}${n ? ` · ${plural(n, 'séance')} annulée${n > 1 ? 's' : ''}` : ''}`);
        viewAdminClosures();
      };
    } catch (err) { box.innerHTML = `<p class="error">${esc(err.message)}</p>`; }
  };
  $view.onclick = async (e) => {
    const d = e.target.closest('[data-del]');
    if (!d) return;
    if (!(await confirmBox('Supprimer cette période ? Les séances annulées par elle seront rétablies.', 'Supprimer'))) return;
    try { const r = await api(`/api/admin/closures/${d.dataset.del}`, { method: 'DELETE' }); toast(`Période supprimée${r.sessions_restored ? ` · ${plural(r.sessions_restored, 'séance')} rétablie${r.sessions_restored > 1 ? 's' : ''}` : ''}`); viewAdminClosures(); }
    catch (err) { toast(err.message, true); }
  };
}

async function viewAdminUsers() {
  loading();
  const { users } = await api('/api/admin/users');
  const render = (term = '') => {
    const t = term.toLowerCase();
    const list = users.filter((u) => !t || u.name.toLowerCase().includes(t) || u.email.toLowerCase().includes(t));
    return list.map((u) => `
      <div class="list-item">
        <div class="grow"><strong>${esc(u.name)}</strong> ${u.role === 'admin' ? '<span class="badge plum">Admin</span>' : ''} ${u.active ? '' : '<span class="badge danger">Désactivé</span>'}
          <div class="small muted">${esc(u.email)}${u.phone ? ` · <a href="tel:${esc(u.phone)}">${esc(u.phone)}</a>` : ''} · ${plural(u.upcoming, 'séance')} à venir</div></div>
        <button class="btn secondary small" data-user="${u.id}">Détails</button>
      </div>`).join('') || '<p class="muted">Aucun résultat.</p>';
  };
  $view.innerHTML = `
    ${adminNav('#/admin/membres')}
    <h1>Membres <span class="badge">${users.length}</span></h1>
    <input class="search" id="q" type="search" placeholder="Rechercher un nom ou un e-mail…">
    <div class="card" id="list">${render()}</div>
    ${users.length ? `<p class="small"><a href="mailto:?bcc=${encodeURIComponent(users.filter((u) => u.active).map((u) => u.email).join(','))}">✉ Écrire à tous les membres</a></p>` : ''}`;
  $view.querySelector('#q').oninput = (e) => { $view.querySelector('#list').innerHTML = render(e.target.value); };
  $view.onclick = async (e) => {
    const b = e.target.closest('[data-user]');
    if (!b) return;
    const u = users.find((x) => String(x.id) === b.dataset.user);
    const { bookings } = await api(`/api/admin/users/${u.id}/bookings`);
    const up = bookings.filter((x) => x.date >= today()).reverse();
    const past = bookings.filter((x) => x.date < today());
    modal(`
      <div class="modal-head"><h2>${esc(u.name)}</h2><button class="icon-btn" data-close aria-label="Fermer">✕</button></div>
      <p class="small">${esc(u.email)}${u.phone ? `<br><a href="tel:${esc(u.phone)}">${esc(u.phone)}</a>` : ''}<br><span class="muted">Inscrit·e le ${new Date(u.created_at.replace(' ', 'T') + 'Z').toLocaleDateString('fr-FR')}</span></p>
      <h3>Séances à venir (${up.length})</h3>
      ${up.length ? up.map((x) => `<div class="small">${x.cancelled ? '❌' : '•'} ${fmtLong(x.date)} ${x.start_time.replace(':', 'h')} — ${esc(x.title)}</div>`).join('') : '<p class="small muted">Aucune.</p>'}
      <h3 style="margin-top:12px">Séances passées</h3><p class="small">${past.filter((x) => !x.cancelled).length} séance(s) suivie(s)</p>
      ${u.id !== state.user.id ? `<div class="btn-row" style="margin-top:16px">
        <button class="btn secondary small" id="role">${u.role === 'admin' ? 'Retirer les droits admin' : 'Rendre administrateur'}</button>
        <button class="btn ${u.active ? 'danger' : 'ok'} small" id="act">${u.active ? 'Désactiver le compte' : 'Réactiver le compte'}</button>
      </div>` : ''}`, (m, close) => {
      const upd = async (body) => {
        try { await api(`/api/admin/users/${u.id}`, { method: 'PUT', body }); close(); toast('Membre mis à jour'); viewAdminUsers(); }
        catch (err) { toast(err.message, true); }
      };
      const r = m.querySelector('#role'); if (r) r.onclick = () => upd({ role: u.role === 'admin' ? 'member' : 'admin' });
      const a = m.querySelector('#act'); if (a) a.onclick = () => upd({ active: !u.active });
    });
  };
}

async function viewAdminSettings() {
  loading();
  const { settings: s } = await api('/api/admin/settings');
  $view.innerHTML = `
    ${adminNav('#/admin/reglages')}
    <h1>Réglages</h1>
    <form class="card" id="f">
      <div class="field"><label>Nom affiché</label><input name="studio_name" value="${esc(s.studio_name)}"></div>
      <div class="field"><label>Délai minimum pour annuler ou déplacer (heures)</label><input type="number" min="0" name="cancel_deadline_hours" value="${esc(s.cancel_deadline_hours)}">
        <p class="small muted">Ex. 12 : impossible d'annuler moins de 12 h avant la séance. 0 = toujours possible.</p></div>
      <div class="field"><label>Ouverture des réservations (jours à l'avance)</label><input type="number" min="0" name="booking_horizon_days" value="${esc(s.booking_horizon_days)}">
        <p class="small muted">Ex. 120 : on peut réserver jusqu'à 4 mois à l'avance. 0 = sans limite (toute l'année).</p></div>
      <div class="field"><label>Nombre maximum de réservations à venir par personne</label><input type="number" min="0" name="max_active_bookings" value="${esc(s.max_active_bookings)}">
        <p class="small muted">0 = illimité. Utile pour une formule « 1 cours par semaine » (mettre 2 ou 3).</p></div>
      <button class="btn">Enregistrer</button>
    </form>`;
  const f = $view.querySelector('#f');
  f.onsubmit = async (e) => {
    e.preventDefault();
    try { await api('/api/admin/settings', { method: 'PUT', body: formData(f) }); await refreshMe(); toast('Réglages enregistrés'); }
    catch (err) { toast(err.message, true); }
  };
}

// ---------- Démarrage ----------
async function refreshMe() {
  const r = await api('/api/me');
  state.user = r.user;
  state.settings = r.settings;
  document.title = `${r.settings.studio_name} — Réservations`;
}

window.addEventListener('hashchange', router);
(async () => {
  try { await refreshMe(); } catch { /* hors ligne */ }
  if (!location.hash) history.replaceState(null, '', '#/planning');
  router();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
})();
