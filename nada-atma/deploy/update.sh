#!/usr/bin/env bash
# Mettre à jour le code (après un git pull ou une nouvelle copie du dossier), sans toucher aux données.
# Usage : sudo bash deploy/update.sh
set -euo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)"
/usr/local/bin/nada-atma-backup || true
rsync -a --delete --exclude data --exclude node_modules --exclude 'demo/nada-atma-essai.html' "$SRC"/ /opt/nada-atma/
systemctl restart nada-atma
sleep 2 && systemctl is-active --quiet nada-atma && echo "Mise à jour faite." || { echo "Problème : journalctl -u nada-atma -n 50"; exit 1; }
