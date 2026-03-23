const mongoose = require('mongoose');

const welcomeSettingsSchema = new mongoose.Schema({
    groupId: { type: String, required: true, unique: true },
    welcomeEnabled: { type: Boolean, default: false },
    goodbyeEnabled: { type: Boolean, default: false },
    welcomeMessage: { type: String, default: "Welcome to {gname}, {name}!" },
    goodbyeMessage: { type: String, default: "Goodbye, {name}!" },
    welcomeFileId: { type: String, default: null },
    welcomeType: { type: String, default: 'text' }, // text, photo, video, document, animation
    goodbyeFileId: { type: String, default: null },
    goodbyeType: { type: String, default: 'text' },
    cleanWelcome: { type: Boolean, default: false },
    lastWelcomeMessageId: { type: Number, default: null },
    lastGoodbyeMessageId: { type: Number, default: null }
});

module.exports = mongoose.model('WelcomeSettings', welcomeSettingsSchema);
