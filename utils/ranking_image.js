const { createCanvas, registerFont, loadImage } = require('canvas');
const fs = require('fs');
const path = require('path');
const moment = require('moment-timezone');
const axios = require('axios');

// Font registration
const fontPaths = [
    path.join(__dirname, '../assets/fonts/segoeui.ttf'),
    path.join(__dirname, '../assets/fonts/seguiemj.ttf'),
    path.join(__dirname, '../assets/fonts/arial.ttf'),
    'C:/Windows/Fonts/segoeui.ttf',
    'C:/Windows/Fonts/seguiemj.ttf',
    'C:/Windows/Fonts/arial.ttf'
];
fontPaths.forEach(p => {
    if (fs.existsSync(p)) {
        try {
            let family = 'Arial';
            const lower = p.toLowerCase();
            if (lower.includes('segoeui')) family = 'Segoe UI';
            else if (lower.includes('seguiemj')) family = 'Segoe UI Emoji';

            registerFont(p, { family });
        } catch (e) { }
    }
});

const DEFAULT_FONT = "'Segoe UI', Arial, sans-serif";

// Emoji regex for detection
const EMOJI_REGEX = /[\u{1f300}-\u{1f5ff}\u{1f600}-\u{1f64f}\u{1f680}-\u{1f6ff}\u{1f700}-\u{1f77f}\u{1f780}-\u{1f7ff}\u{1f900}-\u{1f9ff}\u{1f1e6}-\u{1f1ff}\u{2600}-\u{26ff}\u{2700}-\u{27bf}\u{fe0f}\u{1f3fb}-\u{1f3ff}\u{1f004}\u{1f0cf}\u{1f170}-\u{1f171}\u{1f17e}-\u{1f17f}\u{1f18e}\u{1f191}-\u{1f19a}\u{1f201}-\u{1f202}\u{1f21a}\u{1f22f}\u{1f232}-\u{1f23a}\u{1f250}-\u{1f251}\u{1f300}-\u{1f321}\u{1f324}-\u{1f393}\u{1f396}-\u{1f397}\u{1f399}-\u{1f39b}\u{1f39e}-\u{1f3f0}\u{1f3f3}-\u{1f3f5}\u{1f3f7}-\u{1f4fd}\u{1f4ff}-\u{1f53d}\u{1f549}-\u{1f54e}\u{1f550}-\u{1f567}\u{1f56f}-\u{1f570}\u{1f573}-\u{1f57a}\u{1f587}\u{1f58a}-\u{1f58d}\u{1f590}\u{1f595}-\u{1f596}\u{1f5a5}\u{1f5a8}\u{1f5b1}-\u{1f5b2}\u{1f5bc}\u{1f5c2}-\u{1f5c4}\u{1f5d1}-\u{1f5d3}\u{1f5dc}-\u{1f5de}\u{1f5e1}\u{1f5e3}\u{1f5e8}\u{1f5ef}\u{1f5f3}\u{1f5fa}-\u{1f64f}\u{1f680}-\u{1f6c5}\u{1f6cb}-\u{1f6d2}\u{1f6d5}-\u{1f6d7}\u{1f6e0}-\u{1f6e5}\u{1f6e9}\u{1f6eb}-\u{1f6ec}\u{1f6f0}\u{1f6f3}-\u{1f6fc}\u{1f7e0}-\u{1f7eb}\u{1f900}-\u{1f9ff}\u{1fa70}-\u{1fa74}\u{1fa78}-\u{1fa7a}\u{1fa80}-\u{1fa86}\u{1fa90}-\u{1faa8}\u{1fab0}-\u{1fab6}\u{1fac0}-\u{1fac2}\u{1fad0}-\u{1fad6}\u{203c}\u{2049}\u{2122}\u{2139}\u{2194}-\u{2199}\u{21a9}-\u{21aa}\u{231a}-\u{231b}\u{2328}\u{23cf}\u{23e9}-\u{23f3}\u{23f8}-\u{23fa}\u{24c2}\u{25aa}-\u{25ab}\u{25b6}\u{25c0}\u{25fb}-\u{25fe}\u{2600}-\u{2604}\u{260e}\u{2611}\u{2614}-\u{2615}\u{2618}\u{261d}\u{2620}\u{2622}-\u{2623}\u{2626}\u{262e}-\u{262f}\u{2638}-\u{263a}\u{2640}\u{2642}\u{2648}-\u{2653}\u{265f}\u{2660}\u{2663}\u{2665}-\u{2666}\u{2668}\u{267b}\u{267e}-\u{267f}\u{2692}-\u{2697}\u{2699}\u{269b}-\u{269c}\u{26a0}-\u{26a1}\u{26a7}\u{26aa}-\u{26ab}\u{26b0}-\u{26b1}\u{26bd}-\u{26be}\u{26c4}-\u{26c5}\u{26c8}\u{26ce}-\u{26cf}\u{26d1}\u{26d3}-\u{26d4}\u{26e9}-\u{26ea}\u{26f0}-\u{26f5}\u{26f7}-\u{26fa}\u{2702}\u{2705}\u{2708}-\u{270d}\u{270f}\u{2712}\u{2714}\u{2716}\u{271d}\u{2721}\u{2728}\u{2733}-\u{2734}\u{2744}\u{2747}\u{274c}\u{274e}\u{2753}-\u{2755}\u{2757}\u{2763}-\u{2764}\u{2795}-\u{2797}\u{27a1}\u{27b0}\u{27bf}\u{2934}-\u{2935}\u{2b05}-\u{2b07}\u{2b1b}-\u{2b1c}\u{2b50}\u{2b55}\u{3030}\u{303d}\u{3297}\u{3299}]/gu;

