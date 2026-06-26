#!/usr/bin/env bash
set -Eeuo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Run this installer as root: sudo ./scripts/install-systemd.sh" >&2
  exit 1
fi

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALL_DIR="${INSTALL_DIR:-/opt/whatsapp-trivia}"
SERVICE_USER="${SERVICE_USER:-whatsapp-trivia}"
SERVICE_NAME="${SERVICE_NAME:-whatsapp-trivia}"
ENV_FILE="/etc/${SERVICE_NAME}.env"
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
  useradd --system --home-dir "${INSTALL_DIR}" --shell /usr/sbin/nologin "${SERVICE_USER}"
fi

install -d -m 0750 -o "${SERVICE_USER}" -g "${SERVICE_USER}" "${INSTALL_DIR}"
install -d -m 0700 -o "${SERVICE_USER}" -g "${SERVICE_USER}" "${INSTALL_DIR}/var"

# Copy application source without secrets, databases, dependencies, or build output.
tar -C "${SOURCE_DIR}" \
  --exclude='./node_modules' --exclude='./dist' --exclude='./var' --exclude='./.env' \
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
systemctl restart "${SERVICE_NAME}.service"

echo
echo "Installed ${SERVICE_NAME}."
echo "Edit config:  sudo editor ${ENV_FILE}"
echo "Follow logs:  sudo journalctl -u ${SERVICE_NAME} -f"
echo "Health:       curl http://127.0.0.1:8787/health/ready"
