const mongoose = require("mongoose");

const WordchainScoreSchema = new mongoose.Schema({
    userId: String,
    groupId: String,
    wins: { type: Number, default: 0 },
    gamesPlayed: { type: Number, default: 0 },
    firstName: String,
    username: String
});

WordchainScoreSchema.index({ groupId: 1, userId: 1 }, { unique: true });
WordchainScoreSchema.index({ groupId: 1, wins: -1 });

module.exports = WordchainScoreSchema;
