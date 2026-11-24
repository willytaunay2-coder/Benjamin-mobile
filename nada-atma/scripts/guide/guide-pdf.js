// Guide de la professeure (A4 portrait, PDF) à partir des captures de l'application
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const [DIR, OUT, LOGO, LOGO_CLAIR] = process.argv.slice(2);
const TOP = JSON.parse(fs.readFileSync(path.join(DIR, 'top.json'), 'utf8'));
const img = (n) => 'file://' + path.join(DIR, 'jpg', n + '.jpg');
const bar = (n) => `<div class="sb" style="background:${TOP[n] || '#fff'}"><span>9:41</span><i class="island"></i><span class="ic"><svg viewBox="0 0 18 12"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="5" y="5.5" width="3" height="6.5" rx="1"/><rect x="10" y="3" width="3" height="9" rx="1"/><rect x="15" y="0" width="3" height="12" rx="1"/></svg><svg viewBox="0 0 26 12"><rect x=".5" y=".5" width="22" height="11" rx="3" fill="none" stroke="currentColor" opacity=".45"/><rect x="2" y="2" width="17" height="8" rx="1.8"/></svg></span></div>`;
const phone = (n, cap) => `<figure class="phone-fig"><div class="phone">${bar(n)}<img src="${img(n)}" alt=""></div>${cap ? `<figcaption>${cap}</figcaption>` : ''}</figure>`;
const phones = (list) => `<div class="phones n${list.length}">${list.map(([n, c]) => phone(n, c)).join('')}</div>`;
const steps = (list) => `<ol class="steps">${list.map((s) => `<li>${s}</li>`).join('')}</ol>`;
const tip = (title, body, kind = '') => `<div class="tip ${kind}"><strong>${title}</strong><div>${body}</div></div>`;
const check = (list) => `<ul class="check">${list.map((s) => `<li>${s}</li>`).join('')}</ul>`;

let pageNo = 0;
const page = (kicker, title, body, cls = '') => { pageNo++; return `<section class="page ${cls}"><header class="ph"><span class="kicker">${kicker}</span><h2>${title}</h2></header>${body}<footer class="pf"><span>Nada Atma · Guide de la professeure</span><span>${pageNo}</span></footer></section>`; };
const divider = (n, title, sub) => { pageNo++; return `<section class="page divider"><img src="file://${LOGO_CLAIR}" alt="" class="dv-logo"><div><p class="dv-n">Partie ${n}</p><h2>${title}</h2><p class="dv-sub">${sub}</p></div><footer class="pf"><span></span><span>${pageNo}</span></footer></section>`; };

const P = [];
// ---------- Couverture ----------
pageNo++;
P.push(`<section class="page cover"><img src="file://${LOGO_CLAIR}" alt="" class="cv-logo">
  <p class="cv-brand">Nada Atma</p><p class="cv-tag">En harmonies…</p>
  <h1>Votre application de réservation</h1>
  <p class="cv-lead">Guide de la professeure</p>
  <p class="cv-meta">Tout ce qu’il faut pour gérer vos cours, vos élèves et votre planning depuis votre téléphone : pas à pas, avec les écrans.</p></section>`);

// ---------- L'essentiel ----------
P.push(page('Pour commencer', 'L’essentiel en une minute', `
  <div class="grid2">
    <div class="card"><h3>Pour vos élèves</h3>${check([
      'Chaque élève a <b>son cours de la semaine</b> (formule à l’année) ou vient <b>à la séance</b>.',
      'Un empêchement ? Elle ou il <b>annule</b> dans l’application : la place est proposée aux autres, <b>sans rattrapage</b>.',
      'Une place se libère ? Les élèves disponibles sont prévenus et <b>s’inscrivent</b> en un geste.',
      'Cours complet ? <b>Liste d’attente</b> : la première personne est inscrite automatiquement.',
      '<b>Un seul cours par semaine</b> pour les élèves à l’année.'])}</div>
    <div class="card"><h3>Pour vous</h3>${check([
      'Votre <b>planning</b> en jour, semaine, mois ou année, avec le <b>taux de remplissage</b>.',
      'Vous <b>créez les comptes</b> et envoyez les identifiants <b>par texto</b> depuis votre téléphone.',
      'Vous <b>déplacez</b> ou <b>ajoutez</b> une séance : tout le monde est prévenu.',
      'Les <b>vacances</b> sont retirées du planning ; vous pouvez quand même ajouter un cours exceptionnel.',
      'La <b>feuille d’appel</b> de chaque jour, prête à imprimer.'])}</div>
  </div>
  <div class="card soft"><h3>Ce qui se fait tout seul</h3>${check([
    'Les <b>notifications</b> sur le téléphone des élèves (gratuites) : place libre, cours déplacé, ajouté ou annulé, vacances.',
    'Les <b>alertes</b> dans la cloche, pour vous aussi : qui annule, qui s’inscrit, qui attend.',
    'Les séances de toute la saison, <b>hors vacances et jours fériés</b>.',
    'La <b>sauvegarde</b> de toutes les données, chaque nuit.'])}</div>
  <h3 class="toc-h">Sommaire</h3>
  <ol class="toc">
    <li><span>Démarrer : connexion, installer l’application</span></li>
    <li><span>Préparer la saison : cours, vacances, élèves</span></li>
    <li><span>Au quotidien : planning, séances, liste d’attente, appel</span></li>
    <li><span>Vos élèves : fiche, créneau, à la séance, mot de passe</span></li>
    <li><span>Ce que voient vos élèves</span></li>
    <li><span>Ce à quoi penser · Questions fréquentes · À transmettre aux élèves</span></li>
  </ol>`));

