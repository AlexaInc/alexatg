const { formatLeaderboard, formatProfile, formatNumber, escapeHTML } = require('../utils/ui_ranking');
const moment = require('moment-timezone');

module.exports = function (bot, deps) {
    const { Activity, GlobalUserStats, GlobalGroupStats } = deps;

    const periods = ['today', 'week', 'overall'];

    // Returns a date filter for lastMessageAt/lastActiveAt based on period
    const getDateFilter = (field, period) => {
        if (period === 'today') {
            return { [field]: { $gte: moment().startOf('day').toDate() } };
        } else if (period === 'week') {
            return { [field]: { $gte: moment().startOf('isoWeek').toDate() } };
        }
        return {}; // no filter for 'overall'
    };

    const getKeyboard = (prefix, currentPeriod) => {
        const createBtn = (p) => ({
            text: p === currentPeriod ? `• ${p.toUpperCase()} •` : p.toUpperCase(),
            callback_data: `${prefix}_${p}`
        });

        return {
            inline_keyboard: [
                [createBtn('overall')],
                [createBtn('today'), createBtn('week')]
            ]
        };
    };

    const handleRanking = async (msg, period = 'overall') => {
        const chatId = msg.chat.id.toString();
        const filter = { chatId, ...getDateFilter('lastMessageAt', period) };
        const items = await Activity.find(filter).sort({ [`messages.${period}`]: -1 }).limit(10);
        const title = "RANKING";
        const text = formatLeaderboard(title, items, 'user', null, period);
        bot.sendMessage(msg.chat.id, text, { parse_mode: 'HTML', reply_markup: getKeyboard('rank_local', period) });
    };

    const handleTopUsers = async (msg, period = 'overall') => {
        const filter = getDateFilter('lastActiveAt', period);
        const items = await GlobalUserStats.find(filter).sort({ [`messages.${period}`]: -1 }).limit(10);
        const totalAgg = await GlobalUserStats.aggregate([{ $match: filter }, { $group: { _id: null, total: { $sum: `$messages.${period}` } } }]);
        const total = totalAgg[0] ? totalAgg[0].total : 0;
        const text = formatLeaderboard("GLOBAL LEADERBOARD", items, 'user', total, period);
        bot.sendMessage(msg.chat.id, text, { parse_mode: 'HTML', reply_markup: getKeyboard('rank_global', period) });
    };

    const handleTopGroups = async (msg, period = 'overall') => {
        const filter = getDateFilter('lastActiveAt', period);
        const items = await GlobalGroupStats.find(filter).sort({ [`messages.${period}`]: -1 }).limit(10);
        const totalAgg = await GlobalGroupStats.aggregate([{ $match: filter }, { $group: { _id: null, total: { $sum: `$messages.${period}` } } }]);
        const total = totalAgg[0] ? totalAgg[0].total : 0;
        const text = formatLeaderboard("TOP GROUPS", items, 'group', total, period);
        bot.sendMessage(msg.chat.id, text, { parse_mode: 'HTML', reply_markup: getKeyboard('rank_groups', period) });
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
        const profileName = escapeHTML(msg.from.first_name);
        const profileText = `👤 <b>PROFILE | ${profileName.toUpperCase()}</b>\n` + text.replace('👤 <b>YOUR PROFILE</b>\n', '');

        bot.sendMessage(msg.chat.id, profileText, { parse_mode: 'HTML' });
    };

    const handleMyTop = async (msg, period = 'overall') => {
        const userId = msg.from.id.toString();
        const filter = { userId, ...getDateFilter('lastMessageAt', period) };
        const items = await Activity.find(filter).sort({ [`messages.${period}`]: -1 }).limit(10);
        const name = escapeHTML(msg.from.first_name);
        const text = formatLeaderboard(`MY TOP GROUPS | ${name}`, items, 'group', null, period);
        bot.sendMessage(msg.chat.id, text, { parse_mode: 'HTML', reply_markup: getKeyboard('rank_mytop', period) });
    };

    const handleGroupStats = async (msg) => {
        const chatId = msg.chat.id.toString();
        const group = await GlobalGroupStats.findOne({ chatId });
        if (!group) return bot.sendMessage(msg.chat.id, "No stats found for this group yet.");

        const globalPos = await GlobalGroupStats.countDocuments({ 'messages.overall': { $gt: group.messages.overall } }) + 1;
        const globalPosToday = await GlobalGroupStats.countDocuments({ 'messages.today': { $gt: group.messages.today } }) + 1;
        const globalPosWeek = await GlobalGroupStats.countDocuments({ 'messages.week': { $gt: group.messages.week } }) + 1;

        let text = `📊 <b>STATS FOR ${escapeHTML(group.title)}</b>\n`;
        text += `👥 ChatFight detects ${group.userCount} users in this group.\n\n`;

        text += `➖ <b>Overall stats</b>\n`;
        text += `🏆 Global Position: ${globalPos}°\n`;
        text += `📤 Messages Sent: ${group.messages.overall}\n\n`;

        text += `➖ <b>Today's stats</b>\n`;
        text += `🏆 Global Position: ${globalPosToday}°\n`;
        text += `📤 Messages Sent: ${group.messages.today}\n\n`;

        text += `➖ <b>This week's stats</b>\n`;
        text += `🏆 Global Position: ${globalPosWeek}°\n`;
        text += `📤 Messages Sent: ${group.messages.week}\n`;

        bot.sendMessage(msg.chat.id, text, { parse_mode: 'HTML' });
    };

    // Callback Handler
    const handleCallback = async (query) => {
        const [prefix, type, period] = query.data.split('_');
        const chatId = query.message.chat.id.toString();
        const messageId = query.message.message_id;

        let items, title, text, total, typeIcon;
        const userId = query.from.id.toString();

        if (type === 'local') {
            const filter = { chatId, ...getDateFilter('lastMessageAt', period) };
            items = await Activity.find(filter).sort({ [`messages.${period}`]: -1 }).limit(10);
            text = formatLeaderboard("RANKING", items, 'user', null, period);
        } else if (type === 'global') {
            const filter = getDateFilter('lastActiveAt', period);
            items = await GlobalUserStats.find(filter).sort({ [`messages.${period}`]: -1 }).limit(10);
            const totalAgg = await GlobalUserStats.aggregate([{ $match: filter }, { $group: { _id: null, total: { $sum: `$messages.${period}` } } }]);
            total = totalAgg[0] ? totalAgg[0].total : 0;
            text = formatLeaderboard("GLOBAL LEADERBOARD", items, 'user', total, period);
        } else if (type === 'groups') {
            const filter = getDateFilter('lastActiveAt', period);
            items = await GlobalGroupStats.find(filter).sort({ [`messages.${period}`]: -1 }).limit(10);
            const totalAgg = await GlobalGroupStats.aggregate([{ $match: filter }, { $group: { _id: null, total: { $sum: `$messages.${period}` } } }]);
            total = totalAgg[0] ? totalAgg[0].total : 0;
            text = formatLeaderboard("TOP GROUPS", items, 'group', total, period);
        } else if (type === 'mytop') {
            const filter = { userId, ...getDateFilter('lastMessageAt', period) };
            items = await Activity.find(filter).sort({ [`messages.${period}`]: -1 }).limit(10);
            text = formatLeaderboard(`MY TOP GROUPS | ${query.from.first_name}`, items, 'group', null, period);
        }

        bot.editMessageText(text, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'HTML',
            reply_markup: getKeyboard(prefix + '_' + type, period)
        }).catch(err => {
            console.error("Error editing ranking message:", err.message);
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

            let processedCount = 0;
            let offsetId = 0;
            const chunkSize = 100;

            const now = new Date();
            const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const weekStart = new Date(now);
            weekStart.setDate(now.getDate() - now.getDay());

            // Cache participants once to save RAM/Time
            await bot.editMessageText(`⏳ **Syncing...**\nResolving member names...`, { chat_id: msg.chat.id, message_id: statusMsg.message_id }).catch(() => { });
            const chatUsers = await client.getParticipants(entity).catch(() => []);
            const userCache = {};
            chatUsers.forEach(u => {
                userCache[u.id.toString()] = {
                    name: (u.firstName + (u.lastName ? " " + u.lastName : "")).trim(),
                    bot: u.bot
                };
            });

            while (processedCount < limit) {
                const chunkLimit = Math.min(chunkSize, limit - processedCount);
                const chunk = await client.getMessages(entity, { limit: chunkLimit, offsetId });
                if (!chunk || chunk.length === 0) break;

                const userCounts = {}; // userId -> { overall, today, week, name }
                let chunkTotal = 0;
                let chunkToday = 0;
                let chunkWeek = 0;

                for (const m of chunk) {
                    if (!m.fromId || !m.fromId.userId) continue;
                    const uid = m.fromId.userId.toString();
                    const cached = userCache[uid];
                    if (cached && cached.bot) continue;

                    const date = new Date(m.date * 1000);
                    if (!userCounts[uid]) {
                        userCounts[uid] = { overall: 0, today: 0, week: 0, name: cached ? cached.name : "User" };
                    }
                    userCounts[uid].overall++;
                    chunkTotal++;
                    if (date >= today) { userCounts[uid].today++; chunkToday++; }
                    if (date >= weekStart) { userCounts[uid].week++; chunkWeek++; }
                }

                // Batch update DB for this chunk immediately
                const userIds = Object.keys(userCounts);
                for (const uid of userIds) {
                    const u = userCounts[uid];
                    await Activity.updateOne({ chatId, userId: uid }, {
                        $inc: { 'messages.overall': u.overall, 'messages.today': u.today, 'messages.week': u.week },
                        $set: { username: u.name, chatTitle: msg.chat.title || 'Group' }
                    }, { upsert: true });
                    await GlobalUserStats.updateOne({ userId: uid }, {
                        $inc: { 'messages.overall': u.overall, 'messages.today': u.today, 'messages.week': u.week },
                        $set: { username: u.name }
                    }, { upsert: true });
                }

                await GlobalGroupStats.updateOne({ chatId }, {
                    $inc: { 'messages.overall': chunkTotal, 'messages.today': chunkToday, 'messages.week': chunkWeek }
                }, { upsert: true });

                processedCount += chunk.length;
                offsetId = chunk[chunk.length - 1].id;

                await bot.editMessageText(`⏳ **Syncing (Memory-Safe)...**\nProcessed: \`${processedCount}\` / \`${limit}\``, {
                    chat_id: msg.chat.id, message_id: statusMsg.message_id, parse_mode: 'Markdown'
                }).catch(() => { });

                // Small delay to prevent API flooding
                await new Promise(r => setTimeout(r, 1500));
            }

            if (processedCount === 0) {
                await client.disconnect();
                return bot.editMessageText("ℹ️ No historical messages found.", { chat_id: msg.chat.id, message_id: statusMsg.message_id });
            }

            await bot.editMessageText(`✅ **Sync Complete!**\nTotal: \`${processedCount}\` messages.\nYour database is now up to date.`, {
                chat_id: msg.chat.id, message_id: statusMsg.message_id, parse_mode: 'Markdown'
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
    bot.onText(/^\/ranking(?:\s|$|@)/, (msg) => {
        if (!deps.handlers.checkCommand(msg, '/ranking', deps.BOT_USERNAME)) return;
        handleRanking(msg);
    });
    bot.onText(/^\/topusers(?:\s|$|@)/, (msg) => {
        if (!deps.handlers.checkCommand(msg, '/topusers', deps.BOT_USERNAME)) return;
        handleTopUsers(msg);
    });
    bot.onText(/^\/topgroups(?:\s|$|@)/, (msg) => {
        if (!deps.handlers.checkCommand(msg, '/topgroups', deps.BOT_USERNAME)) return;
        handleTopGroups(msg);
    });
    bot.onText(/^\/(profile|rofile)(?:\s|$|@)/, (msg) => {
        const cmd = msg.text.split(' ')[0].toLowerCase().split('@')[0];
        if (cmd !== '/profile' && cmd !== '/rofile') return;
        if (msg.text.includes('@') && !msg.text.includes(`@${deps.BOT_USERNAME}`)) return;
        handleProfile(msg);
    });
    bot.onText(/^\/mytop(?:\s|$|@)/, (msg) => {
        if (!deps.handlers.checkCommand(msg, '/mytop', deps.BOT_USERNAME)) return;
        handleMyTop(msg);
    });
    bot.onText(/^\/groupstats(?:\s|$|@)/, (msg) => {
        if (!deps.handlers.checkCommand(msg, '/groupstats', deps.BOT_USERNAME)) return;
        handleGroupStats(msg);
    });
    bot.onText(/^\/fetchhistory(?:\s|$|@)/, (msg) => {
        if (!deps.handlers.checkCommand(msg, '/fetchhistory', deps.BOT_USERNAME)) return;
        handleFetchHistory(msg);
    });
    bot.onText(/^\/clearstats(?:\s|$|@)/, (msg) => {
        if (!deps.handlers.checkCommand(msg, '/clearstats', deps.BOT_USERNAME)) return;
        handleClearStats(msg);
    });

    // Export for manual callback routing if needed
    deps.ranking = { handleCallback };
};
