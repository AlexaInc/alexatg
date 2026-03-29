const mongoose = require("mongoose");

const acceptSchema = new mongoose.Schema({
  groupId: { type: String, required: true, unique: true },
  enabled: { type: Boolean, default: false },
  count: { type: Number, default: 5 } // default accept count
});

module.exports = mongoose.model("accceptMap", acceptSchema);