// ---------- Partie 1 ----------
P.push(divider(1, 'Démarrer', 'Votre première connexion et l’application sur votre téléphone'));
P.push(page('Démarrer', 'Votre première connexion', `
  ${phones([['connexion', 'L’écran de connexion'], ['p-profil', 'Profil : notifications et mot de passe']])}
  ${steps([
    'Ouvrez l’adresse de l’application que l’on vous a donnée (elle commence par <b>https://</b>).',
    'Entrez votre <b>e-mail</b> et le <b>mot de passe provisoire</b> reçu. « Afficher » permet de vérifier ce que vous tapez.',
    'Allez dans <b>Profil</b> › <b>Changer de mot de passe</b> : choisissez le vôtre (8 caractères au moins, une phrase facile à retenir est idéale).',
    'Toujours dans <b>Profil</b> : <b>Activer les notifications</b> pour être prévenue quand une élève annule, s’inscrit ou attend.'])}
  ${tip('Votre compte est précieux', 'C’est le seul compte qui peut tout modifier. Ne le partagez pas, et gardez votre téléphone verrouillé. Après 5 erreurs de mot de passe, le compte se bloque 15 minutes : c’est une protection, pas une panne.', 'warn')}`));
P.push(page('Démarrer', 'Installer l’application sur votre téléphone', `
  ${phones([['installer-iphone', 'Sur iPhone'], ['installer-android', 'Sur Android']])}
  ${steps([
    '<b>iPhone</b> : ouvrez l’adresse dans <b>Safari</b>, touchez <b>Partager</b> (le carré avec une flèche), puis <b>« Sur l’écran d’accueil »</b> et <b>« Ajouter »</b>.',
    '<b>Android</b> : dans <b>Chrome</b>, menu <b>⋮</b> › <b>« Installer l’application »</b>.',
    'Ouvrez <b>Nada Atma</b> depuis la nouvelle icône, et <b>connectez-vous à nouveau</b> (l’application installée a sa propre connexion).'])}
  ${tip('Bon à savoir', 'Ce guide d’installation existe aussi dans l’application : lien « Installer l’application sur mon téléphone » sous la connexion, et dans le texto de bienvenue de chaque élève. L’application se met à jour toute seule.')}`));

// ---------- Partie 2 ----------
P.push(divider(2, 'Préparer la saison', 'Vos cours, les vacances, vos élèves : à faire une fois, avant la rentrée'));
P.push(page('Préparer la saison', 'La liste avant la rentrée', `
  ${check([
    '<b>Vérifier vos cours</b> (onglet Cours) : jour, heure, durée, 10 places, lieu, période de septembre à juin.',
    '<b>Importer les vacances scolaires</b> (onglet Vacances › Zone A › Voir les dates › tout cocher › Ajouter).',
    '<b>Ajouter vos propres fermetures</b> : congés, stage, salle indisponible…',
    '<b>Créer les comptes</b> de vos élèves avec leur formule et leur créneau (onglet Élèves › + Nouvel élève).',
    '<b>Envoyer les identifiants par texto</b> (bouton juste après la création).',
    '<b>Vérifier les réglages</b> (onglet Réglages) : délai d’annulation, ouverture des réservations.',
    '<b>Installer l’application</b> sur votre téléphone et activer les notifications.'])}
  ${tip('Le bon ordre', 'Faites les vacances avant ou après les cours, peu importe : l’application retire toute seule les séances pendant les vacances et les remet si vous supprimez une période.')}
  ${tip('Combien de temps ?', 'Compter une heure pour une trentaine d’élèves : environ une minute par élève (création + texto).', 'soft')}`));
