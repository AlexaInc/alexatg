const mongoose = require("mongoose");

const antilinkSchema = new mongoose.Schema({
    groupId: { type: String, required: true, unique: true },
    enabled: { type: Boolean, default: false },
    action: { type: String, default: 'delete' }, // 'restrict', 'warn', 'delete'
    restrictTime: { type: Number, default: 60 }, // minutes
    warnLimit: { type: Number, default: 3 },
    restrictAfterMaxWarns: { type: Number, default: 120 }, // minutes
    types: {
        tg: { type: Boolean, default: true },
        fb: { type: Boolean, default: true },
        yt: { type: Boolean, default: true },
        other: { type: Boolean, default: true },
        all: { type: Boolean, default: false }
    }
});

module.exports = mongoose.model("Antilink", antilinkSchema);
