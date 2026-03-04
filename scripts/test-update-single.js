#!/usr/bin/env node

/**
 * Test script: update a single instance by public IP.
 *
 * Usage:
 *   node scripts/test-update-single.js <PUBLIC_IP>
 *
 * Reads .env from the project root, connects to MongoDB,
 * finds the instance, runs the full update with verbose logging,
 * and updates all DB fields (status, version, currentBranch, updateStatus).
 */

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const mongoose = require("mongoose");
const { spawn } = require("child_process");
const {
  database,
  UPDATE_BRANCH,
  UPDATE_VERSION,
  SSH_KEY_PATH,
  GITHUB_PAT,
} = require("../configs/index");

const Instance = require("../models/instances.model");

const PUBLIC_IP = process.argv[2];

if (!PUBLIC_IP) {
  console.error("Usage: node scripts/test-update-single.js <PUBLIC_IP>");
  process.exit(1);
}

const sshKeyPath = path.resolve(__dirname, "..", SSH_KEY_PATH);
const updateScript = path.join(__dirname, "update-joni-instance.sh");

function ts() {
  return new Date().toISOString();
}

function log(msg) {
  console.log(`[${ts()}] ${msg}`);
}

function logErr(msg) {
  console.error(`[${ts()}] ERROR: ${msg}`);
}

function printInstance(label, doc) {
  console.log(`\n  ── ${label} ──`);
  console.log(`  name:          ${doc.name}`);
  console.log(`  instanceId:    ${doc.instanceId}`);
  console.log(`  publicIP:      ${doc.publicIP}`);
  console.log(`  status:        ${doc.status}`);
  console.log(`  version:       ${doc.version ?? "(none)"}`);
  console.log(`  currentBranch: ${doc.currentBranch ?? "(none)"}`);
  console.log(`  updateStatus:  ${doc.updateStatus ?? "(none)"}`);
  console.log(`  userId:        ${doc.userId ?? "(none)"}`);
  console.log("");
}

function runShellUpdate() {
  return new Promise((resolve, reject) => {
    const child = spawn("bash", [updateScript], {
      cwd: path.dirname(updateScript),
      env: {
        ...process.env,
        HOST_IP: PUBLIC_IP,
        KEY_FILE: sshKeyPath,
        GITHUB_PAT,
        BRANCH: UPDATE_BRANCH,
      },
    });

    child.stdout.on("data", (d) => {
      d.toString()
        .split("\n")
        .filter((l) => l)
        .forEach((line) => log(`  [ssh] ${line}`));
    });

    child.stderr.on("data", (d) => {
      d.toString()
        .split("\n")
        .filter((l) => l)
        .forEach((line) => logErr(`  [ssh] ${line}`));
    });

    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`Shell script exited with code ${code}`));
      resolve();
    });

    child.on("error", reject);
  });
}

(async () => {
  try {
    log("═══════════════════════════════════════════════════");
    log("  JONI Single Instance Update Test");
    log("═══════════════════════════════════════════════════");
    log(`Target IP:      ${PUBLIC_IP}`);
    log(`Target version: ${UPDATE_VERSION}`);
    log(`Target branch:  ${UPDATE_BRANCH}`);
    log(`SSH key:        ${sshKeyPath}`);
    console.log("");

    // Step 1: Connect to DB
    log("Step 1/7: Connecting to MongoDB...");
    mongoose.set("strictQuery", false);
    await mongoose.connect(database.uri);
    log("Step 1/7: Connected to MongoDB");

    // Step 2: Find instance by IP
    log(`Step 2/7: Looking up instance with publicIP=${PUBLIC_IP}...`);
    const instance = await Instance.findOne({ publicIP: PUBLIC_IP });
    if (!instance) {
      logErr(`No instance found with publicIP=${PUBLIC_IP}`);
      process.exit(1);
    }
    printInstance("BEFORE update", instance);

    const originalStatus = instance.userId ? "occupied" : "free";
    log(`  Resolved status: "${originalStatus}" (userId: ${instance.userId ? 'yes' : 'none'})`);

    // Step 3: Mark instance as updating
    log("Step 3/7: Setting status='updating', updateStatus='updating' in DB...");
    await Instance.findByIdAndUpdate(instance._id, {
      status: "updating",
      updateStatus: "updating",
    });
    log("Step 3/7: Instance locked for update (invisible to user assignment)");

    // Step 4: Run SSH update
    log("Step 4/7: Running SSH update script...");
    console.log("");
    const startTime = Date.now();

    try {
      await runShellUpdate();
    } catch (err) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      logErr(`SSH update FAILED after ${elapsed}s: ${err.message}`);

      log(`Rolling back: setting status='${originalStatus}', updateStatus='failed'...`);
      await Instance.findByIdAndUpdate(instance._id, {
        status: originalStatus,
        updateStatus: "failed",
      });

      const after = await Instance.findById(instance._id);
      printInstance("AFTER update (FAILED)", after);

      await mongoose.disconnect();
      process.exit(1);
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    log(`Step 4/7: SSH update completed in ${elapsed}s`);

    // Step 5: Stamp version + branch in DB, restore original status
    log(`Step 5/7: Setting status='${originalStatus}', version='${UPDATE_VERSION}', currentBranch='${UPDATE_BRANCH}' in DB...`);
    await Instance.findByIdAndUpdate(instance._id, {
      status: originalStatus,
      version: UPDATE_VERSION,
      currentBranch: UPDATE_BRANCH,
      updateStatus: "idle",
    });
    log("Step 5/7: DB updated successfully");

    // Step 6: Verify final state
    log("Step 6/7: Verifying final DB state...");
    const after = await Instance.findById(instance._id);
    printInstance("AFTER update (SUCCESS)", after);

    // Step 7: Summary
    log("Step 7/7: Done!");
    log("═══════════════════════════════════════════════════");
    log(`  Instance ${after.name} (${PUBLIC_IP})`);
    log(`  version:       ${instance.version ?? "(none)"} -> ${after.version}`);
    log(`  currentBranch: ${instance.currentBranch ?? "(none)"} -> ${after.currentBranch}`);
    log(`  status:        ${instance.status} -> ${after.status}`);
    log(`  updateStatus:  ${instance.updateStatus ?? "(none)"} -> ${after.updateStatus}`);
    log(`  Duration:      ${elapsed}s`);
    log("═══════════════════════════════════════════════════");

    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    logErr(err.message);
    console.error(err);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  }
})();