P.push(page('Préparer la saison', 'Vos cours de la semaine', `
  ${phones([['p-cours', 'Onglet Cours'], ['p-cours-inscrits', '« 6/10 à l’année » : les inscrites']])}
  ${steps([
    'Onglet <b>Cours</b> : vos 7 cours (mardi 12h15, 19h, 20h15 · jeudi 12h15, 18h30, 19h45 · vendredi 9h), avec le nombre d’inscrites à l’année.',
    'Touchez <b>« x/10 à l’année »</b> pour voir qui est inscrite, en ajouter ou en retirer.',
    '<b>+ Nouveau cours</b> : jour, heure, durée, places, lieu, période. Toutes les séances de la période sont créées d’un coup, hors vacances et jours fériés.'])}
  ${tip('Un cours ponctuel ?', 'Pour un atelier ou un stage unique, n’utilisez pas « Nouveau cours » : utilisez <b>« + Ajouter une séance »</b> dans le planning (page Déplacer ou ajouter).')}`));
P.push(page('Préparer la saison', 'Modifier un cours (changer de créneau)', `
  ${phones([['p-cours-modifier', 'Modifier le cours'], ['p-cours-modifier-bas', '« Changements à partir du »']])}
  ${steps([
    'Onglet <b>Cours</b> › <b>Modifier</b> sur le cours.',
    'Changez ce qu’il faut : <b>jour</b>, <b>heure</b>, durée, <b>places</b>, lieu, période, ou décochez <b>« Cours actif »</b> pour l’arrêter.',
    'Choisissez <b>« Changements à partir du »</b> : les séances avant cette date ne bougent pas.',
    'Laissez cochée <b>« Prévenir les élèves inscrit·es »</b> : elles reçoivent « Votre cours change : jeudi 18h30 ».',
    '<b>Enregistrer</b> : un message résume ce qui a changé (séances ajoutées, retirées, places reportées, élèves prévenues).'])}
  ${tip('Ce qui se fait tout seul', 'Les séances suivent : nouveau jour, période prolongée ou raccourcie, toujours hors vacances. Les places prises par des élèves à la séance sont reportées sur le nouveau jour de la même semaine. On ne peut pas mettre moins de places que d’élèves inscrites à l’année.')}`));
P.push(page('Préparer la saison', 'Vacances et fermetures', `
  ${phones([['p-vacances', 'Onglet Vacances'], ['p-vacances-bas', 'Vacances scolaires et périodes'], ['p-exceptionnel', 'Un cours pendant les vacances']])}
  ${steps([
    '<b>Vacances scolaires</b> : choisissez <b>Zone A</b> et l’année › <b>Voir les dates</b> › cochez › <b>Ajouter</b>.',
    '<b>Une fermeture à vous</b> (congés, stage…) : « Ajouter une période », nom, du… au… (inclus).',
    'Pendant ces dates, les cours habituels n’ont pas lieu. Si la période commence dans le mois, les élèves concernées sont prévenues.',
    '<b>Un cours quand même pendant les vacances</b> ? Bouton <b>« + Cours exceptionnel »</b> sur la période : il est bien proposé aux élèves.',
    '<b>Supprimer</b> une période remet les cours habituels.'])}
  ${tip('Autre possibilité', 'Dans le planning, un cours habituel annulé par les vacances peut être <b>« Rétabli »</b> depuis son détail : il redevient ouvert ce jour-là.')}`));
P.push(page('Préparer la saison', 'Créer un élève', `
  ${phones([['p-eleves', 'Onglet Élèves'], ['p-nouvel-eleve', '+ Nouvel élève'], ['p-compte-pret', 'Compte prêt : texto']])}
  ${steps([
    'Onglet <b>Élèves</b> › <b>+ Nouvel élève</b>.',
    '<b>Prénom et nom</b>, <b>e-mail</b> (c’est son identifiant de connexion) et <b>téléphone</b>.',
    'La <b>formule</b> : <b>À l’année</b> (choisissez son cours : les places restantes sont indiquées) ou <b>À la séance</b>.',
    '<b>Créer le compte</b>, puis <b>« Envoyer par texto »</b> : Messages s’ouvre avec ses identifiants et le lien d’installation, il ne reste qu’à envoyer.',
    '<b>+ Créer un autre élève</b> pour enchaîner.'])}
  ${tip('Pas de numéro ?', '« Partager » (WhatsApp, e-mail…) ou « Copier » font la même chose. Le mot de passe est provisoire : l’élève peut le changer dans son profil.')}`));

