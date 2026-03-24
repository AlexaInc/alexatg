const { formatLeaderboard, formatProfile, formatNumber } = require('../utils/ui_ranking');

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
        bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
    };

    const handleMyTop = async (msg, period = 'overall') => {
        const userId = msg.from.id.toString();
        const items = await Activity.find({ userId }).sort({ [`messages.${period}`]: -1 }).limit(10);
        const text = formatLeaderboard(`MY TOP GROUPS | ${msg.from.first_name}`, items, 'group', null, period);
        bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown', reply_markup: getKeyboard('rank_mytop', period) });
    };

    const handleGroupStats = async (msg) => {
        const chatId = msg.chat.id.toString();
        const group = await GlobalGroupStats.findOne({ chatId });
        if (!group) return bot.sendMessage(msg.chat.id, "No stats found for this group yet.");

        const globalPos = await GlobalGroupStats.countDocuments({ 'messages.overall': { $gt: group.messages.overall } }) + 1;
        const globalPosToday = await GlobalGroupStats.countDocuments({ 'messages.today': { $gt: group.messages.today } }) + 1;
        const globalPosWeek = await GlobalGroupStats.countDocuments({ 'messages.week': { $gt: group.messages.week } }) + 1;

        let text = `📊 *STATS FOR ${group.title}*\n`;
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
        }).catch(() => { });
    };

    // Slash commands
    bot.onText(/\/ranking/, (msg) => handleRanking(msg));
    bot.onText(/\/topusers/, (msg) => handleTopUsers(msg));
    bot.onText(/\/topgroups/, (msg) => handleTopGroups(msg));
    bot.onText(/\/(profile|rofile)/, (msg) => handleProfile(msg));
    bot.onText(/\/mytop/, (msg) => handleMyTop(msg));
    bot.onText(/\/groupstats/, (msg) => handleGroupStats(msg));

    // Export for manual callback routing if needed
    deps.ranking = { handleCallback };
};
