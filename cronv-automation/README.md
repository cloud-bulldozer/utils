# cronv-automation

Automated pipeline that keeps a periodic CI job cron visualization up to date.
Watches `openshift/release` for schedule changes and regenerates an interactive
web dashboard automatically.

## Features

- **Concurrency heatmap** — color-coded bar chart (green/yellow/red) showing
  how many jobs overlap at each time window
- **Conflict detection** — alerts when concurrent jobs exceed a configurable
  threshold, with details on which jobs overlap and when
- **Free slot highlighting** — shows available scheduling windows where no
  jobs are running
- **Date range presets** — 24h, 7 days, 1 month, 3 months, 6 months, 1 year,
  or a custom range
- **Version-grouped timeline** — jobs organized by OCP version with
  collapsible groups
- **Search and filter** — fuzzy search across job names, toggle versions on/off
- **Job detail popovers** — click any job to see its full Prow name,
  human-readable schedule, and next 5 run times
- **Timezone toggle** — switch between UTC and local time
- **Auto-refresh** — data refreshes every 5 minutes without a page reload
- **Red Hat dark theme** — styled with Red Hat brand colors

## How It Works

```
git-sync (polls openshift/release every 5 min)
   └─▶ exechook triggers on-sync.sh
         ├─▶ parse_cron.py reads Prow periodics YAML → crontab.json
         └─▶ cp crontab.json → nginx serving path
```

1. **git-sync** polls `openshift/release@main` every 5 minutes (sparse checkout)
2. On a new commit, it triggers `on-sync.sh` via the exechook mechanism
3. `parse_cron.py` reads the Prow periodics YAML and outputs structured JSON
4. The JSON is copied to the nginx serving path
5. The browser-based dashboard loads the JSON and renders the interactive
   timeline, heatmap, and conflict analysis client-side

No manual steps after initial setup.

## Prerequisites

Install these on the target host:

```bash
# Python 3 + PyYAML
sudo dnf install python3 python3-pyyaml   # RHEL/Fedora
# or: pip3 install pyyaml

# git-sync v4 (download binary from GitHub releases)
# https://github.com/kubernetes/git-sync/releases
# Download the linux_amd64 tar, extract, and install:
#   tar xzf git-sync_<version>_linux_amd64.tar.gz
#   sudo cp git-sync /usr/local/bin/

# Node.js (for building the web dashboard)
# https://nodejs.org/ — install v18+ or use nvm
```

For building the web dashboard (on your dev machine or the host):

```bash
# Verify Node.js is available
node --version   # v18+
npm --version
```

Legacy `cronv` HTML generation is optional (kept as a fallback):

```bash
# cronv (only needed if you want the legacy static HTML)
go install github.com/takumakanari/cronv/cronv@0.4.5
sudo cp ~/go/bin/cronv /usr/local/bin/
```

## Installation

```bash
# 1. Clone this repo to /opt/cronv-automation
sudo git clone https://github.com/cloud-bulldozer/utils.git /tmp/utils
sudo cp -r /tmp/utils/cronv-automation /opt/cronv-automation

# 2. Create runtime directories
sudo mkdir -p /opt/cronv-automation/{repo,output}

# 3. Make scripts executable
sudo chmod +x /opt/cronv-automation/scripts/*.sh

# 4. Build the web dashboard
cd /opt/cronv-automation/web
sudo npm install
sudo npx vite build

# 5. Deploy web files to nginx
sudo cp -r /opt/cronv-automation/web/dist/* /usr/share/nginx/html/

# 6. Edit the environment config
sudo vi /opt/cronv-automation/config/cronv-automation.env
# Set NGINX_HTML_PATH and NGINX_WEB_DIR to match your nginx setup

# 7. Install and start the systemd service
sudo cp /opt/cronv-automation/systemd/cronv-git-sync.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now cronv-git-sync.service
```

## Configuration

Edit `config/cronv-automation.env` to customize:

