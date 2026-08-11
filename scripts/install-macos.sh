#!/usr/bin/env bash
set -euo pipefail

readonly REPO="Yunz93/markdown-press"
readonly APP_NAME="墨记"
readonly INSTALL_DIR="/Applications"
readonly APP_PATH="${INSTALL_DIR}/${APP_NAME}.app"
readonly RAW_SCRIPT_URL="https://raw.githubusercontent.com/${REPO}/main/scripts/install-macos.sh"

log() {
  printf '%s\n' "$*"
}

warn() {
  printf '警告: %s\n' "$*" >&2
}

die() {
  printf '错误: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "缺少依赖命令: $1"
}

[[ "$(uname -s)" == "Darwin" ]] || die "此脚本仅支持 macOS。"

require_command curl
require_command hdiutil
require_command ditto
require_command xattr

ARCH="$(uname -m)"
case "$ARCH" in
  arm64) ASSET_ARCH="aarch64" ;;
  x86_64) ASSET_ARCH="x64" ;;
  *) die "不支持的 CPU 架构: ${ARCH}" ;;
esac

TMP_DIR="$(mktemp -d)"
MOUNT_POINT=""
cleanup() {
  if [[ -n "${MOUNT_POINT}" && -d "${MOUNT_POINT}" ]]; then
    hdiutil detach "${MOUNT_POINT}" -quiet || true
  fi
  rm -rf "${TMP_DIR}"
}
trap cleanup EXIT

normalize_release_tag() {
  local tag="${1:-}"
  tag="${tag#"${tag%%[![:space:]]*}"}"
  tag="${tag%"${tag##*[![:space:]]}"}"

  if [[ -z "${tag}" ]]; then
    tag="$(
      curl -fsSL -o /dev/null -w '%{url_effective}' \
        "https://github.com/${REPO}/releases/latest" \
        | sed -E 's|.*/tag/||' \
        | tr -d '\r\n'
    )"
  fi

  [[ -n "${tag}" ]] || return 1
  [[ "${tag}" == v* ]] || tag="v${tag}"
  printf '%s' "${tag}"
}

build_asset_url() {
  local tag="$1"
  local version="${tag#v}"
  printf 'https://github.com/%s/releases/download/%s/Moji_%s_%s.dmg' \
    "${REPO}" "${tag}" "${version}" "${ASSET_ARCH}"
}

asset_url_exists() {
  local url="$1"
  local status
  status="$(
    curl -fsS -o /dev/null -w '%{http_code}' -L -I \
      -H "User-Agent: markdown-press-installer" \
      "${url}" 2>/dev/null || true
  )"
  [[ "${status}" == "200" || "${status}" == "302" ]]
}

resolve_asset_url() {
  local tag asset_url

  tag="$(normalize_release_tag "${RELEASE_TAG:-}")" || return 1
  asset_url="$(build_asset_url "${tag}")"
  asset_url_exists "${asset_url}" || return 1
  printf '%s' "${asset_url}"
}

log "正在查询 ${REPO} 的最新 macOS 安装包 (${ASSET_ARCH})..."
if ! ASSET_URL="$(resolve_asset_url)"; then
  if [[ "${ASSET_ARCH}" == "x64" ]]; then
    die "未找到 Intel (x64) 版 macOS 安装包。当前 Release 可能仅提供 Apple Silicon (aarch64) 版本。"
  fi
  die "未找到可用的 macOS 安装包。可尝试手动下载: https://github.com/${REPO}/releases/latest"
fi

DMG_PATH="${TMP_DIR}/markdown-press.dmg"
log "正在下载: ${ASSET_URL}"
curl -fsSL -o "${DMG_PATH}" -H "User-Agent: markdown-press-installer" "${ASSET_URL}"

log "正在移除下载隔离标记..."
xattr -cr "${DMG_PATH}" 2>/dev/null || true

log "正在挂载安装镜像..."
MOUNT_POINT="$(hdiutil attach "${DMG_PATH}" -nobrowse | awk '/\/Volumes\// {print $3; exit}')"
[[ -n "${MOUNT_POINT}" && -d "${MOUNT_POINT}" ]] || die "无法挂载安装镜像。"

SOURCE_APP="$(find "${MOUNT_POINT}" -maxdepth 2 -name "${APP_NAME}.app" -type d -print -quit)"
[[ -n "${SOURCE_APP}" ]] || die "在 DMG 中未找到 ${APP_NAME}.app。"

if [[ -d "${APP_PATH}" ]]; then
  log "正在替换已安装的 ${APP_NAME}..."
  rm -rf "${APP_PATH}"
fi

log "正在安装到 ${INSTALL_DIR}..."
ditto "${SOURCE_APP}" "${APP_PATH}"
xattr -cr "${APP_PATH}"

hdiutil detach "${MOUNT_POINT}" -quiet
MOUNT_POINT=""

log "✓ ${APP_NAME} 已安装到 ${APP_PATH}"
log "可在启动台或「应用程序」文件夹中打开。"

if [[ "${OPEN_APP:-1}" != "0" ]]; then
  log "正在启动 ${APP_NAME}..."
  open "${APP_PATH}" || warn "安装完成，但自动启动失败，请手动打开应用。"
fi

log ""
log "安装脚本: ${RAW_SCRIPT_URL}"
