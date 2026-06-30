#!/usr/bin/env bash
set -Eeuo pipefail

export PATH="${PATH:-/usr/local/bin:/usr/bin:/bin}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
export GIT_TERMINAL_PROMPT=0
umask 077

usage() {
  cat <<'USAGE'
Usage: update-whatsapp-trivia [--check] [--force]

Fetch the configured Git branch, validate it, back up the SQLite database,
deploy it through the systemd installer, and restart the service.

Options:
  --check  Fetch and run the full validation suite without deploying or restarting.
  --force  Redeploy even when the installed commit is already current.
  -h, --help  Show this help.
USAGE
}

CHECK_ONLY=false
FORCE=false
while (($#)); do
  case "$1" in
    --check) CHECK_ONLY=true ;;
    --force) FORCE=true ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

if [[ ${EUID} -ne 0 ]]; then
  echo "Run the updater as root, for example: sudo update-whatsapp-trivia" >&2
  exit 1
fi

invoked_name="$(basename "$0")"
if [[ ${invoked_name} == update-* ]]; then
  default_service_name="${invoked_name#update-}"
else
  default_service_name="whatsapp-trivia"
fi

SERVICE_NAME="${SERVICE_NAME:-${default_service_name}}"
UPDATE_CONFIG_FILE="${UPDATE_CONFIG_FILE:-/etc/${SERVICE_NAME}-update.env}"

if [[ ! -r ${UPDATE_CONFIG_FILE} ]]; then
  echo "Updater configuration not found: ${UPDATE_CONFIG_FILE}" >&2
  echo "Configure it once with: sudo ./scripts/install-updater.sh <git-repository-url> [branch]" >&2
  exit 1
fi

# The file is root-managed and may contain shell-quoted values written by install-updater.sh.
# shellcheck disable=SC1090
source "${UPDATE_CONFIG_FILE}"

: "${REPO_URL:?REPO_URL is required in ${UPDATE_CONFIG_FILE}}"
UPDATE_BRANCH="${UPDATE_BRANCH:-main}"
SERVICE_NAME="${SERVICE_NAME:-${default_service_name}}"
SERVICE_USER="${SERVICE_USER:-whatsapp-trivia}"
INSTALL_DIR="${INSTALL_DIR:-/opt/whatsapp-trivia}"
ENV_FILE="${ENV_FILE:-/etc/${SERVICE_NAME}.env}"
UPDATE_CACHE_DIR="${UPDATE_CACHE_DIR:-/var/cache/${SERVICE_NAME}-updater}"
BACKUP_BEFORE_UPDATE="${BACKUP_BEFORE_UPDATE:-true}"

for command_name in git tar npm node flock systemctl; do
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    echo "Required command is missing: ${command_name}" >&2
    exit 1
  fi
done

RUNUSER_BIN="$(command -v runuser || true)"
if [[ ${SERVICE_USER} != root && -z ${RUNUSER_BIN} ]]; then
  echo "runuser is required to validate releases as ${SERVICE_USER}." >&2
  exit 1
fi
if ! id "${SERVICE_USER}" >/dev/null 2>&1; then
  echo "Service account does not exist: ${SERVICE_USER}" >&2
  echo "Install the service first with sudo ./scripts/install-systemd.sh" >&2
  exit 1
fi

install -d -m 0700 -o root -g root "${UPDATE_CACHE_DIR}"
lock_file="/run/lock/${SERVICE_NAME}-update.lock"
exec 9>"${lock_file}"
if ! flock -n 9; then
  echo "Another ${SERVICE_NAME} update is already running." >&2
  exit 1
fi

repo_dir="${UPDATE_CACHE_DIR}/repository"
stage_dir=""
cleanup() {
  if [[ -n ${stage_dir} && -d ${stage_dir} ]]; then
    rm -rf "${stage_dir}"
  fi
}
trap cleanup EXIT

if [[ -d ${repo_dir}/.git ]]; then
  configured_remote="$(git -C "${repo_dir}" remote get-url origin 2>/dev/null || true)"
  if [[ ${configured_remote} != "${REPO_URL}" ]]; then
    echo "Repository URL changed; rebuilding the updater cache."
    rm -rf "${repo_dir}"
  fi
elif [[ -e ${repo_dir} ]]; then
  rm -rf "${repo_dir}"
fi

if [[ ! -d ${repo_dir}/.git ]]; then
  echo "Cloning the configured repository..."
  git clone --filter=blob:none --no-checkout --origin origin "${REPO_URL}" "${repo_dir}"
else
  git -C "${repo_dir}" remote set-url origin "${REPO_URL}"
fi

echo "Fetching origin/${UPDATE_BRANCH}..."
git -C "${repo_dir}" fetch --prune --tags origin \
  "+refs/heads/${UPDATE_BRANCH}:refs/remotes/origin/${UPDATE_BRANCH}"

target_ref="refs/remotes/origin/${UPDATE_BRANCH}"
if ! git -C "${repo_dir}" show-ref --verify --quiet "${target_ref}"; then
  echo "Branch not found on origin: ${UPDATE_BRANCH}" >&2
  exit 1
fi

