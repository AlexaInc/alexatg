const mongoose = require("mongoose");

const DatingLikeSchema = new mongoose.Schema({
    likerUserId: { type: String, required: true },
    likedUserId: { type: String, required: true },
    isMatch: { type: Boolean, default: false },
    timestamp: { type: Date, default: Date.now }
});

// For fast lookup of likes/matches
DatingLikeSchema.index({ likerUserId: 1, likedUserId: 1 }, { unique: true });
DatingLikeSchema.index({ likedUserId: 1, likerUserId: 1 });

module.exports = DatingLikeSchema;
