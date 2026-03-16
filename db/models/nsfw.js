const mongoose = require("mongoose");

const nsfwSchema = new mongoose.Schema({
  groupId: String,
  enabled: { type: Boolean, default: false }
});

module.exports = mongoose.model("NSFWSetting", nsfwSchema);
