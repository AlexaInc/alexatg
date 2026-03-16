const mongoose = require("mongoose");

const CustomQuizSchema = new mongoose.Schema({
  quizId: { type: String, required: true, unique: true },
  creatorId: String,
  title: String,
  questions: [{
    question: String,
    options: [String],
    answer: Number, // 0-indexed correct option
    explanation: String
  }],
  createdAt: { type: Date, default: Date.now }
});

module.exports = CustomQuizSchema;
