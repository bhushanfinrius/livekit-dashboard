#!/bin/sh
set -e
cd /app
echo "Running database migrations..."
if [ -x /usr/local/bin/prisma ]; then
  prisma migrate deploy
else
  node ./node_modules/prisma/build/index.js migrate deploy
fi
echo "Starting Deck..."
exec node server.js
