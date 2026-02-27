# Update Joni Instances

Batch update service for Joni EC2 instances. Automatically updates **free** instances in configurable batches, and processes **user-requested** updates for occupied instances.

## Setup

```bash
npm install
```

Copy `.env` and fill in your values (DB URI, SSH key path, GitHub PAT, etc.).

## Usage

### Start the batch update service

Runs on a cron interval, picking up free instances and user-requested updates:

```bash
npm start          # production
npm run start:dev  # development (auto-reload with nodemon)
```

### Test update on a single instance

Update a specific instance by its public IP with full verbose logging:

```bash
node scripts/test-update-single.js <PUBLIC_IP>
```

Example:

```bash
node scripts/test-update-single.js 54.123.45.67
```

> **Important:** The shell script `scripts/update-joni-instance.sh` is a **bash** script — do NOT run it with `node`. It is spawned automatically by the Node.js service and test script. If you ever need to run it manually:
>
> ```bash
> HOST_IP=54.123.45.67 KEY_FILE=./joni-key.pem GITHUB_PAT=ghp_xxx BRANCH=Joni-V1-BRAIN bash scripts/update-joni-instance.sh
> ```

## .env Configuration

| Variable | Description | Default |
|---|---|---|
| `DATABASE_URI` | MongoDB connection string | — |
| `UPDATE_BATCH_SIZE` | Number of instances to update per batch | `3` |
| `UPDATE_INTERVAL_MINUTES` | Minutes between batch runs | `5` |
| `UPDATE_BRANCH` | Git branch to deploy | `Joni-V1-BRAIN` |
| `UPDATE_VERSION` | Version string stamped in DB after update | `1.0.0` |
| `SSH_KEY_PATH` | Path to the SSH private key (.pem) | `./joni-key.pem` |
| `GITHUB_PAT` | GitHub personal access token for cloning | — |

## How It Works

1. On startup, writes `UPDATE_VERSION` to the `version-configs` collection as `target-version`.
2. Every `UPDATE_INTERVAL_MINUTES`, runs a batch cycle:
   - **Priority 1:** Processes instances with `updateStatus: "pending-user"` (user-requested via the app).
   - **Priority 2:** Picks up to `UPDATE_BATCH_SIZE` free instances whose `version` doesn't match `target-version`.
3. For each instance:
   - Sets `status: "updating"` in DB (prevents user assignment during update).
   - SSHs into the EC2 instance and runs the update script (stop containers, backup data, clone fresh code, restore data, rebuild).
   - On success: restores original `status`, stamps `version` and `currentBranch`.
   - On failure: restores original `status`, sets `updateStatus: "failed"`.

## Data Preserved During Updates

- `~/.joni/` — wallet, memory, sessions, config
- `~/JONI/.env.joni` — instance-specific environment

## Project Structure

```
Update-joni-instances/
├── bin/www                              # Entry point
├── app.js                               # Express app + service init
├── configs/index.js                     # .env loader
├── helpers/db.js                        # MongoDB connection
├── models/
│   ├── instances.model.js               # Instance schema
│   ├── update-lock.model.js             # Concurrency lock
│   └── version-config.model.js          # Global target version
├── scripts/
│   ├── update-joni-instance.sh          # Bash script run on each EC2 (via SSH)
│   └── test-update-single.js            # Manual single-instance test tool
└── services/
    └── update-instances.service.js      # Core batch update logic
```
# Update-joni-instances
# Update-joni-instances
