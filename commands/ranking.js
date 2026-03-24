const { formatLeaderboard, formatProfile, formatNumber, escapeMarkdown } = require('../utils/ui_ranking');

module.exports = function (bot, deps) {
    const { Activity, GlobalUserStats, GlobalGroupStats } = deps;

    const periods = ['today', 'week', 'overall'];

    const getKeyboard = (prefix, currentPeriod) => {
        return {
            inline_keyboard: [
                periods.map(p => ({
                    text: p === currentPeriod ? `• ${p.toUpperCase()} •` : p.toUpperCase(),
                    callback_data: `${prefix}_${p}`
                }))
            ]
        };
    };

    const handleRanking = async (msg, period = 'overall') => {
        const chatId = msg.chat.id.toString();
        const items = await Activity.find({ chatId }).sort({ [`messages.${period}`]: -1 }).limit(10);
        const title = "RANKING";
        const text = formatLeaderboard(title, items, 'user', null, period);
        bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown', reply_markup: getKeyboard('rank_local', period) });
    };

    const handleTopUsers = async (msg, period = 'overall') => {
        const items = await GlobalUserStats.find().sort({ [`messages.${period}`]: -1 }).limit(10);
        const totalAgg = await GlobalUserStats.aggregate([{ $group: { _id: null, total: { $sum: `$messages.${period}` } } }]);
        const total = totalAgg[0] ? totalAgg[0].total : 0;
        const text = formatLeaderboard("GLOBAL LEADERBOARD", items, 'user', total, period);
        bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown', reply_markup: getKeyboard('rank_global', period) });
    };

    const handleTopGroups = async (msg, period = 'overall') => {
        const items = await GlobalGroupStats.find().sort({ [`messages.${period}`]: -1 }).limit(10);
        const totalAgg = await GlobalGroupStats.aggregate([{ $group: { _id: null, total: { $sum: `$messages.${period}` } } }]);
        const total = totalAgg[0] ? totalAgg[0].total : 0;
        const text = formatLeaderboard("TOP GROUPS", items, 'group', total, period);
        bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown', reply_markup: getKeyboard('rank_groups', period) });
    };

    const handleProfile = async (msg) => {
        const userId = msg.from.id.toString();
        const chatId = msg.chat.id.toString();

        const stats = await GlobalUserStats.findOne({ userId }) || { messages: { today: 0, week: 0, overall: 0 } };
        const local = await Activity.findOne({ userId, chatId }) || { messages: { today: 0, week: 0, overall: 0 } };

        const globalPos = {
            overall: await GlobalUserStats.countDocuments({ 'messages.overall': { $gt: stats.messages.overall } }) + 1,
            today: await GlobalUserStats.countDocuments({ 'messages.today': { $gt: stats.messages.today } }) + 1,
            week: await GlobalUserStats.countDocuments({ 'messages.week': { $gt: stats.messages.week } }) + 1
        };
        const localPos = {
            overall: await Activity.countDocuments({ chatId, 'messages.overall': { $gt: local.messages.overall } }) + 1,
            today: await Activity.countDocuments({ chatId, 'messages.today': { $gt: local.messages.today } }) + 1,
            week: await Activity.countDocuments({ chatId, 'messages.week': { $gt: local.messages.week } }) + 1
        };

        const totalUsers = await Activity.countDocuments({ chatId });
        const totalGroups = await GlobalGroupStats.countDocuments({});

        const text = formatProfile(stats, local, globalPos, localPos, totalUsers, totalGroups);
        const escapedName = escapeMarkdown(msg.from.first_name);
        // Add a nice header with the escaped name
        const profileText = `👤 *PROFILE | ${escapedName.toUpperCase()}*\n` + text.replace('👤 *YOUR PROFILE*\n', '');

        bot.sendMessage(msg.chat.id, profileText, { parse_mode: 'Markdown' });
    };

    const handleMyTop = async (msg, period = 'overall') => {
        const userId = msg.from.id.toString();
        const items = await Activity.find({ userId }).sort({ [`messages.${period}`]: -1 }).limit(10);
        const escapedName = escapeMarkdown(msg.from.first_name);
        const text = formatLeaderboard(`MY TOP GROUPS | ${escapedName}`, items, 'group', null, period);
        bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown', reply_markup: getKeyboard('rank_mytop', period) });
    };

    const handleGroupStats = async (msg) => {
        const chatId = msg.chat.id.toString();
        const group = await GlobalGroupStats.findOne({ chatId });
        if (!group) return bot.sendMessage(msg.chat.id, "No stats found for this group yet.");

        const globalPos = await GlobalGroupStats.countDocuments({ 'messages.overall': { $gt: group.messages.overall } }) + 1;
        const globalPosToday = await GlobalGroupStats.countDocuments({ 'messages.today': { $gt: group.messages.today } }) + 1;
        const globalPosWeek = await GlobalGroupStats.countDocuments({ 'messages.week': { $gt: group.messages.week } }) + 1;

        let text = `📊 *STATS FOR ${escapeMarkdown(group.title)}*\n`;
        text += `👥 ChatFight detects ${group.userCount} users in this group.\n\n`;

        text += `➖ *Overall stats*\n`;
        text += `🏆 Global Position: ${globalPos}°\n`;
        text += `📤 Messages Sent: ${group.messages.overall}\n\n`;

        text += `➖ *Today's stats*\n`;
        text += `🏆 Global Position: ${globalPosToday}°\n`;
        text += `📤 Messages Sent: ${group.messages.today}\n\n`;

        text += `➖ *This week's stats*\n`;
        text += `🏆 Global Position: ${globalPosWeek}°\n`;
        text += `📤 Messages Sent: ${group.messages.week}\n`;

        bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
    };

    // Callback Handler
    const handleCallback = async (query) => {
        const [prefix, type, period] = query.data.split('_');
        const chatId = query.message.chat.id.toString();
        const messageId = query.message.message_id;

        let items, title, text, total, typeIcon;
        const userId = query.from.id.toString();

        if (type === 'local') {
            items = await Activity.find({ chatId }).sort({ [`messages.${period}`]: -1 }).limit(10);
            text = formatLeaderboard("RANKING", items, 'user', null, period);
        } else if (type === 'global') {
            items = await GlobalUserStats.find().sort({ [`messages.${period}`]: -1 }).limit(10);
            const totalAgg = await GlobalUserStats.aggregate([{ $group: { _id: null, total: { $sum: `$messages.${period}` } } }]);
            total = totalAgg[0] ? totalAgg[0].total : 0;
            text = formatLeaderboard("GLOBAL LEADERBOARD", items, 'user', total, period);
        } else if (type === 'groups') {
            items = await GlobalGroupStats.find().sort({ [`messages.${period}`]: -1 }).limit(10);
            const totalAgg = await GlobalGroupStats.aggregate([{ $group: { _id: null, total: { $sum: `$messages.${period}` } } }]);
            total = totalAgg[0] ? totalAgg[0].total : 0;
            text = formatLeaderboard("TOP GROUPS", items, 'group', total, period);
        } else if (type === 'mytop') {
            items = await Activity.find({ userId }).sort({ [`messages.${period}`]: -1 }).limit(10);
            text = formatLeaderboard(`MY TOP GROUPS | ${query.from.first_name}`, items, 'group', null, period);
        }

        bot.editMessageText(text, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
            reply_markup: getKeyboard(prefix + '_' + type, period)
        }).catch(err => {
            console.error("Error editing ranking message:", err.message);
            if (err.message.includes("can't parse entities")) {
                // Fallback to plain text if Markdown fails
                bot.editMessageText(text.replace(/[*_`\[\]()]/g, ''), {
                    chat_id: chatId,
                    message_id: messageId,
                    reply_markup: getKeyboard(prefix + '_' + type, period)
                }).catch(() => { });
            }
        });
    };

    const handleFetchHistory = async (msg) => {
        if (!deps.botOWNER_IDS.includes(msg.from.id)) {
            return bot.sendMessage(msg.chat.id, "❌ Restricted to bot owners.");
        }

        const args = (msg.text || '').split(' ');
        const limit = parseInt(args[1]) || 1000000; // Default to 1M (essentially all)
        const chatId = msg.chat.id.toString();

        const statusMsg = await bot.sendMessage(msg.chat.id, `⏳ **History sync started...**\nLimit: \`${limit}\` messages.`, { parse_mode: 'Markdown' });

        try {
            const client = await deps.handlers.getUserbotClient();
            if (!client) return bot.editMessageText("❌ Userbot not configured.", { chat_id: msg.chat.id, message_id: statusMsg.message_id });

            const entity = await deps.handlers.getJoinedEntity(client, bot, chatId);

            let allMessages = [];
            let offsetId = 0;
            const chunkSize = 100;

            while (allMessages.length < limit) {
                const chunkLimit = Math.min(chunkSize, limit - allMessages.length);
                const chunk = await client.getMessages(entity, { limit: chunkLimit, offsetId });
                if (!chunk || chunk.length === 0) break;

                allMessages.push(...chunk);
                offsetId = chunk[chunk.length - 1].id;

                await bot.editMessageText(`⏳ **Syncing history...**\nDownloaded: \`${allMessages.length}\` / \`${limit}\` messages.`, {
                    chat_id: msg.chat.id,
                    message_id: statusMsg.message_id,
                    parse_mode: 'Markdown'
                }).catch(() => { });

                if (allMessages.length < limit) {
                    await new Promise(r => setTimeout(r, 2000)); // Rate limit protection
                }
            }

            if (allMessages.length === 0) {
                await client.disconnect();
                return bot.editMessageText("ℹ️ No historical messages found.", { chat_id: msg.chat.id, message_id: statusMsg.message_id });
            }

            const now = new Date();
            const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const weekStart = new Date(now);
            weekStart.setDate(now.getDate() - now.getDay());

            const userCounts = {}; // userId -> { overall, today, week, name }
            let totalGroupMessages = 0;
            let totalGroupToday = 0;
            let totalGroupWeek = 0;

            // Fetch participants to resolve names if possible (more reliable than m.sender)
            const chatUsers = await client.getParticipants(entity).catch(() => []);
            const userCache = {};
            chatUsers.forEach(u => {
                userCache[u.id.toString()] = {
                    name: (u.firstName + (u.lastName ? " " + u.lastName : "")).trim(),
                    bot: u.bot
                };
            });

            for (const m of allMessages) {
                if (!m.fromId || !m.fromId.userId) continue;
                const uid = m.fromId.userId.toString();

                // Bot detection
                const cachedUser = userCache[uid];
                if (cachedUser && cachedUser.bot) continue;
                if (m.sender && m.sender.bot) continue;

                const date = new Date(m.date * 1000);

                if (!userCounts[uid]) {
                    let fullName = "User";
                    if (cachedUser) {
                        fullName = cachedUser.name;
                    } else if (m.sender) {
                        fullName = (m.sender.firstName + (m.sender.lastName ? " " + m.sender.lastName : "")).trim();
                    }
                    userCounts[uid] = { overall: 0, today: 0, week: 0, name: fullName };
                }
                userCounts[uid].overall++;
                totalGroupMessages++;

                if (date >= today) {
                    userCounts[uid].today++;
                    totalGroupToday++;
                }
                if (date >= weekStart) {
                    userCounts[uid].week++;
                    totalGroupWeek++;
                }
            }

            // Perform updates in moderate batches
            const userIds = Object.keys(userCounts);
            for (let i = 0; i < userIds.length; i++) {
                const uid = userIds[i];
                const u = userCounts[uid];
                await Activity.updateOne(
                    { chatId, userId: uid },
                    {
                        $inc: { 'messages.overall': u.overall, 'messages.today': u.today, 'messages.week': u.week },
                        $set: { username: u.name, chatTitle: msg.chat.title || 'Group' }
                    },
                    { upsert: true }
                );
                await GlobalUserStats.updateOne(
                    { userId: uid },
                    {
                        $inc: { 'messages.overall': u.overall, 'messages.today': u.today, 'messages.week': u.week },
                        $set: { username: u.name }
                    },
                    { upsert: true }
                );

                if (i % 20 === 0) {
                    await new Promise(r => setTimeout(r, 500)); // Prevent DB overload
                }
            }

            await GlobalGroupStats.updateOne(
                { chatId },
                {
                    $inc: { 'messages.overall': totalGroupMessages, 'messages.today': totalGroupToday, 'messages.week': totalGroupWeek },
                    $set: { title: msg.chat.title || 'Unknown Group' }
                },
                { upsert: true }
            );

            await bot.editMessageText(`✅ **Sync Complete!**\nProcessed \`${allMessages.length}\` messages.\nUpdated stats for \`${userIds.length}\` users.`, {
                chat_id: msg.chat.id,
                message_id: statusMsg.message_id,
                parse_mode: 'Markdown'
            });

            await client.disconnect();
        } catch (err) {
            console.error("FetchHistory Error:", err);
            bot.editMessageText("❌ Error: " + err.message, { chat_id: msg.chat.id, message_id: statusMsg.message_id });
        }
    };

    const handleClearStats = async (msg) => {
        if (!deps.botOWNER_IDS.includes(msg.from.id)) {
            return bot.sendMessage(msg.chat.id, "❌ This command is restricted to bot owners.");
        }

        try {
            await Activity.deleteMany({});
            await GlobalUserStats.deleteMany({});
            await GlobalGroupStats.deleteMany({});
            bot.sendMessage(msg.chat.id, "✅ All ranking statistics have been cleared successfully.");
        } catch (err) {
            console.error("Error clearing stats:", err);
            bot.sendMessage(msg.chat.id, "❌ An error occurred while clearing statistics.");
        }
    };

    // Slash commands
    bot.onText(/\/ranking/, (msg) => handleRanking(msg));
    bot.onText(/\/topusers/, (msg) => handleTopUsers(msg));
    bot.onText(/\/topgroups/, (msg) => handleTopGroups(msg));
    bot.onText(/\/(profile|rofile)/, (msg) => handleProfile(msg));
    bot.onText(/\/mytop/, (msg) => handleMyTop(msg));
    bot.onText(/\/groupstats/, (msg) => handleGroupStats(msg));
    bot.onText(/\/fetchhistory/, (msg) => handleFetchHistory(msg));
    bot.onText(/\/clearstats/, (msg) => handleClearStats(msg));

    // Export for manual callback routing if needed
    deps.ranking = { handleCallback };
};