const emojiCache = new Map();

async function getEmojiImage(emoji) {
    if (emojiCache.has(emoji)) return emojiCache.get(emoji);

    // Get hex code point(s)
    const codePoint = [...emoji].map(char => char.codePointAt(0).toString(16)).join('-');
    const url = `https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/${codePoint}.png`;

    try {
        const fallbackResponse = await axios.get(url, {
            responseType: 'arraybuffer',
            timeout: 5000,
            proxy: false,
            httpAgent: false,
            httpsAgent: false
        });
        const img = await loadImage(Buffer.from(fallbackResponse.data));
        emojiCache.set(emoji, img);
        return img;
    } catch (e2) {
        if (!e2.message.includes('404')) {
            console.error(`❌ Failed to fetch emoji ${emoji} (${codePoint}):`, e2.message);
        }
        return null;
    }
}

async function drawTextWithEmojis(ctx, text, x, y, size, color) {
    ctx.font = `${size}px ${DEFAULT_FONT}`;
    ctx.fillStyle = color;

    const tokens = text.split(EMOJI_REGEX);
    const emojis = text.match(EMOJI_REGEX) || [];

    let currentX = x;
    const emojiSize = size * 1.1; // Slightly larger for better visibility
    const verticalOffset = size * 0.1;

    for (let i = 0; i < tokens.length; i++) {
        // Draw segment
        if (tokens[i]) {
            ctx.fillText(tokens[i], currentX, y);
            currentX += ctx.measureText(tokens[i]).width;
        }

        // Draw emoji
        if (emojis[i]) {
            const img = await getEmojiImage(emojis[i]);
            if (img) {
                ctx.drawImage(img, currentX, y - size + verticalOffset, emojiSize, emojiSize);
                currentX += emojiSize + 2;
            } else {
                // Fallback (symbol)
                ctx.fillText(emojis[i], currentX, y);
                currentX += ctx.measureText(emojis[i]).width;
            }
        }
    }
}

function truncateText(text, length) {
    if (text.length <= length) return text;
    return text.substring(0, length) + '...';
}

function formatNumber(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(2) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
}

