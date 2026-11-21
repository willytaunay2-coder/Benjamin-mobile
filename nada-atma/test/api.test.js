'use strict';
process.env.TZ = 'Europe/Paris';
process.env.MAIL_SILENT = '1';
process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { openDb } = require('../lib/db');
const { createApp } = require('../lib/app');
const { createMailer } = require('../lib/mailer');
const { createSms, toInternational, gsmText } = require('../lib/sms');
const D = require('../lib/dates');

// Horloge figée : vendredi 4 septembre 2026, 10h
let NOW = new Date(2026, 8, 4, 10, 0);

const myBookings = (ss) => ss.filter((s) => s.my_status === 'booked').map((s) => ({ ...s, booking_id: s.my_booking_id }));

async function start() {
  const db = openDb(':memory:');
  const mailer = createMailer({ MAIL_SILENT: '1' });
  const sms = createSms({ SMS_SILENT: '1' });
  const server = http.createServer(createApp(db, { now: () => NOW, mailer, sms, appUrl: 'https://resa.example' }));
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
  return { db, server, client, mailer, sms };
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
  assert.ok(profNotifs.some((n) => /Alice annule sa venue/.test(n.title)));

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

  // Changement de créneau habituel : mardi → jeudi, à partir du lundi 14 septembre
  r = await admin('PUT', `/api/admin/users/${uid}/slot`, { template_id: jeu.id, from: '2026-09-14' });
  assert.equal(r.status, 200);
  assert.equal(r.data.start_date, '2026-09-14');
  me = (await eve('GET', '/api/me')).data;
  // le mardi jusqu'au 13, puis le jeudi
  assert.deepEqual(me.enrollments.map((e) => [e.weekday, e.start_date, e.end_date]), [[2, '2026-09-04', '2026-09-13'], [4, '2026-09-14', null]]);
  const st = async (d) => (await eve('GET', `/api/sessions?from=${d}&to=${d}`)).data.sessions[0].my_status;
  assert.equal(await st('2026-09-08'), 'enrolled'); // encore le mardi cette semaine
  assert.equal(await st('2026-09-10'), null);
  assert.equal(await st('2026-09-15'), null);       // plus le mardi ensuite
  assert.equal(await st('2026-09-17'), 'enrolled'); // le jeudi désormais
  assert.match((await eve('GET', '/api/notifications')).data.notifications[0].body, /jeudi 12h15 à partir du lundi 14 septembre/);
  assert.equal((await admin('PUT', `/api/admin/users/${uid}/slot`, { template_id: mar.id, from: 'demain' })).status, 400);

  // Nouveau mot de passe : l'ancienne session est fermée
  r = await admin('POST', `/api/admin/users/${uid}/password`, { send_email: false });
  assert.equal((await eve('GET', '/api/me')).data.user, null);
  assert.equal((await eve('POST', '/api/login', { email: 'eve@example.com', password: r.data.temp_password })).status, 200);
});

