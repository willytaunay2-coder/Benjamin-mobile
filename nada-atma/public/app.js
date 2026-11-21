'use strict';
/* Nada Atma — application de réservation (SPA sans dépendance) */

const state = { user: null, settings: {}, filter: '', enrollments: [], unread: 0 };
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
  document.getElementById('toast').className = 'toast'; // un message précédent ne doit pas masquer la fenêtre
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

// Majuscule au début seulement : « Mardi 24 novembre 2026 »
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
// Heure lisible : 09:00 → 9h, 19:00 → 19h, 12:15 → 12h15
const hm = (t) => String(t).replace(/^0(\d)/, '$1').replace(':', 'h').replace(/h00$/, 'h');

// ---------- Navigation ----------
function navItems() {
  const items = [{ href: '#/planning', label: 'Planning', icon: ICON.cal }];
  if (state.user) {
    if (isAdmin()) items.push({ href: '#/admin', label: 'Gestion', icon: ICON.admin });
    items.push({ href: '#/profil', label: 'Profil', icon: ICON.user });
  } else {
    items.push({ href: '#/connexion', label: 'Connexion', icon: ICON.login });
  }
  return items;
}

function renderBell() {
  const bell = document.getElementById('bell');
  bell.classList.toggle('hidden', !state.user);
  const n = document.getElementById('bell-n');
  n.textContent = state.unread > 9 ? '9+' : String(state.unread);
  n.classList.toggle('hidden', !state.unread);
  bell.setAttribute('aria-label', state.unread ? `Alertes (${state.unread} non lues)` : 'Alertes');
}

function renderNav() {
  renderBell();
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
  '#/mes-reservations': viewPlanning, // anciens liens
  '#/mon-creneau': viewPlanning,
  '#/alertes': viewAlerts,
  '#/profil': viewProfile,
  '#/admin': viewAdminSessions,
  '#/admin/annee': viewAdminYear,
  '#/admin/jour': viewAdminDay,
  '#/admin/mois': viewAdminMonth,
  '#/admin/cours': viewAdminTemplates,
  '#/admin/fermetures': viewAdminClosures,
  '#/admin/membres': viewAdminUsers,
  '#/admin/reglages': viewAdminSettings,
  '#/admin/appel': viewAttendance,
  '#/admin/repartition': viewAssignments,
};

async function router() {
  const path = location.hash.split('?')[0] || '#/planning';
  renderNav();
  document.getElementById('modal-root').innerHTML = '';
  const needUser = ['#/mes-reservations', '#/profil', '#/mon-creneau', '#/alertes'].includes(path) || path.startsWith('#/admin');
  if (needUser && !state.user) { location.hash = '#/connexion'; return; }
  if (path.startsWith('#/admin') && !isAdmin()) { location.hash = '#/planning'; return; }
  const fn = ROUTES[path] || viewPlanning;
  try { await fn(); } catch (e) { $view.innerHTML = `<div class="card error">${esc(e.message)}</div>`; }
  window.scrollTo(0, 0);
}

// ---------- Composants séance ----------
function spotsHtml(s) {
  const pct = Math.min(100, Math.round((s.occupied / s.capacity) * 100));
  return `<span class="spots"><span class="spots-bar"><i style="width:${pct}%"></i></span>${s.spots_left > 0 ? plural(s.spots_left, 'place') : 'Complet'}</span>`;
}

function sessionCard(s, { admin = false } = {}) {
  const meta = [
    `${s.duration_min} min`,
    s.location && `<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>${esc(s.location)}`,
    admin ? `<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c2 .7 3.2 2.5 3.6 5.2"/></svg>${s.occupied}/${s.capacity}${s.absent_count ? ` · ${s.absent_count} absent${s.absent_count > 1 ? 's' : ''}` : ''}` : (!s.cancelled && !s.is_past ? spotsHtml(s) : ''),
  ].filter(Boolean).map((m) => `<span>${m}</span>`).join('');

  let action = '';
  if (admin) {
    action = s.cancelled ? '<span class="badge danger">Annulée</span>'
      : s.occupied >= s.capacity ? '<span class="badge plum">Complet</span>' : '';
  } else {
    action = memberAction(s);
  }

  const mine = !admin && (s.my_status === 'enrolled' || s.my_status === 'booked');
  const cls = ['session', s.cancelled && 'cancelled', mine && 'mine', s.my_status === 'released' && 'released', admin && 'clickable'].filter(Boolean).join(' ');
  return `<div class="${cls}" style="--c:${esc(s.color)}" ${admin ? `data-session="${s.id}"` : ''}>
    <div class="s-time">${hm(s.start_time)}<small>${hm(endTime(s.start_time, s.duration_min))}</small></div>
    <div class="s-body">
      <div class="s-title">${esc(s.title)}</div>
      <div class="s-meta">${meta}</div>
      ${s.cancelled && s.cancel_reason ? `<div class="small muted">${esc(s.cancel_reason)}</div>` : ''}
      ${s.description && !admin ? `<div class="small muted s-desc" title="${esc(s.description)}">${esc(s.description)}</div>` : ''}
    </div>
    <div class="s-action">${action}</div>
  </div>`;
}

// Boutons d'une séance pour un·e élève selon sa situation
function memberAction(s) {
  if (s.cancelled) return '<span class="badge danger">Annulée</span>';
  if (s.is_past) {
    return s.my_status === 'enrolled' || s.my_status === 'booked' ? '<span class="badge ok">Venu·e</span>' : '<span class="badge">Passée</span>';
  }
  if (s.my_status === 'enrolled') {
    return `<span class="badge ok">Mon cours</span><button class="btn secondary small" data-manage="${s.id}">Annuler</button>`;
  }
  const weekTaken = state.takenWeeks && state.takenWeeks.has(mondayOf(s.date));
  if (s.my_status === 'released') {
    return `<span class="badge warn">Annulé</span>${s.spots_left > 0 && !weekTaken ? `<button class="btn ghost small" data-unrelease="${s.id}">Me réinscrire</button>` : ''}`;
  }
  if (s.my_status === 'booked') {
    return `<span class="badge ok">Inscrit·e</span><button class="btn ghost small" data-manage="${s.id}">Annuler</button>`;
  }
  if (s.spots_left <= 0) return '<span class="badge plum">Complet</span>';
  if (weekTaken) return '<span class="small muted week-taken">Déjà un cours cette semaine</span>';
  return `<button class="btn small" data-book="${s.id}">S’inscrire</button>`;
}

// Créneaux attribués d'office, à valider par l'élève
function pendingHtml() {
  const pend = state.enrollments.filter((e) => e.status === 'pending');
  return pend.map((e) => `<div class="pending-card">
    <div><strong>Votre professeure vous a inscrit·e sur le créneau du ${DAYS[e.weekday].toLowerCase()} à ${hm(e.start_time)}</strong>
    <div class="small">${esc(e.title)} · à partir du ${fmtLong(e.start_date)}. Votre place vous est gardée : merci de valider.</div></div>
    <div class="btn-row"><button class="btn small" data-accept="${e.id}">Valider</button><button class="btn ghost small" data-decline="${e.id}">Refuser</button></div>
  </div>`).join('');
}

async function answerEnrollment(id, accept, after) {
  if (!accept && !(await confirmBox('Refuser ce créneau ? Votre place sera proposée à quelqu’un d’autre.', 'Refuser', true))) return;
  try {
    await api(`/api/enrollments/${id}/${accept ? 'accept' : 'decline'}`, { method: 'POST' });
    toast(accept ? 'Créneau validé — à bientôt sur le tapis' : 'Créneau refusé');
    afterChange(after);
  } catch (e) { toast(e.message, true); }
}

// Accueil personnalisé : « Bonjour Katia »
function greetingHtml(sessions) {
  const first = esc(state.user.name.trim().split(/\s+/)[0]);
  const h = new Date().getHours();
  const next = sessions.find((s) => !s.is_past && !s.cancelled && (s.my_status === 'enrolled' || s.my_status === 'booked'));
  const when = next ? `${fmt(next.date, { weekday: 'long', day: 'numeric', month: 'long' })} à ${hm(next.start_time)}` : '';
  return `<div class="greeting"><p class="hello">${h >= 18 ? 'Bonsoir' : 'Bonjour'} ${first}</p>
    <h1>Votre planning</h1>
    ${next ? `<p class="next">Prochain cours : <strong>${when}</strong></p>` : ''}</div>`;
}