// ---------- Partie 3 ----------
P.push(divider(3, 'Au quotidien', 'Votre planning, les séances, la liste d’attente et l’appel'));
P.push(page('Au quotidien', 'Votre planning', `
  ${phones([['p-semaine', 'Semaine'], ['p-jour', 'Jour'], ['p-mois', 'Mois']])}
  ${steps([
    'Onglet <b>Planning</b>, puis <b>Jour</b>, <b>Semaine</b>, <b>Mois</b> ou <b>Année</b> en haut.',
    '<b>Semaine</b> : le remplissage de la semaine, de chaque jour et de chaque cours (« 10/10 · 100 % »), les annulations et les personnes « en attente ».',
    '<b>Jour</b> : la liste des inscrites de chaque cours. <b>Mois</b> : le calendrier avec le remplissage et un récapitulatif par semaine.',
    'Les flèches changent de semaine, de jour ou de mois ; <b>Aujourd’hui</b> revient à la date du jour.'])}
  ${tip('Couleurs', 'Clair : places libres · Rose : presque complet (75 % et plus) · Prune : complet.')}`));
P.push(page('Au quotidien', 'Une séance : qui vient, qui annule', `
  ${phones([['p-seance', 'Détail d’une séance'], ['p-semaine-cours', '« 2 en attente » dans la semaine']])}
  ${steps([
    'Touchez un cours dans le planning : la liste des <b>participantes</b>, des <b>annulations</b> et de la <b>liste d’attente</b>.',
    '<b>Absent·e</b> : une élève vous prévient de vive voix ? Notez-la absente : sa place est proposée aux autres.',
    '<b>Changer son créneau</b> : ouvre directement sa fiche.',
    '<b>Ajouter quelqu’un</b> à la séance (vous pouvez faire une exception à la règle « un cours par semaine »).',
    '<b>Texto aux inscrit·es</b> : prévenir d’un retard ou d’un imprévu.'])}
  ${tip('Texto à plusieurs', 'Sur iPhone, un texto à plusieurs personnes crée une conversation de groupe : chacune voit les numéros des autres. Pour un message discret, écrivez une par une depuis leur fiche.', 'warn')}`));
P.push(page('Au quotidien', 'La liste d’attente', `
  ${phones([['p-seance-attente', 'Liste d’attente d’une séance'], ['p-attente-confirm', 'Confirmation avant de changer l’ordre']])}
  ${steps([
    'Sur un cours complet, les élèves peuvent se mettre <b>sur liste d’attente</b>. Elles ne voient pas leur rang, seulement qu’elles attendent.',
    'Vous voyez la liste <b>dans l’ordre des demandes</b>, avec l’heure de chaque demande.',
    'Les flèches <b>↑ ↓</b> changent l’ordre (une confirmation vous est demandée). <b>Retirer</b> enlève quelqu’un ; vous pouvez aussi <b>ajouter</b> une élève.',
    'Quand une place se libère, <b>la première personne disponible est inscrite automatiquement</b> et prévenue. Vous recevez une alerte.'])}
  ${tip('Plus de places ?', 'Si vous augmentez le nombre de places d’une séance, la liste d’attente avance toute seule.')}`));
P.push(page('Au quotidien', 'Déplacer ou ajouter une séance', `
  ${phones([['p-deplacer', 'Modifier ou déplacer'], ['p-ajouter', 'Ajouter une séance']])}
  ${steps([
    '<b>Déplacer une séance</b> : touchez-la › <b>Modifier / déplacer</b> › nouvelle date ou heure › Enregistrer. Les inscrites gardent leur place.',
    '<b>Ajouter une séance</b> (atelier, stage, cours en plus) : Planning › <b>+ Ajouter une séance</b>.',
    'Laissez cochée la case <b>« Prévenir tous les élèves »</b> : chacune reçoit une notification.',
    '<b>Annuler une séance</b> : dans son détail, « Annuler la séance » (avec un motif) ; « Rétablir » la remet.'])}
  ${tip('Un seul jour ou toutes les semaines ?', 'Ici, on change <b>une seule séance</b>. Pour changer un cours <b>toutes les semaines</b>, passez par l’onglet Cours › Modifier.')}`));
P.push(page('Au quotidien', 'La feuille d’appel', `
  ${phones([['p-appel', 'Feuille d’appel du jour']])}
  ${steps([
    'Bouton <b>Appel</b> à côté de chaque jour du planning, ou <b>Feuille d’appel</b> dans la vue Jour.',
    'Tous les cours de la journée, avec pour chacun : les inscrites, « à l’année » ou « place libre », leur téléphone, une case à cocher et une colonne remarque.',
    '<b>Imprimer</b> depuis l’ordinateur ou le téléphone (ou l’enregistrer en PDF).'])}
  ${tip('Astuce', 'Imprimez la feuille le jour même : elle tient compte des dernières annulations et inscriptions.')}`));
