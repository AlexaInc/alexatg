const mongoose = require('mongoose');

const cleanCommandSchema = new mongoose.Schema({
    groupId: { type: String, required: true, unique: true },
    enabled: { type: Boolean, default: false },
    mode: { type: String, enum: ['all', 'other', 'me'], default: 'all' }
});

module.exports = mongoose.model('CleanCommand', cleanCommandSchema);
