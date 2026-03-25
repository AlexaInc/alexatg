const mongoose = require("mongoose");

const WordchainResultSchema = new mongoose.Schema({
    userId: String,
    groupId: String,
    won: { type: Boolean, default: false },
    firstName: String,
    username: String,
    timestamp: { type: Date, default: Date.now }
});

WordchainResultSchema.index({ timestamp: -1 });
WordchainResultSchema.index({ groupId: 1, timestamp: -1 });
WordchainResultSchema.index({ userId: 1, timestamp: -1 });

module.exports = WordchainResultSchema;
