const { getLeagueInfo } = require('./activity');

function formatNumber(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(3).replace('.', ',') + 'M';
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function formatOrdinal(n) {
    return n + "°";
}

function escapeHTML(text) {
    if (!text) return "";
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function generateProgressBar(current, target) {
    const size = 10;
    const progress = Math.min(Math.floor((current / target) * size), size);
    const empty = size - progress;
    return "▰".repeat(progress) + "▱".repeat(empty);
}

function formatProfile(stats, local, globalPos, localPos, totalUsers, totalGroups) {
    const { currentLeague, nextLeague } = getLeagueInfo(stats.messages.overall);

    let text = `👤 <b>YOUR PROFILE</b>\n`;
    text += ` • Messages sent here: ${formatNumber(local.messages.overall)} (today: ${local.messages.today}, this week: ${local.messages.week})\n`;
    text += ` • Messages sent globally: ${formatNumber(stats.messages.overall)} (today: ${stats.messages.today}, this week: ${stats.messages.week})\n`;
    text += ` • Position here: ${formatOrdinal(localPos.overall)} on ${formatNumber(totalUsers)} (today: ${formatOrdinal(localPos.today)}, this week: ${formatOrdinal(localPos.week)})\n`;
    text += ` • Global position: ${formatOrdinal(globalPos.overall)} on ~${formatNumber(totalGroups * 1000)} (today: ${formatOrdinal(globalPos.today)}, this week: ${formatOrdinal(globalPos.week)})\n\n`;

    text += `🥇<b>${escapeHTML(currentLeague.name)}</b>\n`;
    if (nextLeague) {
        const diff = nextLeague.threshold - stats.messages.overall;
        text += `  — ${formatNumber(diff)} messages to the next league\n`;
    }

    return text;
}

function formatLeaderboard(title, items, type, totalMessages, period) {
    let text = `📈 <b>${escapeHTML(title)} | ${period.toUpperCase()}</b>\n`;
    items.forEach((item, index) => {
        let name = item.username || item.title || item.chatTitle || "Unknown";
        if (type === 'group' && item.chatTitle) name = item.chatTitle;

        const count = item.messages ? (item.messages[period] || 0) : 0;
        let nameDisplay = escapeHTML(name);

        if (type === 'user' && item.userId) {
            nameDisplay = `<a href="tg://user?id=${item.userId}">${nameDisplay}</a>`;
        }

        text += `${index + 1}. ${statusIcon(index, type)} ${nameDisplay} • ${formatNumber(count)}\n`;
    });

    if (totalMessages) {
        text += `\n✉️ Total messages: ${formatNumber(totalMessages)}`;
    }

    return text;
}

function statusIcon(index, type) {
    if (type === 'group') return '👥';
    if (index === 0) return '🥇';
    if (index === 1) return '🥈';
    if (index === 2) return '🥉';
    return '👤';
}

module.exports = {
    formatNumber,
    formatOrdinal,
    formatProfile,
    formatLeaderboard,
    escapeHTML
};
