#!/bin/sh
set -eu
desktop_entry=${1:-scripts/desktop/run.mjs}
case "$desktop_entry" in
  scripts/desktop/run.mjs|scripts/desktop/linux-upgrade.mjs) ;;
  *) echo 'Unsupported desktop test entry' >&2; exit 1 ;;
esac
desktop_runtime=$(mktemp -d)
trap 'rm -rf "$desktop_runtime"' EXIT
export XDG_RUNTIME_DIR="$desktop_runtime/session"
export XDG_CONFIG_HOME="$desktop_runtime/config"
export XDG_DATA_HOME="$desktop_runtime/data"
export XDG_CACHE_HOME="$desktop_runtime/cache"
mkdir -p "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"
dbus-run-session -- xvfb-run -a -s '-screen 0 1440x1000x24 -nolisten tcp' \
  sh -c 'openbox > "$XDG_RUNTIME_DIR/openbox.log" 2>&1 & exec node "$1"' sh "$desktop_entry"
