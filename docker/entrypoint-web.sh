#!/bin/sh
set -eu
umask 077

APP_STATE_DIR="${APP_DATA_DIR:-/data/app}"
mkdir -p "$APP_STATE_DIR"
chmod 700 "$APP_STATE_DIR"
find "$APP_STATE_DIR" -type f -exec chmod 600 {} +

exec node server.js
