const mongoose = require("mongoose");

const HangmanResultSchema = new mongoose.Schema({
    userId: String,
    groupId: String,
    points: { type: Number, default: 0 },
    won: { type: Boolean, default: false },
    firstName: String,
    username: String,
    timestamp: { type: Date, default: Date.now }
});

HangmanResultSchema.index({ timestamp: -1 });
HangmanResultSchema.index({ groupId: 1, timestamp: -1 });
HangmanResultSchema.index({ userId: 1, timestamp: -1 });

module.exports = HangmanResultSchema;
