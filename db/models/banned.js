const mongoose = require("mongoose");

const bannedSchema = new mongoose.Schema({
  groupId: String,
  userId: String,
  reason: String,
  date: { type: Date, default: Date.now }
});

module.exports = mongoose.model("BannedUser", bannedSchema);