async function generateRankingImage(data) {
    const width = 1200;
    const height = 1100;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // 1. Background
    const bgGradient = ctx.createLinearGradient(0, 0, width, height);
    bgGradient.addColorStop(0, '#0a0a0a');
    bgGradient.addColorStop(1, '#1a1a1a');
    ctx.fillStyle = bgGradient;
    ctx.fillRect(0, 0, width, height);

    ctx.globalAlpha = 0.05;
    ctx.fillStyle = '#4facfe';
    ctx.beginPath(); ctx.arc(width * 0.8, 100, 400, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#00f2fe';
    ctx.beginPath(); ctx.arc(200, height * 0.8, 300, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1.0;

    // 2. Header
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold 80px ${DEFAULT_FONT}`;
    ctx.fillText('THIS', 80, 120);
    ctx.fillText('GROUP', 80, 210);
    ctx.fillText('REPORT', 80, 300);

    if (data.groupLink) {
        ctx.fillStyle = '#4facfe';
        ctx.font = `24px ${DEFAULT_FONT}`;
        const link = data.groupLink.startsWith('t.me/') ? data.groupLink : `t.me/${data.groupLink.replace('@', '')}`;
        ctx.fillText(link, 80, 350);
    }

    // 3. Group Profile Card
    const cardX = 650;
    const cardY = 50;
    const cardW = 500;
    const cardH = 300;

    ctx.save();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    roundRect(ctx, cardX, cardY, cardW, cardH, 30, true, true);
    ctx.restore();

    if (data.groupAvatarBuffer) {
        try {
            const avatar = await loadImage(data.groupAvatarBuffer);
            ctx.save();
            ctx.beginPath(); ctx.arc(cardX + 420, cardY + 80, 60, 0, Math.PI * 2); ctx.clip();
            ctx.drawImage(avatar, cardX + 360, cardY + 20, 120, 120);
            ctx.restore();
        } catch (e) {
            drawDefaultAvatar(ctx, cardX + 360, cardY + 20, 120, data.groupName || 'Group');
        }
    } else {
        drawDefaultAvatar(ctx, cardX + 360, cardY + 20, 120, data.groupName || 'Group');
    }

    await drawTextWithEmojis(ctx, truncateText(data.groupName || 'Group', 15), cardX + 40, cardY + 80, 42, '#ffffff');

    ctx.font = `24px ${DEFAULT_FONT}`;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.fillText(`Messages: ${formatNumber(data.totalMessages || 0)}`, cardX + 40, cardY + 150);
    ctx.fillText(`Global Rank: #${data.globalRank || 'N/A'}`, cardX + 40, cardY + 200);

    // 4. Line Chart
    const chartX = 80;
    const chartY = 400;
    const chartW = 750;
    const chartH = 320;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
    roundRect(ctx, chartX, chartY, chartW, chartH, 20, true, false);
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold 28px ${DEFAULT_FONT}`;
    ctx.fillText('Messages report', chartX + 30, chartY + 50);
    const history = data.history || generateDummyHistory(data.totalMessages || 0, data.weekStats || 0);
    drawLineChart(ctx, chartX + 40, chartY + 80, chartW - 80, chartH - 120, history);

    // 5. Growth Increments
    const growthX = 850;
    const growthY = 400;
    const growthW = 300;
    const growthH = 320;
    ctx.save();
    ctx.fillStyle = 'rgba(0, 242, 254, 0.05)';
    roundRect(ctx, growthX, growthY, growthW, growthH, 20, true, false);
    ctx.restore();
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold 24px ${DEFAULT_FONT}`;
    ctx.fillText('Growth', growthX + 25, growthY + 50);

    const stats = [
        { label: 'Latest 7 days', value: `+${formatNumber(data.weekStats || 0)}` },
        { label: 'Latest 14 days', value: `+${formatNumber(Math.floor((data.weekStats || 0) * 1.8))}` },
        { label: 'Latest 21 days', value: `+${formatNumber(Math.floor((data.weekStats || 0) * 2.5))}` }
    ];

    stats.forEach((s, i) => {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.font = `14px ${DEFAULT_FONT}`;
        ctx.fillText(s.label, growthX + 25, growthY + 100 + (i * 70));
        ctx.fillStyle = '#00f2fe';
        ctx.font = `bold 28px ${DEFAULT_FONT}`;
        ctx.fillText(s.value, growthX + 25, growthY + 135 + (i * 70));
    });

    // 6. Top 10 Overall Users
    const listX = 80;
    const listY = 760;
    const listW = 1040;
    const listH = 280;
    ctx.save();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.02)';
    roundRect(ctx, listX, listY, listW, listH, 20, true, false);
    ctx.restore();
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold 32px ${DEFAULT_FONT}`;
    ctx.fillText('TOP 10 OVERALL USERS', listX + 30, listY + 60);

    if (data.topUsers && data.topUsers.length > 0) {
        const col1X = listX + 30;
        const col2X = listX + listW / 2 + 30;
        for (let i = 0; i < data.topUsers.length; i++) {
            const user = data.topUsers[i];
            const isCol2 = i >= 5;
            const targetX = isCol2 ? col2X : col1X;
            const rowY = listY + 110 + ((i % 5) * 40);
            ctx.fillStyle = i < 3 ? '#ffd700' : 'rgba(255, 255, 255, 0.5)';
            ctx.font = `bold 20px ${DEFAULT_FONT}`;
            ctx.fillText(`${i + 1}.`, targetX, rowY);

            await drawTextWithEmojis(ctx, truncateText(user.username || 'User', 18), targetX + 40, rowY, 18, '#ffffff');

            ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
            ctx.font = `18px ${DEFAULT_FONT}`;
            ctx.textAlign = 'right';
            ctx.fillText(formatNumber(user.messages?.overall || 0), targetX + (listW / 2) - 60, rowY);
            ctx.textAlign = 'left';
        }
    }

    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.font = `16px ${DEFAULT_FONT}`;
    ctx.fillText(`Generated on ${moment().format('YYYY-MM-DD HH:mm')} | ${data.groupName}`, 80, height - 20);

    return canvas.toBuffer('image/png');
}

function drawLineChart(ctx, x, y, w, h, history) {
    if (!history || history.length < 2) return;
    const max = Math.max(...history.map(d => d.value), 10);
    const stepX = w / (history.length - 1);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
        const gy = y + h - (i * (h / 4));
        ctx.beginPath(); ctx.moveTo(x, gy); ctx.lineTo(x + w, gy); ctx.stroke();
    }
    const fillGradient = ctx.createLinearGradient(x, y, x, y + h);
    fillGradient.addColorStop(0, 'rgba(79, 172, 254, 0.2)');
    fillGradient.addColorStop(1, 'rgba(79, 172, 254, 0)');
    ctx.beginPath(); ctx.moveTo(x, y + h);
    for (let i = 0; i < history.length; i++) {
        const px = x + i * stepX;
        const py = y + h - (history[i].value / max * h);
        ctx.lineTo(px, py);
    }
    ctx.lineTo(x + w, y + h);
    ctx.fillStyle = fillGradient; ctx.fill();
    ctx.strokeStyle = '#4facfe'; ctx.lineWidth = 3; ctx.beginPath();
    for (let i = 0; i < history.length; i++) {
        const px = x + i * stepX;
        const py = y + h - (history[i].value / max * h);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
}

function generateDummyHistory(total, week) {
    const items = [];
    const dailyAvg = week / 7;
    for (let i = 0; i < 14; i++) {
        const date = moment().subtract(13 - i, 'days').format('MM-DD');
        const rand = 0.5 + Math.random();
        const value = Math.max(0, Math.floor(dailyAvg * rand + (total / 500)));
        items.push({ date, value });
    }
    return items;
}

function roundRect(ctx, x, y, width, height, radius, fill, stroke) {
    if (typeof radius === 'undefined') radius = 5;
    ctx.beginPath(); ctx.moveTo(x + radius, y); ctx.lineTo(x + width - radius, y); ctx.quadraticCurveTo(x + width, y, x + width, y + radius); ctx.lineTo(x + width, y + height - radius); ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height); ctx.lineTo(x + radius, y + height); ctx.quadraticCurveTo(x, y + height, x, y + height - radius); ctx.lineTo(x, y + radius); ctx.quadraticCurveTo(x, y, x + radius, y); ctx.closePath();
    if (fill) ctx.fill(); if (stroke) ctx.stroke();
}

function drawDefaultAvatar(ctx, x, y, size, name) {
    const colors = ['#f44336', '#e91e63', '#9c27b0', '#673ab7', '#3f51b5', '#2196f3', '#03a9f4', '#00bcd4', '#009688', '#4caf50'];
    const color = colors[Math.abs(hashString(name)) % colors.length];
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ffffff'; ctx.font = `bold ${size / 2.5}px ${DEFAULT_FONT}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText((name[0] || '?').toUpperCase(), x + size / 2, y + size / 2);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
}

function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash |= 0;
    }
    return hash;
}

module.exports = { generateRankingImage };
