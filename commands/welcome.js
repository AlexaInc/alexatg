module.exports = function (bot, deps) {
    const { WelcomeSettings, botOWNER_IDS } = deps;

    const checkAdmin = async (chatId, userId) => {
        if (botOWNER_IDS.includes(userId)) return true;
        try {
            const member = await bot.getChatMember(chatId, userId);
            return ["administrator", "creator"].includes(member.status) && member.can_change_info;
        } catch (e) {
            return false;
        }
    };

    const getStatusText = (settings) => {
        return `<b>Welcome Settings:</b>
- Status: ${settings.welcomeEnabled ? '✅ ON' : '❌ OFF'}
- Clean Welcome: ${settings.cleanWelcome ? '✅ ON' : '❌ OFF'}
- Type: <code>${settings.welcomeType}</code>
- Message: <code>${settings.welcomeMessage}</code>

<b>Goodbye Settings:</b>
- Status: ${settings.goodbyeEnabled ? '✅ ON' : '❌ OFF'}
- Type: <code>${settings.goodbyeType}</code>
- Message: <code>${settings.goodbyeMessage}</code>

<b>Usage:</b>
- <code>/welcome [on/off]</code>: Enable/Disable welcome
- <code>/goodbye [on/off]</code>: Enable/Disable goodbye
- <code>/setwelcome</code>: Reply to a message to set it as welcome
- <code>/setgoodbye</code>: Reply to a message to set it as goodbye
- <code>/resetwelcome</code>: Reset to default welcome
- <code>/resetgoodbye</code>: Reset to default goodbye
- <code>/cleanwelcome</code>: Toggle cleaning old messages`;
    };

    // --- Welcome Command ---
    bot.onText(/^\/welcome(?:\s+(on|off))?$/i, async (msg, match) => {
        const chatId = msg.chat.id;
        if (msg.chat.type === 'private') return;

        let settings = await WelcomeSettings.findOne({ groupId: String(chatId) });
        if (!settings) {
            settings = await WelcomeSettings.create({ groupId: String(chatId) });
        }

        const arg = match[1] ? match[1].toLowerCase() : null;

        if (arg) {
            if (!(await checkAdmin(chatId, msg.from.id))) {
                return bot.sendMessage(chatId, "❌ You need 'Change Group Info' permission to use this command.");
            }
            settings.welcomeEnabled = (arg === 'on');
            await settings.save();
            return bot.sendMessage(chatId, `✅ Welcome messages are now <b>${arg.toUpperCase()}</b>.`, { parse_mode: 'HTML' });
        }

        bot.sendMessage(chatId, getStatusText(settings), { parse_mode: 'HTML' });
    });

    // --- Goodbye Command ---
    bot.onText(/^\/goodbye(?:\s+(on|off))?$/i, async (msg, match) => {
        const chatId = msg.chat.id;
        if (msg.chat.type === 'private') return;

        let settings = await WelcomeSettings.findOne({ groupId: String(chatId) });
        if (!settings) {
            settings = await WelcomeSettings.create({ groupId: String(chatId) });
        }

        const arg = match[1] ? match[1].toLowerCase() : null;

        if (arg) {
            if (!(await checkAdmin(chatId, msg.from.id))) {
                return bot.sendMessage(chatId, "❌ You need 'Change Group Info' permission to use this command.");
            }
            settings.goodbyeEnabled = (arg === 'on');
            await settings.save();
            return bot.sendMessage(chatId, `✅ Goodbye messages are now <b>${arg.toUpperCase()}</b>.`, { parse_mode: 'HTML' });
        }

        bot.sendMessage(chatId, getStatusText(settings), { parse_mode: 'HTML' });
    });

    // --- Set Welcome ---
    bot.onText(/^\/setwelcome$/i, async (msg) => {
        const chatId = msg.chat.id;
        if (msg.chat.type === 'private') return;

        if (!(await checkAdmin(chatId, msg.from.id))) {
            return bot.sendMessage(chatId, "❌ You need 'Change Group Info' permission to use this command.");
        }

        if (!msg.reply_to_message) {
            return bot.sendMessage(chatId, "❌ Reply to a message (text, photo, or video) to set it as the welcome message.");
        }

        const reply = msg.reply_to_message;
        let type = 'text';
        let fileId = null;
        let rawText = reply.text || reply.caption || "";
        let entities = reply.entities || reply.caption_entities || [];
        let text = deps.handlers.toHTML(rawText, entities);

        if (reply.photo) {
            type = 'photo';
            fileId = reply.photo[reply.photo.length - 1].file_id;
        } else if (reply.video) {
            type = 'video';
            fileId = reply.video.file_id;
        } else if (reply.animation) {
            type = 'animation';
            fileId = reply.animation.file_id;
        } else if (reply.document) {
            type = 'document';
            fileId = reply.document.file_id;
        }

        await WelcomeSettings.updateOne(
            { groupId: String(chatId) },
            {
                welcomeMessage: text,
                welcomeFileId: fileId,
                welcomeType: type
            },
            { upsert: true }
        );

        bot.sendMessage(chatId, "✅ Welcome message updated successfully!");
    });

    // --- Set Goodbye ---
    bot.onText(/^\/setgoodbye$/i, async (msg) => {
        const chatId = msg.chat.id;
        if (msg.chat.type === 'private') return;

        if (!(await checkAdmin(chatId, msg.from.id))) {
            return bot.sendMessage(chatId, "❌ You need 'Change Group Info' permission to use this command.");
        }

        if (!msg.reply_to_message) {
            return bot.sendMessage(chatId, "❌ Reply to a message (text, photo, or video) to set it as the goodbye message.");
        }

        const reply = msg.reply_to_message;
        let type = 'text';
        let fileId = null;
        let rawText = reply.text || reply.caption || "";
        let entities = reply.entities || reply.caption_entities || [];
        let text = deps.handlers.toHTML(rawText, entities);

        if (reply.photo) {
            type = 'photo';
            fileId = reply.photo[reply.photo.length - 1].file_id;
        } else if (reply.video) {
            type = 'video';
            fileId = reply.video.file_id;
        } else if (reply.animation) {
            type = 'animation';
            fileId = reply.animation.file_id;
        } else if (reply.document) {
            type = 'document';
            fileId = reply.document.file_id;
        }

        await WelcomeSettings.updateOne(
            { groupId: String(chatId) },
            {
                goodbyeMessage: text,
                goodbyeFileId: fileId,
                goodbyeType: type
            },
            { upsert: true }
        );

        bot.sendMessage(chatId, "✅ Goodbye message updated successfully!");
    });

    // --- Reset Welcome ---
    bot.onText(/^\/resetwelcome$/i, async (msg) => {
        const chatId = msg.chat.id;
        if (msg.chat.type === 'private') return;

        if (!(await checkAdmin(chatId, msg.from.id))) {
            return bot.sendMessage(chatId, "❌ You need 'Change Group Info' permission to use this command.");
        }

        await WelcomeSettings.updateOne(
            { groupId: String(chatId) },
            {
                welcomeMessage: "Welcome to {gname}, {name}!",
                welcomeFileId: null,
                welcomeType: 'text'
            },
            { upsert: true }
        );

        bot.sendMessage(chatId, "✅ Welcome message reset to default.");
    });

    // --- Reset Goodbye ---
    bot.onText(/^\/resetgoodbye$/i, async (msg) => {
        const chatId = msg.chat.id;
        if (msg.chat.type === 'private') return;

        if (!(await checkAdmin(chatId, msg.from.id))) {
            return bot.sendMessage(chatId, "❌ You need 'Change Group Info' permission to use this command.");
        }

        await WelcomeSettings.updateOne(
            { groupId: String(chatId) },
            {
                goodbyeMessage: "Goodbye, {name}!",
                goodbyeFileId: null,
                goodbyeType: 'text'
            },
            { upsert: true }
        );

        bot.sendMessage(chatId, "✅ Goodbye message reset to default.");
    });

    // --- Clean Welcome ---
    bot.onText(/^\/cleanwelcome$/i, async (msg) => {
        const chatId = msg.chat.id;
        if (msg.chat.type === 'private') return;

        if (!(await checkAdmin(chatId, msg.from.id))) {
            return bot.sendMessage(chatId, "❌ You need 'Change Group Info' permission to use this command.");
        }

        const settings = await WelcomeSettings.findOne({ groupId: String(chatId) });
        const newState = settings ? !settings.cleanWelcome : true;

        await WelcomeSettings.updateOne(
            { groupId: String(chatId) },
            { cleanWelcome: newState },
            { upsert: true }
        );

        bot.sendMessage(chatId, `✅ Clean Welcome is now <b>${newState ? 'ENABLED' : 'DISABLED'}</b>.\nOld welcome/goodbye messages will be deleted when a new one is sent or after 5 minutes.`, { parse_mode: 'HTML' });
    });
};
