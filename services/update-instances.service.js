const { spawn } = require("child_process");
const path = require("path");
const Instance = require("../models/instances.model");
const UpdateLock = require("../models/update-lock.model");
const VersionConfig = require("../models/version-config.model");
const {
  UPDATE_BATCH_SIZE,
  UPDATE_INTERVAL_MINUTES,
  UPDATE_BRANCH,
  UPDATE_VERSION,
  SSH_KEY_PATH,
  GITHUB_PAT,
} = require("../configs/index");

require("dotenv").config();

function ts() {
  return new Date().toISOString();
}

function log(msg) {
  console.log(`[${ts()}] ${msg}`);
}

function logErr(msg) {
  console.error(`[${ts()}] ERROR: ${msg}`);
}

class UpdateInstancesService {
  constructor() {
    this.batchSize = parseInt(UPDATE_BATCH_SIZE);
    this.intervalMs = parseInt(UPDATE_INTERVAL_MINUTES) * 60 * 1000;
    this.targetBranch = UPDATE_BRANCH;
    this.targetVersion = UPDATE_VERSION;
    this.sshKeyPath = path.resolve(__dirname, "..", SSH_KEY_PATH);
    this.githubPat = GITHUB_PAT;

    this.updateScript = path.join(
      __dirname,
      "..",
      "scripts",
      "update-joni-instance.sh"
    );
  }

  /* ─────────────── LOCK SYSTEM ─────────────── */

  async acquireLock() {
    const lock = await UpdateLock.findOne({ key: "update-instances" });
    const maxDuration = 30 * 60 * 1000;

    if (lock?.isRunning) {
      const lockAge = Date.now() - new Date(lock.startedAt).getTime();
      if (lockAge < maxDuration) {
        log("Update job is currently locked. Skipping this cycle.");
        return false;
      }
      log("Stale update lock detected (>30m). Overriding...");
    }

    await UpdateLock.findOneAndUpdate(
      { key: "update-instances" },
      {
        key: "update-instances",
        isRunning: true,
        startedAt: new Date(),
      },
      { upsert: true }
    );

    log("Lock acquired.");
    return true;
  }

  async releaseLock() {
    await UpdateLock.findOneAndUpdate(
      { key: "update-instances" },
      { isRunning: false }
    );
    log("Lock released.");
  }

  /* ─────────────── GET NEXT BATCH ─────────────── */

  async getUserRequestedBatch() {
    return Instance.find({
      updateStatus: "pending-user",
    }).limit(this.batchSize);
  }

  async getFreeBatch(limit) {
    return Instance.find({
      status: "free",
      userId: null,
      version: { $ne: this.targetVersion },
      updateStatus: { $ne: "updating" },
    }).limit(limit);
  }

  /* ─────────────── UPDATE SINGLE INSTANCE ─────────────── */

  runUpdate(instance) {
    return new Promise((resolve, reject) => {
      const child = spawn("bash", [this.updateScript], {
        cwd: path.dirname(this.updateScript),
        env: {
          ...process.env,
          HOST_IP: instance.publicIP,
          KEY_FILE: this.sshKeyPath,
          GITHUB_PAT: this.githubPat,
          BRANCH: this.targetBranch,
        },
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (d) => {
        const text = d.toString();
        stdout += text;
        text
          .split("\n")
          .filter((l) => l)
          .forEach((line) =>
            log(`  [${instance.name}] ${line}`)
          );
      });

      child.stderr.on("data", (d) => {
        const text = d.toString();
        stderr += text;
        text
          .split("\n")
          .filter((l) => l)
          .forEach((line) =>
            logErr(`  [${instance.name}] ${line}`)
          );
      });

      child.on("close", (code) => {
        if (code !== 0) {
          return reject(
            new Error(
              `Shell exited with code ${code}`
            )
          );
        }
        resolve({ stdout, stderr });
      });

      child.on("error", reject);
    });
  }

  async updateInstance(instance) {
    const originalStatus = instance.userId ? "occupied" : "free";

    log(
      `── Starting update: ${instance.name} (${instance.publicIP}) ` +
        `| status: "${instance.status}" -> restore as "${originalStatus}" (userId: ${instance.userId || 'none'}) ` +
        `| version: ${instance.version ?? "(none)"} -> ${this.targetVersion}`
    );

    log(`  DB: status -> "updating", updateStatus -> "updating"`);
    await Instance.findByIdAndUpdate(instance._id, {
      status: "updating",
      updateStatus: "updating",
    });

    const startTime = Date.now();

    try {
      await this.runUpdate(instance);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      log(
        `  DB: status -> "${originalStatus}", version -> "${this.targetVersion}", ` +
          `currentBranch -> "${this.targetBranch}", updateStatus -> "idle"`
      );
      await Instance.findByIdAndUpdate(instance._id, {
        status: originalStatus,
        version: this.targetVersion,
        currentBranch: this.targetBranch,
        updateStatus: "idle",
      });

      log(
        `── OK: ${instance.name} (${instance.publicIP}) -> v${this.targetVersion} in ${elapsed}s`
      );
    } catch (err) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      logErr(
        `── FAIL: ${instance.name} (${instance.publicIP}) after ${elapsed}s - ${err.message}`
      );

      log(`  DB: status -> "${originalStatus}", updateStatus -> "failed"`);
      await Instance.findByIdAndUpdate(instance._id, {
        status: originalStatus,
        updateStatus: "failed",
      });
    }
  }

