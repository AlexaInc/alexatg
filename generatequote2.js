require('dotenv').config();
const proxyHelper = require('./utils/proxyHelper');
proxyHelper.configureAxios();
proxyHelper.configureGlobal();

const puppeteer = require('puppeteer');
const { createCanvas, registerFont } = require('canvas');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const axios = require('axios');

// --- SHARED BROWSER ---
let sharedBrowser = null;
async function getBrowser() {
    if (sharedBrowser && sharedBrowser.connected) return sharedBrowser;
    sharedBrowser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--no-zygote', '--single-process', '--hide-scrollbars']
    });
    sharedBrowser.on('disconnected', () => { sharedBrowser = null; });
    return sharedBrowser;
}

const fontMap = {
    '/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf': 'Noto Sans',
    '/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf': 'Noto Sans',
    '/usr/share/fonts/truetype/noto/NotoSansSymbols-Regular.ttf': 'Noto Sans Symbols',
    '/usr/share/fonts/truetype/noto/NotoSansMath-Regular.ttf': 'Noto Sans Math',
    '/usr/share/fonts/truetype/noto/NotoSansSC-Bold.otf': 'Noto Sans SC'
};
Object.entries(fontMap).forEach(([f, n]) => { if (fs.existsSync(f)) { try { registerFont(f, { family: n }); } catch (e) { } } });

const FONT_STACK = "'Noto Sans', 'Noto Sans SC', 'Noto Sans Symbols', 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', 'Android Emoji', 'EmojiSymbols', sans-serif";
const BOT_TOKEN = '7961409784:AAH34SqtPohk5YydJVH9Fw9BfsxnSsAPIf8';

function getTelegramDarkThemeColor(id) { const map = new Map([[0, '#FF516A'], [1, '#FF9442'], [2, '#C66FFF'], [3, '#50D892'], [4, '#64D4F5'], [5, '#5095ED'], [6, '#FF66A6'], [7, '#FF8280'], [8, '#EDD64E'], [9, '#C66FFF']]); return map.get(id) || '#00ffff'; }

function escapeHtml(t) { return t ? t.toString().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;") : ''; }

function createTextChunkImageBuffer(text, fontSize, color) {
    const canvas = createCanvas(1, 1);
    const ctx = canvas.getContext('2d');
    ctx.font = `bold ${fontSize}px ${FONT_STACK}`;
    const m = ctx.measureText(text);
    const w = Math.max(1, m.width);
    const h = Math.max(1, fontSize * 1.3);
    const tCanvas = createCanvas(w, h);
    const tCtx = tCanvas.getContext('2d');
    tCtx.font = `bold ${fontSize}px ${FONT_STACK}`;
    tCtx.fillStyle = color; tCtx.textBaseline = 'middle';
    tCtx.fillText(text, 0, h / 2);
    return tCanvas.toBuffer('image/png');
}

// Convert emoji string to Twemoji hex code points
function toCodePoint(unicodeSurrogates, sep) {
    const r = []; let c = 0, p = 0, i = 0;
    while (i < unicodeSurrogates.length) {
        c = unicodeSurrogates.charCodeAt(i++);
        if (p) { r.push((0x10000 + ((p - 0xD800) << 10) + (c - 0xDC00)).toString(16)); p = 0; }
        else if (0xD800 <= c && c <= 0xDBFF) { p = c; }
        else { r.push(c.toString(16)); }
    }
    return r.join(sep || '-');
}

function getTwemojiUrl(emoji) {
    // Handling variation selectors: Twemoji often drops \uFE0F unless specifically required
    let codePoint = toCodePoint(emoji);
    if (codePoint.indexOf('200d') === -1) { codePoint = codePoint.replace(/-fe0f/g, ''); }
    return `https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.0.3/assets/svg/${codePoint}.svg`;
}

function generateNameHtml(text, color, fontSize) {
    if (!text) return '';
    const seg = new Intl.Segmenter();
    let res = '';
    const emojiRegex = /(\p{Emoji_Presentation}|\p{Emoji}\uFE0F|\p{Emoji_Modifier_Base})/u;
    for (const s of seg.segment(text)) {
        const c = s.segment;
        if (emojiRegex.test(c)) {
            res += `<img src="${getTwemojiUrl(c)}" class="emoji" style="height:1.15em; width:1.15em; vertical-align:middle; margin:0 2px;" data-emoji="${escapeHtml(c)}" onerror="this.style.display='none'; this.nextSibling.style.display='inline';" /><span style="display:none;">${escapeHtml(c)}</span>`;
        } else if (c.match(/^\s+$/)) {
            res += `<span style="white-space: pre;">${c}</span>`;
        } else {
            const b = createTextChunkImageBuffer(c, fontSize, color);
            res += `<img src="data:image/png;base64,${b.toString('base64')}" style="height: 1em; vertical-align: middle;" />`;
        }
    }
    return res;
}

const EMOJI_CACHE = new Map();
async function getCustomEmojiBase64(eId) {
    if (EMOJI_CACHE.has(eId)) return EMOJI_CACHE.get(eId);
    try {
        const s = await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/getCustomEmojiStickers`, { custom_emoji_ids: [eId] });
        const st = s.data.result?.[0]; if (!st) return null;
        const f = await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/getFile`, { file_id: st.thumbnail?.file_id || st.file_id });
        const i = await axios.get(`https://api.telegram.org/file/bot${BOT_TOKEN}/${f.data.result.file_path}`, { responseType: 'arraybuffer' });
        const buf = await sharp(i.data).resize(128, 128).png().toBuffer();
        const b64 = `data:image/png;base64,${buf.toString('base64')}`;
        EMOJI_CACHE.set(eId, b64); return b64;
    } catch (e) { return null; }
}

