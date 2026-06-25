#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AUTOMATION_DIR="${AUTOMATION_DIR:-$(dirname "$SCRIPT_DIR")}"

# Source environment config if available, but preserve AUTOMATION_DIR
# if it was already set (avoids env file overriding during local testing)
_SAVED_AUTOMATION_DIR="${AUTOMATION_DIR}"
ENV_FILE="${AUTOMATION_DIR}/config/cronv-automation.env"
if [[ -f "$ENV_FILE" ]]; then
    set -a
    source "$ENV_FILE"
    set +a
fi
AUTOMATION_DIR="${_SAVED_AUTOMATION_DIR}"

REPO_LINK="${AUTOMATION_DIR}/repo/current"
OUTPUT_DIR="${AUTOMATION_DIR}/output"
CRONTAB_FILE="${OUTPUT_DIR}/crontab.txt"
CRONTAB_JSON="${OUTPUT_DIR}/crontab.json"
HTML_OUTPUT="${OUTPUT_DIR}/crontab.html"
NGINX_HTML_PATH="${NGINX_HTML_PATH:-/var/www/html/crontab.html}"
NGINX_WEB_DIR="${NGINX_WEB_DIR:-$(dirname "${NGINX_HTML_PATH}")}"
CRONV_DURATION="${CRONV_DURATION:-31d}"
CRONV_TITLE="${CRONV_TITLE:-Periodic CI Jobs}"
CRONV_WIDTH="${CRONV_WIDTH:-150}"

log() {
    echo "[$(date -u '+%Y-%m-%d %H:%M:%S UTC')] $*"
}

log "Sync detected (hash: ${GITSYNC_HASH:-unknown}), regenerating visualization..."

mkdir -p "$OUTPUT_DIR"

# Step 1: Parse periodics YAML into crontab format + JSON
log "Parsing periodics YAML..."
if ! python3 "${SCRIPT_DIR}/parse_cron.py" "${REPO_LINK}" \
        --json-output "${CRONTAB_JSON}" > "${CRONTAB_FILE}"; then
    log "ERROR: Parser failed, skipping HTML generation"
    exit 1
fi

JOB_COUNT=$(grep -cE '^[0-9@]' "${CRONTAB_FILE}" 2>/dev/null || echo 0)
log "Parsed ${JOB_COUNT} cron jobs"

if [[ "${JOB_COUNT}" -eq 0 ]]; then
    log "WARNING: No cron jobs found. Keeping existing visualization to avoid blank page."
    exit 0
fi

# Step 2: Generate legacy HTML via cronv (kept as fallback)
FROM_DATE=$(date -u +"%Y/%m/%d")
log "Generating HTML (from: ${FROM_DATE}, duration: ${CRONV_DURATION})..."

if ! cat "${CRONTAB_FILE}" | cronv \
    --from-date="${FROM_DATE}" \
    --from-time=00:00 \
    --duration="${CRONV_DURATION}" \
    --title="${CRONV_TITLE}" \
    -w "${CRONV_WIDTH}" \
    -o "${HTML_OUTPUT}"; then
    log "WARNING: cronv failed — web UI will still use JSON data"
fi

# Step 3: Deploy to nginx
if [[ -d "${NGINX_WEB_DIR}" ]]; then
    # Copy JSON data for the new web UI
    cp -f "${CRONTAB_JSON}" "${NGINX_WEB_DIR}/crontab.json"
    log "JSON data deployed to ${NGINX_WEB_DIR}/crontab.json"

    # Copy legacy HTML as fallback
    if [[ -f "${HTML_OUTPUT}" ]]; then
        cp -f "${HTML_OUTPUT}" "${NGINX_HTML_PATH}"
        log "Legacy HTML deployed to ${NGINX_HTML_PATH}"
    fi
else
    log "WARNING: nginx directory ${NGINX_WEB_DIR} does not exist, skipping copy"
    log "Output available at ${CRONTAB_JSON} and ${HTML_OUTPUT}"
fi

log "Done. ${JOB_COUNT} jobs visualized (hash: ${GITSYNC_HASH:-unknown})"