P.push(page('Au quotidien', 'Vos alertes', `
  ${phones([['p-alertes', 'La cloche : vos alertes']])}
  ${steps([
    'La <b>cloche</b> en haut montre le nombre d’alertes non lues.',
    'Vous êtes prévenue quand une élève <b>annule</b>, <b>s’inscrit</b>, <b>revient finalement</b>, <b>se met en liste d’attente</b> ou <b>passe de la liste d’attente</b> au cours.',
    'Pour une élève à la séance, l’alerte indique son <b>nombre de séances</b> (total et ce mois-ci) : pratique pour la facturation.',
    '« Voir » ouvre la journée concernée.'])}
  ${tip('Sur l’écran verrouillé', 'Avec les notifications activées (Profil), ces alertes arrivent aussi sur votre téléphone, comme un SMS.')}`));

// ---------- Partie 4 ----------
P.push(divider(4, 'Vos élèves', 'Coordonnées, créneau, formule, séances, mot de passe'));
P.push(page('Vos élèves', 'La fiche d’une élève', `
  ${phones([['p-fiche', 'Coordonnées'], ['p-fiche-creneau', 'Changer le créneau ou la formule']])}
  ${steps([
    'Onglet <b>Élèves</b> › touchez un nom. La recherche et les filtres <b>Tous / À l’année / À la séance</b> aident à trouver.',
    '<b>Modifier</b> les coordonnées : nom, e-mail, téléphone. <b>Texto</b> lui écrit directement.',
    '<b>Changer le créneau</b> : nouveau cours + <b>« À partir du »</b>. Elle garde son cours actuel jusque-là, puis passe au nouveau, et elle est prévenue.',
    '<b>Changer la formule</b> : à l’année ↔ à la séance.',
    '<b>Désactiver</b> le compte d’une élève qui arrête (ses données restent, elle ne peut plus se connecter).'])}`));
P.push(page('Vos élèves', 'Les élèves à la séance', `
  ${phones([['p-fiche-seance', 'Fiche d’une élève à la séance']])}
  ${steps([
    'Elles n’ont pas de cours fixe : elles <b>s’inscrivent aux cours de leur choix</b>, sans limite par semaine.',
    'Leur fiche affiche <b>le nombre de séances</b> : au total, ce mois-ci, à venir, et <b>la liste des dates</b>.',
    'Dans Élèves, le filtre <b>« À la séance »</b> les regroupe avec leur décompte.'])}
  ${tip('Ce qui compte', 'Une séance réservée compte ; une séance annulée par vous ne compte pas. Une élève qui ne vient pas sans annuler compte quand même : à vous de voir si vous la facturez.')}`));
P.push(page('Vos élèves', 'Une élève a oublié son mot de passe', `
  ${phones([['oubli', 'Ce que voit l’élève'], ['p-compte-pret', 'Le nouveau mot de passe, par texto']])}
  ${steps([
    'L’élève touche « Mot de passe oublié ? » : l’application lui dit de vous le demander.',
    'Ouvrez sa fiche › <b>Nouveau mot de passe</b> › Créer.',
    '<b>Envoyer par texto</b> : elle reçoit son nouveau mot de passe provisoire. Ses anciennes connexions sont fermées.'])}
  ${tip('Compte bloqué ?', 'Après 5 erreurs, un compte est bloqué 15 minutes. Il suffit d’attendre, ou de lui envoyer un nouveau mot de passe.')}`));

// ---------- Partie 5 ----------
P.push(divider(5, 'Ce que voient vos élèves', 'Pour leur expliquer et les accompagner'));
P.push(page('Côté élèves', 'Leur planning', `
  ${phones([['e-planning', '« Bonjour Katia, votre planning »'], ['e-planning-cours', 'Mon cours · Annuler'], ['e-annuler', 'Annuler son cours']])}
  ${steps([
    'Leur planning les accueille par leur prénom, avec <b>leur prochain cours</b> et <b>leur cours de la semaine</b>.',
    '<b>Annuler</b> : la place est proposée aux autres, sans rattrapage. « Me réinscrire » rend la place tant que personne ne l’a prise.',
    'Les autres cours de la semaine affichent « Déjà un cours cette semaine » (formule à l’année).'])}`));
