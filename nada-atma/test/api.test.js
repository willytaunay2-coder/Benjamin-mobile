'use strict';
process.env.TZ = 'Europe/Paris';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { openDb } = require('../lib/db');
const { createApp } = require('../lib/app');
const D = require('../lib/dates');

// Horloge figée : vendredi 4 septembre 2026, 10h
let NOW = new Date(2026, 8, 4, 10, 0);

const myBookings = (ss) => ss.filter((s) => s.my_status === 'booked').map((s) => ({ ...s, booking_id: s.my_booking_id }));

async function start() {
  const db = openDb(':memory:');
  const server = http.createServer(createApp(db, { now: () => NOW }));
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = () => {
    let cookie = '';
    return async (method, path, body) => {
      const res = await fetch(base + path, {
        method,
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: method === 'GET' ? undefined : JSON.stringify(body || {}),
      });
      const sc = res.headers.get('set-cookie');
      if (sc) cookie = sc.split(';')[0];
      return { status: res.status, data: await res.json() };
    };
  };
  return { db, server, client };
}

test('dates : jours fériés et Pâques', () => {
  assert.equal(D.easter(2027), '2027-03-28');
  assert.equal(D.publicHolidayName('2027-03-29'), 'Lundi de Pâques');
  assert.equal(D.publicHolidayName('2026-11-11'), 'Armistice 1918');
  assert.equal(D.publicHolidayName('2026-11-12'), null);
});

