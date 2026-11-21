'use strict';
process.env.TZ = 'Europe/Paris';
process.env.MAIL_SILENT = '1';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { openDb } = require('../lib/db');
const { createApp } = require('../lib/app');
const { createMailer } = require('../lib/mailer');
const D = require('../lib/dates');

// Horloge figée : vendredi 4 septembre 2026, 10h
let NOW = new Date(2026, 8, 4, 10, 0);

const myBookings = (ss) => ss.filter((s) => s.my_status === 'booked').map((s) => ({ ...s, booking_id: s.my_booking_id }));

async function start() {
  const db = openDb(':memory:');
  const mailer = createMailer({ MAIL_SILENT: '1' });
  const server = http.createServer(createApp(db, { now: () => NOW, mailer }));
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
  return { db, server, client, mailer };
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

test('abonnement : un créneau par personne, préférences, répartition, place libérée sans rattrapage', async (t) => {
  NOW = new Date(2026, 8, 4, 10, 0);
  const { server, client } = await start();
  t.after(() => server.close());
  const admin = client();
  await admin('POST', '/api/register', { name: 'Prof', email: 'prof@example.com', password: 'motdepasse1' });
  const c = {}, id = {};
  for (const n of ['Alice', 'Bob', 'Carol', 'Dan']) {
    c[n] = client();
    id[n] = (await c[n]('POST', '/api/register', { name: n, email: n.toLowerCase() + '@example.com', password: 'motdepasse1' })).data.user.id;
  }
  // Deux créneaux de 2 places
  const mar = (await admin('POST', '/api/admin/templates', { title: 'Yoga', weekday: 2, start_time: '19:00', duration_min: 60, capacity: 2, start_date: '2026-09-01', end_date: '2027-06-30' })).data.template;
  const jeu = (await admin('POST', '/api/admin/templates', { title: 'Yoga', weekday: 4, start_time: '12:15', duration_min: 60, capacity: 2, start_date: '2026-09-01', end_date: '2027-06-30' })).data.template;

  // Préférences, dans l'ordre d'arrivée : tout le monde veut le mardi d'abord
  for (const n of ['Alice', 'Bob', 'Carol']) {
    assert.equal((await c[n]('PUT', '/api/my/preferences', { template_ids: [mar.id, jeu.id] })).status, 200);
    await new Promise((res) => setTimeout(res, 1100)); // horodatage à la seconde
  }
  assert.equal((await c.Dan('PUT', '/api/my/preferences', { template_ids: [mar.id, mar.id] })).status, 400);

  // Proposition : Alice et Bob mardi (1er choix), Carol jeudi (2e choix), Dan sans préférence
  const prop = (await admin('POST', '/api/admin/assignments/propose')).data.proposals;
  const by = Object.fromEntries(prop.map((p) => [p.user_id, p]));
  assert.equal(by[id.Alice].template_id, mar.id);
  assert.equal(by[id.Bob].template_id, mar.id);
  assert.equal(by[id.Carol].template_id, jeu.id);
  assert.equal(by[id.Carol].choice, 2);
  assert.equal(by[id.Dan], undefined);
  let r = await admin('POST', '/api/admin/assignments/apply', { assignments: prop });
  assert.equal(r.data.done, 3);
  assert.equal((await c.Alice('GET', '/api/me')).data.enrollments[0].status, 'pending');

  // Un abonnement = un seul créneau par semaine
  r = await admin('POST', `/api/admin/templates/${jeu.id}/enrollments`, { user_id: id.Alice });
  assert.equal(r.status, 409);
  assert.match(r.data.error, /un cours par semaine/);

  // Alice ne vient pas mardi 8 : la place se libère, pas de rattrapage, Dan peut la prendre
  const tue = (await c.Alice('GET', '/api/sessions?from=2026-09-08&to=2026-09-08')).data.sessions[0];
  assert.equal(tue.spots_left, 0);
  r = await c.Alice('POST', `/api/sessions/${tue.id}/release`);
  assert.equal(r.status, 200);
  assert.equal((await c.Dan('GET', '/api/notifications')).data.notifications[0].kind, 'place');
  assert.equal((await c.Dan('POST', `/api/sessions/${tue.id}/book`)).status, 200); // aucun crédit requis
  // Alice ne peut plus revenir : sa place est prise
  assert.equal((await c.Alice('POST', `/api/sessions/${tue.id}/unrelease`)).status, 409);
  // Une place libérée puis reprise par soi-même fonctionne si personne ne l'a prise
  const tue15 = (await c.Bob('GET', '/api/sessions?from=2026-09-15&to=2026-09-15')).data.sessions[0];
  await c.Bob('POST', `/api/sessions/${tue15.id}/release`);
  assert.equal((await c.Bob('POST', `/api/sessions/${tue15.id}/unrelease`)).status, 200);
});

test('inscription d\'office à valider + alerte « place libre » à tous les élèves', async (t) => {
  NOW = new Date(2026, 8, 4, 10, 0);
  const { server, client, mailer } = await start();
  t.after(() => server.close());
  const admin = client(), alice = client(), bob = client(), carol = client();
  await admin('POST', '/api/register', { name: 'Prof', email: 'prof@example.com', password: 'motdepasse1' });
  const ids = {};
  for (const [c, n] of [[alice, 'Alice'], [bob, 'Bob'], [carol, 'Carol']]) ids[n] = (await c('POST', '/api/register', { name: n, email: n.toLowerCase() + '@example.com', password: 'motdepasse1' })).data.user.id;
  await bob('PUT', '/api/me', { notify_email: false }); // Bob ne veut pas d'e-mails
  const mar = (await admin('POST', '/api/admin/templates', { title: 'Yoga', weekday: 2, start_time: '19:00', duration_min: 60, capacity: 2, start_date: '2026-09-01', end_date: '2027-06-30' })).data.template;
  const jeu = (await admin('POST', '/api/admin/templates', { title: 'Yoga', weekday: 4, start_time: '12:15', duration_min: 60, capacity: 2, start_date: '2026-09-01', end_date: '2027-06-30' })).data.template;

  // Inscription d'office : en attente de validation, l'élève est prévenu
  let r = await admin('POST', `/api/admin/templates/${mar.id}/enrollments`, { user_id: ids.Alice, pending: true });
  assert.equal(r.data.status, 'pending');
  await admin('POST', `/api/admin/templates/${mar.id}/enrollments`, { user_id: ids.Bob, pending: true });
  await admin('POST', `/api/admin/templates/${jeu.id}/enrollments`, { user_id: ids.Carol, pending: true });
  let me = (await alice('GET', '/api/me')).data;
  assert.equal(me.enrollments[0].status, 'pending');
  assert.equal(me.unread, 1);
  assert.ok(mailer.sent.some((m) => m.to === 'alice@example.com' && /mardi 19h/.test(m.subject)));
  // La place est gardée pendant l'attente : le créneau est complet
  const tue = (await alice('GET', '/api/sessions?from=2026-09-08&to=2026-09-08')).data.sessions[0];
  assert.equal(tue.spots_left, 0);

  // Alice valide ; Carol refuse son créneau
  assert.equal((await alice('POST', `/api/enrollments/${me.enrollments[0].id}/accept`)).data.enrollments[0].status, 'confirmed');
  const cEnr = (await carol('GET', '/api/me')).data.enrollments[0];
  assert.equal((await carol('POST', `/api/enrollments/${cEnr.id}/decline`)).status, 200);
  assert.equal((await carol('GET', '/api/me')).data.enrollments.length, 0);
  assert.equal((await alice('POST', `/api/enrollments/${me.enrollments[0].id}/accept`)).status, 409); // déjà validée

  // Alice ne vient pas : Carol (pas sur ce cours) et Bob ? Bob est inscrit au cours -> pas prévenu
  mailer.sent.length = 0;
  await alice('POST', `/api/sessions/${tue.id}/release`);
  await new Promise((res) => setTimeout(res, 20));
  const carolNotifs = (await carol('GET', '/api/notifications')).data;
  assert.equal(carolNotifs.notifications[0].kind, 'place');
  assert.match(carolNotifs.notifications[0].title, /Une place est libre mardi 8 septembre à 19h/);
  const bobNotifs = (await bob('GET', '/api/notifications')).data.notifications;
  assert.ok(!bobNotifs.some((n) => n.kind === 'place'));
  assert.deepEqual(mailer.sent.map((m) => m.to), ['carol@example.com']); // Alice exclue, Bob déjà inscrit
  const profNotifs = (await admin('GET', '/api/notifications')).data.notifications;
  assert.ok(profNotifs.some((n) => /Alice libère sa place/.test(n.title)));

  // Marquer comme lu
  await carol('POST', '/api/notifications/read');
  assert.equal((await carol('GET', '/api/me')).data.unread, 0);
});

test('déplacer / ajouter une séance prévient tout le monde ; feuille d\'appel du jour', async (t) => {
  NOW = new Date(2026, 8, 4, 10, 0);
  const { server, client, mailer } = await start();
  t.after(() => server.close());
  const admin = client(), alice = client(), bob = client();
  await admin('POST', '/api/register', { name: 'Prof', email: 'prof@example.com', password: 'motdepasse1' });
  const aId = (await alice('POST', '/api/register', { name: 'Alice', email: 'alice@example.com', password: 'motdepasse1' })).data.user.id;
  await bob('POST', '/api/register', { name: 'Bob', email: 'bob@example.com', password: 'motdepasse1' });
  const mar = (await admin('POST', '/api/admin/templates', { title: 'Yoga', weekday: 2, start_time: '19:00', duration_min: 60, capacity: 10, start_date: '2026-09-01', end_date: '2027-06-30' })).data.template;
  await admin('POST', `/api/admin/templates/${mar.id}/enrollments`, { user_id: aId, confirmed: true });
  const tue = (await admin('GET', '/api/sessions?from=2026-09-08&to=2026-09-08')).data.sessions[0];

  // Déplacer au mercredi 9 à 18h : Alice (concernée) et Bob (les autres) sont prévenus
  mailer.sent.length = 0;
  let r = await admin('PUT', `/api/admin/sessions/${tue.id}`, { date: '2026-09-09', start_time: '18:00' });
  assert.equal(r.status, 200);
  assert.equal(r.data.notified, 2);
  const an = (await alice('GET', '/api/notifications')).data.notifications[0];
  assert.match(an.title, /Votre séance est déplacée : mercredi 9 septembre à 18h/);
  assert.match((await bob('GET', '/api/notifications')).data.notifications[0].title, /Séance déplacée/);
  // Alice garde sa place sur la séance déplacée
  const moved = (await alice('GET', '/api/sessions?from=2026-09-09&to=2026-09-09')).data.sessions[0];
  assert.equal(moved.my_status, 'enrolled');
  await new Promise((res) => setTimeout(res, 20));
  assert.equal(mailer.sent.length, 2);

  // Ajouter une séance : tout le monde est prévenu
  r = await admin('POST', '/api/admin/sessions', { title: 'Yoga du son', date: '2026-09-12', start_time: '10:00', duration_min: 90, capacity: 8 });
  assert.equal(r.data.notified, 2);
  assert.match((await bob('GET', '/api/notifications')).data.notifications[0].title, /Nouvelle séance samedi 12 septembre à 10h/);
  // Sans prévenir
  r = await admin('POST', '/api/admin/sessions', { title: 'Test', date: '2026-09-13', start_time: '10:00', duration_min: 60, capacity: 8, notify: false });
  assert.equal(r.data.notified, 0);

  // Feuille d'appel du mercredi 9
  const day = (await admin('GET', '/api/admin/day?date=2026-09-09')).data;
  assert.equal(day.sessions.length, 1);
  assert.deepEqual(day.sessions[0].attendees.map((a) => a.name), ['Alice']);
  assert.equal((await alice('GET', '/api/admin/day?date=2026-09-09')).status, 403);
});

test('la professeure crée un compte élève avec son créneau, le change, réinitialise le mot de passe', async (t) => {
  NOW = new Date(2026, 8, 4, 10, 0);
  const { server, client, mailer } = await start();
  t.after(() => server.close());
  const admin = client(), eve = client();
  await admin('POST', '/api/register', { name: 'Prof', email: 'prof@example.com', password: 'motdepasse1' });
  const mar = (await admin('POST', '/api/admin/templates', { title: 'Yoga', weekday: 2, start_time: '19:00', duration_min: 60, capacity: 2, start_date: '2026-09-01', end_date: '2027-06-30' })).data.template;
  const jeu = (await admin('POST', '/api/admin/templates', { title: 'Yoga', weekday: 4, start_time: '12:15', duration_min: 60, capacity: 2, start_date: '2026-09-01', end_date: '2027-06-30' })).data.template;

  let r = await admin('POST', '/api/admin/users', { name: 'Ève', email: 'Eve@example.com', phone: '0601020304', template_id: mar.id });
  assert.equal(r.status, 200);
  assert.match(r.data.temp_password, /^[a-z0-9]{5}-[a-z0-9]{5}$/);
  assert.equal(r.data.start_date, '2026-09-04');
  const uid = r.data.user.id;
  await new Promise((res) => setTimeout(res, 20));
  assert.ok(mailer.sent.some((m) => m.to === 'eve@example.com' && m.text.includes(r.data.temp_password) && /mardi 19h/.test(m.text)));
  assert.equal((await admin('POST', '/api/admin/users', { name: 'X', email: 'eve@example.com' })).status, 409);
  assert.equal((await eve('POST', '/api/admin/users', { name: 'X', email: 'x@example.com' })).status, 401);

  // L'élève se connecte : son créneau est déjà validé
  assert.equal((await eve('POST', '/api/login', { email: 'eve@example.com', password: r.data.temp_password })).status, 200);
  let me = (await eve('GET', '/api/me')).data;
  assert.equal(me.enrollments.length, 1);
  assert.equal(me.enrollments[0].status, 'confirmed');

  // Changement de créneau : mardi → jeudi
  r = await admin('PUT', `/api/admin/users/${uid}/slot`, { template_id: jeu.id });
  assert.equal(r.status, 200);
  me = (await eve('GET', '/api/me')).data;
  assert.deepEqual(me.enrollments.map((e) => e.weekday), [4]);
  const thu = (await eve('GET', '/api/sessions?from=2026-09-10&to=2026-09-10')).data.sessions[0];
  assert.equal(thu.my_status, 'enrolled');

  // Nouveau mot de passe : l'ancienne session est fermée
  r = await admin('POST', `/api/admin/users/${uid}/password`, { send_email: false });
  assert.equal((await eve('GET', '/api/me')).data.user, null);
  assert.equal((await eve('POST', '/api/login', { email: 'eve@example.com', password: r.data.temp_password })).status, 200);
});
