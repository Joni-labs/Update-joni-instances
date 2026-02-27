const mongoose = require("mongoose");
const { database } = require("../configs");

(async () => {
  try {
    mongoose.set("strictQuery", false);
    await mongoose.connect(database.uri);
    console.log(`Database connected...`);
  } catch (ex) {
    console.log("Error connecting to Database...", ex);
    console.log("Exiting application");
    process.exit(-1);
  }
})();

mongoose.connection.on("connected", () => {
  console.log("Mongoose connected to db");
});

mongoose.connection.on("error", (err) => {
  console.log(err.message);
});

mongoose.connection.on("disconnected", () => {
  console.log("Mongoose connection disconnected...");
});

mongoose.connection.on("SIGINT", async () => {
  await mongoose.connection.close();
  process.exit(0);
});
