module.exports = {
  database: {
    uri: process.env.DATABASE_URI,
  },
  UPDATE_BATCH_SIZE: process.env.UPDATE_BATCH_SIZE || "3",
  UPDATE_INTERVAL_MINUTES: process.env.UPDATE_INTERVAL_MINUTES || "5",
  UPDATE_BRANCH: process.env.UPDATE_BRANCH || "Joni-V1-BRAIN",
  UPDATE_VERSION: process.env.UPDATE_VERSION || "1.0.0",
  SSH_KEY_PATH: process.env.SSH_KEY_PATH || "../Joni-AI-Backend/joni-key.pem",
  GITHUB_PAT: process.env.GITHUB_PAT,
};
