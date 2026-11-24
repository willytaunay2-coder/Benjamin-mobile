# Mettre Nada Atma en ligne sur un domaine OVH

Résultat : l'application sur **https://yoga.votre-domaine.fr** (le sous-domaine est un exemple, choisissez-le),
avec HTTPS automatique, sauvegarde chaque nuit, redémarrage automatique et mises à jour de sécurité.

Temps : environ 45 minutes, plus l'attente du DNS (de quelques minutes à quelques heures).

## Ce qu'il faut

| Élément | Pourquoi | Coût indicatif |
|---|---|---|
| Le nom de domaine chez OVH | Il est déjà à vous | — |
| Un **VPS OVH** (le plus petit suffit) | L'application tourne en continu et garde un fichier de données : l'hébergement web mutualisé ne convient pas | quelques € par mois (voir le tarif OVH du moment) |
| L'e-mail de la professeure | Son compte est le seul à pouvoir être créé en premier | — |

Pas besoin de Firebase, ni de base de données à part, ni de compte Brevo (facultatif, pour les e-mails).

## 1. Commander le VPS

1. Espace client OVH › **Bare Metal Cloud › Serveurs privés virtuels (VPS)** › Commander.
2. Le plus petit modèle, système **Ubuntu 24.04** (ou Debian 12), localisation en France.
3. OVH envoie par e-mail l'**adresse IP** (IPv4, et IPv6) et les accès (utilisateur `ubuntu`).

Conseil sécurité : à la commande, ajoutez votre **clé SSH** plutôt qu'un mot de passe.

## 2. Relier le sous-domaine au VPS (zone DNS OVH)

1. Espace client OVH › **Web Cloud › Noms de domaine** › votre domaine › onglet **Zone DNS**.
2. **Ajouter une entrée** › type **A**.
   - Sous-domaine : `yoga` (ou ce que vous voulez : `reservation`, `cours`…)
   - Cible : l'**IPv4 du VPS**
   - TTL : laisser par défaut
3. Facultatif : même chose en type **AAAA** avec l'**IPv6** du VPS.
4. Si une entrée existe déjà pour ce sous-domaine (A ou CNAME), modifiez-la au lieu d'en ajouter une.

Vérifier : `ping yoga.votre-domaine.fr` doit répondre avec l'IP du VPS (sinon, attendre la propagation).

Le site principal (par exemple nada-atma.com) n'est pas touché : seul le sous-domaine pointe vers le VPS.

## 3. Installer l'application

Depuis votre ordinateur :

```bash
# Copier le dossier de l'application sur le serveur
scp -r nada-atma ubuntu@IP_DU_VPS:~
# Se connecter au serveur
ssh ubuntu@IP_DU_VPS
```

Sur le serveur :

```bash
cd ~/nada-atma
sudo bash deploy/install.sh yoga.votre-domaine.fr email-de-la-prof@exemple.fr
```

Le script installe Node.js 22 et Caddy, et règle le certificat HTTPS. Il crée aussi le service, qui redémarre tout seul, ainsi que la sauvegarde de chaque nuit à 3h (gardée 30 jours), le pare-feu et les mises à jour de sécurité automatiques.

Il affiche ensuite les deux commandes à lancer :

```bash
# Compte de la professeure : affiche son mot de passe provisoire
sudo -u nadaatma bash -c 'set -a; . /etc/nada-atma.env; cd /opt/nada-atma && node --disable-warning=ExperimentalWarning scripts/create-admin.js email-de-la-prof@exemple.fr "Prénom Nom"'
# Les 7 cours de la saison (mardi 12h15, 19h, 20h15 · jeudi 12h15, 18h30, 19h45 · vendredi 9h)
sudo -u nadaatma bash -c 'set -a; . /etc/nada-atma.env; cd /opt/nada-atma && node --disable-warning=ExperimentalWarning scripts/creneaux-nada-atma.js'
```

Ouvrez **https://yoga.votre-domaine.fr** : la page de connexion s'affiche, avec le cadenas HTTPS.

Ensuite, côté application (ou avec la professeure) : **Gestion › Vacances › Vacances scolaires › Zone A › Voir les dates**,
tout cocher, ajouter. Les cours pendant les vacances sont retirés.

## 4. Remettre l'accès à la professeure

Envoyez-lui l'adresse, son e-mail et son mot de passe provisoire, avec le **Guide de la professeure** (PDF).
Elle installe l'application sur son téléphone et change son mot de passe dans **Profil**.

## 5. Réglages (fichier `/etc/nada-atma.env`)

| Réglage | Rôle |
|---|---|
| `APP_URL` | Adresse publique (liens, cookie sécurisé, HSTS) |
| `ADMIN_EMAIL` | Seul compte pouvant être créé en premier |
| `DB_FILE` | Fichier de données (`/var/lib/nada-atma/nada-atma.db`) |
| `TRUST_PROXY=1` | Vraie adresse des visiteurs derrière Caddy (limites de tentatives) |
| `BREVO_API_KEY`, `MAIL_FROM` | Facultatif : e-mails automatiques |

Après une modification : `sudo systemctl restart nada-atma`.

## 6. Au quotidien

| Besoin | Commande |
|---|---|
| L'application tourne-t-elle ? | `systemctl status nada-atma` |
| Journal des erreurs | `journalctl -u nada-atma -n 100` |
| Sauvegardes | `ls -lh /var/backups/nada-atma` |
| Mettre à jour le code | copier le nouveau dossier puis `sudo bash deploy/update.sh` (sauvegarde d'abord, données conservées) |
| Restaurer une sauvegarde | `sudo systemctl stop nada-atma`, `gunzip -c /var/backups/nada-atma/nada-atma-AAAA-MM-JJ.db.gz > /var/lib/nada-atma/nada-atma.db`, `sudo chown nadaatma: /var/lib/nada-atma/nada-atma.db`, `sudo systemctl start nada-atma` |
| Professeure qui a perdu son mot de passe | relancer la commande du compte de la professeure ci-dessus : nouveau mot de passe provisoire |

## 7. À ne pas oublier

- **Une copie des sauvegardes ailleurs que sur le VPS**, au moins chaque semaine (si le VPS disparaît, ses sauvegardes aussi).
  Par exemple depuis votre ordinateur : `scp ubuntu@IP_DU_VPS:/var/backups/nada-atma/*.gz ~/Sauvegardes/nada-atma/`.
  Ou l'option « sauvegarde automatisée » du VPS chez OVH.
- **Surveillance gratuite** : un service comme UptimeRobot qui vérifie l'adresse toutes les 5 minutes et vous alerte.
- **SSH** : connexion par clé, puis désactiver la connexion par mot de passe (`PasswordAuthentication no` dans `/etc/ssh/sshd_config`).
- **Renouvellement** du domaine et du VPS chez OVH (paiement automatique).
- **Données personnelles** : les élèves sont des personnes réelles (nom, e-mail, téléphone). Le serveur en France,
  HTTPS et les sauvegardes y contribuent ; le guide de la professeure rappelle ses obligations (informer, ne garder
  que le nécessaire, supprimer les anciens comptes).
