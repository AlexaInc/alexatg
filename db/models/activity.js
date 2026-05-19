const mongoose = require("mongoose");

const ActivitySchema = new mongoose.Schema({
    userId: { type: String, required: true, index: true },
    chatId: { type: String, required: true, index: true },
    username: String,
    chatTitle: String,
    messages: {
        today: { type: Number, default: 0 },
        week: { type: Number, default: 0 },
        overall: { type: Number, default: 0 }
    },
    lastMessageAt: { type: Date, default: Date.now }
});

// Composite index for fast lookups of a user in a specific chat
ActivitySchema.index({ userId: 1, chatId: 1 }, { unique: true });

module.exports = mongoose.model("Activity", ActivitySchema);
