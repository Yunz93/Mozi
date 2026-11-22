#!/bin/sh
set -eu
desktop_entry=${1:-scripts/desktop/run.mjs}
case "$desktop_entry" in
  scripts/desktop/run.mjs|scripts/desktop/linux-upgrade.mjs) ;;
  *) echo 'Unsupported desktop test entry' >&2; exit 1 ;;
esac
desktop_runtime=$(mktemp -d)
# 文档门户可能挂载 FUSE；先卸载本次测试的挂载，再移除临时目录。
cleanup_runtime() {
  desktop_exit=$?
  trap - EXIT
  desktop_document_portal="$desktop_runtime/session/doc"
  if mountpoint -q "$desktop_document_portal"; then
    if ! fusermount3 -u -z "$desktop_document_portal"; then
      echo "Failed to unmount desktop test document portal: $desktop_document_portal" >&2
      exit 1
    fi
  fi
  if ! rm -rf "$desktop_runtime"; then
    exit 1
  fi
  exit "$desktop_exit"
}
trap cleanup_runtime EXIT
export XDG_RUNTIME_DIR="$desktop_runtime/session"
export XDG_CONFIG_HOME="$desktop_runtime/config"
export XDG_DATA_HOME="$desktop_runtime/data"
export XDG_CACHE_HOME="$desktop_runtime/cache"
mkdir -p "$XDG_RUNTIME_DIR"
chmod 700 "$XDG_RUNTIME_DIR"
dbus-run-session -- xvfb-run -a -s '-screen 0 1440x1000x24 -nolisten tcp' \
  sh -c 'openbox > "$XDG_RUNTIME_DIR/openbox.log" 2>&1 & exec node "$1"' sh "$desktop_entry"