  /* ─────────────── BATCH RUN ─────────────── */

  async runBatch() {
    const locked = await this.acquireLock();
    if (!locked) return;

    try {
      // Priority: user-requested updates first (occupied instances)
      const userBatch = await this.getUserRequestedBatch();
      if (userBatch.length > 0) {
        log(
          `\n━━━ User-requested updates: ${userBatch.length} instance(s) ` +
            `-> v${this.targetVersion} (${this.targetBranch}) ━━━`
        );
        for (let i = 0; i < userBatch.length; i++) {
          log(`[user ${i + 1}/${userBatch.length}] ${userBatch[i].name} (${userBatch[i].publicIP})`);
          await this.updateInstance(userBatch[i]);
        }
      }

      // Then: auto-update free instances
      const slotsLeft = this.batchSize - userBatch.length;
      if (slotsLeft <= 0) {
        log("Batch full with user-requested updates. Free auto-updates next cycle.");
        return;
      }

      const freeBatch = await this.getFreeBatch(slotsLeft);
      if (freeBatch.length === 0 && userBatch.length === 0) {
        log(
          `No instances need updating. All on v${this.targetVersion}.`
        );
        return;
      }

      if (freeBatch.length > 0) {
        const totalFree = await Instance.countDocuments({
          status: "free",
          userId: null,
          version: { $ne: this.targetVersion },
          updateStatus: { $ne: "updating" },
        });

        log(
          `\n━━━ Free auto-updates: ${freeBatch.length} of ${totalFree} remaining ` +
            `-> v${this.targetVersion} (${this.targetBranch}) ━━━`
        );

        for (let i = 0; i < freeBatch.length; i++) {
          log(`[free ${i + 1}/${freeBatch.length}] ${freeBatch[i].name} (${freeBatch[i].publicIP})`);
          await this.updateInstance(freeBatch[i]);
        }
      }

      const remaining = await Instance.countDocuments({
        status: "free",
        userId: null,
        version: { $ne: this.targetVersion },
        updateStatus: { $ne: "updating" },
      });
      const pendingUser = await Instance.countDocuments({
        updateStatus: "pending-user",
      });

      log(
        `━━━ Batch complete. ${remaining} free + ${pendingUser} user-requested still pending. ━━━\n`
      );
    } catch (err) {
      logErr(`Batch error: ${err.message}`);
      console.error(err);
    } finally {
      await this.releaseLock();
    }
  }

  /* ─────────────── START SERVICE ─────────────── */

  async setTargetVersion() {
    await VersionConfig.findOneAndUpdate(
      { key: "target-version" },
      { key: "target-version", value: this.targetVersion },
      { upsert: true }
    );
    log(`Target version set in DB: ${this.targetVersion}`);
  }

  async start() {
    log("═══════════════════════════════════════════════════");
    log("  Update Instances Service Started");
    log("═══════════════════════════════════════════════════");
    log(`  Version:  ${this.targetVersion}`);
    log(`  Branch:   ${this.targetBranch}`);
    log(`  Batch:    ${this.batchSize} instance(s) per run`);
    log(`  Interval: every ${UPDATE_INTERVAL_MINUTES} minute(s)`);
    log(`  SSH Key:  ${this.sshKeyPath}`);
    log("");

    await this.setTargetVersion();

    this.runBatch();

    setInterval(() => {
      this.runBatch();
    }, this.intervalMs);
  }
}

module.exports = UpdateInstancesService;
