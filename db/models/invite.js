const mongoose = require("mongoose");

const inviteSchema = new mongoose.Schema({
  groupId: String,
  userId: String,
  count: { type: Number, default: 0 },
});

module.exports = mongoose.model("Invite", inviteSchema);
