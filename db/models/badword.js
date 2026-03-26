const mongoose = require("mongoose");

const badWordSchema = new mongoose.Schema({
    groupId: { type: String, required: true },
    words: [{ type: String }]
});

// Index for fast lookup by groupId
badWordSchema.index({ groupId: 1 });

module.exports = mongoose.model("BadWord", badWordSchema);