target_commit="$(git -C "${repo_dir}" rev-parse "${target_ref}^{commit}")"
short_target="$(git -C "${repo_dir}" rev-parse --short=12 "${target_commit}")"
installed_commit=""
if [[ -r ${INSTALL_DIR}/.deployed-commit ]]; then
  installed_commit="$(tr -d '[:space:]' < "${INSTALL_DIR}/.deployed-commit")"
fi

if [[ ${CHECK_ONLY} == false && ${FORCE} == false && -n ${installed_commit} && ${installed_commit} == "${target_commit}" ]]; then
  echo "${SERVICE_NAME} is already at ${short_target} from ${UPDATE_BRANCH}; nothing to deploy."
  systemctl is-active --quiet "${SERVICE_NAME}.service" || {
    echo "The code is current, but the service is not active." >&2
    exit 1
  }
  exit 0
fi

stage_dir="$(mktemp -d "${UPDATE_CACHE_DIR}/stage.XXXXXXXX")"
git -C "${repo_dir}" archive --format=tar "${target_commit}" | tar -xf - -C "${stage_dir}"
printf '%s\n' "${target_commit}" > "${stage_dir}/.deployed-commit"
printf '%s\n' "${UPDATE_BRANCH}" > "${stage_dir}/.deployed-branch"

service_group="$(id -gn "${SERVICE_USER}")"
chown -R "${SERVICE_USER}:${service_group}" "${stage_dir}"
install -d -m 0700 -o "${SERVICE_USER}" -g "${service_group}" "${stage_dir}/.update-home"

run_as_service() {
  local command_text="$1"
  if [[ ${SERVICE_USER} == root ]]; then
    HOME="${stage_dir}/.update-home" bash -c "${command_text}"
  else
    "${RUNUSER_BIN}" -u "${SERVICE_USER}" -- env \
      HOME="${stage_dir}/.update-home" \
      PATH="${PATH}" \
      bash -c "${command_text}"
  fi
}

node_version="$(run_as_service "node -p 'process.versions.node'")"
run_as_service "node -e 'const [a,b]=process.versions.node.split(\".\").map(Number); if(a<22 || (a===22 && b<13)) process.exit(1)'" || {
  echo "Node.js 22.13 or newer is required. Found: ${node_version}" >&2
  exit 1
}

echo "Validating commit ${short_target} before deployment..."
quoted_stage="$(printf '%q' "${stage_dir}")"
run_as_service "cd ${quoted_stage} && npm ci && npm run check"

if [[ ${CHECK_ONLY} == true ]]; then
  echo "Validation passed for ${short_target}. No files were deployed and the service was not restarted."
  exit 0
fi

if [[ ${BACKUP_BEFORE_UPDATE,,} == true && -f ${INSTALL_DIR}/scripts/backup.mjs && -f ${INSTALL_DIR}/package.json ]]; then
  database_path="$(
    ENV_FILE_VALUE="${ENV_FILE}" INSTALL_DIR_VALUE="${INSTALL_DIR}" bash -c '
      database_path="./var/trivia.db"
      if [[ -r ${ENV_FILE_VALUE} ]]; then
        set -a
        # shellcheck disable=SC1090
        source "${ENV_FILE_VALUE}"
        set +a
        database_path="${DATABASE_PATH:-./var/trivia.db}"
      fi
      if [[ ${database_path} = /* ]]; then
        printf "%s" "${database_path}"
      else
        printf "%s/%s" "${INSTALL_DIR_VALUE}" "${database_path#./}"
      fi
    '
  )"

  if [[ -f ${database_path} ]]; then
    echo "Creating a pre-update database backup..."
    quoted_install="$(printf '%q' "${INSTALL_DIR}")"
    quoted_env="$(printf '%q' "${ENV_FILE}")"
    backup_command="cd ${quoted_install} && if [[ -r ${quoted_env} ]]; then set -a; source ${quoted_env}; set +a; fi; npm run backup"
    if [[ ${SERVICE_USER} == root ]]; then
      HOME="${INSTALL_DIR}" bash -c "${backup_command}"
    else
      "${RUNUSER_BIN}" -u "${SERVICE_USER}" -- env HOME="${INSTALL_DIR}" PATH="${PATH}" bash -c "${backup_command}"
    fi
  else
    echo "No database exists yet; skipping the pre-update backup."
  fi
fi

echo "Deploying ${short_target} and restarting ${SERVICE_NAME}..."
REPO_URL="${REPO_URL}" \
UPDATE_BRANCH="${UPDATE_BRANCH}" \
UPDATE_CACHE_DIR="${UPDATE_CACHE_DIR}" \
INSTALL_DIR="${INSTALL_DIR}" \
SERVICE_NAME="${SERVICE_NAME}" \
SERVICE_USER="${SERVICE_USER}" \
ENV_FILE="${ENV_FILE}" \
bash "${stage_dir}/scripts/install-systemd.sh"

if ! systemctl is-active --quiet "${SERVICE_NAME}.service"; then
  echo "Deployment completed, but ${SERVICE_NAME}.service is not active." >&2
  systemctl status "${SERVICE_NAME}.service" --no-pager >&2 || true
  exit 1
fi

version="$(node -p "require('${INSTALL_DIR}/package.json').version" 2>/dev/null || true)"
if [[ -n ${version} ]]; then
  echo "Updated ${SERVICE_NAME} to v${version} (${short_target}) and restarted the service."
else
  echo "Updated ${SERVICE_NAME} to ${short_target} and restarted the service."
fi
