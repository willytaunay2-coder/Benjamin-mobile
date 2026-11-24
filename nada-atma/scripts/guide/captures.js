// Captures pour le guide de la professeure (iPhone, sans le bandeau de démo)
const { chromium, devices } = require('playwright');
const fs = require('fs');
const [FILE, OUT, SQLJS] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch({ args: ['--lang=fr-FR'], env: { ...process.env, LANG: 'fr_FR.UTF-8' } });
  const p = await (await b.newContext({ ...devices['iPhone 13'], locale: 'fr-FR', timezoneId: 'Europe/Paris' })).newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.addInitScript(() => addEventListener('DOMContentLoaded', () => { const e = document.createElement('style'); e.textContent = '#demo-bar{display:none!important}.toast{display:none!important}'; document.head.appendChild(e); }));
  await p.route('https://cdn.jsdelivr.net/**', (r) => r.fulfill({ body: fs.readFileSync(SQLJS), contentType: 'application/javascript' }));
  const html = fs.readFileSync(FILE, 'utf8');
  await p.route('http://demo.local/', (r) => r.fulfill({ body: `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>${html}</body></html>`, contentType: 'text/html' }));
  await p.goto('http://demo.local/'); await p.waitForSelector('#demo-as-prof:not([disabled])', { timeout: 120000 });
  const shot = async (name) => { await sleep(450); await p.screenshot({ path: `${OUT}/${name}.png` }); console.log('→', name); };
  const go = async (h, sel) => { await p.evaluate((h) => { NAV.hash = h; scrollTo(0, 0); }, h); await p.waitForSelector('#view ' + sel, { state: 'attached' }); await sleep(350); };
  const click = (sel, i = 0) => p.evaluate(([s, n]) => document.querySelectorAll(s)[n].click(), [sel, i]);
  const closeModal = async () => { await p.evaluate(() => { const c = document.querySelector('.modal [data-close]'); if (c) c.click(); }); await sleep(250); };
  const scrollModal = (sel) => p.evaluate((sel) => { const el = document.querySelector('.modal ' + sel); if (el) el.scrollIntoView({ block: 'center' }); }, sel);
  const frame = (sel) => p.evaluate((sel) => { const el = document.querySelector(sel); const d = el.closest('section.day') || el; scrollTo(0, d.getBoundingClientRect().top + scrollY - 90); }, sel);

  // ---------- Professeure ----------
  await p.click('#demo-as-prof'); await p.waitForSelector('.rate-card');
  await shot('p-semaine');
  await frame('.wait-count'); await shot('p-semaine-cours');
  await go('#/admin/jour', '.day-card'); await shot('p-jour');
  await go('#/admin/mois', '.mgrid'); await p.evaluate(() => scrollTo(0, 180)); await shot('p-mois');
  await go('#/admin/annee', '.year-grid'); await shot('p-annee');
  // Séance avec liste d'attente
  await go('#/admin', '[data-session]');
  await p.evaluate(() => document.querySelector('.wait-count').closest('[data-session]').click()); await p.waitForSelector('.modal .waitlist');
  await shot('p-seance'); await scrollModal('.waitlist'); await shot('p-seance-attente');
  await click('.modal [data-wmove="1"][data-dir="-1"]'); await p.waitForSelector('#ok'); await shot('p-attente-confirm'); await closeModal();
  await go('#/admin', '[data-session]'); await click('[data-session]', 1); await p.waitForSelector('.modal #edit'); await click('.modal #edit'); await p.waitForSelector('input[name=start_time]'); await shot('p-deplacer'); await closeModal();
  await click('#add'); await p.waitForSelector('.modal input[name=title]'); await shot('p-ajouter'); await closeModal();
  await go('#/admin/appel?date=' + (await p.evaluate(() => { const d = new Date(); const t = d.getDay(); const add = t <= 2 ? 2 - t : 9 - t; d.setDate(d.getDate() + add); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })), '.sheet'); await shot('p-appel');
  // Cours
  await go('#/admin/cours', '[data-edit]'); await shot('p-cours');
  await click('[data-edit]'); await p.waitForSelector('#t-from'); await shot('p-cours-modifier'); await scrollModal('#t-from'); await shot('p-cours-modifier-bas'); await closeModal();
  await go('#/admin/cours', '[data-edit]'); await click('[data-enrolled]', 1); await sleep(800); await shot('p-cours-inscrits'); await closeModal();
  // Vacances
  await go('#/admin/fermetures', '#f'); await shot('p-vacances');
  await p.evaluate(() => { const el = document.querySelector('#view .card:nth-of-type(2)'); if (el) el.scrollIntoView({ block: 'start' }); scrollBy(0, -80); }); await shot('p-vacances-bas');
  const extra = await p.$('[data-extra]');
  if (extra) { await extra.evaluate((e) => e.click()); await p.waitForSelector('.modal .holiday-hint:not([hidden])', { timeout: 5000 }).catch(() => {}); await sleep(500); await scrollModal('.holiday-hint'); await shot('p-exceptionnel'); await closeModal(); }
  // Élèves
  await go('#/admin/membres', '#new'); await shot('p-eleves');
  await click('#new'); await p.waitForSelector('#n-name'); await p.fill('#n-name', 'Léon Martin'); await p.fill('#n-email', 'leon.martin@exemple.fr'); await p.fill('#n-phone', '06 11 22 33 44'); await sleep(200); await shot('p-nouvel-eleve');
  await click('#f button:not([type=button])'); await p.waitForSelector('.cred'); await shot('p-compte-pret'); await closeModal();
  const kid = await p.evaluate(() => NADA_DEMO.db.prepare("SELECT id FROM users WHERE email = 'katia.picquet@exemple.fr'").get().id);
  await go('#/admin/membres', '[data-user]'); await p.evaluate((id) => document.querySelector(`[data-user="${id}"]`).click(), kid); await p.waitForSelector('#contact-edit'); await shot('p-fiche');
  await scrollModal('#slot-block'); await shot('p-fiche-creneau'); await closeModal();
  await go('#/admin/membres', '[data-plan]'); await click('[data-plan="drop_in"]'); await sleep(300); await click('#list [data-user]'); await p.waitForSelector('.count-grid'); await shot('p-fiche-seance'); await closeModal();
  await go('#/alertes', 'h1'); await shot('p-alertes');
  await go('#/admin/reglages', '.radio-cards'); await shot('p-reglages');
  await go('#/profil', '.push-card'); await p.evaluate(() => { const c = document.querySelector('.push-card'); const h = c.querySelector('h2').outerHTML; c.innerHTML = h + '<p class="push-state on">Activées sur ce téléphone.</p><p class="small muted">Vous êtes prévenu·e dès qu’une place se libère ou qu’un cours change, comme par SMS, gratuitement.</p><div class="btn-row"><button type="button" class="btn secondary small">Envoyer un essai</button><button type="button" class="btn ghost small">Désactiver</button></div>'; }); await shot('p-profil');
  await go('#/installer', '.install-page'); await shot('installer-iphone');
  await click('[data-os="android"]'); await sleep(300); await shot('installer-android');

  // ---------- Élève (Katia) ----------
  await p.evaluate(() => document.getElementById('demo-switch').click()); await p.waitForSelector('.greeting');
  await go('#/planning', '.greeting'); await shot('e-planning');
  await frame('[data-manage]'); await shot('e-planning-cours');
  await click('[data-manage]'); await p.waitForSelector('#release'); await shot('e-annuler');
  await click('#release'); await sleep(900);
  const book = await p.$('#view [data-book]');
  if (book) { await frame('[data-book]'); await shot('e-place-libre'); await book.evaluate((e) => e.click()); await p.waitForSelector('#confirm-book'); await shot('e-sinscrire'); await closeModal(); }
  const wait = await p.$('#view [data-wait]');
  if (wait) { await wait.evaluate((e) => e.click()); await p.waitForSelector('#confirm-wait'); await shot('e-attente'); await closeModal(); }
  await go('#/alertes', 'h1'); await shot('e-alertes');
  await go('#/profil', '.push-card'); await p.evaluate(() => { const c = document.querySelector('.push-card'); const h = c.querySelector('h2').outerHTML; c.innerHTML = h + '<p class="push-state on">Activées sur ce téléphone.</p><p class="small muted">Vous êtes prévenu·e dès qu’une place se libère ou qu’un cours change, comme par SMS, gratuitement.</p><div class="btn-row"><button type="button" class="btn secondary small">Envoyer un essai</button><button type="button" class="btn ghost small">Désactiver</button></div>'; }); await shot('e-profil');
  console.log('erreurs :', errs.length ? errs : 'aucune');
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
