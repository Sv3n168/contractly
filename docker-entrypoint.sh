#!/bin/sh
# Fix ownership of the data volume, then drop root privileges.
set -e
PUID="${PUID:-1000}"
PGID="${PGID:-1000}"
if [ "$(id -u)" = "0" ]; then
  mkdir -p /data
  if [ "$(stat -c %u /data)" != "$PUID" ]; then
    chown -R "$PUID:$PGID" /data
  fi
  exec setpriv --reuid="$PUID" --regid="$PGID" --clear-groups "$@"
fi
exec "$@"
