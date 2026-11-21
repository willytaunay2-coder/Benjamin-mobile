# Nada Atma — Réservations de yoga

Application web et mobile pour gérer le planning des cours de yoga de [Nada Atma](https://www.nada-atma.com/) :
les élèves créent un compte, réservent, déplacent ou annulent leurs séances. La professeure gère le planning de l'année,
les vacances et les inscrit·es.

C'est une **application web installable** (PWA) : elle s'utilise dans un navigateur sur ordinateur, et s'installe sur
iPhone/Android comme une application (Safari → Partager → « Sur l'écran d'accueil » ; Chrome → ⋮ → « Installer »).
Une seule version à maintenir, pas besoin de passer par l'App Store.

## Fonctionnement

**Un abonnement = un cours par semaine.** Chaque élève est inscrit·e sur un seul créneau pour l'année
(ex. mardi 19h) : sa place l'attend chaque semaine, hors vacances.

**La professeure crée les comptes.** Dans Gestion › Élèves, « + Nouvel élève » : nom, e-mail, téléphone et
cours de la semaine, en une fois. Un mot de passe provisoire est créé, envoyé par e-mail (ou à copier) ; l'élève
le change dans son profil. Le créneau peut être changé à tout moment depuis la fiche de l'élève.

**« Je ne viens pas » → la place est libre, sans rattrapage.** L'élève libère sa place en un clic ; **tous les
autres élèves sont prévenus** (alerte 🔔 + e-mail) et le premier qui la prend l'a. Le cours n'est pas rattrapé.
« Je viens finalement » rend la place tant que personne ne l'a prise.

## Fonctionnalités

Deux vues simples.

**L'élève** (onglets Planning · Profil)
- Planning semaine par semaine avec son cours de la semaine
- « Je ne viens pas » / « Je viens finalement », « Prendre la place » quand une place se libère
- Alertes 🔔 et e-mails

**La professeure** (onglet « Gestion » : Semaine · Cours · Élèves · Vacances)
- **Semaine** : remplissage des séances, **déplacer** ou **ajouter** une séance (tous les élèves sont prévenus),
  détail d'une séance, **feuille d'appel** imprimable par jour
- **Cours** : les créneaux réguliers, qui créent toutes les séances de la saison
- **Élèves** : **créer un compte avec son créneau**, changer de créneau, nouveau mot de passe, désactiver
- **Vacances & fermetures** (vacances scolaires zone A/B/C, jours fériés sautés)
- Écrans avancés toujours accessibles par adresse : `#/admin/annee`, `#/admin/repartition`, `#/admin/reglages`

## Version d'essai (sans serveur)

`npm run demo` construit `demo/nada-atma-essai.html` : une seule page qui fait tourner le vrai serveur
dans le navigateur (SQLite via sql.js), avec des données de démonstration. On y entre côté élève (Katia Picquet)
ou côté professeure, on passe de l'un à l'autre, et les e-mails arrivent dans une boîte de démonstration.
Les essais restent dans le navigateur ; « Remettre la démo à zéro » repart de l'état initial.

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
| `BREVO_API_KEY` | —                      | Clé API Brevo : envoie les e-mails **et les SMS** (e-mails gratuits jusqu'à 300/jour, SMS payants à l'unité) |
| `SMS_SENDER`    | `NadaAtma`             | Nom affiché à la place du numéro sur les SMS (11 lettres/chiffres max) |
| `RESEND_API_KEY`| —                      | Alternative à Brevo                                         |

Sans clé d'envoi, les alertes restent visibles dans l'application et les e-mails et SMS sont seulement affichés dans la
console du serveur. Chaque élève choisit dans son profil : SMS, e-mail, ou les deux.

**SMS.** Avec Brevo, il suffit d'acheter des crédits SMS dans le compte Brevo : la même clé `BREVO_API_KEY` sert
aux e-mails et aux SMS (envoi « transactionnel » via `POST /v3/transactionalSMS/send`). Dans Gestion › Réglages,
la professeure choisit : tout par SMS, seulement les changements de cours (les places libres restent par e-mail),
ou jamais. Une place libérée envoie un SMS à chaque élève qui a un numéro : c'est le poste le plus coûteux.
Les textes sont gardés dans l'alphabet SMS standard (160 caractères par SMS).

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
