#!/usr/bin/env bash
set -euo pipefail

readonly REPO="Yunz93/Mozi"
readonly APP_NAME="墨知"
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
require_command plutil
require_command stat

install_directory_identity() {
  [[ -d "$1" && ! -L "$1" ]] || return 1
  stat -f '%d:%i' "$1"
}

restore_install_backup() {
  local identity restored_identity
  [[ -n "${INSTALL_BACKUP_PATH:-}" && -d "$INSTALL_BACKUP_PATH" ]] || return 0
  # 不向已出现的目录移动备份，macOS mv 会将其嵌入而非交换。
  if [[ -e "$INSTALL_TARGET_PATH" || -L "$INSTALL_TARGET_PATH" ]]; then
    warn "安装目标已被其他操作占用，原应用保留在 ${INSTALL_BACKUP_PATH}，请手动恢复。"
    return 1
  fi
  identity="$(install_directory_identity "$INSTALL_BACKUP_PATH")" || return 1
  if mv "$INSTALL_BACKUP_PATH" "$INSTALL_TARGET_PATH"; then
    restored_identity="$(install_directory_identity "$INSTALL_TARGET_PATH")" || restored_identity=""
    if [[ "$restored_identity" == "$identity" ]]; then return 0; fi
    # 即使检查后才出现竞争，也保留并准确指出被 mv 嵌入的旧应用。
    if [[ "$(install_directory_identity "$INSTALL_TARGET_PATH/previous.app" 2>/dev/null || true)" == "$identity" ]]; then
      INSTALL_BACKUP_PATH="$INSTALL_TARGET_PATH/previous.app"
    fi
  fi
  warn "恢复旧应用失败，原应用保留在 ${INSTALL_BACKUP_PATH}，请手动恢复。"
  return 1
}

install_app_bundle() {
  local source="$1" target="$2" staging candidate backup bundle_id candidate_identity installed_identity
  # 同一目标的安装串行化；只有成功取得锁的进程才能在退出时释放它。
  if ! mkdir "${target}.mozi-install-lock"; then
    warn "已有安装操作或未清理的安装锁：${target}.mozi-install-lock，请确认其他安装已结束后重试。"
    return 1
  fi
  INSTALL_LOCK_DIR="${target}.mozi-install-lock"
  staging="$(mktemp -d "$(dirname "$target")/.mozi-install.XXXXXX")" || return 1
  candidate="${staging}/new.app"
  backup="${staging}/previous.app"
  INSTALL_STAGING_DIR="$staging"
  INSTALL_BACKUP_PATH="$backup"
  INSTALL_TARGET_PATH="$target"
  # 先在同一文件系统完整复制、校验，任何准备失败都不碰已安装应用。
  if ! ditto "$source" "$candidate" ||
     ! plutil -lint "$candidate/Contents/Info.plist" >/dev/null; then
    rm -rf "$staging"
    return 1
  fi
  bundle_id="$(plutil -extract CFBundleIdentifier raw -o - "$candidate/Contents/Info.plist")" || bundle_id=""
  if [[ "$bundle_id" != "com.bxyz.markdown-press" || ! -x "$candidate/Contents/MacOS/app" ]] ||
     ! xattr -cr "$candidate"; then
    rm -rf "$staging"
    return 1
  fi
  candidate_identity="$(install_directory_identity "$candidate")" || return 1
  if [[ -e "$target" || -L "$target" ]]; then
    if [[ ! -d "$target" || -L "$target" ]] || ! mv "$target" "$backup"; then
      rm -rf "$staging"
      return 1
    fi
  fi
  if mv "$candidate" "$target"; then
    installed_identity="$(install_directory_identity "$target")" || installed_identity=""
    if [[ "$installed_identity" == "$candidate_identity" ]]; then
      # 新应用已完整换入后才清理旧应用，不触及偏好、知识库或其他用户数据。
      rm -rf "$staging"
      return 0
    fi
    warn "安装目标在交换时被其他操作占用，未确认安装成功。"
  fi
  restore_install_backup || return 1
  rm -rf "$staging"
  return 1
}

