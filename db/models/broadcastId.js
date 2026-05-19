const mongoose = require("mongoose");

const broadcastIdSchema = new mongoose.Schema({
    chatId: { type: String, unique: true },
    type: { type: String, enum: ['private', 'group', 'supergroup', 'channel'] },
    addedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("BroadcastId", broadcastIdSchema);
