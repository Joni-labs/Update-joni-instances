const fs = require("fs");
const path = require("path");
const express = require("express");
const { exec } = require("child_process");

const router = express.Router();

const ENV_PATH = path.resolve(process.cwd(), ".env");
const TARGET_BRANCH = "refs/heads/Joni-V1-BRAIN";
const PM2_PROCESS = "Joni-update-instance-dev";

router.post("/webhook/brain", (req, res) => {
  try {
    // 1️⃣ Only react to correct branch
    if (req.body.ref !== TARGET_BRANCH) {
      return res.status(200).send("Ignored branch");
    }

    // 2️⃣ Read .env
    let env = fs.readFileSync(ENV_PATH, "utf8");

    const match = env.match(/UPDATE_VERSION=(\d+)\.(\d+)\.(\d+)/);
    if (!match) {
      return res.status(500).send("Invalid UPDATE_VERSION format");
    }

    let major = match[1];
    let minor = match[2];
    let patch = Number(match[3]) + 1;

    const newVersion = `${major}.${minor}.${patch}`;

    // 3️⃣ Replace only UPDATE_VERSION
    env = env.replace(
      /UPDATE_VERSION=\d+\.\d+\.\d+/,
      `UPDATE_VERSION=${newVersion}`
    );

    fs.writeFileSync(ENV_PATH, env);

    // 4️⃣ Restart ONLY update-instance PM2
    exec(`pm2 restart ${PM2_PROCESS}`);

    console.log(`✅ Brain push → UPDATE_VERSION=${newVersion}`);

    res.send(`Updated to ${newVersion}`);
  } catch (err) {
    console.error("❌ Webhook error:", err);
    res.status(500).send("Webhook failed");
  }
});

module.exports = router;
