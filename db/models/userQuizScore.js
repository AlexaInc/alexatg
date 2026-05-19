const mongoose = require("mongoose");

const UserQuizScoreSchema = new mongoose.Schema({
  userId: String,
  groupId: String,
  score: { type: Number, default: 0 },
  firstName: String,
  username: String
});

// Create a compound index for efficient querying
UserQuizScoreSchema.index({ groupId: 1, userId: 1 }, { unique: true });

module.exports = UserQuizScoreSchema;