ARCH="$(uname -m)"
case "$ARCH" in
  arm64) ASSET_ARCH="aarch64" ;;
  x86_64) ASSET_ARCH="x64" ;;
  *) die "不支持的 CPU 架构: ${ARCH}" ;;
esac

TMP_DIR="$(mktemp -d)"
MOUNT_POINT=""
cleanup() {
  # 恢复也验证目录身份，竞争时保留备份，不把嵌套移动误当作恢复成功。
  restore_install_backup || true
  if [[ -n "${INSTALL_STAGING_DIR:-}" && ! -d "${INSTALL_BACKUP_PATH:-}" ]]; then
    rm -rf "${INSTALL_STAGING_DIR}"
  fi
  if [[ -n "${INSTALL_LOCK_DIR:-}" ]]; then
    rmdir "$INSTALL_LOCK_DIR" || warn "请检查安装锁：${INSTALL_LOCK_DIR}"
  fi
  if [[ -n "${MOUNT_POINT}" && -d "${MOUNT_POINT}" ]]; then
    hdiutil detach "${MOUNT_POINT}" -quiet || true
  fi
  rm -rf "${TMP_DIR}"
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

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
  # 用户安装入口只接受正式版，指定标签也不能绕过渠道限制。
  if [[ ! "${tag}" =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]; then
    warn "仅支持正式版本标签（如 v2.3.6）；beta 请从对应预发布页面手动下载验证。"
    return 1
  fi
  printf '%s' "${tag}"
}

build_asset_url() {
  local tag="$1"
  local version="${tag#v}"
  printf 'https://github.com/%s/releases/download/%s/Mozi_%s_%s.dmg' \
    "${REPO}" "${tag}" "${version}" "${ASSET_ARCH}"
}

asset_url_exists() {
  local url="$1"
  local status
  status="$(
    curl -fsS -o /dev/null -w '%{http_code}' -L -I \
      -H "User-Agent: Mozi-installer" \
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

DMG_PATH=""
if [[ -n "${DMG_FILE:-}" ]]; then
  [[ -f "${DMG_FILE}" ]] || die "找不到安装包: ${DMG_FILE}"
  DMG_PATH="${DMG_FILE}"
  log "使用已下载的安装包: ${DMG_PATH}"
else
  log "正在查询 ${REPO} 的正式版 macOS 安装包 (${ASSET_ARCH})..."
  if ! ASSET_URL="$(resolve_asset_url)"; then
    if [[ "${ASSET_ARCH}" == "x64" ]]; then
      die "未找到 Intel (x64) 版 macOS 安装包。当前 Release 可能仅提供 Apple Silicon (aarch64) 版本。"
    fi
    die "未找到可用的 macOS 安装包。可尝试手动下载: https://github.com/${REPO}/releases/latest"
  fi

  DMG_PATH="${TMP_DIR}/Mozi.dmg"
  log "正在下载: ${ASSET_URL}"
  curl -fsSL -o "${DMG_PATH}" -H "User-Agent: Mozi-installer" "${ASSET_URL}"
fi

log "正在移除下载隔离标记..."
xattr -cr "${DMG_PATH}" 2>/dev/null || true

log "正在挂载安装镜像..."
MOUNT_POINT="$(hdiutil attach "${DMG_PATH}" -nobrowse | awk '/\/Volumes\// {print $3; exit}')"
[[ -n "${MOUNT_POINT}" && -d "${MOUNT_POINT}" ]] || die "无法挂载安装镜像。"

SOURCE_APP="$(find "${MOUNT_POINT}" -maxdepth 2 -name "${APP_NAME}.app" -type d -print -quit)"
[[ -n "${SOURCE_APP}" ]] || die "在 DMG 中未找到 ${APP_NAME}.app。"

log "正在安装到 ${INSTALL_DIR}..."
install_app_bundle "${SOURCE_APP}" "${APP_PATH}" || die "安装失败，原应用已保留或恢复。"

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