// Bandeau « mon créneau »
function slotBanner() {
  if (!state.user || isAdmin() && !state.enrollments.length) return '';
  if (state.enrollments.some((e) => e.status === 'pending')) return pendingHtml();
  if (!state.enrollments.length) {
    return `<div class="slot-banner"><div><strong>Votre cours de la semaine</strong><div class="small">Votre professeure vous attribue votre créneau. En attendant, vous pouvez prendre une place libre.</div></div></div>`;
  }
  const e = state.enrollments[0];
  return `<div class="slot-banner"><div><div class="small muted">Votre cours de la semaine</div><strong>${DAYS[e.weekday]} ${hm(e.start_time)} · ${esc(e.title)}</strong>
    <div class="small">Un empêchement ? Annulez : votre place sera proposée aux autres élèves.</div></div></div>`;
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
    const list = (byDay[d] || []).filter((s) => admin || !(s.cancelled && s.closure_id && !s.my_status));
    if (!list.length && !closure && !admin) continue; // élèves : on n'affiche que les jours de cours
    html += `<section class="day"><h3 class="day-title ${d === today() ? 'today' : ''}">${fmtLong(d)}${admin && list.length ? `<a class="print-link" href="#/admin/appel?date=${d}" aria-label="Imprimer la feuille d’appel du ${fmtLong(d)}"><svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 8V3h10v5"/><rect x="3" y="8" width="18" height="9" rx="2"/><path d="M7 14h10v7H7z"/></svg>Appel</a>` : ''}</h3>`;
    if (closure) html += `<div class="closure-banner"><svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 19c0-8 5-13 14-14-1 9-6 14-14 14z"/><path d="M5 19l7-7"/></svg><span><strong>${esc(closure.label)}</strong> — pas de cours</span></div>`;
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
async function afterChange(after) { try { await refreshMe(); } catch { /* */ } after && after(); }

// Confirmation avant de s'inscrire sur une place libre
function confirmBook(s, after) {
  if (!state.user || !s) { book(s ? s.id : 0, after); return; }
  modal(`
    <div class="modal-head"><h2>S’inscrire à ce cours ?</h2><button class="icon-btn" data-close aria-label="Fermer"><svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
    <div class="confirm-slot">
      <div class="day-time"><strong>${hm(s.start_time)}</strong><span>${hm(endTime(s.start_time, s.duration_min))}</span></div>
      <div><strong>${cap(fmtFull(s.date))}</strong><div class="small muted">${esc(s.title)} · ${s.duration_min} min${s.location ? ` · ${esc(s.location)}` : ''}</div></div>
    </div>
    <p class="small muted">Un seul cours par semaine. Si vous ne pouvez finalement pas venir, annulez pour laisser la place à quelqu’un d’autre.</p>
    <div class="btn-row" style="margin-top:14px"><button class="btn" id="confirm-book">Confirmer l’inscription</button><button class="btn ghost" data-close>Retour</button></div>`, (m, close) => {
    m.querySelector('#confirm-book').onclick = async (e) => { e.target.disabled = true; close(); await book(s.id, after); };
  });
}

async function book(sessionId, after) {
  if (!state.user) { toast('Connectez-vous pour vous inscrire'); location.hash = '#/connexion'; return; }
  try {
    const r = await api(`/api/sessions/${sessionId}/book`, { method: 'POST' });
    toast(`Inscription confirmée : ${fmtLong(r.session.date)} à ${hm(r.session.start_time)}`);
    afterChange(after);
  } catch (e) { toast(e.message, true); after && after(); }
}

async function unrelease(sessionId, after) {
  try { await api(`/api/sessions/${sessionId}/unrelease`, { method: 'POST' }); toast('Votre place est à nouveau réservée'); afterChange(after); }
  catch (e) { toast(e.message, true); }
}

function deadlineInfo(s) {
  const h = state.settings.cancel_deadline_hours || 0;
  const [y, m, d] = s.date.split('-').map(Number);
  const [hh, mm] = s.start_time.split(':').map(Number);
  const start = new Date(y, m - 1, d, hh, mm);
  return { late: start - new Date() < h * 3600000, hours: h };
}

// Annuler sa venue (son cours) ou son inscription sur une place libre
function manageSession(s, after) {
  const { late, hours } = deadlineInfo(s);
  const head = `<div class="modal-head"><h2>${esc(s.title)}</h2><button class="icon-btn" data-close aria-label="Fermer"><svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
    <p><strong>${cap(fmtFull(s.date))}</strong><br>${hm(s.start_time)} – ${hm(endTime(s.start_time, s.duration_min))}${s.location ? ` · ${esc(s.location)}` : ''}</p>`;
  if (s.my_status === 'enrolled') {
    modal(`${head}
      <p>Vous ne pouvez pas venir ? En annulant, votre place est proposée aux autres élèves.</p>
      <p class="small muted">Le cours n’est pas rattrapé. Si vous changez d’avis, « Me réinscrire » vous rend votre place tant que personne ne l’a prise.</p>
      <div class="btn-row" style="margin-top:14px"><button class="btn" id="release">Confirmer l’annulation</button><button class="btn ghost" data-close>Retour</button></div>`, (m, close) => {
      m.querySelector('#release').onclick = async () => {
        try {
          await api(`/api/sessions/${s.id}/release`, { method: 'POST' });
          close(); toast('Cours annulé — votre place est proposée aux autres élèves'); afterChange(after);
        } catch (e) { toast(e.message, true); }
      };
    });
    return;
  }
  // place libre réservée ponctuellement
  modal(`${head}
    ${late && !isAdmin() ? `<p class="badge warn">Annulation impossible moins de ${hours} h avant la séance</p><p class="small muted">Contactez directement votre professeure si besoin.</p>` : '<p class="small muted">En annulant, la place est proposée aux autres élèves.</p>'}
    <div class="btn-row" style="margin-top:14px"><button class="btn danger" id="cancel" ${late ? 'disabled' : ''}>Annuler mon inscription</button><button class="btn ghost" data-close>Retour</button></div>`, (m, close) => {
    m.querySelector('#cancel').onclick = async () => {
      try { await api(`/api/bookings/${s.my_booking_id}/cancel`, { method: 'POST' }); close(); toast('Réservation annulée'); afterChange(after); }
      catch (e) { toast(e.message, true); }
    };
  });
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
  // Un cours par semaine : les semaines où l'élève a déjà un cours
  state.takenWeeks = new Set(data.sessions.filter((x) => !x.cancelled && (x.my_status === 'enrolled' || x.my_status === 'booked')).map((x) => mondayOf(x.date)));
  $view.innerHTML = `
    ${!state.user ? `<div class="hero"><p class="script">Nada Atma</p><p class="tag">En harmonies…</p>
      <p class="muted">Consultez le planning et <a href="#/inscription">créez votre compte</a> pour choisir votre créneau.</p></div>` : greetingHtml(data.sessions) + slotBanner()}
    <div class="week-head">
      <button class="icon-btn" id="prev" aria-label="Semaine précédente"><svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg></button>
      <h1>${fmt(from, { day: 'numeric', month: 'short' })} – ${fmt(to, { day: 'numeric', month: 'short', year: 'numeric' })}</h1>
      <button class="icon-btn" id="next" aria-label="Semaine suivante"><svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></button>
      <button class="btn secondary small" id="now">Aujourd'hui</button>
      <input type="date" id="jump" value="${from}" style="width:auto" aria-label="Aller à la date">
    </div>
    ${filtersHtml(data.sessions)}
    ${weekHtml(from, data)}
    ${!data.sessions.length && !data.closures.length ? '<div class="empty"><div class="big"></div>Aucune séance cette semaine.</div>' : ''}
  `;
  const go = (d) => { location.hash = `#/planning?semaine=${mondayOf(d)}`; };
  $view.querySelector('#prev').onclick = () => go(addDays(from, -7));
  $view.querySelector('#next').onclick = () => go(addDays(from, 7));
  $view.querySelector('#now').onclick = () => go(today());
  $view.querySelector('#jump').onchange = (e) => e.target.value && go(e.target.value);
  $view.onclick = (e) => memberClicks(e, data.sessions, viewPlanning, () => { viewPlanning(); });
}

// Gestion commune des boutons d'une séance (planning, mes séances)
function memberClicks(e, sessions, after, onFilter) {
  const f = e.target.closest('[data-filter]');
  if (f && onFilter) { state.filter = f.dataset.filter; onFilter(); return; }
  const b = e.target.closest('[data-book]');
  if (b) { confirmBook(sessions.find((x) => String(x.id) === b.dataset.book), after); return; }
  const ac = e.target.closest('[data-accept]');
  if (ac) { answerEnrollment(ac.dataset.accept, true, after); return; }
  const de = e.target.closest('[data-decline]');
  if (de) { answerEnrollment(de.dataset.decline, false, after); return; }
  const u = e.target.closest('[data-unrelease]');
  if (u) { u.disabled = true; unrelease(u.dataset.unrelease, after); return; }
  const g = e.target.closest('[data-manage]');
  if (g) manageSession(sessions.find((x) => String(x.id) === g.dataset.manage), after);
}

async function viewMyBookings() {
  loading();
  const data = await api(`/api/my/sessions?from=${addDays(today(), -90)}&to=${addDays(today(), 63)}`);
  state.enrollments = data.enrollments;
  const upcoming = data.sessions.filter((s) => !s.is_past);
  const past = data.sessions.filter((s) => s.is_past && !s.cancelled && s.my_status !== 'released').reverse();
  const row = (s) => `
    <div class="session ${s.cancelled ? 'cancelled' : ''} ${s.my_status === 'released' ? 'released' : ''}" style="--c:${esc(s.color)}">
      <div class="s-time">${fmt(s.date, { day: 'numeric' })}<small>${fmt(s.date, { month: 'short' })}</small></div>
      <div class="s-body">
        <div class="s-title">${esc(s.title)}</div>
        <div class="s-meta"><span style="text-transform:capitalize">${fmt(s.date, { weekday: 'long' })}</span><span>${hm(s.start_time)} – ${hm(endTime(s.start_time, s.duration_min))}</span></div>
        ${s.cancelled && s.cancel_reason ? `<div class="small" style="color:var(--danger)">${esc(s.cancel_reason)}</div>` : ''}
      </div>
      <div class="s-action">${memberAction(s)}</div>
    </div>`;
  const e = state.enrollments[0];
  const slot = e
    ? `<div class="list-item"><span class="dot" style="background:${esc(e.color)}"></span><div class="grow"><strong>${DAYS[e.weekday]} ${hm(e.start_time)} — ${esc(e.title)}</strong> ${e.status === 'pending' ? '<span class="badge warn">À valider</span>' : ''}<div class="small muted">${e.duration_min} min${e.location ? ` · ${esc(e.location)}` : ''} · depuis le ${fmtShort(e.start_date)}</div></div></div>`
    : `<p class="muted">Pas encore de créneau. Indiquez vos préférences : votre professeure vous inscrira selon les places disponibles.</p><a class="btn small" href="#/mon-creneau">Mes préférences</a>`;
  $view.innerHTML = `
    <h1>Mes séances</h1>
    ${pendingHtml()}
    <div class="card"><h2>Mon cours de la semaine</h2>${slot}
      <p class="small muted" style="margin:12px 0 0">Un empêchement ? Annulez : votre place est proposée aux autres élèves. Le cours n’est pas rattrapé.</p></div>
    <h2 style="margin-top:8px">Prochaines séances</h2>
    ${upcoming.length ? upcoming.map(row).join('') : '<div class="empty"><div class="big"></div>Aucune séance à venir.</div>'}
    ${past.length ? `<h2 style="margin-top:28px">Historique</h2>${past.slice(0, 20).map(row).join('')}` : ''}
  `;
  $view.onclick = (ev) => memberClicks(ev, data.sessions, viewMyBookings);
}

// Préférences de créneau (1er, 2e, 3e choix)
async function viewChooseSlot() {
  loading();
  const [{ templates }, { preferences }] = await Promise.all([api('/api/templates'), api('/api/my/preferences')]);
  const mine = state.enrollments[0];
  const label = (t) => `${DAYS[t.weekday]} ${hm(t.start_time)} — ${t.title}`;
  const select = (rank) => {
    const cur = preferences.find((p) => p.rank === rank)?.template_id;
    return `<div class="field"><label for="p${rank}">${rank === 1 ? '1er choix' : `${rank}e choix`}${rank > 1 ? ' <span class="muted">(facultatif)</span>' : ''}</label>
      <select id="p${rank}" name="p${rank}"><option value="">—</option>${templates.map((t) => `<option value="${t.id}" ${t.id === cur ? 'selected' : ''}>${esc(label(t))}${t.free <= 0 ? ' (complet)' : ''}</option>`).join('')}</select></div>`;
  };
  $view.innerHTML = `
    <h1>Mes préférences</h1>
    ${mine ? `<div class="card"><p style="margin:0">Votre cours de la semaine : <strong>${DAYS[mine.weekday]} ${hm(mine.start_time)} — ${esc(mine.title)}</strong>${mine.status === 'pending' ? ' <span class="badge warn">À valider</span>' : ''}.</p>
      <p class="small muted" style="margin:6px 0 0">Pour changer de créneau, indiquez vos nouvelles préférences et prévenez votre professeure.</p></div>` : ''}
    <form class="card" id="f">
      <p>Votre abonnement comprend <strong>un cours par semaine</strong>, toute l’année. Classez les créneaux qui vous conviennent : votre professeure vous inscrira selon vos préférences et les places disponibles, puis vous validerez.</p>
      ${select(1)}${select(2)}${select(3)}
      <div class="error" id="err"></div>
      <button class="btn">Enregistrer mes préférences</button>
    </form>`;
  const f = $view.querySelector('#f');
  f.onsubmit = async (ev) => {
    ev.preventDefault();
    const ids = [1, 2, 3].map((r) => Number(f.querySelector(`#p${r}`).value)).filter(Boolean);
    try { await api('/api/my/preferences', { method: 'PUT', body: { template_ids: ids } }); toast('Préférences enregistrées — votre professeure est prévenue'); f.querySelector('#err').textContent = ''; }
    catch (err) { f.querySelector('#err').textContent = err.message; }
  };
}

// Alertes (cloche)
async function viewAlerts() {
  loading();
  const { notifications } = await api('/api/notifications');
  if (notifications.some((n) => !n.read_at)) { api('/api/notifications/read', { method: 'POST' }).catch(() => {}); state.unread = 0; renderBell(); }
  const ago = (d) => {
    const t = new Date(d.replace(' ', 'T') + 'Z'); const m = Math.round((Date.now() - t) / 60000);
    if (m < 1) return 'à l’instant'; if (m < 60) return `il y a ${m} min`; if (m < 1440) return `il y a ${Math.round(m / 60)} h`;
    return t.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
  };
  const icon = { place: '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20c-4.5 0-8-2.5-9-6 3 0 5.5 1 7 3M12 20c4.5 0 8-2.5 9-6-3 0-5.5 1-7 3"/><path d="M12 20c-2.5-2-3.5-5-3.5-8S10 6 12 4c2 2 3.5 5 3.5 8s-1 6-3.5 8z"/></svg>', enrollment: '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>', admin: '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>' };
  $view.innerHTML = `
    <h1>Alertes</h1>
    ${notifications.length ? `<div class="card">${notifications.map((n) => `
      <div class="list-item alert ${n.read_at ? '' : 'unread'}">
        <span class="alert-ico" aria-hidden="true">${icon[n.kind] || (['move', 'new', 'cancel', 'restore'].includes(n.kind) ? icon.enrollment : icon.admin)}</span>
        <div class="grow"><strong>${esc(n.title)}</strong><div class="small muted">${esc(n.body)}</div><div class="small muted">${ago(n.created_at)}</div></div>
        ${n.link ? `<a class="btn ${n.kind === 'place' || n.kind === 'new' ? '' : 'secondary'} small" href="${esc(n.link)}">${n.kind === 'place' || n.kind === 'new' ? 'S’inscrire' : n.kind === 'enrollment' ? 'Valider' : 'Voir'}</a>` : ''}
      </div>`).join('')}</div>` : '<div class="empty"><div class="big"></div>Aucune alerte pour le moment.<br>Vous serez prévenu·e ici dès qu’une place se libère.</div>'}`;
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
      toast(r.user.role === 'admin' ? 'Compte administrateur créé' : 'Bienvenue chez Nada Atma');
      location.hash = r.user.role === 'admin' ? '#/admin' : '#/planning';
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
      <fieldset class="field notify-set"><legend>Être prévenu·e (places libres, cours déplacés ou ajoutés)</legend>
        <label class="check"><input type="checkbox" name="notify_sms" ${u.notify_sms !== false ? 'checked' : ''}>Par SMS, au numéro ci-dessus</label>
        <label class="check"><input type="checkbox" name="notify_email" ${u.notify_email !== false ? 'checked' : ''}>Par e-mail</label>
        <p class="small muted">Les alertes restent toujours visibles dans l’application (la cloche).</p>
      </fieldset>
      <h3>Changer de mot de passe</h3>
      <div class="grid2">
        <div class="field"><label for="cp">Mot de passe actuel</label><input id="cp" name="current_password" type="password" autocomplete="current-password"></div>
        <div class="field"><label for="np">Nouveau mot de passe</label><input id="np" name="new_password" type="password" minlength="8" autocomplete="new-password"></div>
      </div>
      <div class="error" id="err"></div>
      <button class="btn">Enregistrer</button>
    </form>
    <button class="btn danger" id="logout">Se déconnecter</button>
    <div class="install-tip"><svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="6" y="2.5" width="12" height="19" rx="3"/><path d="M11 18h2"/></svg><div><strong>Installer l'application</strong> : sur iPhone, ouvrez ce site dans Safari, touchez « Partager » puis « Sur l'écran d'accueil ». Sur Android, menu ⋮ puis « Installer l'application ».</div></div>`;
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
    ['#/admin', 'Planning'], ['#/admin/cours', 'Cours'], ['#/admin/membres', 'Élèves'], ['#/admin/fermetures', 'Vacances'], ['#/admin/reglages', 'Réglages'],
  ];
  return `<div class="subnav">${tabs.map(([h, l]) => `<a href="${h}" class="chip ${h === active ? 'active' : ''}">${l}</a>`).join('')}</div>`;
}

async function viewAdminSessions() {
  const p = hashParams();
  let from = mondayOf(p.semaine || today());
  loading();
  let data = await api(`/api/sessions?from=${from}&to=${addDays(from, 6)}`);
  // Le week-end (plus de séance à venir), afficher directement la semaine suivante
  if (!p.semaine && !data.sessions.some((s) => !s.is_past)) {
    from = addDays(from, 7);
    data = await api(`/api/sessions?from=${from}&to=${addDays(from, 6)}`);
  }
  setHashParams('#/admin', { semaine: p.semaine ? from : '' });
  const total = data.sessions.filter((s) => !s.cancelled).reduce((a, s) => a + s.occupied, 0);
  $view.innerHTML = `
    ${adminNav('#/admin')}
    ${planNav('#/admin')}
    <div class="week-head">
      <button class="icon-btn" id="prev" aria-label="Semaine précédente"><svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg></button>
      <h1>${fmt(from, { day: 'numeric', month: 'short' })} – ${fmt(addDays(from, 6), { day: 'numeric', month: 'short', year: 'numeric' })}</h1>
      <button class="icon-btn" id="next" aria-label="Semaine suivante"><svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></button>
      <button class="btn secondary small" id="now">Aujourd'hui</button>
      <button class="btn small" id="add">+ Ajouter une séance</button>
    </div>
    <p class="muted small">${plural(data.sessions.filter((s) => !s.cancelled).length, 'séance')} · ${plural(total, 'place')} occupées cette semaine. Touchez une séance pour voir les inscrit·es.</p>
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
  const [{ session: s, attendees, absent }, { users }] = await Promise.all([api(`/api/admin/sessions/${id}`), api('/api/admin/users')]);
  const others = users.filter((u) => u.active && !attendees.some((a) => a.id === u.id) && !absent.some((a) => a.id === u.id));
  const kindBadge = { regular: '<span class="badge">À l’année</span>', makeup: '<span class="badge ok">Place libre</span>' };
  const personRow = (a, btn) => `<div class="list-item"><div class="grow"><strong>${esc(a.name)}</strong> ${kindBadge[a.kind] || ''}<div class="small muted">${esc(a.email)}${a.phone ? ` · <a href="tel:${esc(a.phone)}">${esc(a.phone)}</a>` : ''}</div></div>${btn}</div>`;
  modal(`
    <div class="modal-head"><h2>${esc(s.title)}</h2><button class="icon-btn" data-close aria-label="Fermer"><svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
    <p><strong>${cap(fmtFull(s.date))}</strong><br>
      ${hm(s.start_time)} – ${hm(endTime(s.start_time, s.duration_min))}${s.location ? ` · ${esc(s.location)}` : ''}<br>
      ${s.cancelled ? `<span class="badge danger">Annulée${s.cancel_reason ? ` : ${esc(s.cancel_reason)}` : ''}</span>` : `<span class="badge plum">${s.occupied} / ${s.capacity} inscrit·es</span>`}</p>
    <h3>Participant·es</h3>
    ${attendees.length ? attendees.map((a) => personRow(a, a.kind === 'makeup'
      ? `<button class="btn ghost small" data-unbook="${a.booking_id}">Retirer</button>`
      : `<button class="btn ghost small" data-absent="${a.id}">Absent·e</button>`)).join('') : '<p class="muted small">Personne pour le moment.</p>'}
    ${absent.length ? `<h3 style="margin-top:14px">Places libérées (${absent.length})</h3>${absent.map((a) => personRow(a, `<button class="btn ghost small" data-present="${a.id}">Remettre</button>`)).join('')}` : ''}
    ${!s.cancelled && !s.is_past && s.spots_left > 0 && others.length ? `
      <div class="btn-row" style="margin:10px 0 18px">
        <select id="adduser" style="flex:1"><option value="">Ajouter quelqu’un pour cette séance…</option>${others.map((u) => `<option value="${u.id}">${esc(u.name)}</option>`).join('')}</select>
        <button class="btn small" id="addbtn">Ajouter</button>
      </div>` : ''}
    ${attendees.length ? `<p class="small"><a href="mailto:?bcc=${encodeURIComponent(attendees.map((a) => a.email).join(','))}&subject=${encodeURIComponent(`${s.title} — ${fmtLong(s.date)}`)}" class="mail"><svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3.5 7l8.5 6 8.5-6"/></svg>Écrire à tous les inscrit·es</a></p>` : ''}
    <div class="btn-row" style="margin-top:16px">
      <button class="btn secondary small" id="edit">Modifier / déplacer</button>
      <a class="btn ghost small" href="#/admin/appel?date=${s.date}"><svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 8V3h10v5"/><rect x="3" y="8" width="18" height="9" rx="2"/><path d="M7 14h10v7H7z"/></svg>Feuille d’appel</a>
      ${s.cancelled ? '<button class="btn ok small" id="restore">Rétablir la séance</button>' : '<button class="btn danger small" id="cancel">Annuler la séance</button>'}
      ${!attendees.length && !absent.length ? '<button class="btn ghost small" id="del">Supprimer</button>' : ''}
    </div>`, (m, close) => {
    const reopen = () => { after && after(); sessionDetailModal(id, after); };
    m.addEventListener('click', async (e) => {
      const u = e.target.closest('[data-unbook]');
      if (u) {
        try { await api(`/api/bookings/${u.dataset.unbook}/cancel`, { method: 'POST' }); toast('Participant·e retiré·e'); reopen(); }
        catch (err) { toast(err.message, true); }
      }
      const ab = e.target.closest('[data-absent]');
      if (ab) {
        try { await api(`/api/admin/sessions/${id}/absences`, { method: 'POST', body: { user_id: Number(ab.dataset.absent) } }); toast('Absence notée — place libérée, les élèves sont prévenus'); reopen(); }
        catch (err) { toast(err.message, true); }
      }
      const pr = e.target.closest('[data-present]');
      if (pr) {
        try { await api(`/api/admin/sessions/${id}/absences/${pr.dataset.present}`, { method: 'DELETE' }); toast('Place rendue'); reopen(); }
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
      const reason = prompt(`Annuler cette séance ?${attendees.length ? `\n${plural(attendees.length, 'personne')} inscrite(s) seront prévenue(s) par alerte et e-mail dans l'application.` : ''}\n\nMotif (facultatif) :`, '');
      if (reason === null) return;
      try { await api(`/api/admin/sessions/${id}`, { method: 'PUT', body: { cancelled: true, cancel_reason: reason || 'Séance annulée' } }); toast('Séance annulée — les inscrit·es sont prévenu·es'); reopen(); }
      catch (err) { toast(err.message, true); }
    };
    const restore = m.querySelector('#restore');
    if (restore) restore.onclick = async () => {
      try { await api(`/api/admin/sessions/${id}`, { method: 'PUT', body: { cancelled: false } }); toast('Séance rétablie — les inscrit·es sont prévenu·es'); reopen(); }
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
    <div class="modal-head"><h2>${s ? 'Modifier ou déplacer' : 'Ajouter une séance'}</h2><button class="icon-btn" data-close aria-label="Fermer"><svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
    ${!s ? '<p class="small muted">Séance supplémentaire, atelier, stage… Elle est ouverte à la réservation de tous les élèves. Pour un cours qui revient chaque semaine, utilisez « Cours réguliers ».</p>' : ''}
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
      <div class="field"><label class="check"><input type="checkbox" name="notify" checked>${s ? 'Prévenir tous les élèves si la date ou l’heure change (alerte + e-mail)' : 'Prévenir tous les élèves de cette nouvelle séance (alerte + e-mail)'}</label></div>
      <div class="error" id="err"></div>
      <button class="btn block">${s ? 'Enregistrer' : 'Créer la séance'}</button>
    </form>`, (m, close) => {
    const f = m.querySelector('#f');
    f.onsubmit = async (e) => {
      e.preventDefault();
      try {
        const r = s ? await api(`/api/admin/sessions/${s.id}`, { method: 'PUT', body: formData(f) })
          : await api('/api/admin/sessions', { method: 'POST', body: formData(f) });
        close(); toast(r.notified ? `Séance enregistrée — ${plural(r.notified, 'élève')} prévenu${r.notified > 1 ? 's' : ''}` : 'Séance enregistrée'); after && after();
      } catch (err) { f.querySelector('#err').textContent = err.message; }
    };
  });
}

// Répartition de l'année selon les préférences
async function viewAssignments(proposal) {
  loading();
  const { templates, members } = await api('/api/admin/assignments');
  const tName = (id) => { const t = templates.find((x) => x.id === id); return t ? `${DAYS[t.weekday].slice(0, 3)} ${hm(t.start_time)}` : '—'; };
  const todo = members.filter((m) => !m.enrollment);
  const done = members.filter((m) => m.enrollment);
  const proposed = Object.fromEntries((proposal || []).map((p) => [p.user_id, p.template_id]));
  const sorted = [...todo].sort((a, b) => (a.since ? 0 : 1) - (b.since ? 0 : 1) || (a.since || '').localeCompare(b.since || '') || a.name.localeCompare(b.name));
  const row = (m) => {
    const pick = proposed[m.id] ?? '';
    const choice = m.prefs.indexOf(pick);
    return `<div class="list-item">
      <div class="grow"><strong>${esc(m.name)}</strong>
        <div class="small muted">${m.prefs.length ? m.prefs.map((tid, i) => `${i + 1}. ${tName(tid)}`).join(' · ') : 'Pas de préférence indiquée'}${m.since ? ` · demande du ${new Date(m.since.replace(' ', 'T') + 'Z').toLocaleDateString('fr-FR')}` : ''}</div></div>
      <div class="btn-row">
        ${pick && choice >= 0 ? `<span class="badge ${choice === 0 ? 'ok' : 'warn'}">${choice === 0 ? '1er choix' : `${choice + 1}e choix`}</span>` : ''}
        <select data-assign="${m.id}" style="width:auto;min-width:150px" aria-label="Créneau pour ${esc(m.name)}"><option value="">Ne pas inscrire</option>
          ${templates.map((t) => `<option value="${t.id}" ${t.id === pick ? 'selected' : ''}>${tName(t.id)} (${t.capacity - t.enrolled} pl.)</option>`).join('')}</select>
      </div></div>`;
  };
  $view.innerHTML = `
    ${adminNav('#/admin/repartition')}
    <h1>Répartition de l'année</h1>
    <p class="muted small">Chaque abonné·e a un cours par semaine. Les élèves classent leurs créneaux préférés (Mes séances › Mes préférences). Proposez une répartition automatique — par ordre d'arrivée des demandes, 1er choix si possible, sinon 2e puis 3e — ajustez, puis inscrivez : chacun·e est prévenu·e et valide son créneau.</p>
    <div class="filters" style="flex-wrap:wrap">${templates.map((t) => `<span class="chip" style="cursor:default">${tName(t.id)} · ${t.enrolled}/${t.capacity}</span>`).join('')}</div>
    <div class="card">
      <div class="section-title" style="margin-top:0"><h2>À inscrire (${todo.length})</h2>
        <div class="btn-row"><button class="btn secondary small" id="auto">Proposer automatiquement</button><button class="btn small" id="apply" ${todo.length ? '' : 'disabled'}>Inscrire la sélection</button></div></div>
      ${sorted.length ? sorted.map(row).join('') : '<p class="muted">Tout le monde a son créneau.</p>'}
      ${proposal && proposal.some((p) => !p.template_id) ? '<p class="small" style="color:var(--warn)">Certaines personnes n’ont pas pu être placées : leurs créneaux préférés sont complets.</p>' : ''}
    </div>
    <details class="card"><summary><strong>Déjà inscrit·es (${done.length})</strong></summary>
      ${done.map((m) => `<div class="list-item"><div class="grow">${esc(m.name)}</div><span class="small">${tName(m.enrollment.template_id)}</span> ${m.enrollment.status === 'pending' ? '<span class="badge warn">À valider</span>' : '<span class="badge ok">Validé</span>'}</div>`).join('') || '<p class="muted small">Personne.</p>'}
    </details>`;
  $view.querySelector('#auto').onclick = async () => {
    try { const r = await api('/api/admin/assignments/propose', { method: 'POST' }); viewAssignments(r.proposals); toast(`${r.proposals.filter((p) => p.template_id).length} proposition(s)`); }
    catch (err) { toast(err.message, true); }
  };
  $view.querySelector('#apply').onclick = async () => {
    const assignments = [...$view.querySelectorAll('[data-assign]')].filter((sel) => sel.value).map((sel) => ({ user_id: Number(sel.dataset.assign), template_id: Number(sel.value) }));
    if (!assignments.length) { toast('Choisissez au moins un créneau', true); return; }
    if (!(await confirmBox(`Inscrire ${plural(assignments.length, 'personne')} ? Chacun·e reçoit une alerte et un e-mail pour valider son créneau.`, 'Inscrire'))) return;
    try {
      const r = await api('/api/admin/assignments/apply', { method: 'POST', body: { assignments } });
      toast(r.errors.length ? `${r.done} inscrit·e(s) — ${r.errors.length} impossible(s) : ${r.errors.map((x) => x.name + ' (' + x.error + ')').join(', ')}` : `${r.done} inscrit·e(s), en attente de validation`, !!r.errors.length);
      viewAssignments();
    } catch (err) { toast(err.message, true); }
  };
}

// Feuille d'appel imprimable d'une journée
async function viewAttendance() {
  const p = hashParams();
  let date = p.date || today();
  loading();
  let data = await api(`/api/admin/day?date=${date}`);
  // Sans date précisée : prochain jour de cours
  if (!p.date && !data.sessions.length) {
    const next = (await api(`/api/sessions?from=${today()}&to=${addDays(today(), 30)}`)).sessions.find((x) => !x.cancelled);
    if (next) { date = next.date; data = await api(`/api/admin/day?date=${date}`); }
  }
  setHashParams('#/admin/appel', { date });
  const rows = (list) => list.map((a) => `<tr><td class="box"><span></span></td><td><strong>${esc(a.name)}</strong></td><td>${a.kind === 'makeup' ? 'Place libre' : 'À l’année'}</td><td class="nowrap">${a.phone ? esc(a.phone) : ''}</td><td class="sign"></td></tr>`).join('');
  const blank = (n) => Array.from({ length: n }, () => '<tr class="blank"><td class="box"><span></span></td><td></td><td></td><td></td><td class="sign"></td></tr>').join('');
  const sheet = (x) => {
    const s = x.session;
    return `<section class="sheet">
      <div class="sheet-head">
        <div><div class="sheet-time">${hm(s.start_time)} – ${hm(endTime(s.start_time, s.duration_min))}</div>
          <div class="sheet-title">${esc(s.title)}${s.location ? ` · ${esc(s.location)}` : ''}</div></div>
        <div class="sheet-count">${s.cancelled ? '<span class="badge danger">Annulée</span>' : `${x.attendees.length} / ${s.capacity}`}</div>
      </div>
      ${s.cancelled ? `<p class="muted">Séance annulée${s.cancel_reason ? ` : ${esc(s.cancel_reason)}` : ''}.</p>` : `
      <table class="roll">
        <thead><tr><th class="box">Présent</th><th>Nom</th><th>Inscription</th><th>Téléphone</th><th class="sign">Remarque</th></tr></thead>
        <tbody>${rows(x.attendees)}${blank(Math.min(3, Math.max(1, s.capacity - x.attendees.length)))}</tbody>
      </table>
      ${x.absent.length ? `<p class="sheet-absent"><strong>Ont libéré leur place :</strong> ${x.absent.map((a) => esc(a.name)).join(', ')}</p>` : ''}`}
    </section>`;
  };
  $view.innerHTML = `
    <div class="no-print">${adminNav('#/admin')}</div>
    <div class="week-head no-print">
      <button class="icon-btn" id="prev" aria-label="Jour précédent">${'<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>'}</button>
      <h1>${cap(fmtFull(date))}</h1>
      <button class="icon-btn" id="next" aria-label="Jour suivant">${'<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>'}</button>
      <input type="date" id="jump" value="${date}" style="width:auto" aria-label="Choisir la date">
      <button class="btn small" id="print" ${data.sessions.length ? '' : 'disabled'}><svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 8V3h10v5"/><rect x="3" y="8" width="18" height="9" rx="2"/><path d="M7 14h10v7H7z"/></svg>Imprimer</button>
    </div>
    <div class="print-page">
      <header class="print-head">
        <img src="/logo.png" alt="" class="print-logo">
        <div><div class="print-brand">Nada Atma</div><div class="print-sub">Feuille d’appel — <span>${cap(fmtFull(date))}</span></div></div>
      </header>
      ${data.sessions.length ? data.sessions.map(sheet).join('') : '<div class="empty"><div class="big"></div>Pas de cours ce jour-là.</div>'}
    </div>`;
  const go = (d) => { location.hash = `#/admin/appel?date=${d}`; };
  $view.querySelector('#prev').onclick = () => go(addDays(date, -1));
  $view.querySelector('#next').onclick = () => go(addDays(date, 1));
  $view.querySelector('#jump').onchange = (e) => e.target.value && go(e.target.value);
  $view.querySelector('#print').onclick = () => window.print();
}

// Vue annuelle (année scolaire de septembre à août)
// Choix du type de planning (professeure)
function planNav(active) {
  const views = [['#/admin/jour', 'Jour'], ['#/admin', 'Semaine'], ['#/admin/mois', 'Mois'], ['#/admin/annee', 'Année']];
  return `<nav class="seg" aria-label="Type de planning">${views.map(([h, l]) => `<a href="${h}" class="${h === active ? 'active' : ''}" ${h === active ? 'aria-current="page"' : ''}>${l}</a>`).join('')}</nav>`;
}
const ARROW_L = '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>';
const ARROW_R = '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';
const fillLevel = (occ, cap) => (occ >= cap ? 'full' : occ / cap >= 0.75 ? 'high' : 'open');

// ---------- Planning du jour ----------
async function viewAdminDay() {
  const p = hashParams();
  let date = p.date || today();
  loading();
  let data = await api(`/api/admin/day?date=${date}`);
  // Sans date précisée : prochain jour de cours
  if (!p.date && !data.sessions.some((x) => !x.session.cancelled)) {
    const next = (await api(`/api/sessions?from=${today()}&to=${addDays(today(), 60)}`)).sessions.find((x) => !x.cancelled && !x.is_past);
    if (next) { date = next.date; data = await api(`/api/admin/day?date=${date}`); }
  }
  setHashParams('#/admin/jour', { date: p.date ? date : '' });
  const card = (x) => {
    const s = x.session; const occ = x.attendees.length;
    const lvl = fillLevel(occ, s.capacity);
    return `<section class="card day-card ${s.cancelled ? 'is-cancelled' : ''}">
      <div class="day-card-head">
        <div class="day-time"><strong>${hm(s.start_time)}</strong><span>${hm(endTime(s.start_time, s.duration_min))}</span></div>
        <div class="grow"><div class="s-title">${esc(s.title)}</div><div class="small muted">${s.duration_min} min${s.location ? ` · ${esc(s.location)}` : ''}</div></div>
        ${s.cancelled ? '<span class="badge danger">Annulée</span>' : `<span class="fill-pill ${lvl}">${occ} / ${s.capacity}</span>`}
      </div>
      ${s.cancelled ? `<p class="small muted">Séance annulée${s.cancel_reason ? ` : ${esc(s.cancel_reason)}` : ''}.</p>` : `
      <ol class="people">${x.attendees.map((a) => `<li><span>${esc(a.name)}</span>${a.kind === 'makeup' ? '<span class="badge ok">Place libre</span>' : ''}</li>`).join('') || '<li class="muted">Personne pour l’instant</li>'}</ol>
      ${x.absent.length ? `<p class="small muted day-absent">Ont annulé : ${x.absent.map((a) => esc(a.name)).join(', ')}</p>` : ''}
      ${s.capacity - occ > 0 ? `<p class="small day-free">${plural(s.capacity - occ, 'place')} libre${s.capacity - occ > 1 ? 's' : ''}</p>` : ''}`}
      <div class="btn-row"><button class="btn secondary small" data-session="${s.id}">Détails et modifications</button></div>
    </section>`;
  };
  $view.innerHTML = `
    ${adminNav('#/admin')}
    ${planNav('#/admin/jour')}
    <div class="week-head">
      <button class="icon-btn" id="prev" aria-label="Jour de cours précédent">${ARROW_L}</button>
      <h1>${cap(fmtFull(date))}</h1>
      <button class="icon-btn" id="next" aria-label="Jour de cours suivant">${ARROW_R}</button>
      <input type="date" id="jump" value="${date}" style="width:auto" aria-label="Choisir la date">
      ${data.sessions.length ? `<a class="btn ghost small" href="#/admin/appel?date=${date}"><svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 8V3h10v5"/><rect x="3" y="8" width="18" height="9" rx="2"/><path d="M7 14h10v7H7z"/></svg>Feuille d’appel</a>` : ''}
    </div>
    ${data.sessions.length ? `<div class="day-list">${data.sessions.map(card).join('')}</div>` : '<div class="empty card"><div class="big"></div>Pas de cours ce jour-là.<br>Les flèches mènent au jour de cours précédent ou suivant.</div>'}`;
  const go = (d) => { location.hash = `#/admin/jour?date=${d}`; };
  $view.querySelector('#prev').onclick = async () => {
    const { sessions } = await api(`/api/sessions?from=${addDays(date, -60)}&to=${addDays(date, -1)}`);
    const prev = sessions.filter((x) => !x.cancelled).pop();
    go(prev ? prev.date : addDays(date, -1));
  };
  $view.querySelector('#next').onclick = async () => {
    const { sessions } = await api(`/api/sessions?from=${addDays(date, 1)}&to=${addDays(date, 60)}`);
    const next = sessions.find((x) => !x.cancelled);
    go(next ? next.date : addDays(date, 1));
  };
  $view.querySelector('#jump').onchange = (e) => { if (e.target.value) go(e.target.value); };
  $view.onclick = (e) => {
    const s = e.target.closest('[data-session]');
    if (s) sessionDetailModal(Number(s.dataset.session), viewAdminDay);
  };
}

// ---------- Planning du mois ----------
async function viewAdminMonth() {
  const p = hashParams();
  const month = /^\d{4}-\d{2}$/.test(p.mois || '') ? p.mois : today().slice(0, 7);
  const [y, mo] = month.split('-').map(Number);
  const first = `${month}-01`, last = iso(new Date(y, mo, 0, 12));
  setHashParams('#/admin/mois', { mois: month === today().slice(0, 7) ? '' : month });
  loading();
  const data = await api(`/api/sessions?from=${first}&to=${last}`);
  const byDay = {};
  for (const s of data.sessions) (byDay[s.date] ||= []).push(s);
  const closedDay = (d) => data.closures.find((c) => c.start_date <= d && c.end_date >= d);
  const active = data.sessions.filter((s) => !s.cancelled);
  const seats = active.reduce((a, s) => a + s.capacity, 0), taken = active.reduce((a, s) => a + s.occupied, 0);
  let cells = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].map((d) => `<div class="mdow">${d}</div>`).join('');
  for (let d = mondayOf(first); d <= addDays(mondayOf(last), 6); d = addDays(d, 1)) {
    const inMonth = d.slice(0, 7) === month;
    const list = byDay[d] || [];
    const c = closedDay(d);
    const chips = list.map((s) => s.cancelled
      ? `<button class="mchip cancelled" data-session="${s.id}" aria-label="${hm(s.start_time)}, séance annulée"><span class="t">${hm(s.start_time)}</span><span class="n">annulée</span></button>`
      : `<button class="mchip ${fillLevel(s.occupied, s.capacity)}" data-session="${s.id}" aria-label="${hm(s.start_time)} : ${s.occupied} inscrit·es sur ${s.capacity}"><span class="t">${hm(s.start_time)}</span><span class="n">${s.occupied}/${s.capacity}</span></button>`).join('');
    cells += `<div class="mcell ${inMonth ? '' : 'out'} ${c && !list.length ? 'closed' : ''} ${d === today() ? 'today' : ''}">
      <button class="mday" data-day="${d}" aria-label="Voir le ${fmtLong(d)}">${Number(d.slice(8))}</button>
      ${chips}${c && !list.length && inMonth && (d === c.start_date || d === first || D_isMonday(d)) ? `<span class="mclosed">${esc(c.label)}</span>` : ''}
    </div>`;
  }
  const title = new Date(y, mo - 1, 1, 12).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  $view.innerHTML = `
    ${adminNav('#/admin')}
    ${planNav('#/admin/mois')}
    <div class="week-head">
      <button class="icon-btn" id="prev" aria-label="Mois précédent">${ARROW_L}</button>
      <h1>${cap(title)}</h1>
      <button class="icon-btn" id="next" aria-label="Mois suivant">${ARROW_R}</button>
      <button class="btn secondary small" id="now">Ce mois-ci</button>
    </div>
    <p class="muted small">${plural(active.length, 'séance')} · ${plural(taken, 'place')} occupée${taken > 1 ? 's' : ''} sur ${seats}${seats ? ` (${Math.round(taken / seats * 100)} %)` : ''}. Touchez un cours pour le détail, ou un numéro de jour pour la journée.</p>
    <div class="legend"><span class="l-open">Places libres</span><span class="l-high">Presque complet</span><span class="l-full">Complet</span></div>
    <div class="mgrid">${cells}</div>`;
  const shift = (n) => { const dt = new Date(y, mo - 1 + n, 1, 12); location.hash = `#/admin/mois?mois=${dt.getFullYear()}-${pad(dt.getMonth() + 1)}`; };
  $view.querySelector('#prev').onclick = () => shift(-1);
  $view.querySelector('#next').onclick = () => shift(1);
  $view.querySelector('#now').onclick = () => { location.hash = `#/admin/mois?mois=${today().slice(0, 7)}`; };
  $view.onclick = (e) => {
    const s = e.target.closest('[data-session]');
    if (s) { sessionDetailModal(Number(s.dataset.session), viewAdminMonth); return; }
    const d = e.target.closest('[data-day]');
    if (d) location.hash = `#/admin/jour?date=${d.dataset.day}`;
  };
}
const D_isMonday = (d) => new Date(d + 'T12:00:00').getDay() === 1;

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
      const full = list.length && list.every((s) => s.occupied >= s.capacity);
      const cls = ['d', list.length && 'has', full && 'full', !list.length && c && 'closed', ds === today() && 'today'].filter(Boolean).join(' ');
      const tip = c ? c.label : list.map((s) => `${s.start_time} ${s.title} (${s.occupied}/${s.capacity})`).join('\n');
      cells += `<div class="${cls}" data-day="${ds}" title="${esc(tip)}">${d}</div>`;
    }
    months += `<div class="month"><h3>${first.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}</h3><div class="month-grid">${cells}</div></div>`;
  }
  $view.innerHTML = `
    ${adminNav('#/admin')}
    ${planNav('#/admin/annee')}
    <div class="week-head">
      <button class="icon-btn" id="prev" aria-label="Année précédente"><svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg></button>
      <h1>Saison ${startYear}–${startYear + 1}</h1>
      <button class="icon-btn" id="next" aria-label="Année suivante"><svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg></button>
    </div>
    <p class="muted small">${plural(active.length, 'séance')} programmée${active.length > 1 ? 's' : ''} · ${plural(active.reduce((a, s) => a + s.occupied, 0), 'inscription')} · ${plural(data.closures.length, 'période')} de fermeture</p>
    <div class="legend"><span class="l-has">Cours</span><span class="l-full">Complet</span><span class="l-closed">Vacances / fermeture</span></div>
    <div class="year-grid">${months}</div>`;
  $view.querySelector('#prev').onclick = () => { location.hash = `#/admin/annee?annee=${startYear - 1}`; };
  $view.querySelector('#next').onclick = () => { location.hash = `#/admin/annee?annee=${startYear + 1}`; };
  $view.onclick = (e) => {
    const d = e.target.closest('[data-day]');
    if (d) location.hash = `#/admin/jour?date=${d.dataset.day}`;
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
    <div class="section-title"><h1 style="margin:0">Cours de la semaine</h1><button class="btn" id="add">+ Nouveau cours</button></div>
    <p class="muted small">Un cours régulier crée automatiquement une séance chaque semaine sur la période choisie, en sautant les vacances et jours fériés.</p>
    ${templates.length ? `<div class="card">${templates.map((t) => `
      <div class="list-item">
        <span class="dot" style="background:${esc(t.color)}"></span>
        <div class="grow">
          <strong>${esc(t.title)}</strong> ${t.active ? '' : '<span class="badge">Inactif</span>'}
          <div class="small muted">${DAYS[t.weekday]} ${hm(t.start_time)} · ${t.duration_min} min · ${t.capacity} places${t.location ? ` · ${esc(t.location)}` : ''}</div>
          <div class="small muted">Du ${fmtShort(t.start_date)} ${t.start_date.slice(0, 4)} au ${fmtShort(t.end_date)} ${t.end_date.slice(0, 4)} · ${plural(t.upcoming_sessions, 'séance')} à venir</div>
        </div>
        <div class="btn-row">
          <button class="btn small ${t.enrolled >= t.capacity ? 'secondary' : ''}" data-enrolled="${t.id}"><svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c2 .7 3.2 2.5 3.6 5.2"/></svg>${t.enrolled}/${t.capacity} à l’année</button>
          <button class="btn secondary small" data-edit="${t.id}">Modifier</button>
        </div>
      </div>`).join('')}</div>` : `<div class="empty card"><div class="big"></div>Aucun cours pour l'instant.<br>Commencez par créer vos cours de la semaine (ex. « Hatha yoga — mardi 18h30 »).</div>`}
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
    const en = e.target.closest('[data-enrolled]');
    if (en) enrollmentsModal(templates.find((t) => String(t.id) === en.dataset.enrolled), viewAdminTemplates);
  };
}

