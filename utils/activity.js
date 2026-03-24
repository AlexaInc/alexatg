const moment = require('moment-timezone');

const LEAGUES = [
    { name: "Bronze League 1", threshold: 0 },
    { name: "Bronze League 2", threshold: 1000 },
    { name: "Silver League 1", threshold: 5000 },
    { name: "Silver League 2", threshold: 10000 },
    { name: "Gold League 1", threshold: 25000 },
    { name: "Gold League 2", threshold: 50000 },
    { name: "Platinum League 1", threshold: 100000 },
    { name: "Platinum League 2", threshold: 250000 },
    { name: "Diamond League", threshold: 500000 },
    { name: "Master League", threshold: 1000000 },
    { name: "Legendary League", threshold: 5000000 }
];

const floodCache = new Map(); // userId -> { count, lastMessageAt, blockedUntil }

function getLeagueInfo(messages) {
    let currentLeague = LEAGUES[0];
    let nextLeague = null;

    for (let i = 0; i < LEAGUES.length; i++) {
        if (messages >= LEAGUES[i].threshold) {
            currentLeague = LEAGUES[i];
            nextLeague = LEAGUES[i + 1] || null;
        } else {
            break;
        }
    }

    return { currentLeague, nextLeague };
}

async function handleActivity(bot, deps, msg) {
    if (!msg.from || msg.from.is_bot) return;

    const userId = msg.from.id.toString();
    const chatId = msg.chat.id.toString();
    const now = new Date();

    // 1. Flood Control
    let flood = floodCache.get(userId);
    if (!flood) {
        flood = { count: 0, lastMessageAt: now, blockedUntil: null };
        floodCache.set(userId, flood);
    }

    // Check if already blocked
    if (flood.blockedUntil && flood.blockedUntil > now) {
        return; // Silently ignore if blocked
    }

    // Reset flood count after some time of inactivity
    if (now - flood.lastMessageAt > 5000) {
        flood.count = 0;
    }

    flood.count++;
    flood.lastMessageAt = now;

    if (flood.count > 10) { // More than 10 messages in 5 seconds
        flood.blockedUntil = new Date(now.getTime() + 20 * 60 * 1000);
        const mention = `[${msg.from.first_name}](tg://user?id=${userId})`;
        bot.sendMessage(msg.chat.id, `${mention} is loading blocked for 20 minutes`, { parse_mode: 'Markdown' });

        // Also update GlobalUserStats to persist block
        await deps.GlobalUserStats.updateOne(
            { userId },
            { $set: { blockedUntil: flood.blockedUntil } },
            { upsert: true }
        );
        return;
    }

    // 2. Persistent Block Check (from DB)
    const globalStats = await deps.GlobalUserStats.findOne({ userId });
    if (globalStats && globalStats.blockedUntil && globalStats.blockedUntil > now) {
        flood.blockedUntil = globalStats.blockedUntil;
        return;
    }

    // 3. Update Counts
    const isNewDay = (lastDate) => !lastDate || !moment(lastDate).isSame(now, 'day');
    const isNewWeek = (lastDate) => !lastDate || !moment(lastDate).isSame(now, 'week');

    // Update Local Activity
    const activityUpdate = {
        $inc: {
            'messages.overall': 1,
            'messages.today': 1,
            'messages.week': 1
        },
        $set: {
            username: msg.from.username || msg.from.first_name,
            lastMessageAt: now
        }
    };

    // If rollover, set instead of inc
    const localActivity = await deps.Activity.findOne({ userId, chatId });
    if (localActivity) {
        if (isNewDay(localActivity.lastMessageAt)) activityUpdate.$set['messages.today'] = 1;
        if (isNewWeek(localActivity.lastMessageAt)) activityUpdate.$set['messages.week'] = 1;

        // Fix $inc if we are setting
        if (activityUpdate.$set['messages.today']) delete activityUpdate.$inc['messages.today'];
        if (activityUpdate.$set['messages.week']) delete activityUpdate.$inc['messages.week'];
    }

    await deps.Activity.updateOne({ userId, chatId }, activityUpdate, { upsert: true });

    // Update Global User Stats
    const globalUserUpdate = {
        $inc: {
            'messages.overall': 1,
            'messages.today': 1,
            'messages.week': 1
        },
        $set: {
            username: msg.from.username || msg.from.first_name,
            lastActiveAt: now
        }
    };

    if (globalStats) {
        if (isNewDay(globalStats.lastActiveAt)) globalUserUpdate.$set['messages.today'] = 1;
        if (isNewWeek(globalStats.lastActiveAt)) globalUserUpdate.$set['messages.week'] = 1;

        if (globalUserUpdate.$set['messages.today']) delete globalUserUpdate.$inc['messages.today'];
        if (globalUserUpdate.$set['messages.week']) delete globalUserUpdate.$inc['messages.week'];
    }

    await deps.GlobalUserStats.updateOne({ userId }, globalUserUpdate, { upsert: true });

    // Update Global Group Stats
    const globalGroupUpdate = {
        $inc: {
            'messages.overall': 1,
            'messages.today': 1,
            'messages.week': 1
        },
        $set: {
            title: msg.chat.title || 'Private Chat',
            lastActiveAt: now
        }
    };

    const globalGroup = await deps.GlobalGroupStats.findOne({ chatId });
    if (globalGroup) {
        if (isNewDay(globalGroup.lastActiveAt)) globalGroupUpdate.$set['messages.today'] = 1;
        if (isNewWeek(globalGroup.lastActiveAt)) globalGroupUpdate.$set['messages.week'] = 1;

        if (globalGroupUpdate.$set['messages.today']) delete globalGroupUpdate.$inc['messages.today'];
        if (globalGroupUpdate.$set['messages.week']) delete globalGroupUpdate.$inc['messages.week'];
    } else {
        // Increment userCount for new group in global stats
        globalGroupUpdate.$set.userCount = 1;
    }

    await deps.GlobalGroupStats.updateOne({ chatId }, globalGroupUpdate, { upsert: true });
}

module.exports = {
    getLeagueInfo,
    handleActivity
};
