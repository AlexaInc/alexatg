const mongoose = require("mongoose");

const warningSchema = new mongoose.Schema({
    groupId: { type: String, required: true },
    userId: { type: String, required: true },
    count: { type: Number, default: 0 }
});
warningSchema.index({ groupId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model("Warning", warningSchema);
