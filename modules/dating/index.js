module.exports = function (bot, deps) {
    const { db, UserMap, userRegistrationState } = deps;

    async function findPotentialMatch(userId, userGeom, maxKm, minAge, maxAge, seekingGender) {
        const queryText = `
      SELECT user_id, first_name, age, bio, profile_photo_file_id
      FROM users
      WHERE
          profile_complete = TRUE
          AND user_id != $1
          AND gender = $2
          AND age BETWEEN $3 AND $4
          AND ST_Distance(location_geom, $5) <= $6
          AND user_id NOT IN (
              SELECT liked_user_id FROM likes WHERE liker_user_id = $1
          )
      LIMIT 1;
    `;
        try {
            // Note: db.query might fail if not properly initialized with a SQL driver
            if (typeof db.query !== 'function') {
                console.error("Dating Module: db.query is not a function. SQL database might not be configured.");
                return null;
            }
            const res = await db.query(queryText, [
                userId, seekingGender, minAge, maxAge,
                userGeom,
                maxKm * 1000,
            ]);
            return res.rows[0];
        } catch (err) {
            console.error("Error finding match:", err);
            return null;
        }
    }

    // --- /dating Command ---
    bot.onText(/\/dating/, async (msg) => {
        const chatId = msg.chat.id;
        if (msg.chat.type !== 'private') return bot.sendMessage(chatId, 'The dating feature only works in private chats.');

        try {
            const res = await db.query('SELECT profile_complete FROM users WHERE user_id = $1', [chatId]);
            const userRecord = res.rows[0];

            if (userRecord && userRecord.profile_complete) {
                return bot.sendMessage(chatId, "You already have a complete profile! Send /find to check out matches or /settings to update your preferences.");
            }

            let initialStep = 'awaiting_name';
            let initialPrompt = "Hi! Welcome to the Dating Bot. Let's create your profile.\n\nWhat's your first name?";

            if (userRecord && userRecord.profile_complete === false) {
                initialStep = 'awaiting_gender';
                initialPrompt = "Welcome back! It looks like you didn't finish your profile. Let's start with your gender.";
            }

            userRegistrationState[chatId] = { step: initialStep, profile: {} };
            bot.sendMessage(chatId, initialPrompt);
        } catch (err) {
            console.error("Error in /dating check:", err);
            bot.sendMessage(chatId, "An error occurred checking your profile status.");
        }
    });

    // --- /settings Command ---
    bot.onText(/\/settings/, async (msg) => {
        const chatId = msg.chat.id;
        if (msg.chat.type !== 'private') return;

        try {
            const res = await db.query('SELECT profile_complete FROM users WHERE user_id = $1', [chatId]);
            if (!res.rows[0] || !res.rows[0].profile_complete) {
                return bot.sendMessage(chatId, "Please complete your profile first using /dating.");
            }

            bot.sendMessage(chatId, "⚙️ **Profile Settings**\n\nWhat would you like to update?", {
                parse_mode: 'Markdown',
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '📝 Update Bio', callback_data: 'setting_update_bio' }],
                        [{ text: '🖼️ Update Photo', callback_data: 'setting_update_photo' }],
                        [{ text: '🔎 Seeking Gender', callback_data: 'setting_update_seeking' }],
                        [{ text: '🗺️ Max Distance', callback_data: 'setting_update_distance' }],
                        [{ text: '❌ Delete Profile', callback_data: 'setting_delete_profile' }],
                    ]
                }
            });
        } catch (err) {
            console.error("Database error in /settings:", err);
            bot.sendMessage(chatId, "An error occurred fetching your settings.");
        }
    });

    // --- /find Command ---
    bot.onText(/\/find/, async (msg) => {
        const chatId = msg.chat.id;
        if (msg.chat.type !== 'private') {
            return bot.sendMessage(chatId, 'The dating feature only works in private chats.');
        }

        let userProfile;
        try {
            if (typeof db.query !== 'function') return bot.sendMessage(chatId, "❌ Dating database not configured.");

            const res = await db.query(
                'SELECT *, ST_AsText(location_geom) as geom_text FROM users WHERE user_id = $1',
                [chatId]
            );
            userProfile = res.rows[0];
        } catch (err) {
            console.error("Error fetching user profile:", err);
            return bot.sendMessage(chatId, "An error occurred fetching your profile.");
        }

        if (!userProfile || !userProfile.profile_complete) {
            return bot.sendMessage(chatId, "Please complete your profile with /dating first.");
        }

        const match = await findPotentialMatch(
            chatId,
            userProfile.geom_text,
            userProfile.seeking_max_distance_km,
            userProfile.seeking_min_age,
            userProfile.seeking_max_age,
            userProfile.seeking_gender || 'Female'
        );

        if (match) {
            const { user_id: matchUserId, first_name, age, bio, profile_photo_file_id } = match;
            const caption = `${first_name}, ${age}\n\n${bio}`;

            bot.sendPhoto(chatId, profile_photo_file_id, {
                caption: caption,
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: '❤️ Like', callback_data: `like_${matchUserId}` },
                            { text: '❌ Next', callback_data: `next_${matchUserId}` }
                        ]
                    ]
                }
            });
        } else {
            bot.sendMessage(chatId, "No new profiles found matching your criteria. Try again later!");
        }
    });

    async function handleDatingCallback(query) {
        const chatId = query.message.chat.id.toString();
        const data = query.data;
        const userId = query.from.id.toString();
        const messageId = query.message.message_id;

        if (data.startsWith('like_') || data.startsWith('next_')) {
            const [action, targetId] = data.split('_');
            if (action === 'like') {
                try {
                    if (typeof db.query !== 'function') return bot.answerCallbackQuery(query.id, { text: "❌ Database error." });
                    await db.query('INSERT INTO likes (liker_user_id, liked_user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [userId, targetId]);
                    const res = await db.query('SELECT EXISTS (SELECT 1 FROM likes WHERE liker_user_id = $2 AND liked_user_id = $1)', [userId, targetId]);
                    if (res.rows[0].exists) {
                        bot.editMessageCaption("It's a match! 🎉", { chat_id: chatId, message_id: messageId });
                        bot.sendMessage(userId, `Matched with ${targetId}!`);
                        bot.sendMessage(targetId, `Matched with ${userId}!`);
                    } else {
                        bot.editMessageCaption('Liked! 👍', { chat_id: chatId, message_id: messageId });
                    }
                } catch (err) { console.error(err); }
            } else {
                bot.editMessageCaption('Next profile...', { chat_id: chatId, message_id: messageId });
            }
            return bot.answerCallbackQuery(query.id);
        }

        if (data.startsWith('setting_')) {
            const action = data.replace('setting_', '');
            if (action === 'update_bio') {
                userRegistrationState[userId] = { step: 'awaiting_update_bio' };
                bot.sendMessage(chatId, "Please send your new bio.");
            } else if (action === 'update_photo') {
                userRegistrationState[userId] = { step: 'awaiting_update_photo' };
                bot.sendMessage(chatId, "Please send your new profile photo.");
            } else if (action === 'update_seeking') {
                userRegistrationState[userId] = { step: 'awaiting_update_seeking_gender' };
                bot.sendMessage(chatId, "Who are you looking for?", {
                    reply_markup: {
                        keyboard: [['Male', 'Female', 'Other']],
                        one_time_keyboard: true,
                        resize_keyboard: true,
                    }
                });
            } else if (action === 'update_distance') {
                userRegistrationState[userId] = { step: 'awaiting_update_distance' };
                bot.sendMessage(chatId, "Enter max distance in km (1-500).");
            } else if (action === 'delete_profile') {
                bot.editMessageCaption("⚠️ **Are you sure? This is permanent.**", {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: 'Yes, Delete Permanently', callback_data: 'confirm_delete_profile' }],
                            [{ text: 'No, Cancel', callback_data: 'setting_cancel' }]
                        ]
                    }
                });
            } else if (action === 'cancel') {
                bot.editMessageCaption("Cancelled. Use /settings to try again.", { chat_id: chatId, message_id: messageId });
            }
            return bot.answerCallbackQuery(query.id);
        }

        if (data === 'confirm_delete_profile') {
            try {
                await db.query('DELETE FROM likes WHERE liker_user_id = $1 OR liked_user_id = $1', [userId]);
                await db.query('DELETE FROM users WHERE user_id = $1', [userId]);
                delete userRegistrationState[userId];
                bot.editMessageCaption("✅ Profile deleted.", { chat_id: chatId, message_id: messageId });
            } catch (err) {
                bot.answerCallbackQuery(query.id, { text: "❌ Deletion failed." });
            }
            return bot.answerCallbackQuery(query.id);
        }
    }

    return {
        findPotentialMatch,
        handleDatingCallback,
        handleDatingState: async (msg) => {
            const chatId = msg.chat.id;
            const text = msg.text;
            const userState = userRegistrationState[chatId];

            if (!userState) return false;

            // Handle simple text updates or state transitions
            switch (userState.step) {
                case 'awaiting_name':
                    if (text.startsWith('/')) return true;
                    userState.profile.name = text;
                    userState.step = 'awaiting_gender';
                    bot.sendMessage(chatId, "Great. What's your gender?", {
                        reply_markup: {
                            keyboard: [['Male', 'Female', 'Other']],
                            one_time_keyboard: true,
                            resize_keyboard: true,
                        },
                    });
                    return true;

                case 'awaiting_gender':
                    if (!['Male', 'Female', 'Other'].includes(text)) {
                        bot.sendMessage(chatId, 'Please select a gender from the keyboard.');
                        return true;
                    }
                    userState.profile.gender = text;
                    userState.step = 'awaiting_age';
                    bot.sendMessage(chatId, 'How old are you? (Please send just the number)', {
                        reply_markup: { remove_keyboard: true },
                    });
                    return true;

                case 'awaiting_age':
                    const parsedAge = parseInt(text, 10);
                    if (isNaN(parsedAge) || parsedAge < 18) {
                        bot.sendMessage(chatId, 'Please send a valid age (18 or older).');
                        return true;
                    }
                    userState.profile.age = parsedAge;
                    userState.step = 'awaiting_photo';
                    bot.sendMessage(chatId, 'Awesome. Now, please send a photo for your profile.');
                    return true;

                case 'awaiting_photo':
                    let photoFileId;
                    if (msg.photo && msg.photo.length > 0) {
                        photoFileId = msg.photo[msg.photo.length - 1].file_id;
                    } else if (msg.document && msg.document.mime_type && msg.document.mime_type.startsWith('image/')) {
                        photoFileId = msg.document.file_id;
                    } else {
                        bot.sendMessage(chatId, 'That\'s not a valid image. Please send a photo directly or as a file.');
                        return true;
                    }
                    userState.profile.photo_id = photoFileId;
                    userState.step = 'awaiting_location';
                    bot.sendMessage(chatId, 'Nice photo! Now, please share your location so we can find matches near you.', {
                        reply_markup: {
                            keyboard: [[{ text: 'Share My Location', request_location: true }]],
                            one_time_keyboard: true,
                            resize_keyboard: true,
                        },
                    });
                    return true;

                case 'awaiting_location':
                    if (!msg.location) {
                        bot.sendMessage(chatId, 'Please use the button to share your location.');
                        return true;
                    }
                    userState.profile.latitude = msg.location.latitude;
                    userState.profile.longitude = msg.location.longitude;
                    userState.step = 'awaiting_bio';
                    bot.sendMessage(chatId, 'Got it. Finally, write a short bio about yourself.', {
                        reply_markup: { remove_keyboard: true },
                    });
                    return true;

                case 'awaiting_bio':
                    if (text.startsWith('/')) return true;
                    userState.profile.bio = text;
                    userState.step = 'saving';

                    const { name, gender, age, photo_id, latitude, longitude, bio } = userState.profile;
                    const queryText = `
            INSERT INTO users (
                user_id, first_name, gender, age, profile_photo_file_id, 
                latitude, longitude, bio, profile_complete,
                location_geom
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, ST_SetSRID(ST_MakePoint($10, $11), 4326))
            ON CONFLICT (user_id) DO UPDATE SET
                first_name = EXCLUDED.first_name,
                gender = EXCLUDED.gender,
                age = EXCLUDED.age,
                profile_photo_file_id = EXCLUDED.profile_photo_file_id,
                latitude = EXCLUDED.latitude,
                longitude = EXCLUDED.longitude,
                bio = EXCLUDED.bio,
                profile_complete = EXCLUDED.profile_complete,
                location_geom = EXCLUDED.location_geom;
          `;

                    try {
                        await db.query(queryText, [
                            chatId, name, gender, age, photo_id,
                            latitude, longitude, bio, true,
                            longitude, latitude
                        ]);
                        bot.sendMessage(chatId, "Your profile is complete! Send /find to start matching.");
                    } catch (err) {
                        console.error("Database error in registration:", err);
                        bot.sendMessage(chatId, "Something went wrong saving your profile. Please try /dating again.");
                    }
                    delete userRegistrationState[chatId];
                    return true;

                case 'awaiting_update_bio':
                    try {
                        await db.query('UPDATE users SET bio = $1 WHERE user_id = $2', [text, chatId]);
                        bot.sendMessage(chatId, "✅ Bio successfully updated! Send /find to check out profiles.");
                    } catch (err) {
                        bot.sendMessage(chatId, "❌ Failed to update bio.");
                    }
                    delete userRegistrationState[chatId];
                    return true;

                case 'awaiting_update_photo':
                    let updatePhotoId;
                    if (msg.photo && msg.photo.length > 0) {
                        updatePhotoId = msg.photo[msg.photo.length - 1].file_id;
                    } else if (msg.document && msg.document.mime_type && msg.document.mime_type.startsWith('image/')) {
                        updatePhotoId = msg.document.file_id;
                    } else {
                        bot.sendMessage(chatId, 'That\'s not a valid photo. Please send an image file.');
                        return true;
                    }
                    try {
                        await db.query('UPDATE users SET profile_photo_file_id = $1 WHERE user_id = $2', [updatePhotoId, chatId]);
                        bot.sendMessage(chatId, "✅ Profile photo updated!");
                    } catch (err) {
                        bot.sendMessage(chatId, "❌ Failed to update photo.");
                    }
                    delete userRegistrationState[chatId];
                    return true;

                case 'awaiting_update_distance':
                    const distance = parseInt(text, 10);
                    if (isNaN(distance) || distance < 1 || distance > 500) {
                        bot.sendMessage(chatId, 'Please enter a valid number between 1 and 500 for the distance.');
                        return true;
                    }
                    try {
                        await db.query('UPDATE users SET seeking_max_distance_km = $1 WHERE user_id = $2', [distance, chatId]);
                        bot.sendMessage(chatId, `✅ Max search distance set to ${distance} km.`);
                    } catch (err) {
                        bot.sendMessage(chatId, "❌ Failed to update distance.");
                    }
                    delete userRegistrationState[chatId];
                    return true;

                case 'awaiting_update_seeking_gender':
                    if (!['Male', 'Female', 'Other'].includes(text)) {
                        bot.sendMessage(chatId, 'Please select a gender from the keyboard.');
                        return true;
                    }
                    try {
                        await db.query('UPDATE users SET seeking_gender = $1 WHERE user_id = $2', [text, chatId]);
                        bot.sendMessage(chatId, `✅ Seeking preference updated to ${text}.`);
                    } catch (err) {
                        bot.sendMessage(chatId, "❌ Failed to update seeking preference.");
                    }
                    delete userRegistrationState[chatId];
                    return true;

                default:
                    return false;
            }
        }
    };
};
