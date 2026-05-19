const mongoose = require('mongoose');

const specialUserSchema = new mongoose.Schema({
    userId: { type: Number, required: true, unique: true },
    addedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('SpecialUser', specialUserSchema);