async function processMessageHtml(text, entities = []) {
    if (!text) return '';
    const sorted = (entities || []).filter(e => e.type === 'custom_emoji').sort((a, b) => b.offset - a.offset);
    let rows = []; let last = text.length;
    for (const e of sorted) {
        const b = await getCustomEmojiBase64(e.custom_emoji_id);
        if (b) { rows.unshift(text.substring(e.offset + e.length, last)); rows.unshift(`<img src="${b}" class="msg-emoji" />`); last = e.offset; }
    }
    rows.unshift(text.substring(0, last));
    const combined = rows.join('');
    const highlightRegex = /(https?:\/\/[^\s]+|www\.[^\s]+|@\w+|\/\w+(?:@\w+)?)/g;
    const seg = new Intl.Segmenter();
    const emojiRegex = /(\p{Emoji_Presentation}|\p{Emoji}\uFE0F|\p{Emoji_Modifier_Base})/u;

    return combined.split(/(<img[^>]+>)/).map(part => {
        if (part.startsWith('<img')) return part;
        let pRes = '';
        for (const s of seg.segment(part)) {
            const c = s.segment;
            if (emojiRegex.test(c)) pRes += `<img src="${getTwemojiUrl(c)}" class="emoji" />`;
            else pRes += c;
        }
        return pRes.replace(highlightRegex, (p) => `<span style="color: #6ab8ed;">${escapeHtml(p)}</span>`).replace(/\n/g, '<br/>');
    }).join('');
}

async function createDummyAvatarBuffer(f, l, color, scale) {
    const s = 140 * scale;
    const canvas = createCanvas(s, s); const ctx = canvas.getContext('2d');
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#FFF'; ctx.font = `bold ${50 * scale}px ${FONT_STACK}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(((f?.[0] || '') + (l?.[0] || '')).toUpperCase().substring(0, 2) || '?', s / 2, s / 2);
    return canvas.toBuffer('image/png');
}

