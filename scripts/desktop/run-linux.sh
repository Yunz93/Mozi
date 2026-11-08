#!/bin/sh
set -eu
desktop_runtime=$(mktemp -d)
trap 'rm -rf "$desktop_runtime"' EXIT
export XDG_RUNTIME_DIR="$desktop_runtime/session"
export XDG_CONFIG_HOME="$desktop_runtime/config"
export XDG_DATA_HOME="$desktop_runtime/data"
export XDG_CACHE_HOME="$desktop_runtime/cache"
mkdir -p "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"
dbus-run-session -- xvfb-run -a -s '-screen 0 1440x1000x24 -nolisten tcp' \
  sh -c 'openbox > "$XDG_RUNTIME_DIR/openbox.log" 2>&1 & exec node scripts/desktop/run.mjs'
