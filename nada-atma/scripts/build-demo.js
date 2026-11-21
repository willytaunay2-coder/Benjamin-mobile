// Construit la version d'essai autonome (une seule page HTML) : élève + professeure, sans serveur.
// Usage : node scripts/build-demo.js [sortie.html]
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const OUT = process.argv[2] || path.join(ROOT, 'demo', 'nada-atma-essai.html');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const dataUri = (p, type) => `data:${type};base64,${fs.readFileSync(path.join(ROOT, p)).toString('base64')}`;
const safe = (js) => js.replace(/<\/script/gi, '<\\/script');

const LOGO = dataUri('public/logo.png', 'image/png');
const LOGO_CLAIR = dataUri('public/logo-clair.png', 'image/png');

// Styles de l'application (images intégrées)
const css = read('public/styles.css')
  .replaceAll('url(/logo-clair.png)', `url(${LOGO_CLAIR})`)
  .replaceAll('url(/logo.png)', 'var(--logo-img)');
// Logo défini une seule fois (il revient plusieurs fois dans les styles)
const cssLogo = `:root { --logo-img: url(${LOGO}); }`;

// Corps de index.html (sans le script)
const indexHtml = read('public/index.html');
const body = indexHtml.slice(indexHtml.indexOf('<body>') + 6, indexHtml.indexOf('<script src="/app.js"></script>'))
  .replace('src="/logo.png"', `src="${LOGO}"`);

// Application : navigation interne (la page tourne dans un cadre), pas de service worker
let app = read('public/app.js');
const swaps = [
  ["window.addEventListener('hashchange', router);", 'NAV.onchange = router;'],
  ["history.replaceState(null, '', '#/planning')", "NAV.replace('#/planning')"],
  ["history.replaceState(null, '', h)", 'NAV.replace(h)'],
  ["if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});", ''],
  ['${location.origin}', 'Application Nada Atma'],
  ['<img src="/logo.png"', `<img src="${LOGO}"`],
];
for (const [a, b] of swaps) {
  if (!app.includes(a)) throw new Error('Motif introuvable dans app.js : ' + a);
  app = app.replaceAll(a, b);
}
app = app.replaceAll('location.hash', 'NAV.hash');
app = `window.startNadaApp = function () {\n${app}\nreturn { state, refreshMe, router, renderNav, toast };\n};`;

// Serveur : chaque fichier de lib/ devient un module
const mods = ['dates', 'db', 'app'].map((m) =>
  `${JSON.stringify('./' + m)}: function (module, exports, require, __dirname) {\n${read('lib/' + m + '.js')}\n}`).join(',\n');
const modules = `window.DEMO_MODULES = {\n${mods}\n};`;

const html = `<title>Nada Atma Réservations</title>
<meta name="claude:viewport-fit-sides" content="cover">
<meta name="theme-color" content="#cdd3ea">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Comfortaa:wght@400;600;700&family=Josefin+Sans:wght@600;700&family=Kalam:wght@700&display=swap" rel="stylesheet">
<style>
${cssLogo}
${css}
${read('demo/shell.css')}
</style>
${read('demo/shell.html').replaceAll('{{LOGO_CLAIR}}', LOGO_CLAIR).replaceAll('{{LOGO}}', LOGO)}
${body}
<script src="https://cdn.jsdelivr.net/npm/sql.js@1.10.3/dist/sql-asm.js"></script>
<script>${safe(modules)}</script>
<script>${safe(read('demo/runtime.js'))}</script>
<script>
const NAV = { h: '', onchange: null,
  get hash() { return this.h; },
  set hash(v) { if (v === this.h) return; this.h = v; setTimeout(() => this.onchange && this.onchange(), 0); },
  replace(v) { this.h = v; } };
${safe(app)}
</script>
<script>${safe(read('demo/shell.js'))}</script>
`;
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html);
console.log(`Démo écrite : ${OUT} (${Math.round(html.length / 1024)} Ko)`);