test('un cours par semaine : pas de deuxième inscription la même semaine', async (t) => {
  NOW = new Date(2026, 8, 4, 10, 0); // vendredi 4 septembre 2026
  const { server, client } = await start();
  t.after(() => server.close());
  const admin = client(), alice = client(), bob = client(), eve = client();
  await admin('POST', '/api/register', { name: 'Prof', email: 'prof@example.com', password: 'motdepasse1' });
  await admin('PUT', '/api/admin/settings', { booking_horizon_days: 0 });
  const mar = (await admin('POST', '/api/admin/templates', { title: 'Yoga', weekday: 2, start_time: '19:00', duration_min: 60, capacity: 2, start_date: '2026-09-01', end_date: '2026-12-31' })).data.template;
  const jeu = (await admin('POST', '/api/admin/templates', { title: 'Yoga', weekday: 4, start_time: '18:30', duration_min: 60, capacity: 2, start_date: '2026-09-01', end_date: '2026-12-31' })).data.template;
  const login = async (c, name, slot) => {
    const r = await admin('POST', '/api/admin/users', { name, email: `${name.toLowerCase()}@example.com`, template_id: slot, send_email: false });
    await c('POST', '/api/login', { email: `${name.toLowerCase()}@example.com`, password: r.data.temp_password });
  };
  await login(alice, 'Alice', mar.id);
  await login(bob, 'Bob', jeu.id);
  await login(eve, 'Eve', null);
  const s = (await admin('GET', '/api/sessions?from=2026-09-07&to=2026-09-13')).data.sessions;
  const tue = s.find((x) => x.date === '2026-09-08'), thu = s.find((x) => x.date === '2026-09-10');

  // Alice a son cours mardi : impossible de s'inscrire jeudi la même semaine
  let r = await alice('POST', `/api/sessions/${thu.id}/book`);
  assert.equal(r.status, 409);
  assert.match(r.data.error, /Un cours par semaine : vous êtes déjà inscrit·e le mardi 8 septembre à 19h/);
  // Elle annule mardi : elle peut prendre jeudi
  assert.equal((await alice('POST', `/api/sessions/${tue.id}/release`)).status, 200);
  // Bob a déjà son cours jeudi cette semaine : inutile de le prévenir ; Eve, sans cours, l'est
  assert.ok(!(await bob('GET', '/api/notifications')).data.notifications.some((n) => /Une place est libre mardi 8/.test(n.title)));
  assert.ok((await eve('GET', '/api/notifications')).data.notifications.some((n) => /Une place est libre mardi 8/.test(n.title)));
  assert.equal((await alice('POST', `/api/sessions/${thu.id}/book`)).status, 200);
  // …mais ne peut plus reprendre mardi tant qu'elle est inscrite jeudi
  r = await alice('POST', `/api/sessions/${tue.id}/unrelease`);
  assert.equal(r.status, 409);
  assert.match(r.data.error, /jeudi 10 septembre à 18h30/);

  // Eve (sans créneau) : une place libre par semaine
  assert.equal((await eve('POST', `/api/sessions/${tue.id}/book`)).status, 200);
  // La professeure est prévenue de l'inscription
  const profN = (await admin('GET', '/api/notifications')).data.notifications;
  assert.ok(profN.some((n) => n.title === 'Eve s’inscrit mardi 8 septembre à 19h' && /1 \/ 2 places occupées/.test(n.body) && n.link === '#/admin/jour?date=2026-09-08'));
  assert.equal((await eve('POST', `/api/sessions/${thu.id}/book`)).status, 409);
  // La semaine suivante, c'est de nouveau possible
  const thu2 = (await admin('GET', '/api/sessions?from=2026-09-17&to=2026-09-17')).data.sessions[0];
  assert.equal((await eve('POST', `/api/sessions/${thu2.id}/book`)).status, 200);

  // La professeure ne s'inscrit pas elle-même aux cours
  r = await admin('POST', `/api/sessions/${thu2.id}/book`);
  assert.equal(r.status, 403);
  assert.match(r.data.error, /La professeure ne s’inscrit pas aux cours/);

  // La professeure peut faire une exception
  const bobId = (await bob('GET', '/api/me')).data.user.id;
  const tue2 = (await admin('GET', '/api/sessions?from=2026-09-15&to=2026-09-15')).data.sessions[0];
  assert.equal((await admin('POST', `/api/admin/sessions/${tue2.id}/attendees`, { user_id: bobId })).status, 200);
});