test('parcours complet : cours, vacances, réservation, déplacement', async (t) => {
  const { server, client } = await start();
  t.after(() => server.close());
  const admin = client(), alice = client(), bob = client();

  // Le premier compte devient admin
  let r = await admin('POST', '/api/register', { name: 'Prof', email: 'prof@example.com', password: 'motdepasse1' });
  assert.equal(r.data.user.role, 'admin');
  r = await alice('POST', '/api/register', { name: 'Alice', email: 'alice@example.com', password: 'motdepasse1' });
  assert.equal(r.data.user.role, 'member');
  await bob('POST', '/api/register', { name: 'Bob', email: 'bob@example.com', password: 'motdepasse1' });

  // Ancien fonctionnement (réservation libre) pour ce test : pas de crédit requis
  await admin('PUT', '/api/admin/settings', { makeup_requires_credit: false });

  // Un membre n'accède pas à l'admin
  assert.equal((await alice('GET', '/api/admin/users')).status, 403);

  // Vacances de la Toussaint avant création des cours
  r = await admin('POST', '/api/admin/closures', { label: 'Toussaint', start_date: '2026-10-17', end_date: '2026-11-01' });
  assert.equal(r.status, 200);

  // Cours du mercredi 18h30, 2 places, toute la saison
  r = await admin('POST', '/api/admin/templates', {
    title: 'Hatha yoga', weekday: 3, start_time: '18:30', duration_min: 75, capacity: 2,
    start_date: '2026-09-01', end_date: '2027-07-03',
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const created = r.data.generated.created;
  assert.ok(created > 35 && created < 44, `séances créées : ${created}`);

  const week = await alice('GET', '/api/sessions?from=2026-09-07&to=2026-09-13');
  assert.equal(week.data.sessions.length, 1);
  const s1 = week.data.sessions[0];
  assert.equal(s1.date, '2026-09-09');

  // Aucune séance pendant la Toussaint
  const tous = await alice('GET', '/api/sessions?from=2026-10-17&to=2026-11-01');
  assert.equal(tous.data.sessions.length, 0);
  assert.equal(tous.data.closures.length, 1);

  // Réservations et capacité
  assert.equal((await alice('POST', `/api/sessions/${s1.id}/book`)).status, 200);
  assert.equal((await alice('POST', `/api/sessions/${s1.id}/book`)).status, 409); // doublon
  assert.equal((await bob('POST', `/api/sessions/${s1.id}/book`)).status, 200);
  const carol = client();
  await carol('POST', '/api/register', { name: 'Carol', email: 'carol@example.com', password: 'motdepasse1' });
  r = await carol('POST', `/api/sessions/${s1.id}/book`);
  assert.equal(r.status, 409);
  assert.match(r.data.error, /complète/);

  // Non connecté : refus
  assert.equal((await client()('POST', `/api/sessions/${s1.id}/book`)).status, 401);

  // Déplacement d'Alice vers la semaine suivante
  const next = (await alice('GET', '/api/sessions?from=2026-09-14&to=2026-09-20')).data.sessions[0];
  let mine = myBookings((await alice('GET', '/api/my/sessions?from=2026-09-01&to=2027-07-31')).data.sessions);
  assert.equal(mine.length, 1);
  r = await alice('POST', `/api/bookings/${mine[0].booking_id}/move`, { target_session_id: next.id });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  mine = myBookings((await alice('GET', '/api/my/sessions?from=2026-09-01&to=2027-07-31')).data.sessions);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].date, '2026-09-16');
  // Une place s'est libérée pour Carol
  assert.equal((await carol('POST', `/api/sessions/${s1.id}/book`)).status, 200);

  // Bob ne peut pas annuler la réservation d'Alice
  assert.equal((await bob('POST', `/api/bookings/${mine[0].booking_id}/cancel`)).status, 404);

  // Délai d'annulation : à 2h de la séance, refus
  NOW = new Date(2026, 8, 16, 16, 30);
  r = await alice('POST', `/api/bookings/${mine[0].booking_id}/cancel`);
  assert.equal(r.status, 409);
  NOW = new Date(2026, 8, 4, 10, 0);
  assert.equal((await alice('POST', `/api/bookings/${mine[0].booking_id}/cancel`)).status, 200);

  // Fermeture ajoutée après coup : annule les séances, puis la suppression les rétablit
  const dec = (await alice('GET', '/api/sessions?from=2026-12-14&to=2026-12-20')).data.sessions[0];
  // ouverture des réservations limitée à 60 jours -> trop tôt
  await admin('PUT', '/api/admin/settings', { booking_horizon_days: 60 });
  r = await alice('POST', `/api/sessions/${dec.id}/book`);
  assert.equal(r.status, 409);
  assert.match(r.data.error, /ouvrent/);
  await admin('PUT', '/api/admin/settings', { booking_horizon_days: 0 });
  assert.equal((await alice('POST', `/api/sessions/${dec.id}/book`)).status, 200);
  r = await admin('POST', '/api/admin/closures', { label: 'Noël', start_date: '2026-12-14', end_date: '2027-01-03' });
  assert.equal(r.data.sessions_cancelled, 3);
  assert.equal(r.data.bookings_affected, 1);
  mine = myBookings((await alice('GET', '/api/my/sessions?from=2026-09-01&to=2027-07-31')).data.sessions);
  assert.equal(mine[0].cancelled, true);
  // Alice déplace sa réservation d'une séance annulée
  const jan = (await alice('GET', '/api/sessions?from=2027-01-04&to=2027-01-10')).data.sessions[0];
  assert.equal((await alice('POST', `/api/bookings/${mine[0].booking_id}/move`, { target_session_id: jan.id })).status, 200);
  r = await admin('DELETE', `/api/admin/closures/${r.data.closure.id}`);
  assert.equal(r.data.sessions_restored, 3);

  // Séance ponctuelle + admin inscrit un membre
  r = await admin('POST', '/api/admin/sessions', { title: 'Atelier respiration', date: '2026-09-26', start_time: '10:00', duration_min: 120, capacity: 8 });
  assert.equal(r.status, 200);
  const users = (await admin('GET', '/api/admin/users')).data.users;
  const bobId = users.find((u) => u.name === 'Bob').id;
  assert.equal((await admin('POST', `/api/admin/sessions/${r.data.session.id}/attendees`, { user_id: bobId })).status, 200);
  const detail = await admin('GET', `/api/admin/sessions/${r.data.session.id}`);
  assert.equal(detail.data.attendees.length, 1);

  // Limite de réservations à venir
  await admin('PUT', '/api/admin/settings', { max_active_bookings: 1 });
  r = await alice('POST', `/api/sessions/${r.data.session.id}/book`);
  assert.equal(r.status, 409);
  assert.match(r.data.error, /limite/);
});

