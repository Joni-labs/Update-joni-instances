require("dotenv").config();
const express = require("express");
const UpdateInstancesService = require("./services/update-instances.service");
const brainWebhook = require("./routes/brain-webhook"); // 👈 add

const app = express();

// ✅ REQUIRED for GitHub webhook
app.use(express.json());

// ✅ Mount webhook BEFORE services
app.use(brainWebhook);

(async () => {
  require("./helpers/db");

  const updateService = new UpdateInstancesService();
  updateService.start();
})();

module.exports = app;
