const mongoose = require("mongoose");

const QuizResultSchema = new mongoose.Schema({
    userId: String,
    groupId: String,
    score: { type: Number, default: 0 },
    firstName: String,
    username: String,
    timestamp: { type: Date, default: Date.now }
});

// Index for efficient querying by time and group/user
QuizResultSchema.index({ timestamp: -1 });
QuizResultSchema.index({ groupId: 1, timestamp: -1 });
QuizResultSchema.index({ userId: 1, timestamp: -1 });

module.exports = QuizResultSchema;