P.push(page('Côté élèves', 'S’inscrire, attendre, être prévenue', `
  ${phones([['e-sinscrire', 'S’inscrire (avec confirmation)'], ['e-attente', 'Liste d’attente'], ['e-profil', 'Notifications']])}
  ${steps([
    'Une place libre : <b>S’inscrire</b>, avec une confirmation avant.',
    'Un cours complet : <b>Liste d’attente</b>. Elles savent seulement qu’elles attendent, pas leur rang.',
    'Dans <b>Profil</b> : <b>Activer les notifications</b> (gratuit), changer leur mot de passe et leur téléphone.'])}`));

// ---------- Partie 6 ----------
P.push(divider(6, 'Ce à quoi penser', 'Les bons réflexes, les questions fréquentes, le message à envoyer'));
P.push(page('Ce à quoi penser', 'Les bons réflexes', `
  <div class="grid2">
    <div class="card"><h3>À la rentrée</h3>${check(['Vérifier les cours et leurs dates.', 'Importer les vacances de l’année (Zone A).', 'Créer ou mettre à jour les comptes, envoyer les textos.', 'Passer à « à la séance » ou désactiver les élèves qui changent.'])}</div>
    <div class="card"><h3>Chaque semaine</h3>${check(['Un coup d’œil au planning et à la cloche.', 'Imprimer la feuille d’appel le jour même.', 'Noter les élèves à la séance pour la facturation.'])}</div>
    <div class="card"><h3>Avant des vacances ou une absence</h3>${check(['Ajouter la période (ou vérifier qu’elle y est).', 'Ajouter un cours exceptionnel si vous en donnez un.', 'Un texto aux inscrites si c’est imprévu.'])}</div>
    <div class="card"><h3>En fin de saison</h3>${check(['Désactiver les comptes des élèves qui arrêtent.', 'Préparer les cours de la saison suivante (dates de début et de fin).'])}</div>
  </div>
  <div class="card"><h3>Données personnelles de vos élèves</h3>${check([
    'Vous gardez leur nom, e-mail et téléphone pour gérer les cours : dites-le leur (une phrase à l’inscription suffit, voir le message type).',
    'Ne gardez que ce qui sert. Une élève qui arrête : désactivez son compte ; si elle le demande, faites supprimer ses données.',
    'Le serveur est en France, la connexion est chiffrée (https) et une sauvegarde est faite chaque nuit.'])}</div>
  <div class="card"><h3>Sécurité</h3>${check([
    'Un mot de passe à vous, jamais partagé ; téléphone verrouillé (code ou visage).',
    'Ne donnez jamais vos identifiants par e-mail ou par téléphone à quelqu’un qui vous les demande : personne n’en a besoin.',
    'Un doute (connexion inconnue, alerte bizarre) ? Changez votre mot de passe : vos autres appareils sont déconnectés.'])}</div>`, 'dense'));
P.push(page('Ce à quoi penser', 'Questions fréquentes', `
  <dl class="faq">
    <dt>Une élève ne reçoit pas les notifications.</dt><dd>Elle doit avoir installé l’application (sur iPhone, c’est obligatoire) puis touché « Activer les notifications » dans son Profil, et accepté. Si elle a refusé, c’est dans les réglages du téléphone, rubrique Notifications.</dd>
    <dt>Sur iPhone, l’installation ne marche pas.</dt><dd>Le lien doit être ouvert dans <b>Safari</b>, pas depuis Instagram ou WhatsApp : touchez ⋯ › « Ouvrir dans Safari ».</dd>
    <dt>Elle s’est connectée mais l’application lui redemande de se connecter.</dt><dd>Normal la première fois : l’application installée a sa propre connexion, différente de celle de Safari.</dd>
    <dt>Une élève veut changer de cours à l’année.</dt><dd>Sa fiche › Changer le créneau › nouveau cours et « À partir du » › Enregistrer. Elle est prévenue.</dd>
    <dt>Une élève veut venir deux fois la même semaine.</dt><dd>Avec la formule à l’année, c’est un seul cours par semaine. Vous pouvez faire une exception : détail de la séance › Ajouter quelqu’un.</dd>
    <dt>Je donne un cours pendant les vacances.</dt><dd>Vacances › « + Cours exceptionnel » sur la période, ou Rétablir le cours habituel depuis le planning.</dd>
    <dt>Je suis malade ce soir.</dt><dd>Détail de la séance › Annuler la séance (avec un motif) : les inscrites sont prévenues. Ajoutez un texto si c’est à la dernière minute.</dd>
    <dt>Je n’arrive plus à me connecter.</dt><dd>Attendez 15 minutes si vous avez fait plusieurs erreurs. Sinon, demandez un nouveau mot de passe à la personne qui a installé l’application.</dd>
    <dt>Les inscrites d’un créneau sont trop nombreuses.</dt><dd>Le nombre de places d’un cours ne peut pas descendre sous le nombre d’inscrites à l’année : changez d’abord le créneau de certaines élèves.</dd>
  </dl>`, 'dense'));
