#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="$DIR/backups"
KEEP_DAYS=7

mkdir -p "$BACKUP_DIR"

STAMP="$(date +%Y%m%d-%H%M%S)"
tar czf "$BACKUP_DIR/config-$STAMP.tar.gz" -C "$DIR" \
    swag/config init-certbot-config.run ../docker-compose.duckdns.yml

find "$BACKUP_DIR" -name 'config-*.tar.gz' -mtime +"$KEEP_DAYS" -delete

echo "Backup criado: $BACKUP_DIR/config-$STAMP.tar.gz"
echo "Backups atuais:"
ls -lh "$BACKUP_DIR"/config-*.tar.gz