| Variable | Default | Description |
|----------|---------|-------------|
| `NGINX_HTML_PATH` | `/var/www/html/crontab.html` | Where the legacy HTML is written |
| `NGINX_WEB_DIR` | derived from `NGINX_HTML_PATH` | Directory where nginx serves the web UI and JSON data |
| `CRONV_DURATION` | `31d` | Legacy HTML timeline window |
| `CRONV_TITLE` | `Periodic CI Jobs` | Legacy HTML page title |
| `CRONV_WIDTH` | `150` | Legacy HTML table width |
| `GIT_SYNC_PERIOD` | `300s` | How often to check for changes |
| `REPO_URL` | `https://github.com/openshift/release.git` | Repository to watch |
| `REPO_REF` | `main` | Branch to track |
| `AUTOMATION_DIR` | `/opt/cronv-automation` | Base install directory |

After editing, restart the service:

```bash
sudo systemctl restart cronv-git-sync.service
```

## Usage

### Check service status

```bash
sudo systemctl status cronv-git-sync.service
```

### View logs

```bash
journalctl -u cronv-git-sync -f            # follow live
journalctl -u cronv-git-sync --since today  # today's logs
```

### Manual test run

```bash
# Parse the periodics YAML and generate JSON
python3 /opt/cronv-automation/scripts/parse_cron.py /path/to/release \
    --json-output /tmp/crontab.json > /tmp/crontab.txt

# Inspect the output
python3 -c "import json; d=json.load(open('/tmp/crontab.json')); print(f'{d[\"total_jobs\"]} jobs')"
```

### Local development (web dashboard)

```bash
cd /opt/cronv-automation/web
npm install
npm run dev
# Opens at http://localhost:5173 with sample data
```

### Force a re-sync

```bash
sudo systemctl restart cronv-git-sync.service
```

This triggers a fresh sync and re-runs the pipeline.

## Troubleshooting

### Service won't start

```bash
# Check for errors
journalctl -u cronv-git-sync -n 50 --no-pager

# Verify git-sync binary is in PATH
which git-sync
```

### Parser finds 0 jobs

The parser will log a warning and skip deployment to avoid overwriting
a working visualization with empty data. Check:

```bash
# Verify the sparse checkout contains the periodics file
ls -la /opt/cronv-automation/repo/current/ci-operator/jobs/openshift-eng/ocp-qe-perfscale-ci/

# Test the parser directly
python3 /opt/cronv-automation/scripts/parse_cron.py /opt/cronv-automation/repo/current
```

### Dashboard shows "Could not load schedule data"

1. Verify `crontab.json` exists in the nginx directory:
   `ls -la /usr/share/nginx/html/crontab.json`
2. Restart the service to trigger a fresh sync:
   `sudo systemctl restart cronv-git-sync.service`
3. Check that `NGINX_WEB_DIR` in the env config points to the nginx root

### Data age keeps growing

This is normal. The "Data: Xm ago" badge shows when the pipeline last ran,
which only happens when `openshift/release` receives a new commit. If no
schedule changes have been merged, the data stays the same. The browser still
checks for updates every 5 minutes.

## Repository Structure

```
cronv-automation/
├── README.md                      # This file
├── scripts/
│   ├── parse_cron.py              # Prow YAML → JSON + crontab.txt parser
│   └── on-sync.sh                 # Orchestrator (parse → deploy to nginx)
├── config/
│   ├── cronv-automation.env       # Environment configuration
│   └── sparse-checkout            # git sparse-checkout scope
├── systemd/
│   └── cronv-git-sync.service     # systemd unit file
└── web/                           # Interactive web dashboard
    ├── index.html                 # Entry point
    ├── package.json               # Node.js dependencies
    ├── vite.config.js             # Build configuration
    ├── public/
    │   ├── crontab.json           # Sample data for development
    │   └── favicon.svg
    └── src/
        ├── main.js                # App bootstrap and auto-refresh
        ├── store.js               # Reactive state management
        ├── cron.js                # Cron parsing, concurrency, conflict detection
        ├── theme.css              # Red Hat dark theme
        └── components/
            ├── header.js          # Branding bar, timezone toggle, data age
            ├── toolbar.js         # Date range pills, version filters, search
            ├── timeline.js        # Timeline grid with markers and column shading
            ├── heatmap.js         # Concurrency heatmap (Canvas)
            ├── sidebar.js         # Version navigation
            ├── conflicts.js       # Conflict alert banner
            ├── free-slots.js      # Available scheduling windows
            └── job-detail.js      # Job detail popover
```