async function createImage(firstName, lastName, customemojiid, message, nameColorId, inputImageBuffer, replySender, replyMessage, replysendercolor, messageEntities = []) {
    let msgList = Array.isArray(firstName) ? firstName : [{ firstName, lastName, customemojiid, message, nameColorId, inputImageBuffer, replySender, replyMessage, replysendercolor, messageEntities, id: '1' }];
    const scale = 5;
    let processed = await Promise.all(msgList.map(async (data) => {
        const username = `${data.firstName || ''} ${data.lastName || ''}`.trim() || 'User';
        const color = getTelegramDarkThemeColor(data.nameColorId);
        const nameHtml = generateNameHtml(username, color, 32 * scale);
        let avatar = data.inputImageBuffer ? await sharp(data.inputImageBuffer).png().toBuffer() : await createDummyAvatarBuffer(data.firstName, data.lastName, color, scale);
        let mB64 = null;
        if (data.mediaBuffer) { const b = await sharp(data.mediaBuffer).resize(512, 512, { fit: 'inside' }).png().toBuffer(); mB64 = `data:image/png;base64,${b.toString('base64')}`; }
        const isS = !!data.mediaBuffer && (!data.message || data.message.trim() === '');
        const rColor = getTelegramDarkThemeColor(data.replysendercolor || 0);
        const rName = data.replySender ? generateNameHtml(data.replySender, rColor, 26 * scale) : '';
        const eStat = data.customemojiid ? await getCustomEmojiBase64(data.customemojiid) : null;
        const msgH = await processMessageHtml(data.message || '', data.entities || []);
        return { avatar: `data:image/png;base64,${avatar.toString('base64')}`, nameHtml, messageHtml: msgH, mediaBase64: mB64, isSticker: isS, rNameHtml: rName, rMsg: data.replyMessage, rColor, nameColor: color, userId: data.id || username, eStatus: eStat };
    }));

    const processedMessages = processed.map((m, i) => { const next = processed[i + 1], prev = processed[i - 1]; return { ...m, showName: !(prev && prev.userId === m.userId), showAvatar: !(next && next.userId === m.userId) }; });

    const html = `<html><head><style>
        body { margin: 0; padding: 0; font-family: ${FONT_STACK}; background: transparent; -webkit-font-smoothing: antialiased; }
        #capture { display: inline-flex; flex-direction: column; gap: ${12 * scale}px; padding: ${12 * scale}px; width: fit-content; }
        .group { display: flex; align-items: flex-end; }
        .avatar-area { width: ${85 * scale}px; margin-right: ${10 * scale}px; display: flex; flex-direction: column; align-items: center; flex-shrink: 0; }
        .avatar { width: ${85 * scale}px; height: ${85 * scale}px; border-radius: 50%; display: block; }
        .bubble { background: #2a2233; border-radius: ${25 * scale}px; padding: ${20 * scale}px ${30 * scale}px; position: relative; max-width: ${700 * scale}px; box-shadow: 0 4px 15px rgba(0,0,0,0.3); display: flex; flex-direction: column; }
        .bubble-tail { border-radius: ${25 * scale}px ${25 * scale}px ${25 * scale}px 0; }
        .bubble-tail::after { content: ''; position: absolute; bottom: 0; left: -${22 * scale}px; width: ${22 * scale}px; height: ${22 * scale}px; background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3Cpath fill='%232a2233' d='M22 0 V22 H0 C11 22 22 11 22 0 Z'/%3E%3C/svg%3E"); background-size: contain; }
        .name-line { display: flex; align-items: center; margin-bottom: ${10 * scale}px; font-size: ${32 * scale}px; font-weight: bold; line-height: 1.1; }
        .e-status { height: 1.15em; width: 1.15em; margin-left: 8px; border-radius: 4px; }
        .msg { color: #fff; font-size: ${36 * scale}px; line-height: 1.5; word-break: break-word; font-weight: 500; }
        .emoji { height: 1.1em !important; width: 1.1em !important; vertical-align: middle; margin: 0 2px; border: 0 !important; }
        .msg-emoji { height: 1.15em; width: 1.15em; vertical-align: middle; margin: 0 2px; }
        .sticker { max-width: ${400 * scale}px; max-height: ${400 * scale}px; border-radius: 12px; }
        .reply { background: rgba(255,255,255,0.08); border-radius: 12px; padding: 12px 16px; border-left: 6px solid; margin-bottom: 12px; }
        .r-name { font-weight: bold; margin-bottom: 4px; font-size: ${26 * scale}px; line-height: 1; }
        .r-msg { color: #b0b0b0; font-size: ${24 * scale}px; white-space: nowrap; overflow: hidden; -webkit-mask-image: linear-gradient(to right, black 90%, transparent 100%); }
        .hidden-avatar { opacity: 0; }
        .s-avatar-area { width: ${42 * scale}px !important; margin-right: 8px !important; }
        .s-avatar { width: ${42 * scale}px !important; height: ${42 * scale}px !important; }
        .s-bubble { background: transparent !important; box-shadow: none !important; padding: 0 !important; }
    </style></head><body><div id="capture">
            ${processedMessages.map(m => `
                <div class="group">
                    <div class="avatar-area ${m.isSticker ? 's-avatar-area' : ''}"><img src="${m.avatar}" class="avatar ${m.isSticker ? 's-avatar' : ''} ${!m.showAvatar ? 'hidden-avatar' : ''}" /></div>
                    <div class="bubble ${(m.showAvatar && !m.isSticker) ? 'bubble-tail' : ''} ${m.isSticker ? 's-bubble' : ''}">
                        ${m.showName && !m.isSticker ? `<div class="name-line" style="color: ${m.nameColor}">${m.nameHtml} ${m.eStatus ? `<img src="${m.eStatus}" class="e-status" />` : ''}</div>` : ''}
                        ${m.rNameHtml && !m.isSticker ? `<div class="reply" style="border-left-color: ${m.rColor}"><div class="r-name" style="color: ${m.rColor}">${m.rNameHtml}</div><div class="r-msg">${escapeHtml(m.rMsg)}</div></div>` : ''}
                        ${m.mediaBase64 ? `<img src="${m.mediaBase64}" class="sticker" />` : ''}
                        ${m.messageHtml ? `<div class="msg">${m.messageHtml}</div>` : ''}
                    </div>
                </div>
            `).join('')}
        </div></body></html>`;

    const browser = await getBrowser(); const page = await browser.newPage();
    await page.setViewport({ width: 5000, height: 5000 });
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const screenshot = await (await page.$('#capture')).screenshot({ omitBackground: true });
    await page.close();
    return await sharp(screenshot).trim({ threshold: 5 }).resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true }).webp({ quality: 100 }).toBuffer();
}

module.exports = createImage;