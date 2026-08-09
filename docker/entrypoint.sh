#!/bin/sh
set -eu
umask 077

ZT_DATA_DIR="/data/zerotier"
APP_STATE_DIR="/data/app"

mkdir -p "$ZT_DATA_DIR" "$APP_STATE_DIR" /var/lib
chmod 700 "$ZT_DATA_DIR" "$APP_STATE_DIR"
if [ -e /var/lib/zerotier-one ] && [ ! -L /var/lib/zerotier-one ]; then
  echo "Expected /var/lib/zerotier-one to be a symlink" >&2
  exit 1
fi
ln -sfn "$ZT_DATA_DIR" /var/lib/zerotier-one
chown -R controlplane:controlplane "$APP_STATE_DIR"
find "$APP_STATE_DIR" -type f -exec chmod 600 {} +

/usr/sbin/zerotier-one &
ZT_PID=$!

attempt=0
while [ ! -s "$ZT_DATA_DIR/authtoken.secret" ]; do
  attempt=$((attempt + 1))
  if [ "$attempt" -gt 100 ]; then
    echo "ZeroTier did not create its local API token" >&2
    kill "$ZT_PID" 2>/dev/null || true
    exit 1
  fi
  sleep 0.1
done
chgrp controlplane "$ZT_DATA_DIR/authtoken.secret"
chmod 640 "$ZT_DATA_DIR/authtoken.secret"

gosu controlplane node server.js &
WEB_PID=$!

shutdown() {
  kill -TERM "$WEB_PID" "$ZT_PID" 2>/dev/null || true
  wait "$WEB_PID" 2>/dev/null || true
  wait "$ZT_PID" 2>/dev/null || true
}
trap shutdown INT TERM EXIT

while kill -0 "$ZT_PID" 2>/dev/null && kill -0 "$WEB_PID" 2>/dev/null; do
  sleep 1
done
exit 1
