const mongoose = require("mongoose");

const GlobalUserStatsSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true, index: true },
    username: String,
    messages: {
        today: { type: Number, default: 0 },
        week: { type: Number, default: 0 },
        overall: { type: Number, default: 0 }
    },
    blockedUntil: { type: Date, default: null },
    lastActiveAt: { type: Date, default: Date.now }
});

const GlobalGroupStatsSchema = new mongoose.Schema({
    chatId: { type: String, required: true, unique: true, index: true },
    title: String,
    messages: {
        today: { type: Number, default: 0 },
        week: { type: Number, default: 0 },
        overall: { type: Number, default: 0 }
    },
    userCount: { type: Number, default: 0 },
    lastActiveAt: { type: Date, default: Date.now }
});

const GlobalUserStats = mongoose.model("GlobalUserStats", GlobalUserStatsSchema);
const GlobalGroupStats = mongoose.model("GlobalGroupStats", GlobalGroupStatsSchema);

module.exports = {
    GlobalUserStats,
    GlobalGroupStats
};
