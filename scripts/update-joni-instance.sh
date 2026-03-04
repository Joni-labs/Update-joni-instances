#!/usr/bin/env bash
set -euo pipefail

# Update a single JONI instance via SSH.
# All configuration is passed via environment variables:
#   HOST_IP     - public IP of the EC2 instance
#   KEY_FILE    - path to the SSH private key
#   GITHUB_PAT  - GitHub personal access token
#   BRANCH      - git branch to deploy (e.g. Joni-V1-BRAIN)

ts() { date '+%Y-%m-%dT%H:%M:%S'; }

log()  { echo "[$(ts)] $*"; }
err()  { echo "[$(ts)] ERROR: $*" >&2; }

if [[ -z "${HOST_IP:-}" ]]; then
  err "HOST_IP is required"
  exit 1
fi
if [[ -z "${KEY_FILE:-}" ]]; then
  err "KEY_FILE is required"
  exit 1
fi
if [[ -z "${GITHUB_PAT:-}" ]]; then
  err "GITHUB_PAT is required"
  exit 1
fi

BRANCH="${BRANCH:-Joni-V1-BRAIN}"
SSH_HOST="ubuntu@${HOST_IP}"
SSH_OPTS=(-o StrictHostKeyChecking=accept-new -o ConnectTimeout=10 -i "$KEY_FILE")
CLONE_URL="https://${GITHUB_PAT}@github.com/Joni-labs/JONI-BRAIN.git"

TOTAL_START=$SECONDS

log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log "Updating JONI on ${HOST_IP} to branch: ${BRANCH}"
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Step 1: Stop containers
STEP_START=$SECONDS
log "[1/9] Stopping running JONI containers..."
ssh "${SSH_OPTS[@]}" "$SSH_HOST" "cd ~/JONI 2>/dev/null && docker compose down || true"
log "[1/9] Containers stopped ($(( SECONDS - STEP_START ))s)"

# Step 2: Prune Docker cache
STEP_START=$SECONDS
log "[2/9] Pruning Docker system (images, containers, build cache)..."
ssh "${SSH_OPTS[@]}" "$SSH_HOST" "docker system prune -a -f"
log "[2/9] Docker prune complete ($(( SECONDS - STEP_START ))s)"

# Step 3: Backup .env.joni and ~/.joni
STEP_START=$SECONDS
log "[3/9] Backing up .env.joni and ~/.joni..."
ssh "${SSH_OPTS[@]}" "$SSH_HOST" "
  if [[ -f ~/JONI/.env.joni ]]; then
    cp ~/JONI/.env.joni /tmp/.env.joni.bak
    echo 'BACKUP: .env.joni -> /tmp/.env.joni.bak'
  else
    echo 'BACKUP: no .env.joni found, skipping'
  fi
  if [[ -d ~/.joni ]]; then
    cp -r ~/.joni /tmp/.joni-backup
    echo 'BACKUP: ~/.joni -> /tmp/.joni-backup'
  else
    echo 'BACKUP: no ~/.joni found, skipping'
  fi
"
log "[3/9] Backup complete ($(( SECONDS - STEP_START ))s)"

# Step 4: Remove old source
STEP_START=$SECONDS
log "[4/9] Removing old JONI source..."
ssh "${SSH_OPTS[@]}" "$SSH_HOST" "rm -rf ~/JONI && echo 'Removed ~/JONI'"
log "[4/9] Old source removed ($(( SECONDS - STEP_START ))s)"

# Step 5: Clone fresh from branch
STEP_START=$SECONDS
log "[5/9] Cloning from branch ${BRANCH}..."
ssh "${SSH_OPTS[@]}" "$SSH_HOST" "GIT_TERMINAL_PROMPT=0 git clone -b ${BRANCH} ${CLONE_URL} ~/JONI && cd ~/JONI && echo 'Cloned. On branch:' && git branch --show-current && echo 'Commit:' && git log --oneline -1"
log "[5/9] Clone complete ($(( SECONDS - STEP_START ))s)"

# Step 6: Restore .env.joni
STEP_START=$SECONDS
log "[6/9] Restoring .env.joni..."
ssh "${SSH_OPTS[@]}" "$SSH_HOST" "
  if [[ -f /tmp/.env.joni.bak ]]; then
    cp /tmp/.env.joni.bak ~/JONI/.env.joni
    echo 'RESTORE: .env.joni restored'
  else
    echo 'RESTORE: no .env.joni backup found'
  fi
"
log "[6/9] .env.joni restore done ($(( SECONDS - STEP_START ))s)"

# Step 6b: Inject any missing env vars into .env.joni
ssh "${SSH_OPTS[@]}" "$SSH_HOST" "
  grep -q '^ALCHEMY_API_KEY=' ~/JONI/.env.joni 2>/dev/null || echo 'ALCHEMY_API_KEY=_b50-oCapOtUkL7Auw6Re' >> ~/JONI/.env.joni
"

# Step 7: Restore ~/.joni (wallet, memory, sessions, config)
STEP_START=$SECONDS
log "[7/9] Restoring ~/.joni (wallet, memory, sessions, config)..."
ssh "${SSH_OPTS[@]}" "$SSH_HOST" "
  if [[ -d /tmp/.joni-backup ]]; then
    rm -rf ~/.joni
    cp -r /tmp/.joni-backup ~/.joni
    echo 'RESTORE: ~/.joni restored'
    echo 'Contents:'
    ls -la ~/.joni/ 2>/dev/null || true
  else
    echo 'RESTORE: no ~/.joni backup found'
  fi
"
log "[7/9] ~/.joni restore done ($(( SECONDS - STEP_START ))s)"

# Step 8: Rebuild & start
STEP_START=$SECONDS
log "[8/9] Rebuilding & starting JONI (docker-setup.sh)..."
ssh "${SSH_OPTS[@]}" "$SSH_HOST" "cd ~/JONI && chmod +x docker-setup.sh && ./docker-setup.sh"
log "[8/9] Docker rebuild & start complete ($(( SECONDS - STEP_START ))s)"

# Step 9: Set default model
STEP_START=$SECONDS
log "[9/9] Setting default model..."
ssh "${SSH_OPTS[@]}" "$SSH_HOST" "cd ~/JONI && docker compose run --rm joni-cli models set openrouter/anthropic/claude-sonnet-4-5 || true"
log "[9/9] Model set ($(( SECONDS - STEP_START ))s)"

TOTAL_ELAPSED=$(( SECONDS - TOTAL_START ))
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log "JONI updated to ${BRANCH} on ${HOST_IP}"
log "Total time: ${TOTAL_ELAPSED}s"
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
