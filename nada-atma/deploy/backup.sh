#!/usr/bin/env bash
# Sauvegarde cohérente de la base (même pendant l'utilisation), 30 jours gardés.
set -euo pipefail
set -a; . /etc/nada-atma.env; set +a
DEST=/var/backups/nada-atma
STAMP=$(date +%Y-%m-%d)
sqlite3 "$DB_FILE" ".backup '$DEST/nada-atma-$STAMP.db'"
gzip -f "$DEST/nada-atma-$STAMP.db"
find "$DEST" -name 'nada-atma-*.db.gz' -mtime +30 -delete
