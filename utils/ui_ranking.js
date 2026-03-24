const { getLeagueInfo } = require('./activity');

function formatNumber(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(3).replace('.', ',') + 'M';
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function formatOrdinal(n) {
    return n + "°";
}

function generateProgressBar(current, target) {
    const size = 10;
    const progress = Math.min(Math.floor((current / target) * size), size);
    const empty = size - progress;
    return "▰".repeat(progress) + "▱".repeat(empty);
}

function formatProfile(stats, local, globalPos, localPos, totalUsers, totalGroups) {
    const { currentLeague, nextLeague } = getLeagueInfo(stats.messages.overall);

    let text = `👤 *YOUR PROFILE*\n`;
    text += ` • Messages sent here: ${formatNumber(local.messages.overall)} (today: ${local.messages.today}, this week: ${local.messages.week})\n`;
    text += ` • Messages sent globally: ${formatNumber(stats.messages.overall)} (today: ${stats.messages.today}, this week: ${stats.messages.week})\n`;
    text += ` • Position here: ${formatOrdinal(localPos.overall)} on ${formatNumber(totalUsers)} (today: ${formatOrdinal(localPos.today)}, this week: ${formatOrdinal(localPos.week)})\n`;
    text += ` • Global position: ${formatOrdinal(globalPos.overall)} on ~${formatNumber(totalGroups * 1000)} (today: ${formatOrdinal(globalPos.today)}, this week: ${formatOrdinal(globalPos.week)})\n\n`;

    text += `🥇*${currentLeague.name}*\n`;
    if (nextLeague) {
        const diff = nextLeague.threshold - stats.messages.overall;
        text += `  — ${formatNumber(diff)} messages to the next league\n`;
    }

    return text;
}

function formatLeaderboard(title, items, type, totalMessages, period) {
    let text = `📈 *${title} | ${period.toUpperCase()}*\n`;
    items.forEach((item, index) => {
        const name = item.username || item.title || "Unknown";
        const count = item.messages[period] || 0;
        const icon = type === 'group' ? '👥' : (index === 0 ? '👦🏻' : '👤');
        text += `${index + 1}. ${icon} ${name} • ${formatNumber(count)}\n`;
    });

    if (totalMessages) {
        text += `\n✉️ Total messages: ${formatNumber(totalMessages)}`;
    }

    return text;
}

module.exports = {
    formatNumber,
    formatOrdinal,
    formatProfile,
    formatLeaderboard
};
