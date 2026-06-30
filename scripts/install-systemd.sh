#!/usr/bin/env bash
set -Eeuo pipefail

export PATH="${PATH:-/usr/local/bin:/usr/bin:/bin}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

if [[ ${EUID} -ne 0 ]]; then
  echo "Run this installer as root: sudo ./scripts/install-systemd.sh" >&2
  exit 1
fi

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALL_DIR="${INSTALL_DIR:-/opt/whatsapp-trivia}"
SERVICE_USER="${SERVICE_USER:-whatsapp-trivia}"
SERVICE_NAME="${SERVICE_NAME:-whatsapp-trivia}"
ENV_FILE="${ENV_FILE:-/etc/${SERVICE_NAME}.env}"
NODE_BIN="$(command -v node || true)"

if [[ -z ${NODE_BIN} ]]; then
  echo "Node.js 22.13 or newer is required." >&2
  exit 1
fi

node -e 'const [a,b]=process.versions.node.split(".").map(Number); if(a<22 || (a===22 && b<13)) process.exit(1)' || {
  echo "Node.js 22.13 or newer is required. Found: $(node -v)" >&2
  exit 1
}

if ! id "${SERVICE_USER}" >/dev/null 2>&1; then
  USERADD_BIN="$(command -v useradd || true)"
  if [[ -z ${USERADD_BIN} ]]; then
    echo "useradd is required to create the ${SERVICE_USER} service account." >&2
    exit 1
  fi
  NOLOGIN_SHELL="$(command -v nologin || true)"
  NOLOGIN_SHELL="${NOLOGIN_SHELL:-/usr/sbin/nologin}"
  "${USERADD_BIN}" --system --home-dir "${INSTALL_DIR}" --shell "${NOLOGIN_SHELL}" "${SERVICE_USER}"
fi

install -d -m 0750 -o "${SERVICE_USER}" -g "${SERVICE_USER}" "${INSTALL_DIR}"
install -d -m 0700 -o "${SERVICE_USER}" -g "${SERVICE_USER}" "${INSTALL_DIR}/var"

# Remove obsolete release files while preserving all runtime data. This is
# skipped only when someone intentionally runs the installer from INSTALL_DIR.
source_real="$(readlink -f "${SOURCE_DIR}")"
install_real="$(readlink -f "${INSTALL_DIR}")"
if [[ ${source_real} != "${install_real}" ]]; then
  find "${INSTALL_DIR}" -mindepth 1 -maxdepth 1 \
    ! -name 'var' ! -name '.env' -exec rm -rf -- {} +
fi

# Copy application source without secrets, databases, repository metadata,
# dependencies, temporary validation files, or build output.
tar -C "${SOURCE_DIR}" \
  --exclude='./.git' --exclude='./.update-home' --exclude='./node_modules' \
  --exclude='./dist' --exclude='./var' --exclude='./.env' \
  -cf - . | tar -C "${INSTALL_DIR}" -xf -
chown -R "${SERVICE_USER}:${SERVICE_USER}" "${INSTALL_DIR}"

runuser -u "${SERVICE_USER}" -- bash -lc "cd '${INSTALL_DIR}' && rm -rf dist && npm ci && npm run build && npm prune --omit=dev"

if [[ ! -f ${ENV_FILE} ]]; then
  install -m 0640 -o root -g "${SERVICE_USER}" "${INSTALL_DIR}/.env.example" "${ENV_FILE}"
  echo "Created ${ENV_FILE}. Review it before pairing the bot."
fi

sed \
  -e "s|User=whatsapp-trivia|User=${SERVICE_USER}|" \
  -e "s|Group=whatsapp-trivia|Group=${SERVICE_USER}|" \
  -e "s|/opt/whatsapp-trivia|${INSTALL_DIR}|g" \
  -e "s|/etc/whatsapp-trivia.env|${ENV_FILE}|" \
  -e "s|/usr/bin/node|${NODE_BIN}|" \
  "${INSTALL_DIR}/deploy/systemd/whatsapp-trivia.service" \
  > "/etc/systemd/system/${SERVICE_NAME}.service"

systemctl daemon-reload
systemctl enable "${SERVICE_NAME}.service"

# Install or refresh the one-command Git updater. When this source tree is a
# Git checkout, its origin and current branch are detected automatically. A
# ZIP deployment can pass REPO_URL and UPDATE_BRANCH explicitly.
SERVICE_NAME="${SERVICE_NAME}" \
SERVICE_USER="${SERVICE_USER}" \
INSTALL_DIR="${INSTALL_DIR}" \
ENV_FILE="${ENV_FILE}" \
REPO_URL="${REPO_URL:-}" \
UPDATE_BRANCH="${UPDATE_BRANCH:-}" \
UPDATE_CACHE_DIR="${UPDATE_CACHE_DIR:-}" \
bash "${SOURCE_DIR}/scripts/install-updater.sh"

systemctl restart "${SERVICE_NAME}.service"

echo
echo "Installed ${SERVICE_NAME}."
echo "Edit config:  sudo editor ${ENV_FILE}"
echo "Follow logs:  sudo journalctl -u ${SERVICE_NAME} -f"
echo "Health:       curl http://127.0.0.1:8787/health/ready"
echo "Update:       sudo update-${SERVICE_NAME}"
