#!/bin/sh
set -e

# Agent Deploy from the UI shells out to host Docker via the mounted socket.
if [ -S /var/run/docker.sock ]; then
  SOCK_GID="$(stat -c '%g' /var/run/docker.sock 2>/dev/null || stat -f '%g' /var/run/docker.sock)"
  if [ "$SOCK_GID" = "0" ]; then
    chmod 666 /var/run/docker.sock 2>/dev/null || true
  elif [ -n "$SOCK_GID" ]; then
    if ! getent group dockersock >/dev/null 2>&1; then
      addgroup -g "$SOCK_GID" -S dockersock 2>/dev/null || addgroup -S dockersock
    fi
    adduser nextjs dockersock 2>/dev/null || true
  fi
fi

cd /app
echo "Running database migrations..."
if [ -x /usr/local/bin/prisma ]; then
  su-exec nextjs prisma migrate deploy
else
  su-exec nextjs node ./node_modules/prisma/build/index.js migrate deploy
fi
echo "Starting Deck..."
exec su-exec nextjs node server.js
