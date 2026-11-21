# Nada Atma — Réservations de yoga

Application web et mobile pour gérer le planning des cours de yoga de [Nada Atma](https://www.nada-atma.com/) :
les élèves créent un compte, réservent, déplacent ou annulent leurs séances. La professeure gère le planning de l'année,
les vacances et les inscrit·es.

C'est une **application web installable** (PWA) : elle s'utilise dans un navigateur sur ordinateur, et s'installe sur
iPhone/Android comme une application (Safari → Partager → « Sur l'écran d'accueil » ; Chrome → ⋮ → « Installer »).
Une seule version à maintenir, pas besoin de passer par l'App Store.

## Fonctionnement

**Un créneau à l'année, à valider.** En début de saison, la professeure inscrit d'office chaque élève sur son
créneau (ex. mardi 19h). L'élève reçoit une alerte et un e-mail, puis **valide** (ou refuse) dans l'application ; sa
place est gardée en attendant. Sa place est ensuite réservée toutes les semaines, hors vacances.

**« Je ne viens pas » → ma place est disponible.** Si l'élève ne peut pas venir, il libère sa place en un clic :
elle devient libre, **tous les autres élèves sont prévenus** (alerte dans l'application 🔔 + e-mail), et il gagne
**un rattrapage** (s'il prévient au moins 12 h avant, délai réglable). Le premier qui réserve prend la place.

**Rattrapage sur un créneau libre.** Avec ce rattrapage, il réserve n'importe quelle place libre du planning,
ou utilise directement « Venir un autre jour » (libération + réservation en une seule fois).
Une séance annulée par la professeure donne aussi un rattrapage ; pas les vacances.

## Fonctionnalités

**Pour les élèves**
- Choix de son créneau à l'année (places limitées par créneau) — ou inscription par la professeure
- Planning semaine par semaine (consultable sans compte), filtre par cours, places libres affichées
- « Je ne viens pas » / « Je viens finalement » (si la place n'a pas été reprise entre-temps)
- Compteur de rattrapages, réservation d'une place libre, déplacement ou annulation d'un rattrapage
- « Mes séances » : mon créneau, mes rattrapages, mes prochaines séances, historique

**Pour la professeure (onglet « Gestion »)**
- **Cours réguliers** : un cours crée toutes les séances de la saison ; bouton « 👥 x/12 à l'année » pour voir,
  inscrire ou retirer les élèves du créneau
- **Vacances & fermetures** (import des vacances scolaires zone A/B/C, jours fériés sautés)
- **Vue annuelle** et **vue semaine** ; détail d'une séance : inscrits à l'année, rattrapages, places libérées ;
  noter une absence, rendre une place, annuler une séance (rattrapage offert aux inscrits)
- **Séances ponctuelles** (ateliers, stages)
- **Membres** : créneau, nombre de rattrapages, ajout/retrait manuel de rattrapages
- **Réglages** : délai pour libérer sa place avec rattrapage, ouverture des réservations, choix du créneau par
  les élèves eux-mêmes ou non, rattrapage obligatoire ou non pour prendre une place libre

## Démarrage

Prérequis : **Node.js 22.13 ou plus récent**. Aucune autre dépendance (la base SQLite est intégrée à Node).

```bash
cd nada-atma
npm start          # → http://localhost:3000
npm test           # tests automatiques de l'API
```

**Créneaux Nada Atma** : `npm run creneaux -- places=12` crée les 7 créneaux de la saison
(mardi 12h15, 19h, 20h15 · jeudi 12h15, 18h30, 19h45 · vendredi 9h, durée 1 h, à L'espace des possibles)
et toutes les séances jusqu'au 30 juin (`fin=AAAA-MM-JJ` pour changer). Les durées et le nombre de places se
modifient ensuite dans Gestion › Cours réguliers.

**Premier lancement** : le **premier compte créé devient administrateur**. Créez donc d'abord le compte de la
professeure, puis ajoutez les cours réguliers et les vacances, et partagez le lien aux élèves.

### Variables d'environnement

| Variable        | Défaut                 | Rôle                                                        |
|-----------------|------------------------|-------------------------------------------------------------|
| `PORT`          | `3000`                 | Port HTTP                                                   |
| `DB_FILE`       | `./data/nada-atma.db`  | Fichier de base de données (à sauvegarder régulièrement)    |
| `STUDIO_TZ`     | `Europe/Paris`         | Fuseau horaire des cours                                    |
| `COOKIE_SECURE` | —                      | Mettre `1` en production derrière HTTPS                     |
| `APP_URL`       | —                      | Adresse publique (ex. `https://reservation.nada-atma.com`), pour les liens des e-mails |
| `MAIL_FROM`     | —                      | Expéditeur, ex. `Nada Atma <reservations@nada-atma.com>`    |
| `BREVO_API_KEY` | —                      | Clé API Brevo pour envoyer les e-mails (gratuit jusqu'à 300 e-mails/jour) |
| `RESEND_API_KEY`| —                      | Alternative à Brevo                                         |

Sans clé d'envoi, les alertes restent visibles dans l'application et les e-mails sont seulement affichés dans la
console du serveur. Chaque élève peut désactiver les e-mails dans son profil.

## Mise en ligne

N'importe quel hébergeur Node avec un **disque persistant** convient (Render, Railway, Fly.io, Scaleway, un petit VPS…) :

1. Commande de démarrage : `npm start`
2. `DB_FILE` pointant vers le disque persistant (ex. `/data/nada-atma.db`)
3. HTTPS activé + `COOKIE_SECURE=1`
4. Relier un sous-domaine, par ex. `reservation.nada-atma.com`, et ajouter un bouton « Réserver » sur le site actuel

Sauvegarde : copier le fichier `.db` (par ex. une fois par jour).

## Organisation du code

```
server.js          démarrage du serveur HTTP
lib/db.js          schéma SQLite (membres, cours réguliers, séances, réservations, fermetures, réglages)
lib/app.js         API JSON + règles métier (capacité, délais, déplacement atomique, génération du planning)
lib/dates.js       calcul des dates, jours fériés français
public/            interface (HTML/CSS/JS sans framework), manifeste PWA, service worker
test/              tests de l'API (node:test)
```

## Pistes d'évolution

- E-mails automatiques (confirmation, rappel la veille, séance annulée) via un service SMTP
- Liste d'attente quand une séance est complète (prévenir quand une place se libère)
- Date d'expiration des rattrapages (fin de saison)
- Carnets de séances / abonnements et paiement en ligne (Stripe)
- Mot de passe oublié (nécessite l'envoi d'e-mails)
