const mongoose = require("mongoose");

const updateLockSchema = new mongoose.Schema(
  {
    key: { type: String, unique: true },
    isRunning: { type: Boolean, default: false },
    startedAt: { type: Date },
  },
  { timestamps: true }
);

module.exports = mongoose.model("update-lock", updateLockSchema);
