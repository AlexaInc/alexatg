module.exports = function (bot, deps) {
    const {
        botOWNER_IDS,
        botId,
        Invite,
        UserMap,
        BannedUser,
        CustomQuizModel,
        UserQuizScoreModel,
        activeQuizzes,
        startQuiz,
        stopQuiz,
        db,
        userRegistrationState,
        noPermissions
    } = deps;

    bot.on("callback_query", async (query) => {
        const chatId = query.message.chat.id.toString();
        const data = query.data;
        const userId = query.from.id;

        // --- Routing ---
        if (data.startsWith('pin_msg_')) {
            return deps.admin.handlePinCallback(query);
        }

        if (data.startsWith('prom_')) {
            return deps.admin.handlePromoteCallback(query);
        }

        if (data === 'unmask_admin') {
            return deps.admin.handleUnmaskCallback(query);
        }

        if (data.startsWith('antilink_')) {
            return deps.admin.handleAntilinkCallback(query);
        }

        if (data.startsWith('antiwarn_')) {
            return deps.admin.handleAntilinkActionCallback(query);
        }

        if (data.startsWith('genwarn_')) {
            return deps.admin.handleGenericWarnCallback(query);
        }

        if (data.startsWith('verify_')) {
            return deps.admin.handleVerifyCallback(query);
        }

        if (data.startsWith('ready_quiz_')) {
            return deps.quiz.handleReadyCallback(query);
        }

        if (data.startsWith('qlead_') || data.startsWith('ql_')) {
            return deps.quiz.handleLeaderboardCallback(query);
        }

        if (data.startsWith('lb_')) {
            return deps.gameLeaderboard.handleLeaderboardCallback(query);
        }

        if (data.startsWith('setting_') || data === 'confirm_delete_profile' || data.startsWith('like_') || data.startsWith('next_')) {
            return deps.dating.handleDatingCallback(query);
        }

        if (data.startsWith('rank_')) {
            return deps.ranking.handleCallback(query);
        }

        // --- Remaining Handlers ---
        const message = query.message;
        const from = query.from;
        const messageId = query.message.message_id;

        // --- Admin & Invites ---
        if (data.startsWith("check_")) {
            const [, targetUserId, groupId] = data.split("_");
            const inviteData = await Invite.findOne({ groupId, userId: targetUserId });
            const count = inviteData ? inviteData.count : 0;
            return bot.answerCallbackQuery(query.id, {
                text: `📊 You have invited ${count} members.`,
                show_alert: true,
            });
        }

        if (data.startsWith("unban_")) {
            const [, targetUserId, groupId] = data.split("_");
            const member = await bot.getChatMember(groupId, userId);
            if (!["administrator", "creator"].includes(member.status)) {
                return bot.answerCallbackQuery(query.id, { text: "❌ Only admins can unban.", show_alert: true });
            }
            await BannedUser.deleteOne({ groupId, userId: targetUserId });
            bot.answerCallbackQuery(query.id, { text: "✅ User unbanned!" });
            bot.sendMessage(groupId, `✅ <a href="tg://user?id=${targetUserId}">User</a> has been <b>unbanned</b> by ${from.first_name}.`, { parse_mode: "HTML" });
            return;
        }

        if (data.startsWith("unmute_")) {
            const [, targetUserId, groupId] = data.split("_");
            const member = await bot.getChatMember(groupId, userId);
            if (!["administrator", "creator"].includes(member.status)) {
                return bot.answerCallbackQuery(query.id, { text: "❌ Only admins can unmute.", show_alert: true });
            }
            let userInvite = await Invite.findOne({ groupId, userId: targetUserId });
            if (!userInvite) {
                userInvite = new Invite({ groupId, userId: targetUserId, count: 11 });
            } else {
                userInvite.count = userInvite.count + 11;
            }
            await userInvite.save();
            bot.answerCallbackQuery(query.id, { text: "✅ User unmuted!", show_alert: true });
            bot.sendMessage(groupId, `✅ User <a href="tg://user?id=${targetUserId}">unlocked</a> by admin ${from.first_name}`, { parse_mode: "HTML" });
            return;
        }

        // --- UI Navigation ---
        const ui = require('../utils/ui');

        const editMessage = (text, markup) => {
            const options = {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML',
                reply_markup: markup
            };

            // If the message has a photo or a caption, we use editMessageCaption
            if (query.message.photo || query.message.caption !== undefined) {
                bot.editMessageCaption(text, options).catch(() => { });
            } else {
                bot.editMessageText(text, options).catch(() => { });
            }
        };

        switch (data) {
            case 'start_menu':
                editMessage(ui.getStartMessage(from.first_name || 'User'), ui.startKeyboard);
                break;
            case 'contact_us':
                if (deps.getContactKeyboard()) {
                    editMessage('Here are the contacts for my owners:', deps.getContactKeyboard());
                } else {
                    bot.answerCallbackQuery(query.id, { text: 'Contacts are still loading...', show_alert: true });
                }
                break;
            case 'bot_stats':
                const stats = `📊 <b>Bot Statistics:</b>\n\nGroups: <code>${deps.groupChatIds.size}</code>\nUsers (DM): <code>${deps.userChatIds.size}</code>\nTotal Chats: <code>${deps.groupChatIds.size + deps.userChatIds.size}</code>`;
                editMessage(stats, { inline_keyboard: [[{ text: '🔙 Back', callback_data: 'start_menu' }]] });
                break;
            case 'help_main':
                editMessage('<b>Please select a command category:</b>', ui.helpMainKeyboard);
                break;
            case 'help_admin':
                editMessage(ui.helpTexts.admin, ui.backToHelpKeyboard);
                break;
            case 'help_utils':
                editMessage(ui.helpTexts.utils, ui.backToHelpKeyboard);
                break;
            case 'help_games':
                editMessage(ui.helpTexts.games, ui.backToHelpKeyboard);
                break;
            case 'help_premium':
                editMessage(ui.helpTexts.premium, ui.backToHelpKeyboard);
                break;
            case 'help_owner':
                if (botOWNER_IDS.includes(userId)) {
                    editMessage(ui.helpTexts.owner, ui.backToHelpKeyboard);
                } else {
                    bot.answerCallbackQuery(query.id, { text: '❌ This section is for bot owners only.', show_alert: true });
                }
                break;
            case 'help_extra':
                editMessage(ui.helpTexts.extra, ui.backToHelpKeyboard);
                break;
            case 'help_welcome':
                editMessage(ui.helpTexts.welcome, ui.backToHelpKeyboard);
                break;
            case 'help_nsfw':
                editMessage(ui.helpTexts.nsfw, ui.backToHelpKeyboard);
                break;
        }

        bot.answerCallbackQuery(query.id).catch(() => { });
    });
};
