const mongoose = require("mongoose");

const userMapSchema = new mongoose.Schema({
  groupId: String,
  userId: String,
  username: String,
  firstName: String,
});

module.exports = mongoose.model("UserMap", userMapSchema);