test('sécurité : JSON requis et mot de passe vérifié', async (t) => {
  const { server, client } = await start();
  t.after(() => server.close());
  const a = client();
  await a('POST', '/api/register', { name: 'A', email: 'a@example.com', password: 'motdepasse1' });
  const b = client();
  assert.equal((await b('POST', '/api/login', { email: 'a@example.com', password: 'mauvais' })).status, 401);
  assert.equal((await b('POST', '/api/login', { email: 'A@example.com', password: 'motdepasse1' })).status, 200);
  const addr = server.address();
  const res = await fetch(`http://127.0.0.1:${addr.port}/api/logout`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'x' });
  assert.equal(res.status, 415);
});

test('créneau à l\'année : libérer sa place, rattrapage, reprendre sa place', async (t) => {
  NOW = new Date(2026, 8, 4, 10, 0);
  const { server, client } = await start();
  t.after(() => server.close());
  const admin = client(), alice = client(), bob = client(), carol = client();
  await admin('POST', '/api/register', { name: 'Prof', email: 'prof@example.com', password: 'motdepasse1' });
  await alice('POST', '/api/register', { name: 'Alice', email: 'alice@example.com', password: 'motdepasse1' });
  await bob('POST', '/api/register', { name: 'Bob', email: 'bob@example.com', password: 'motdepasse1' });
  await carol('POST', '/api/register', { name: 'Carol', email: 'carol@example.com', password: 'motdepasse1' });

  // Deux créneaux de 2 places : mardi et jeudi
  const mar = (await admin('POST', '/api/admin/templates', { title: 'Hatha', weekday: 2, start_time: '18:30', duration_min: 75, capacity: 2, start_date: '2026-09-01', end_date: '2027-06-30' })).data.template;
  const jeu = (await admin('POST', '/api/admin/templates', { title: 'Doux', weekday: 4, start_time: '10:00', duration_min: 75, capacity: 2, start_date: '2026-09-01', end_date: '2027-06-30' })).data.template;

  // Inscriptions à l'année
  assert.equal((await alice('POST', `/api/templates/${mar.id}/enroll`)).status, 200);
  assert.equal((await bob('POST', `/api/templates/${mar.id}/enroll`)).status, 200);
  let r = await carol('POST', `/api/templates/${mar.id}/enroll`);
  assert.equal(r.status, 409); // créneau complet
  assert.equal((await carol('POST', `/api/templates/${jeu.id}/enroll`)).status, 200);

  let tpl = (await carol('GET', '/api/templates')).data.templates;
  assert.equal(tpl.find((x) => x.id === mar.id).free, 0);
  assert.equal(tpl.find((x) => x.id === jeu.id).free, 1);

  // Mardi 8 sept : complet (Alice + Bob), Alice y est attendue
  let week = (await alice('GET', '/api/sessions?from=2026-09-07&to=2026-09-13')).data.sessions;
  const tue = week.find((s) => s.date === '2026-09-08'), thu = week.find((s) => s.date === '2026-09-10');
  assert.equal(tue.my_status, 'enrolled');
  assert.equal(tue.spots_left, 0);
  assert.equal(thu.spots_left, 1);

  // Carol (jeudi) ne peut pas réserver mardi : complet, et pas de crédit
  r = await carol('POST', `/api/sessions/${tue.id}/book`);
  assert.equal(r.status, 409);

  // Alice ne vient pas mardi : sa place se libère, elle gagne 1 rattrapage
  r = await alice('POST', `/api/sessions/${tue.id}/release`);
  assert.equal(r.status, 200);
  assert.equal(r.data.with_credit, true);
  assert.equal(r.data.credits, 1);
  week = (await carol('GET', '/api/sessions?from=2026-09-07&to=2026-09-13')).data.sessions;
  assert.equal(week.find((s) => s.id === tue.id).spots_left, 1);

  // Carol n'a pas de crédit : refus
  r = await carol('POST', `/api/sessions/${tue.id}/book`);
  assert.equal(r.status, 409);
  assert.match(r.data.error, /rattrapage/);

  // Alice utilise son rattrapage le jeudi
  r = await alice('POST', `/api/sessions/${thu.id}/book`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.credits, 0);
  // plus de crédit pour une 2e réservation
  const thu2 = (await alice('GET', '/api/sessions?from=2026-09-17&to=2026-09-17')).data.sessions[0];
  assert.equal((await alice('POST', `/api/sessions/${thu2.id}/book`)).status, 409);

  // Carol reçoit un crédit de l'admin puis prend la place libérée par Alice
  const users = (await admin('GET', '/api/admin/users')).data.users;
  const carolId = users.find((u) => u.name === 'Carol').id;
  assert.equal((await admin('POST', `/api/admin/users/${carolId}/credits`, { delta: 1 })).data.credits, 1);
  assert.equal((await carol('POST', `/api/sessions/${tue.id}/book`)).status, 200);

  // Alice veut revenir mardi : sa place a été prise
  r = await alice('POST', `/api/sessions/${tue.id}/unrelease`);
  assert.equal(r.status, 409);
  assert.match(r.data.error, /prise/);

  // Détail admin de la séance : Bob (année) + Carol (rattrapage), Alice absente
  const d = (await admin('GET', `/api/admin/sessions/${tue.id}`)).data;
  assert.deepEqual(d.attendees.map((a) => a.name + ':' + a.kind).sort(), ['Bob:regular', 'Carol:makeup']);
  assert.deepEqual(d.absent.map((a) => a.name), ['Alice']);

  // Déplacer en une fois : Bob déplace son mardi 15 vers le jeudi 17 (place libre)
  const tue15 = (await bob('GET', '/api/sessions?from=2026-09-15&to=2026-09-15')).data.sessions[0];
  r = await bob('POST', `/api/sessions/${tue15.id}/swap`, { target_session_id: thu2.id });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.session.my_status, 'booked');
  assert.equal(r.data.credits, 0);
  // Bob revient sur son créneau : le swap inverse annule l'absence
  r = await bob('POST', `/api/sessions/${thu2.id}/swap`, { target_session_id: tue15.id });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.session.my_status, 'enrolled');

  // Libérer trop tard : pas de crédit
  NOW = new Date(2026, 8, 22, 15, 0); // 3h30 avant le mardi 22 18h30
  const tue22 = (await bob('GET', '/api/sessions?from=2026-09-22&to=2026-09-22')).data.sessions[0];
  r = await bob('POST', `/api/sessions/${tue22.id}/release`);
  assert.equal(r.data.with_credit, false);
  assert.equal(r.data.credits, 0);

  // Séance annulée par la prof : crédit pour les inscrits à l'année
  NOW = new Date(2026, 8, 4, 10, 0);
  const tue29 = (await admin('GET', '/api/sessions?from=2026-09-29&to=2026-09-29')).data.sessions[0];
  await admin('PUT', `/api/admin/sessions/${tue29.id}`, { cancelled: true, cancel_reason: 'Prof absente' });
  assert.equal((await bob('GET', '/api/me')).data.credits, 1);
  // ... mais pas pour les vacances
  await admin('POST', '/api/admin/closures', { label: 'Toussaint', start_date: '2026-10-17', end_date: '2026-11-01' });
  assert.equal((await bob('GET', '/api/me')).data.credits, 1);

  // Fin d'inscription par l'admin
  const enr = (await admin('GET', `/api/admin/templates/${mar.id}/enrollments`)).data.enrollments;
  assert.equal(enr.length, 2);
  assert.equal((await admin('DELETE', `/api/admin/enrollments/${enr[0].id}`)).status, 200);
  assert.equal((await admin('GET', `/api/admin/templates/${mar.id}/enrollments`)).data.enrollments.length, 1);
});