P.push(page('À transmettre', 'Le message à envoyer à vos élèves', `
  <p>À envoyer avec ou après le texto des identifiants (vous pouvez l’adapter) :</p>
  <div class="msg">Bonjour,<br><br>Pour réserver vos cours de yoga, Nada Atma a maintenant son application. Vous y retrouvez votre cours de la semaine et, si vous ne pouvez pas venir, vous l’annulez en un geste : votre place est alors proposée aux autres élèves (le cours n’est pas rattrapé). Quand une place se libère, vous êtes prévenu·e et pouvez vous inscrire.<br><br>1. Ouvrez le lien reçu par texto (dans Safari sur iPhone).<br>2. Installez l’application : Partager › « Sur l’écran d’accueil » (iPhone) ou menu ⋮ › « Installer l’application » (Android).<br>3. Ouvrez-la depuis son icône et connectez-vous avec votre e-mail et votre mot de passe provisoire.<br>4. Dans Profil, activez les notifications et choisissez votre mot de passe.<br><br>Vos nom, e-mail et téléphone servent uniquement à gérer les cours et ne sont jamais transmis.<br><br>À bientôt sur le tapis,<br>Nada Atma</div>
  ${phones([['e-planning', 'Leur planning'], ['installer-iphone', 'Le guide d’installation intégré']])}`));

