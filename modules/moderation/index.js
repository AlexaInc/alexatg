module.exports = function (bot, deps) {
    const {
        Invite,
        UserMap,
        BannedUser,
        accceptMap,
        saveUserMap,
        groupChatIds,
        saveGroupIds,
        noPermissions,
        botOWNER_IDS,
        Filters,
        handlers
    } = deps;
    const { getGreeting } = handlers;

    // ====== New Member Handler ======
    bot.on("new_chat_members", async (msg) => {
        try {
            const chatId = msg.chat.id;
            const adder = msg.from;
            const newMembers = msg.new_chat_members;
            let newAddedCount = 0;

            for (const member of newMembers) {
                if (adder.id === member.id) continue;
                bot.deleteMessage(chatId, msg.message_id).catch(() => { });
                await saveUserMap(chatId, member);
                newAddedCount++;
            }

            if (newAddedCount > 0) {
                const result = await Invite.findOneAndUpdate(
                    { groupId: chatId, userId: adder.id },
                    { $inc: { count: newAddedCount } },
                    { new: true, upsert: true }
                );
                const conf = await accceptMap.findOne({ groupId: chatId });
                if (conf?.enabled) {
                    bot.sendMessage(chatId, `👋 ${adder.first_name} added ${newAddedCount} new members! Total invites: ${result.count}.`);
                }
            }

            // Handle bot added
            const me = await bot.getMe();
            if (newMembers.some(m => m.id === me.id)) {
                if (groupChatIds && !groupChatIds.has(chatId)) {
                    groupChatIds.add(chatId);
                    saveGroupIds();
                }
            }
        } catch (err) { }
    });

    bot.on('left_chat_member', async (msg) => {
        try {
            const chatId = msg.chat.id;
            bot.deleteMessage(chatId, msg.message_id).catch(() => { });
            const me = await bot.getMe();
            if (msg.left_chat_member.id === me.id) {
                if (groupChatIds && groupChatIds.has(chatId)) {
                    groupChatIds.delete(chatId);
                    saveGroupIds();
                }
            }
        } catch (err) { }
    });

    // ====== Message Interceptor for Invite Check ======
    bot.on('message', async (msg) => {
        try {
            const text = msg.text || msg.caption || "";
            if (!text) return;

            // --- CleanCommand Logic ---
            if (text.startsWith('/')) {
                const cleanSettings = await deps.CleanCommand.findOne({ groupId: String(msg.chat.id) });
                if (cleanSettings?.enabled) {
                    const commandPart = text.split(' ')[0];
                    const hasBotTag = commandPart.includes('@');
                    const isMyTag = hasBotTag && commandPart.toLowerCase().endsWith(`@${deps.BOT_USERNAME.toLowerCase()}`);

                    let shouldDelete = false;
                    if (cleanSettings.mode === 'all') {
                        shouldDelete = true;
                    } else if (cleanSettings.mode === 'other') {
                        if (hasBotTag && !isMyTag) shouldDelete = true;
                    } else if (cleanSettings.mode === 'me') {
                        if (!hasBotTag || isMyTag) shouldDelete = true;
                    }

                    if (shouldDelete) {
                        // Don't delete my own configuration commands for this bot immediately if needed
                        // but usually it's better to keep them for visibility, OR delete after response.
                        // I'll delete all commands as requested.
                        bot.deleteMessage(msg.chat.id, msg.message_id).catch(() => { });
                    }
                }
            }

            if (text.startsWith('/') || text.startsWith('!')) return;
            const chatId = msg.chat.id;
            const userId = msg.from.id;

            // --- Antilink Check ---
            const antilinkSettings = await deps.Antilink.findOne({ groupId: String(chatId) });
            if (antilinkSettings?.enabled) {
                const LINK_PATTERNS = {
                    tg: /(t\.me|telegram\.me|telegram\.dog)\/[a-zA-Z0-9_]{5,}/i,
                    fb: /(facebook\.com|fb\.watch|fb\.me)\//i,
                    yt: /(youtube\.com|youtu\.be)\//i,
                    all: /https?:\/\/[^\s]+/i // Catch-all regex as fallback
                };

                const entities = msg.entities || msg.caption_entities || [];
                let hasLink = entities.some(e => ['url', 'text_link'].includes(e.type));

                if (hasLink && !antilinkSettings.types.all) {
                    // Refine check based on selected types
                    let matchesType = false;
                    if (antilinkSettings.types.tg && LINK_PATTERNS.tg.test(text)) matchesType = true;
                    if (antilinkSettings.types.fb && LINK_PATTERNS.fb.test(text)) matchesType = true;
                    if (antilinkSettings.types.yt && LINK_PATTERNS.yt.test(text)) matchesType = true;
                    if (antilinkSettings.types.other && !matchesType) {
                        if (!LINK_PATTERNS.tg.test(text) && !LINK_PATTERNS.fb.test(text) && !LINK_PATTERNS.yt.test(text)) {
                            matchesType = true;
                        }
                    }
                    hasLink = matchesType;
                }

                if (hasLink) {
                    const clicker = await bot.getChatMember(chatId, userId).catch(() => ({ status: 'member' }));
                    const isAdmin = ["administrator", "creator"].includes(clicker.status) || botOWNER_IDS.includes(userId);

                    if (!isAdmin) {
                        if (['delete', 'warn', 'restrict'].includes(antilinkSettings.action)) {
                            bot.deleteMessage(chatId, msg.message_id).catch(() => { });
                        }

                        if (antilinkSettings.action === 'warn') {
                            const warns = await deps.AntilinkWarning.findOneAndUpdate(
                                { groupId: chatId, userId },
                                { $inc: { count: 1 } },
                                { upsert: true, new: true }
                            );

                            if (warns.count >= antilinkSettings.warnLimit) {
                                await deps.AntilinkWarning.deleteOne({ groupId: chatId, userId });
                                const until = Math.floor(Date.now() / 1000) + (antilinkSettings.restrictAfterMaxWarns * 60);
                                await bot.restrictChatMember(chatId, userId, { can_send_messages: false, until_date: until });
                                bot.sendMessage(chatId, `🚫 [${msg.from.first_name}](tg://user?id=${userId}) restricted for ${antilinkSettings.restrictAfterMaxWarns}m (Max Warnings).`, {
                                    parse_mode: 'Markdown',
                                    reply_markup: {
                                        inline_keyboard: [[{ text: "🔓 Unmute", callback_data: `antiwarn_unmute_${userId}` }]]
                                    }
                                });
                            } else {
                                bot.sendMessage(chatId, `⚠️ [${msg.from.first_name}](tg://user?id=${userId}), No links allowed! (${warns.count}/${antilinkSettings.warnLimit})`, {
                                    parse_mode: 'Markdown',
                                    reply_markup: {
                                        inline_keyboard: [[
                                            { text: "🗑️ RemWarn", callback_data: `antiwarn_remove_${userId}` },
                                            { text: "🚫 Restrict", callback_data: `antiwarn_restrict_${userId}` }
                                        ]]
                                    }
                                });
                            }
                        } else if (antilinkSettings.action === 'restrict') {
                            const until = Math.floor(Date.now() / 1000) + (antilinkSettings.restrictTime * 60);
                            await bot.restrictChatMember(chatId, userId, { can_send_messages: false, until_date: until });
                            bot.sendMessage(chatId, `🚫 [${msg.from.first_name}](tg://user?id=${userId}) restricted for ${antilinkSettings.restrictTime}m for sending a link.`, {
                                parse_mode: 'Markdown',
                                reply_markup: {
                                    inline_keyboard: [[{ text: "🔓 Unmute", callback_data: `antiwarn_unmute_${userId}` }]]
                                }
                            });
                        }
                        return;
                    }
                }
            }

            const clicker = await bot.getChatMember(chatId, userId).catch(() => ({ status: 'member' }));
            if (["administrator", "creator"].includes(clicker.status) || msg.from.is_bot) return;

            const banned = await BannedUser.findOne({ groupId: chatId, userId });
            if (banned) {
                bot.deleteMessage(chatId, msg.message_id).catch(() => { });
                return;
            }

            const conf = await accceptMap.findOne({ groupId: chatId });
            if (conf?.enabled) {
                const inviteData = await Invite.findOne({ groupId: chatId, userId });
                if (!inviteData || inviteData.count < conf.count) {
                    bot.deleteMessage(chatId, msg.message_id).catch(() => { });
                    return; // Stop here if user is limited by invite count
                }
            }

            // ====== Filter Check ======
            const content = msg.text?.trim() || msg.sticker?.emoji || "";
            const matchedFilter = Filters.checkFilters(String(chatId), content);

            if (matchedFilter) {
                switch (matchedFilter.type) {
                    case 'text': {
                        let reptxt = matchedFilter.reply;
                        const senderName = (msg.from.first_name + " " + (msg.from.last_name || "")).trim();
                        const groupName = msg.chat.title || "";

                        reptxt = reptxt
                            .replace(/\{name\}|<name>/gi, senderName)
                            .replace(/\{gname\}|<gname>|\{group name\}|<group name>/gi, groupName)
                            .replace(/\{time\}/gi, require('moment-timezone').tz('Asia/Colombo').format('HH:mm:ss'))
                            .replace(/\{date\}/gi, require('moment-timezone').tz('Asia/Colombo').format('MMMM Do YYYY'))
                            .replace(/\{day\}/gi, require('moment-timezone').tz('Asia/Colombo').format('dddd'))
                            .replace(/\{greating\}/gi, getGreeting());

                        bot.sendMessage(chatId, reptxt, { reply_to_message_id: msg.message_id });
                        break;
                    }
                    case 'sticker':
                        bot.sendSticker(chatId, matchedFilter.reply, { reply_to_message_id: msg.message_id });
                        break;
                    case 'image':
                        bot.sendPhoto(chatId, matchedFilter.reply, { reply_to_message_id: msg.message_id });
                        break;
                    case 'video':
                        bot.sendVideo(chatId, matchedFilter.reply, { reply_to_message_id: msg.message_id });
                        break;
                    case 'gif':
                        bot.sendAnimation(chatId, matchedFilter.reply, { reply_to_message_id: msg.message_id });
                        break;
                    case 'audio':
                        bot.sendAudio(chatId, matchedFilter.reply, { reply_to_message_id: msg.message_id });
                        break;
                    case 'voice':
                        bot.sendVoice(chatId, matchedFilter.reply, { reply_to_message_id: msg.message_id });
                        break;
                    case 'document':
                        bot.sendDocument(chatId, matchedFilter.reply, { reply_to_message_id: msg.message_id });
                        break;
                    case 'video_note':
                        bot.sendVideoNote(chatId, matchedFilter.reply, { reply_to_message_id: msg.message_id });
                        break;
                }
            }
        } catch (err) { }
    });
};