// Inscrit·es à l'année sur un créneau
async function enrollmentsModal(t, after) {
  const [{ enrollments }, { users }] = await Promise.all([api(`/api/admin/templates/${t.id}/enrollments`), api('/api/admin/users')]);
  const others = users.filter((u) => u.active && u.role !== 'admin' && !u.slots.length); // un cours par semaine
  modal(`
    <div class="modal-head"><h2>${esc(t.title)}</h2><button class="icon-btn" data-close aria-label="Fermer"><svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
    <p>${DAYS[t.weekday]} ${hm(t.start_time)} · <span class="badge plum">${enrollments.length} / ${t.capacity} inscrit·es à l’année</span></p>
    ${enrollments.length ? enrollments.map((e) => `<div class="list-item"><div class="grow"><strong>${esc(e.name)}</strong> ${e.status === 'pending' ? '<span class="badge warn">En attente de validation</span>' : '<span class="badge ok">Validé</span>'}<div class="small muted">${esc(e.email)}${e.phone ? ` · ${esc(e.phone)}` : ''} · depuis le ${fmtShort(e.start_date)}</div></div>
      <button class="btn ghost small" data-end="${e.id}">Retirer</button></div>`).join('') : '<p class="muted small">Personne pour le moment.</p>'}
    ${enrollments.length < t.capacity && others.length ? `<div class="btn-row" style="margin-top:14px">
      <select id="who" style="flex:1"><option value="">Inscrire un membre à l’année…</option>${others.map((u) => `<option value="${u.id}">${esc(u.name)}</option>`).join('')}</select>
      <button class="btn small" id="addenr">Inscrire</button></div><p class="small muted">L’élève est prévenu·e (alerte + e-mail) et doit valider son créneau. Sa place est gardée en attendant.</p>` : ''}
    ${enrollments.length ? `<p class="small" style="margin-top:14px"><a href="mailto:?bcc=${encodeURIComponent(enrollments.map((e) => e.email).join(','))}" class="mail"><svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3.5 7l8.5 6 8.5-6"/></svg>Écrire aux inscrit·es de ce créneau</a></p>` : ''}`, (m, close) => {
    const reopen = () => { close(); after && after(); enrollmentsModal(t, after); };
    const add = m.querySelector('#addenr');
    if (add) add.onclick = async () => {
      const uid = m.querySelector('#who').value;
      if (!uid) return;
      try { const r = await api(`/api/admin/templates/${t.id}/enrollments`, { method: 'POST', body: { user_id: Number(uid) } }); toast(`Inscrit·e à partir du ${fmtLong(r.start_date)} — en attente de validation`); reopen(); }
      catch (err) { toast(err.message, true); }
    };
    m.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-end]');
      if (!b) return;
      try { await api(`/api/admin/enrollments/${b.dataset.end}`, { method: 'DELETE' }); toast('Inscription à l’année terminée'); reopen(); }
      catch (err) { toast(err.message, true); }
    });
  });
}