const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Comfortaa:wght@400;700&family=Josefin+Sans:wght@600;700&family=Kalam:wght@700&display=swap">
<style>
@page{size:A4;margin:0}*{box-sizing:border-box}
body{margin:0;font-family:Comfortaa,sans-serif;color:#33283a;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{width:210mm;height:297mm;padding:16mm 15mm 18mm;position:relative;overflow:hidden;page-break-after:always;background:linear-gradient(175deg,#f3f2fa 0%,#fdfcff 40%);display:flex;flex-direction:column;gap:5mm}
.ph .kicker{font:600 8pt 'Josefin Sans',sans-serif;letter-spacing:2.5pt;text-transform:uppercase;color:#8e3b6b}
.ph h2{margin:1.5mm 0 0;font:700 19pt 'Josefin Sans',sans-serif;letter-spacing:1pt;text-transform:uppercase;color:#33283a}
.pf{position:absolute;left:15mm;right:15mm;bottom:8mm;display:flex;justify-content:space-between;font:600 7.5pt 'Josefin Sans',sans-serif;letter-spacing:1.5pt;text-transform:uppercase;color:#9a8fa3}
.cover{justify-content:center;align-items:center;text-align:center;background:linear-gradient(150deg,#6e2a52 0%,#4a2d40 55%,#2e1f2a 100%);color:#f4eef3;gap:3mm}
.cv-logo{width:62mm;height:62mm;margin-bottom:6mm}
.cv-brand{margin:0;font:700 italic 44pt Kalam,cursive;color:#e7c6d8;line-height:1}
.cv-tag{margin:0 0 12mm;font:700 13pt Kalam,cursive;letter-spacing:6pt;color:#cdd3ea}
.cover h1{margin:0;font:700 22pt 'Josefin Sans',sans-serif;letter-spacing:2pt;text-transform:uppercase}
.cv-lead{margin:3mm 0 10mm;font-size:14pt;color:#efe4ec}
.cv-meta{max-width:120mm;font-size:10pt;line-height:1.7;color:#cfc2cb;margin:0}
.divider{justify-content:center;align-items:flex-start;padding:40mm 22mm;background:linear-gradient(140deg,#a04a7c 0%,#8e3b6b 45%,#5e2447 100%);color:#fbf6f9}
.divider .pf{color:rgba(255,255,255,.6)}
.dv-logo{width:46mm;height:46mm;margin-bottom:10mm;opacity:.95}
.dv-n{margin:0;font:600 11pt 'Josefin Sans',sans-serif;letter-spacing:4pt;text-transform:uppercase;color:#f0d9e6}
.divider h2{margin:2mm 0 4mm;font:700 34pt 'Josefin Sans',sans-serif;letter-spacing:2pt;text-transform:uppercase}
.dv-sub{margin:0;font-size:12pt;color:#f6e6ef;max-width:140mm;line-height:1.5}
.phones{display:flex;justify-content:center;gap:7mm;align-items:flex-start}
.phone-fig{margin:0;display:flex;flex-direction:column;align-items:center;gap:2.5mm}
.phones.n1 .phone{width:70mm}.phones.n2 .phone{width:66mm}.phones.n3 .phone{width:55mm}
.phone{border:2mm solid #241a22;border-radius:7mm;overflow:hidden;box-shadow:0 4mm 10mm -4mm rgba(46,31,42,.45);background:#fff}
.phone img{display:block;width:100%}
figcaption{font:600 7.5pt 'Josefin Sans',sans-serif;letter-spacing:1pt;text-transform:uppercase;color:#6f6677;text-align:center;max-width:62mm}
.sb{height:5.6mm;display:flex;align-items:center;justify-content:space-between;padding:0 4.5mm 0 5.5mm;font:600 7pt -apple-system,'Josefin Sans',sans-serif;color:#1d1d1f;position:relative}
.sb .island{position:absolute;left:50%;top:.9mm;width:15mm;height:4mm;margin-left:-7.5mm;border-radius:3mm;background:#0b0b0b}
.sb .ic{display:flex;gap:1mm;align-items:center}.sb svg{height:2.2mm;fill:currentColor}
.steps{margin:0;padding:0;list-style:none;counter-reset:s;display:flex;flex-direction:column;gap:2.4mm}
.steps li{counter-increment:s;position:relative;padding-left:9.5mm;min-height:6.5mm;font-size:9.8pt;line-height:1.55}
.steps li::before{content:counter(s);position:absolute;left:0;top:-.3mm;width:6.5mm;height:6.5mm;border-radius:50%;display:grid;place-items:center;background:linear-gradient(135deg,#a04a7c,#6e2a52);color:#fff;font:700 8.5pt 'Josefin Sans',sans-serif}
.steps b,.check b{color:#6e2a52}
.tip{padding:3.5mm 4.5mm;border-radius:4mm;background:#fff;border:1px solid rgba(91,66,80,.14);border-left:1.6mm solid #8e3b6b;font-size:9pt;line-height:1.55}
.tip strong{display:block;font:700 8.5pt 'Josefin Sans',sans-serif;letter-spacing:1.5pt;text-transform:uppercase;color:#8e3b6b;margin-bottom:1mm}
.tip.warn{border-left-color:#b8742a}.tip.warn strong{color:#9a5418}
.tip.soft{background:#f6edf2}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:4mm}
.card{background:#fff;border:1px solid rgba(91,66,80,.12);border-radius:4.5mm;padding:4.5mm 5mm}
.card.soft{background:#f6edf2}
.card h3,.toc-h{margin:0 0 2.5mm;font:700 10pt 'Josefin Sans',sans-serif;letter-spacing:1.5pt;text-transform:uppercase;color:#5b4250}
.check{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:1.8mm}
.check li{position:relative;padding-left:6mm;font-size:9pt;line-height:1.5}
.check li::before{content:"";position:absolute;left:0;top:1.2mm;width:3.4mm;height:3.4mm;border-radius:1mm;border:1.3px solid #8e3b6b}
.dense .check li{font-size:8.6pt}
.toc{margin:0;padding-left:5mm;display:flex;flex-direction:column;gap:1.5mm;font-size:10pt}
.toc li::marker{color:#8e3b6b;font-weight:700}
.faq{margin:0;display:flex;flex-direction:column;gap:2.6mm}
.faq dt{font:700 9.6pt 'Josefin Sans',sans-serif;letter-spacing:.4pt;color:#6e2a52}
.faq dd{margin:.6mm 0 0;font-size:9pt;line-height:1.55}
.msg{background:#fff;border:1px dashed rgba(142,59,107,.45);border-radius:4mm;padding:5mm 6mm;font-size:9.4pt;line-height:1.6}
p{margin:0;font-size:9.8pt;line-height:1.55}
</style></head><body>${P.join('\n')}</body></html>`;
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  const tmp = path.join(DIR, 'guide-source.html'); fs.writeFileSync(tmp, html);
  await p.goto('file://' + tmp, { waitUntil: 'networkidle' }); await p.evaluate(() => document.fonts.ready);
  // Contrôle : rien ne doit dépasser du bas d'une page
  const over = await p.evaluate(() => [...document.querySelectorAll('.page')].map((pg, i) => {
    const limit = pg.getBoundingClientRect().bottom - 14 * 3.78;
    const last = [...pg.children].filter((c) => !c.classList.contains('pf')).reduce((m, c) => Math.max(m, c.getBoundingClientRect().bottom), 0);
    return last > limit ? `page ${i + 1} déborde de ${Math.round((last - limit) / 3.78)} mm` : null;
  }).filter(Boolean));
  console.log('pages :', pageNo, '·', over.length ? over : 'aucun débordement');
  await p.pdf({ path: OUT, width: '210mm', height: '297mm', printBackground: true });
  await b.close();
})();
