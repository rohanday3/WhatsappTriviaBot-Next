#!/usr/bin/env bash
set -Eeuo pipefail

export PATH="${PATH:-/usr/local/bin:/usr/bin:/bin}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
umask 077

if [[ ${EUID} -ne 0 ]]; then
  echo "Run this installer as root: sudo ./scripts/install-updater.sh [repository-url] [branch]" >&2
  exit 1
fi

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_NAME="${SERVICE_NAME:-whatsapp-trivia}"
SERVICE_USER="${SERVICE_USER:-whatsapp-trivia}"
INSTALL_DIR="${INSTALL_DIR:-/opt/whatsapp-trivia}"
ENV_FILE="${ENV_FILE:-/etc/${SERVICE_NAME}.env}"
UPDATE_CONFIG_FILE="${UPDATE_CONFIG_FILE:-/etc/${SERVICE_NAME}-update.env}"
UPDATE_CACHE_DIR="${UPDATE_CACHE_DIR:-/var/cache/${SERVICE_NAME}-updater}"
UPDATE_COMMAND="${UPDATE_COMMAND:-/usr/local/sbin/update-${SERVICE_NAME}}"

repo_url="${1:-${REPO_URL:-}}"
branch="${2:-${UPDATE_BRANCH:-}}"

if [[ -z ${repo_url} ]] && command -v git >/dev/null 2>&1 && git -C "${SOURCE_DIR}" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  repo_url="$(git -C "${SOURCE_DIR}" remote get-url origin 2>/dev/null || true)"
  branch="${branch:-$(git -C "${SOURCE_DIR}" branch --show-current 2>/dev/null || true)}"
fi
branch="${branch:-main}"

install -D -m 0755 -o root -g root "${SOURCE_DIR}/scripts/update-server.sh" "${UPDATE_COMMAND}"

if [[ -n ${repo_url} ]]; then
  config_tmp="$(mktemp)"
  trap 'rm -f "${config_tmp}"' EXIT
  {
    printf '# Managed by install-updater.sh. Values are shell-quoted.\n'
    printf 'REPO_URL=%q\n' "${repo_url}"
    printf 'UPDATE_BRANCH=%q\n' "${branch}"
    printf 'SERVICE_NAME=%q\n' "${SERVICE_NAME}"
    printf 'SERVICE_USER=%q\n' "${SERVICE_USER}"
    printf 'INSTALL_DIR=%q\n' "${INSTALL_DIR}"
    printf 'ENV_FILE=%q\n' "${ENV_FILE}"
    printf 'UPDATE_CACHE_DIR=%q\n' "${UPDATE_CACHE_DIR}"
    printf 'BACKUP_BEFORE_UPDATE=true\n'
  } > "${config_tmp}"
  install -m 0600 -o root -g root "${config_tmp}" "${UPDATE_CONFIG_FILE}"
  echo "Configured repository updates from branch ${branch}."
elif [[ -f ${UPDATE_CONFIG_FILE} ]]; then
  echo "Kept existing updater configuration: ${UPDATE_CONFIG_FILE}"
else
  echo "Installed ${UPDATE_COMMAND}, but no Git repository URL was available."
  echo "Configure it once with:"
  echo "  sudo ${SOURCE_DIR}/scripts/install-updater.sh https://github.com/OWNER/REPOSITORY.git main"
  exit 0
fi

echo "Update command: sudo $(basename "${UPDATE_COMMAND}")"
echo "Validation only: sudo $(basename "${UPDATE_COMMAND}") --check"
