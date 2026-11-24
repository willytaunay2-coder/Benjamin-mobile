#!/usr/bin/env bash
# Installation complète de Nada Atma sur un VPS neuf (Ubuntu 24.04 ou Debian 12), en tant que root.
# Usage (depuis le dossier nada-atma copié sur le serveur) :
#   sudo bash deploy/install.sh yoga.mondomaine.fr prof@exemple.fr
# Ce que fait le script : Node.js 22, Caddy (HTTPS automatique), un utilisateur dédié, le service,
# la sauvegarde quotidienne, le pare-feu. On peut le relancer sans risque (mise à jour du code).
set -euo pipefail

DOMAIN="${1:?Indiquez le sous-domaine, ex. : yoga.mondomaine.fr}"
ADMIN_EMAIL="${2:?Indiquez l’e-mail de la professeure}"
SRC="$(cd "$(dirname "$0")/.." && pwd)"
APP=/opt/nada-atma
DATA=/var/lib/nada-atma
BACKUPS=/var/backups/nada-atma

[ "$(id -u)" -eq 0 ] || { echo "Lancez ce script avec sudo."; exit 1; }
echo "==> Paquets système"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q curl ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https sqlite3 rsync ufw unattended-upgrades

echo "==> Node.js 22"
if ! node -v 2>/dev/null | grep -q '^v2[2-9]'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -q nodejs
fi

echo "==> Caddy (HTTPS automatique)"
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -q && apt-get install -y -q caddy
fi

echo "==> Utilisateur et dossiers"
id nadaatma >/dev/null 2>&1 || useradd --system --home-dir "$APP" --shell /usr/sbin/nologin nadaatma
mkdir -p "$APP" "$DATA" "$BACKUPS"
rsync -a --delete --exclude data --exclude node_modules --exclude 'demo/nada-atma-essai.html' "$SRC"/ "$APP"/
chown -R root:root "$APP"
chown -R nadaatma:nadaatma "$DATA" "$BACKUPS"
chmod 750 "$DATA" "$BACKUPS"

echo "==> Configuration (/etc/nada-atma.env)"
if [ ! -f /etc/nada-atma.env ]; then
  cat > /etc/nada-atma.env <<CONF
# Réglages de Nada Atma (modifier puis : systemctl restart nada-atma)
APP_URL=https://$DOMAIN
ADMIN_EMAIL=$ADMIN_EMAIL
DB_FILE=$DATA/nada-atma.db
PORT=3000
HOST=127.0.0.1
TRUST_PROXY=1
STUDIO_TZ=Europe/Paris
# E-mails (facultatif) : clé Brevo et expéditeur
# BREVO_API_KEY=
# MAIL_FROM=Nada Atma <reservations@$DOMAIN>
CONF
  chmod 640 /etc/nada-atma.env
  chown root:nadaatma /etc/nada-atma.env
fi

echo "==> Service"
install -m 644 "$APP/deploy/nada-atma.service" /etc/systemd/system/nada-atma.service
systemctl daemon-reload
systemctl enable nada-atma >/dev/null
systemctl restart nada-atma

echo "==> Site HTTPS"
sed "s/{{DOMAIN}}/$DOMAIN/g" "$APP/deploy/Caddyfile" > /etc/caddy/Caddyfile
systemctl reload caddy || systemctl restart caddy

echo "==> Sauvegarde chaque nuit à 3h (30 jours gardés)"
install -m 755 "$APP/deploy/backup.sh" /usr/local/bin/nada-atma-backup
echo "0 3 * * * nadaatma /usr/local/bin/nada-atma-backup" > /etc/cron.d/nada-atma-backup

echo "==> Pare-feu (SSH, HTTP, HTTPS) et mises à jour de sécurité automatiques"
ufw allow OpenSSH >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null
dpkg-reconfigure -f noninteractive unattended-upgrades >/dev/null 2>&1 || true

sleep 2
if systemctl is-active --quiet nada-atma; then
  echo
  echo "Nada Atma tourne. Adresse : https://$DOMAIN"
  echo "Étapes suivantes :"
  echo "  1. Compte de la professeure : sudo -u nadaatma bash -c 'set -a; . /etc/nada-atma.env; cd $APP && node --disable-warning=ExperimentalWarning scripts/create-admin.js $ADMIN_EMAIL \"Prénom Nom\"'"
  echo "  2. Cours de la saison      : sudo -u nadaatma bash -c 'set -a; . /etc/nada-atma.env; cd $APP && node --disable-warning=ExperimentalWarning scripts/creneaux-nada-atma.js'"
else
  echo "Le service ne démarre pas : journalctl -u nada-atma -n 50"; exit 1
fi
