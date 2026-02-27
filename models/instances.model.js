const mongoose = require("mongoose");

const instanceSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "users",
    },
    name: { type: String, unique: true },
    instanceId: { type: String, unique: true },
    publicIP: { type: String },
    region: { type: String, default: "us-east-1" },
    status: {
      type: String,
      enum: ["free", "occupied", "updating"],
      default: "free",
    },
    token: { type: String },
    openRouterApiKey: {
      type: String,
      unique: true,
    },
    openRouterApiKeyHash: {
      type: String,
      unique: true,
    },
    version: { type: String, default: null },
    currentBranch: { type: String, default: null },
    updateStatus: {
      type: String,
      enum: ["idle", "updating", "failed", "pending-user"],
      default: "idle",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("instances", instanceSchema);
