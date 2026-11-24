# Régénérer le guide de la professeure (PDF)

1. `npm run demo` (construit `demo/nada-atma-essai.html`).
2. `node scripts/guide/captures.js demo/nada-atma-essai.html <dossier>/img <chemin vers sql-asm.js de sql.js 1.10.3>` :
   captures iPhone de tous les écrans (Playwright).
3. Convertir les captures en JPEG 780 px de large dans `<dossier>/jpg`, et noter la couleur du haut de chaque
   capture dans `<dossier>/top.json` (barre d'état du téléphone).
4. `node scripts/guide/guide-pdf.js <dossier> ../documents/Nada-Atma-guide-de-la-professeure.pdf public/logo.png public/logo-clair.png`.
