# Nada Atma — Réservations de yoga

Application web et mobile pour gérer le planning des cours de yoga de [Nada Atma](https://www.nada-atma.com/) :
les élèves créent un compte, réservent, déplacent ou annulent leurs séances. La professeure gère le planning de l'année,
les vacances et les inscrit·es.

C'est une **application web installable** (PWA) : elle s'utilise dans un navigateur sur ordinateur, et s'installe sur
iPhone/Android comme une application (Safari → Partager → « Sur l'écran d'accueil » ; Chrome → ⋮ → « Installer »).
Une seule version à maintenir, pas besoin de passer par l'App Store.

## Fonctionnalités

**Pour les élèves**
- Planning semaine par semaine, consultable sans compte, filtre par type de cours
- Création de compte (nom, e-mail, téléphone, mot de passe)
- Réservation en un clic, affichage des places restantes
- « Mes séances » : déplacer un rendez-vous vers une autre séance (même cours ou non) ou l'annuler
- Délai limite de modification (par défaut 12 h avant la séance)
- Séance annulée par la professeure → signalée dans « Mes séances » avec un bouton pour la déplacer

**Pour la professeure (onglet « Gestion »)**
- **Cours réguliers** : ex. « Hatha yoga, mardi 18h30, 75 min, 12 places, de septembre à juillet » → toutes les séances
  de l'année sont créées automatiquement
- **Vacances & fermetures** : une période sans cours annule les séances concernées (et les rétablit si on la supprime).
  Import en un clic des **vacances scolaires officielles** (zone A, B ou C), et jours fériés sautés automatiquement
- **Vue annuelle** : toute la saison (septembre → août) sur un écran, vacances hachurées, jours complets en couleur
- **Vue semaine** : nombre d'inscrit·es par séance, liste des participant·es avec téléphone, inscrire ou retirer quelqu'un,
  modifier/annuler une séance, e-mail groupé aux inscrit·es
- **Séances ponctuelles** : ateliers, stages, cours exceptionnels
- **Membres** : liste, recherche, historique, désactivation, droits administrateur
- **Réglages** : délai d'annulation, ouverture des réservations (ex. 120 jours à l'avance), nombre max de réservations
  à venir par personne

## Démarrage

Prérequis : **Node.js 22.13 ou plus récent**. Aucune autre dépendance (la base SQLite est intégrée à Node).

```bash
cd nada-atma
npm start          # → http://localhost:3000
npm test           # tests automatiques de l'API
```

**Premier lancement** : le **premier compte créé devient administrateur**. Créez donc d'abord le compte de la
professeure, puis ajoutez les cours réguliers et les vacances, et partagez le lien aux élèves.

### Variables d'environnement

| Variable        | Défaut                 | Rôle                                                        |
|-----------------|------------------------|-------------------------------------------------------------|
| `PORT`          | `3000`                 | Port HTTP                                                   |
| `DB_FILE`       | `./data/nada-atma.db`  | Fichier de base de données (à sauvegarder régulièrement)    |
| `STUDIO_TZ`     | `Europe/Paris`         | Fuseau horaire des cours                                    |
| `COOKIE_SECURE` | —                      | Mettre `1` en production derrière HTTPS                     |

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
- Liste d'attente quand une séance est complète
- Carnets de séances / abonnements et paiement en ligne (Stripe)
- Mot de passe oublié (nécessite l'envoi d'e-mails)
