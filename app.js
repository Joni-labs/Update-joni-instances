require("dotenv").config();
const express = require("express");
const UpdateInstancesService = require("./services/update-instances.service");

const app = express();

(async () => {
  require("./helpers/db");

  const updateService = new UpdateInstancesService();
  updateService.start();
})();

module.exports = app;