function templateModal(t, after) {
  const d = seasonDefaults();
  const v = t || { title: '', description: '', weekday: 2, start_time: '18:30', duration_min: 75, capacity: 12, location: '', color: '#8e3b6b', start_date: d.start, end_date: d.end, active: 1 };
  modal(`
    <div class="modal-head"><h2>${t ? 'Modifier le cours' : 'Nouveau cours régulier'}</h2><button class="icon-btn" data-close aria-label="Fermer"><svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
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

const CLOSE_X = '<button class="icon-btn" data-close aria-label="Fermer"><svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>';

// Liste déroulante des créneaux, avec les places restantes à l'année
function slotOptions(templates, current) {
  const opts = templates.filter((t) => t.active).map((t) => {
    const left = t.capacity - t.enrolled + (t.id === current ? 1 : 0);
    const full = left <= 0;
    return `<option value="${t.id}" ${t.id === current ? 'selected' : ''} ${full ? 'disabled' : ''}>${DAYS[t.weekday]} ${hm(t.start_time)} — ${full ? 'complet' : plural(left, 'place')}</option>`;
  });
  return `<option value="">Pas de créneau pour l’instant</option>${opts.join('')}`;
}

function passwordModal(name, email, pw, sent) {
  modal(`
    <div class="modal-head"><h2>Compte prêt</h2>${CLOSE_X}</div>
    <p>Identifiants de <strong>${esc(name)}</strong> :</p>
    <div class="cred"><div><span class="small muted">E-mail</span><strong>${esc(email)}</strong></div>
      <div><span class="small muted">Mot de passe provisoire</span><strong class="pw">${esc(pw)}</strong></div></div>
    <p class="small muted">${sent ? 'Ces identifiants viennent d’être envoyés par e-mail.' : 'Transmettez-les à l’élève.'} Le mot de passe pourra être changé dans son profil.</p>
    <div class="btn-row" style="justify-content:flex-end">
      <button class="btn secondary" id="copy">Copier</button><button class="btn" data-close>Terminé</button></div>`, (m) => {
    m.querySelector('#copy').onclick = async () => {
      try { await navigator.clipboard.writeText(`Nada Atma\nE-mail : ${email}\nMot de passe : ${pw}\n${location.origin}`); toast('Copié'); }
      catch { toast('Copie impossible : notez le mot de passe', true); }
    };
  });
}

function newStudentModal(templates) {
  modal(`
    <div class="modal-head"><h2>Nouvel élève</h2>${CLOSE_X}</div>
    <form id="f">
      <div class="field"><label for="n-name">Prénom et nom</label><input id="n-name" name="name" required autocomplete="off"></div>
      <div class="field"><label for="n-email">E-mail</label><input id="n-email" name="email" type="email" required autocomplete="off"></div>
      <div class="field"><label for="n-phone">Téléphone</label><input id="n-phone" name="phone" type="tel" autocomplete="off"></div>
      <div class="field"><label for="n-slot">Cours de la semaine (à l’année)</label><select id="n-slot" name="template_id">${slotOptions(templates, null)}</select></div>
      <label class="check"><input type="checkbox" name="send_email" checked> Envoyer les identifiants par e-mail</label>
      <div class="btn-row" style="justify-content:flex-end;margin-top:16px">
        <button type="button" class="btn ghost" data-close>Annuler</button><button class="btn">Créer le compte</button></div>
    </form>`, (m, close) => {
    m.querySelector('#f').onsubmit = async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const body = { name: f.get('name'), email: f.get('email'), phone: f.get('phone'), template_id: Number(f.get('template_id')) || null, send_email: !!f.get('send_email') };
      try {
        const r = await api('/api/admin/users', { method: 'POST', body });
        close();
        await viewAdminUsers();
        passwordModal(r.user.name, r.user.email, r.temp_password, body.send_email);
      } catch (err) { toast(err.message, true); }
    };
  });
}

async function viewAdminUsers() {
  loading();
  const [{ users }, { templates }] = await Promise.all([api('/api/admin/users'), api('/api/admin/templates')]);
  const render = (term = '') => {
    const t = term.toLowerCase();
    const list = users.filter((u) => !t || u.name.toLowerCase().includes(t) || u.email.toLowerCase().includes(t));
    return list.map((u) => `
      <button class="list-item member-row" data-user="${u.id}">
        <span class="avatar">${esc(u.name.split(/\s+/).map((w) => w[0] || '').join('').slice(0, 2).toUpperCase())}</span>
        <span class="grow"><strong>${esc(u.name)}</strong> ${u.role === 'admin' ? '<span class="badge plum">Prof</span>' : ''} ${u.active ? '' : '<span class="badge danger">Désactivé</span>'}
          <span class="small ${u.slots.length ? '' : 'muted'}" style="display:block">${u.slots.length ? u.slots.map(esc).join(' · ') : 'Pas de créneau'}</span></span>
        <svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>
      </button>`).join('') || '<p class="muted">Aucun résultat.</p>';
  };
  $view.innerHTML = `
    ${adminNav('#/admin/membres')}
    <div class="section-title"><h1 style="margin:0">Élèves <span class="badge">${users.filter((u) => u.role !== 'admin').length}</span></h1><button class="btn" id="new">+ Nouvel élève</button></div>
    <input class="search" id="q" type="search" placeholder="Rechercher un nom ou un e-mail…" aria-label="Rechercher">
    <div class="card" id="list">${render()}</div>
    ${users.length ? `<p class="small"><a href="mailto:?bcc=${encodeURIComponent(users.filter((u) => u.active).map((u) => u.email).join(','))}" class="mail"><svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3.5 7l8.5 6 8.5-6"/></svg>Écrire à tous les élèves</a></p>` : ''}`;
  $view.querySelector('#q').oninput = (e) => { $view.querySelector('#list').innerHTML = render(e.target.value); };
  $view.querySelector('#new').onclick = () => newStudentModal(templates);
  $view.onclick = (e) => {
    const b = e.target.closest('[data-user]');
    if (!b) return;
    const u = users.find((x) => String(x.id) === b.dataset.user);
    const cur = templates.find((t) => u.slot_ids.includes(t.id));
    modal(`
      <div class="modal-head"><h2>${esc(u.name)}</h2>${CLOSE_X}</div>
      <p class="small">${esc(u.email)}${u.phone ? `<br><a href="tel:${esc(u.phone)}">${esc(u.phone)}</a>` : ''}</p>
      <div class="field"><label for="slot">Cours de la semaine (à l’année)</label><select id="slot">${slotOptions(templates, cur?.id || null)}</select></div>
      <div class="btn-row"><button class="btn" id="save">Enregistrer le créneau</button></div>
      <h3 style="margin-top:20px">Compte</h3>
      <div class="btn-row">
        <button class="btn secondary small" id="pw">Nouveau mot de passe</button>
        ${u.id !== state.user.id ? `<button class="btn ${u.active ? 'danger' : 'ok'} small" id="act">${u.active ? 'Désactiver' : 'Réactiver'}</button>` : ''}
      </div>`, (m, close) => {
      m.querySelector('#save').onclick = async () => {
        const id = Number(m.querySelector('#slot').value) || null;
        try {
          await api(`/api/admin/users/${u.id}/slot`, { method: 'PUT', body: { template_id: id } });
          close(); toast(id ? 'Créneau enregistré, l’élève est prévenu·e' : 'Créneau retiré'); viewAdminUsers();
        } catch (err) { toast(err.message, true); }
      };
      m.querySelector('#pw').onclick = async () => {
        if (!(await confirmBox(`Créer un nouveau mot de passe pour ${esc(u.name)} ? Il lui sera envoyé par e-mail.`, 'Créer'))) return;
        try { const r = await api(`/api/admin/users/${u.id}/password`, { method: 'POST', body: {} }); passwordModal(u.name, u.email, r.temp_password, true); }
        catch (err) { toast(err.message, true); }
      };
      const a = m.querySelector('#act');
      if (a) a.onclick = async () => {
        try { await api(`/api/admin/users/${u.id}`, { method: 'PUT', body: { active: !u.active } }); close(); toast('Compte mis à jour'); viewAdminUsers(); }
        catch (err) { toast(err.message, true); }
      };
    });
  };
}

async function viewAdminSettings() {
  loading();
  const [{ settings: s, sms_ready: smsReady }, { users }] = await Promise.all([api('/api/admin/settings'), api('/api/admin/users')]);
  const reach = users.filter((u) => u.active && u.role === 'member' && u.notify_sms !== false && u.phone.replace(/\D/g, '').length >= 9).length;
  const mode = s.sms_mode || 'all';
  const opt = (v, title, desc) => `<label class="radio-card ${mode === v ? 'on' : ''}"><input type="radio" name="sms_mode" value="${v}" ${mode === v ? 'checked' : ''}><span><strong>${title}</strong><span class="small muted">${desc}</span></span></label>`;
  $view.innerHTML = `
    ${adminNav('#/admin/reglages')}
    <h1>Réglages</h1>
    <form class="card" id="f">
      <h2>Alertes par SMS</h2>
      <p class="small ${smsReady ? 'sms-ok' : 'sms-off'}">${smsReady ? 'Les SMS sont branchés : ils partent au nom « NadaAtma ».' : 'Les SMS ne sont pas encore branchés : il faut ajouter la clé Brevo au serveur (voir le guide). En attendant, seuls les e-mails et les alertes de l’application partent.'}</p>
      <div class="radio-cards" role="radiogroup" aria-label="Quand envoyer un SMS">
        ${opt('all', 'Tout par SMS', 'Places libres, cours déplacés, ajoutés ou annulés, identifiants des nouveaux comptes.')}
        ${opt('changes', 'Changements de cours seulement', 'Cours déplacés, ajoutés ou annulés et identifiants. Les places libres restent par e-mail et dans l’application.')}
        ${opt('off', 'Jamais', 'Uniquement e-mails et alertes dans l’application.')}
      </div>
      <p class="small muted">${reach} élève${reach > 1 ? 's' : ''} recevr${reach > 1 ? 'aient' : 'ait'} les SMS (numéro renseigné, SMS acceptés). Une place libérée envoie un SMS à chacun·e : chaque SMS est facturé par Brevo, quelques centimes.</p>
      <h2 style="margin-top:22px">Général</h2>
      <div class="field"><label>Nom affiché</label><input name="studio_name" value="${esc(s.studio_name)}"></div>
      <div class="field"><label>Délai minimum pour annuler une place réservée (heures)</label><input type="number" min="0" name="cancel_deadline_hours" value="${esc(s.cancel_deadline_hours)}">
        <p class="small muted">Concerne les places libres prises ponctuellement. Annuler son cours habituel reste possible jusqu'au début du cours. 0 = toujours possible.</p></div>
      <div class="field"><label>Ouverture des réservations (jours à l'avance)</label><input type="number" min="0" name="booking_horizon_days" value="${esc(s.booking_horizon_days)}">
        <p class="small muted">Ex. 120 : on peut s'inscrire jusqu'à 4 mois à l'avance. 0 = sans limite (toute l'année).</p></div>
      <div class="field"><label>Nombre maximum de places libres réservées à l'avance par personne</label><input type="number" min="0" name="max_active_bookings" value="${esc(s.max_active_bookings)}">
        <p class="small muted">0 = illimité.</p></div>
      <button class="btn">Enregistrer</button>
    </form>`;
  const f = $view.querySelector('#f');
  f.querySelectorAll('input[name=sms_mode]').forEach((r) => { r.onchange = () => f.querySelectorAll('.radio-card').forEach((c) => c.classList.toggle('on', c.querySelector('input').checked)); });
  f.onsubmit = async (e) => {
    e.preventDefault();
    const body = formData(f); body.sms_mode = (f.querySelector('input[name=sms_mode]:checked') || {}).value;
    try { await api('/api/admin/settings', { method: 'PUT', body }); await refreshMe(); toast('Réglages enregistrés'); }
    catch (err) { toast(err.message, true); }
  };
}

// ---------- Démarrage ----------
async function refreshMe() {
  const r = await api('/api/me');
  state.user = r.user;
  state.settings = r.settings;
  state.enrollments = r.enrollments;
  state.unread = r.unread || 0;
  renderBell();
  document.title = `${r.settings.studio_name} — Réservations`;
}

window.addEventListener('hashchange', router);
(async () => {
  try { await refreshMe(); } catch { /* hors ligne */ }
  if (!location.hash) history.replaceState(null, '', '#/planning');
  router();
  setInterval(async () => {
    if (!state.user || document.hidden) return;
    try { const r = await api('/api/me'); state.unread = r.unread || 0; renderBell(); } catch { /* hors ligne */ }
  }, 60000);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
})();
