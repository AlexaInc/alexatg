const mongoose = require("mongoose");

const antilinkWarningsSchema = new mongoose.Schema({
    groupId: { type: String, required: true },
    userId: { type: String, required: true },
    count: { type: Number, default: 0 }
});
antilinkWarningsSchema.index({ groupId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model("AntilinkWarning", antilinkWarningsSchema);
