const mongoose = require("mongoose");

const DatingProfileSchema = new mongoose.Schema({
    userId: { type: String, unique: true, required: true },
    name: String,
    gender: String, // 'Male', 'Female', 'Other'
    age: Number,
    bio: String,
    photoId: String,
    // Geo-location for matching
    location: {
        type: { type: String, default: 'Point' },
        coordinates: { type: [Number], index: '2dsphere' } // [longitude, latitude]
    },
    // Search preferences
    seekingGender: { type: String, default: 'Female' },
    seekingMinAge: { type: Number, default: 18 },
    seekingMaxAge: { type: Number, default: 99 },
    seekingMaxDistance: { type: Number, default: 100 }, // in km
    profileComplete: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
});

module.exports = DatingProfileSchema;