test('alertes par SMS : places libres, changements, préférence de chaque élève', async (t) => {
  assert.equal(toInternational('06 12 34 56 78'), '33612345678');
  assert.equal(toInternational('+32 470 12 34 56'), '32470123456');
  assert.equal(toInternational('12'), '');
  assert.equal(gsmText('Une place est libre jeudi · « vite » — l’appli'), 'Une place est libre jeudi - "vite" - l\'appli');

  NOW = new Date(2026, 8, 4, 10, 0);
  const { server, client, sms } = await start();
  t.after(() => server.close());
  const admin = client(), alice = client(), bob = client(), carol = client();
  await admin('POST', '/api/register', { name: 'Prof', email: 'prof@example.com', password: 'motdepasse1' });
  assert.equal((await admin('GET', '/api/admin/settings')).data.settings.sms_mode, 'off'); // payant : désactivé par défaut
  await admin('PUT', '/api/admin/settings', { sms_mode: 'all' });
  const mar = (await admin('POST', '/api/admin/templates', { title: 'Yoga', weekday: 2, start_time: '19:00', duration_min: 60, capacity: 2, start_date: '2026-09-01', end_date: '2026-12-31' })).data.template;
  const make = async (c, name, phone, slot) => {
    const r = await admin('POST', '/api/admin/users', { name, email: `${name.toLowerCase()}@example.com`, phone, template_id: slot });
    await c('POST', '/api/login', { email: `${name.toLowerCase()}@example.com`, password: r.data.temp_password });
  };
  await make(alice, 'Alice', '06 11 11 11 11', mar.id);
  await make(bob, 'Bob', '06 22 22 22 22', null);
  await make(carol, 'Carol', '', null); // pas de numéro : pas de SMS
  await new Promise((r) => setTimeout(r, 30));
  // Identifiants envoyés aussi par SMS
  assert.ok(sms.sent.some((m) => m.to === '33611111111' && /votre compte est pret/.test(m.text) && /mardi 19h/.test(m.text)));
  sms.sent.length = 0;

  // Alice annule : Bob reçoit un SMS (Carol n'a pas de numéro)
  const tue = (await admin('GET', '/api/sessions?from=2026-09-08&to=2026-09-08')).data.sessions[0];
  await alice('POST', `/api/sessions/${tue.id}/release`);
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(sms.sent.map((m) => m.to), ['33622222222']);
  assert.match(sms.sent[0].text, /^Nada Atma : Une place est libre mardi 8 septembre à 19h\. Inscrivez-vous dans l'appli https:\/\/resa\.example\/#\/planning/);
  assert.ok(sms.sent[0].text.length <= 160);
  sms.sent.length = 0;

  // Réglage « changements seulement » : pas de SMS pour une place libre, mais un pour un cours déplacé
  assert.equal((await admin('PUT', '/api/admin/settings', { sms_mode: 'changes' })).status, 200);
  await alice('POST', `/api/sessions/${tue.id}/unrelease`);
  await alice('POST', `/api/sessions/${tue.id}/release`);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(sms.sent.length, 0);
  await alice('POST', `/api/sessions/${tue.id}/unrelease`);
  await admin('PUT', `/api/admin/sessions/${tue.id}`, { start_time: '19:30' });
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(sms.sent.some((m) => m.to === '33611111111' && /deplacee|déplacée/.test(m.text)));
  sms.sent.length = 0;

  // Bob ne veut pas de SMS
  assert.equal((await bob('PUT', '/api/me', { notify_sms: false })).data.user.notify_sms, false);
  await admin('PUT', '/api/admin/settings', { sms_mode: 'all' });
  await alice('POST', `/api/sessions/${tue.id}/release`);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(sms.sent.length, 0);
  // Réglage « jamais »
  assert.equal((await admin('GET', '/api/admin/settings')).data.settings.sms_mode, 'all');
});

// Déchiffrement côté téléphone (RFC 8291), écrit à part pour vérifier ce que le serveur envoie
const nodeCrypto = require('node:crypto');
function decryptPush(buf, ua, authSecret) {
  const hmac = (k, d) => nodeCrypto.createHmac('sha256', k).update(d).digest();
  const salt = buf.subarray(0, 16), idlen = buf[20], keyid = buf.subarray(21, 21 + idlen), data = buf.subarray(21 + idlen);
  const ikm = hmac(hmac(authSecret, ua.computeSecret(keyid)), Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), keyid, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: aes128gcm\0'), Buffer.from([1])])).subarray(0, 16);
  const nonce = hmac(prk, Buffer.concat([Buffer.from('Content-Encoding: nonce\0'), Buffer.from([1])])).subarray(0, 12);
  const d = nodeCrypto.createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(data.subarray(data.length - 16));
  const plain = Buffer.concat([d.update(data.subarray(0, data.length - 16)), d.final()]);
  assert.equal(plain[plain.length - 1], 2); // dernier bloc
  return JSON.parse(plain.subarray(0, plain.length - 1).toString());
}

test('notifications sur le téléphone (Web Push) : chiffrées, signées, gratuites', async (t) => {
  NOW = new Date(2026, 8, 4, 10, 0);
  // Faux service de notifications (celui d'Apple ou de Google en vrai)
  const received = []; let answer = 201;
  const pushSrv = http.createServer((req, res) => {
    const chunks = []; req.on('data', (c) => chunks.push(c));
    req.on('end', () => { received.push({ url: req.url, headers: req.headers, body: Buffer.concat(chunks) }); res.writeHead(answer); res.end(); });
  });
  await new Promise((r) => pushSrv.listen(0, r));
  t.after(() => pushSrv.close());
  const pushBase = `http://127.0.0.1:${pushSrv.address().port}`;

  const { server, client } = await start();
  t.after(() => server.close());
  const admin = client(), alice = client(), bob = client();
  await admin('POST', '/api/register', { name: 'Prof', email: 'prof@example.com', password: 'motdepasse1' });
  const mar = (await admin('POST', '/api/admin/templates', { title: 'Yoga', weekday: 2, start_time: '19:00', duration_min: 60, capacity: 2, start_date: '2026-09-01', end_date: '2026-12-31' })).data.template;
  for (const [c, name, slot] of [[alice, 'Alice', mar.id], [bob, 'Bob', null]]) {
    const r = await admin('POST', '/api/admin/users', { name, email: `${name.toLowerCase()}@example.com`, template_id: slot, send_email: false });
    await c('POST', '/api/login', { email: `${name.toLowerCase()}@example.com`, password: r.data.temp_password });
  }
  // Le téléphone de Bob s'abonne
  const { publicKey } = (await bob('GET', '/api/push/key')).data;
  assert.equal(Buffer.from(publicKey, 'base64url').length, 65);
  const ua = nodeCrypto.createECDH('prime256v1'); ua.generateKeys();
  const auth = nodeCrypto.randomBytes(16);
  const sub = { endpoint: `${pushBase}/bob-phone`, keys: { p256dh: ua.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } };
  assert.equal((await bob('POST', '/api/push/subscribe', sub)).status, 200);
  assert.equal((await bob('POST', '/api/push/subscribe', { ...sub, endpoint: 'ftp://x' })).status, 400);

  // Alice annule : le téléphone de Bob reçoit la notification
  const tue = (await admin('GET', '/api/sessions?from=2026-09-08&to=2026-09-08')).data.sessions[0];
  await alice('POST', `/api/sessions/${tue.id}/release`);
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(received.length, 1);
  const got = received[0];
  assert.equal(got.url, '/bob-phone');
  assert.equal(got.headers['content-encoding'], 'aes128gcm');
  assert.ok(Number(got.headers.ttl) > 0);
  const msg = decryptPush(got.body, ua, auth);
  assert.equal(msg.title, 'Une place est libre mardi 8 septembre à 19h');
  assert.match(msg.url, /^\/#\/planning\?semaine=2026-09-07$/);
  // Signature VAPID valide, pour ce service
  const [, jwt, k] = /^vapid t=([^,]+), k=(.+)$/.exec(got.headers.authorization);
  assert.equal(k, publicKey);
  const [h, c, sig] = jwt.split('.');
  assert.equal(JSON.parse(Buffer.from(c, 'base64url')).aud, pushBase);
  const raw = Buffer.from(k, 'base64url');
  const pub = nodeCrypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: raw.subarray(1, 33).toString('base64url'), y: raw.subarray(33).toString('base64url') }, format: 'jwk' });
  assert.ok(nodeCrypto.verify('sha256', Buffer.from(`${h}.${c}`), { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url')));

  // Téléphone désinstallé (réponse 410) : l'abonnement est supprimé
  answer = 410;
  assert.equal((await bob('POST', '/api/push/test')).data.devices, 1);
  await new Promise((r) => setTimeout(r, 200));
  assert.equal((await bob('POST', '/api/push/test')).data.devices, 0);
  // La clé privée n'est jamais exposée dans les réglages
  assert.ok(!JSON.stringify((await admin('GET', '/api/admin/settings')).data).includes('vapid'));
});

test('liste d’attente : par ordre de demande, ordre modifiable par la professeure, inscription automatique', async (t) => {
  NOW = new Date(2026, 8, 4, 10, 0);
  const { server, client } = await start();
  t.after(() => server.close());
  const admin = client();
  await admin('POST', '/api/register', { name: 'Prof', email: 'prof@example.com', password: 'motdepasse1' });
  await admin('PUT', '/api/admin/settings', { booking_horizon_days: 0 });
  const mar = (await admin('POST', '/api/admin/templates', { title: 'Yoga', weekday: 2, start_time: '19:00', duration_min: 60, capacity: 2, start_date: '2026-09-01', end_date: '2026-12-31' })).data.template;
  const jeu = (await admin('POST', '/api/admin/templates', { title: 'Yoga', weekday: 4, start_time: '18:30', duration_min: 60, capacity: 2, start_date: '2026-09-01', end_date: '2026-12-31' })).data.template;
  const C = {}, ID = {};
  for (const [name, slot] of [['Alice', mar.id], ['Dan', mar.id], ['Bob', jeu.id], ['Eve', null], ['Fay', null]]) {
    C[name] = client();
    const r = await admin('POST', '/api/admin/users', { name, email: `${name.toLowerCase()}@example.com`, template_id: slot, send_email: false });
    ID[name] = r.data.user.id;
    await C[name]('POST', '/api/login', { email: `${name.toLowerCase()}@example.com`, password: r.data.temp_password });
  }
  const tue = (await admin('GET', '/api/sessions?from=2026-09-08&to=2026-09-08')).data.sessions[0];
  // Complet : on ne peut pas s'inscrire, mais on peut rejoindre la liste
  assert.equal((await C.Eve('POST', `/api/sessions/${tue.id}/book`)).status, 409);
  let r = await C.Eve('POST', `/api/sessions/${tue.id}/waitlist`);
  assert.equal(r.status, 200); assert.equal(r.data.position, 1);
  assert.equal((await C.Fay('POST', `/api/sessions/${tue.id}/waitlist`)).data.position, 2);
  assert.equal((await C.Fay('POST', `/api/sessions/${tue.id}/waitlist`)).status, 409);
  assert.match((await C.Bob('POST', `/api/sessions/${tue.id}/waitlist`)).data.error, /Un cours par semaine/); // Bob a son jeudi
  assert.equal((await admin('POST', `/api/sessions/${tue.id}/waitlist`)).status, 403);
  const seen = (await C.Fay('GET', '/api/sessions?from=2026-09-08&to=2026-09-08')).data.sessions[0];
  assert.equal(seen.my_wait_pos, 2); assert.equal(seen.waiting_count, 2);
  assert.ok((await admin('GET', '/api/notifications')).data.notifications.some((n) => /Eve en liste d’attente mardi 8 septembre/.test(n.title)));

  // La professeure change l'ordre : Fay passe devant
  r = await admin('PUT', `/api/admin/sessions/${tue.id}/waitlist`, { user_ids: [ID.Fay, ID.Eve] });
  assert.deepEqual(r.data.waiting.map((w) => w.name), ['Fay', 'Eve']);
  assert.equal((await admin('PUT', `/api/admin/sessions/${tue.id}/waitlist`, { user_ids: [ID.Fay] })).status, 409);

  // Alice annule : Fay est inscrite d'office, Eve devient n° 1, personne d'autre n'est alerté
  await C.Alice('POST', `/api/sessions/${tue.id}/release`);
  let s = (await C.Fay('GET', '/api/sessions?from=2026-09-08&to=2026-09-08')).data.sessions[0];
  assert.equal(s.my_status, 'booked'); assert.equal(s.my_wait_pos, null);
  assert.match((await C.Fay('GET', '/api/notifications')).data.notifications[0].title, /Vous êtes inscrit·e mardi 8 septembre à 19h/);
  assert.equal((await C.Eve('GET', '/api/sessions?from=2026-09-08&to=2026-09-08')).data.sessions[0].my_wait_pos, 1);
  assert.ok(!(await C.Eve('GET', '/api/notifications')).data.notifications.some((n) => /Une place est libre/.test(n.title)));
  const profN = (await admin('GET', '/api/notifications')).data.notifications.map((n) => n.title);
  assert.ok(profN.includes('Fay passe de la liste d’attente au cours du mardi 8 septembre à 19h'));
  assert.ok(profN.includes('Alice annule sa venue'));

  // Fay annule à son tour : Eve est inscrite
  await C.Fay('POST', `/api/bookings/${s.my_booking_id}/cancel`);
  s = (await C.Eve('GET', '/api/sessions?from=2026-09-08&to=2026-09-08')).data.sessions[0];
  assert.equal(s.my_status, 'booked'); assert.equal(s.waiting_count, 0);

  // La professeure peut ajouter puis retirer quelqu'un ; une place en plus profite à la liste
  await admin('POST', `/api/admin/sessions/${tue.id}/waitlist`, { user_id: ID.Fay });
  assert.equal((await admin('POST', `/api/admin/sessions/${tue.id}/waitlist/remove`, { user_id: ID.Fay })).data.waiting.length, 0);
  await admin('POST', `/api/admin/sessions/${tue.id}/waitlist`, { user_id: ID.Fay });
  await admin('PUT', `/api/admin/sessions/${tue.id}`, { capacity: 3, notify: false });
  assert.equal((await C.Fay('GET', '/api/sessions?from=2026-09-08&to=2026-09-08')).data.sessions[0].my_status, 'booked');
});
