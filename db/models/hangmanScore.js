const mongoose = require("mongoose");

const HangmanScoreSchema = new mongoose.Schema({
    userId: String,
    groupId: String,
    points: { type: Number, default: 0 },
    wins: { type: Number, default: 0 },
    gamesPlayed: { type: Number, default: 0 },
    firstName: String,
    username: String
});

HangmanScoreSchema.index({ groupId: 1, userId: 1 }, { unique: true });
HangmanScoreSchema.index({ groupId: 1, points: -1 });

module.exports = HangmanScoreSchema;
