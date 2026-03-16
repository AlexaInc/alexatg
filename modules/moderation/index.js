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
    });

    bot.on('left_chat_member', async (msg) => {
        const chatId = msg.chat.id;
        bot.deleteMessage(chatId, msg.message_id).catch(() => { });
        const me = await bot.getMe();
        if (msg.left_chat_member.id === me.id) {
            if (groupChatIds && groupChatIds.has(chatId)) {
                groupChatIds.delete(chatId);
                saveGroupIds();
            }
        }
    });

    // ====== Message Interceptor for Invite Check ======
    bot.on('message', async (msg) => {
        if (!msg.text || msg.text.startsWith('/') || msg.text.startsWith('!')) return;
        const chatId = msg.chat.id;
        const userId = msg.from.id;

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
    });
};
