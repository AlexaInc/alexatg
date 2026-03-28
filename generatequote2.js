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
    let cp = toCodePoint(emoji);
    if (cp.indexOf('200d') === -1) { cp = cp.replace(/-fe0f/g, ''); }
    return `https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.0.3/assets/svg/${cp}.svg`;
}

function generateNameHtml(text, color, fontSize) {
    if (!text) return '';
    const seg = new Intl.Segmenter();
    let res = '';
    const emojiRegex = /(\p{Emoji_Presentation}|\p{Emoji}\uFE0F|\p{Emoji_Modifier_Base})/u;
    for (const s of seg.segment(text)) {
        const c = s.segment;
        if (emojiRegex.test(c)) {
            res += `<img src="${getTwemojiUrl(c)}" class="emoji" onerror="this.style.display='none'; this.nextSibling.style.display='inline';" /><span style="display:none;">${escapeHtml(c)}</span>`;
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

// FIXED: Order of operations to prevent regex from breaking internal emoji URLs
async function processMessageHtml(text, entities = []) {
    if (!text) return '';
    const sorted = (entities || []).filter(e => e.type === 'custom_emoji').sort((a, b) => b.offset - a.offset);
    let rows = []; let lastOffset = text.length;
    for (const e of sorted) {
        const b = await getCustomEmojiBase64(e.custom_emoji_id);
        if (b) { rows.unshift(text.substring(e.offset + e.length, lastOffset)); rows.unshift(`<img src="${b}" class="msg-emoji" />`); lastOffset = e.offset; }
    }
    rows.unshift(text.substring(0, lastOffset));
    const combined = rows.join('');

    const highlightRegex = /(https?:\/\/[^\s]+|www\.[^\s]+|@\w+|\/\w+(?:@\w+)?)/g;
    const emojiRegex = /(\p{Emoji_Presentation}|\p{Emoji}\uFE0F|\p{Emoji_Modifier_Base})/u;
    const seg = new Intl.Segmenter();

    return combined.split(/(<img[^>]+>)/).map(part => {
        if (part.startsWith('<img')) return part;
        // 1. Highlight standard text patterns first (Links/Mentions)
        const highlighted = part.replace(highlightRegex, (p) => `<span style="color: #6ab8ed;">${escapeHtml(p)}</span>`);

        // 2. Process segment by segment to replace Emojis ONLY in parts that aren't already highlighted
        let finalHtml = '';
        highlighted.split(/(<span[^>]+>|<\/span>)/).map(subPart => {
            if (subPart.startsWith('<span') || subPart === '</span>') {
                finalHtml += subPart;
            } else {
                // Not in a highlight tag, replace emojis and newlines
                for (const s of seg.segment(subPart)) {
                    const c = s.segment;
                    if (emojiRegex.test(c)) finalHtml += `<img src="${getTwemojiUrl(c)}" class="emoji" />`;
                    else finalHtml += escapeHtml(c).replace(/\n/g, '<br/>');
                }
            }
        });
        return finalHtml;
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
    let processedRaw = await Promise.all(msgList.map(async (data) => {
        const username = `${data.firstName || ''} ${data.lastName || ''}`.trim() || 'User';
        const color = getTelegramDarkThemeColor(data.nameColorId);
        const nameHtml = generateNameHtml(username, color, 30 * scale);
        let avatar = data.inputImageBuffer ? await sharp(data.inputImageBuffer).png().toBuffer() : await createDummyAvatarBuffer(data.firstName, data.lastName, color, scale);
        let mB64 = null;
        if (data.mediaBuffer) { const b = await sharp(data.mediaBuffer).resize(512, 512, { fit: 'inside' }).png().toBuffer(); mB64 = `data:image/png;base64,${b.toString('base64')}`; }
        const isS = !!data.mediaBuffer && (!data.message || data.message.trim() === '');
        const rColor = getTelegramDarkThemeColor(data.replysendercolor || 0);
        const rName = data.replySender ? generateNameHtml(data.replySender, rColor, 24 * scale) : '';
        const eStat = data.customemojiid ? await getCustomEmojiBase64(data.customemojiid) : null;
        const msgH = await processMessageHtml(data.message || '', data.entities || []);
        return { avatar: `data:image/png;base64,${avatar.toString('base64')}`, nameHtml, messageHtml: msgH, mediaBase64: mB64, isSticker: isS, rNameHtml: rName, rMsg: data.replyMessage, rColor, nameColor: color, userId: data.id || username, eStatus: eStat };
    }));

    const processedMessages = processedRaw.map((m, i) => { const next = processedRaw[i + 1], prev = processedRaw[i - 1]; return { ...m, showName: !(prev && prev.userId === m.userId), showAvatar: !(next && next.userId === m.userId) }; });

    const html = `<html><head><style>
        body { margin: 0; padding: 0; font-family: ${FONT_STACK}; background: transparent; -webkit-font-smoothing: antialiased; }
        #capture { display: inline-flex; flex-direction: column; gap: ${6 * scale}px; padding: ${10 * scale}px; width: fit-content; }
        .group { display: flex; align-items: flex-end; position: relative; }
        .avatar-area { width: ${70 * scale}px; margin-right: ${8 * scale}px; display: flex; flex-direction: column; align-items: center; flex-shrink: 0; margin-bottom: -${2 * scale}px; }
        .avatar { width: ${70 * scale}px; height: ${70 * scale}px; border-radius: 50%; display: block; }
        .hidden-avatar { opacity: 0; } 
        .bubble { background: #1b242d; border-radius: ${15 * scale}px; padding: ${12 * scale}px ${18 * scale}px; position: relative; max-width: ${750 * scale}px; width: fit-content; display: flex; flex-direction: column; box-shadow: 0 1px 3px rgba(0,0,0,0.5); }
        .bubble-tail { border-radius: ${15 * scale}px ${15 * scale}px ${15 * scale}px 0 !important; }
        .bubble-tail::after { 
            content: ''; position: absolute; bottom: 0; left: -${14 * scale}px; width: ${18 * scale}px; height: ${18 * scale}px; 
            background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3Cpath fill='%231b242d' d='M18 0 V18 H0 C9 18 18 9 18 0 Z'/%3E%3C/svg%3E"); 
            background-size: contain; 
        }
        .name-line { display: flex; align-items: center; margin-bottom: ${6 * scale}px; font-size: ${28 * scale}px; font-weight: bold; line-height: 1.1; }
        .e-status { height: 1.1em; width: 1.1em; margin-left: 8px; }
        .msg { color: #ffffff; font-size: ${32 * scale}px; line-height: 1.4; word-break: break-word; font-weight: 500; }
        .emoji { height: 1.1em; width: 1.1em; vertical-align: middle; margin: 0 2px; }
        .msg-emoji { height: 1.25em; width: 1.25em; vertical-align: middle; margin: 0 2px; }
        .reply { background: rgba(255,255,255,0.06); border-radius: ${8 * scale}px; padding: ${8 * scale}px ${12 * scale}px; border-left: ${4 * scale}px solid; margin-bottom: ${10 * scale}px; width: fit-content; max-width: 100%; box-sizing: border-box; }
        .r-name { font-weight: bold; margin-bottom: 2px; font-size: ${24 * scale}px; line-height: 1.1; }
        .r-msg { color: #8e969d; font-size: ${22 * scale}px; white-space: nowrap; overflow: hidden; -webkit-mask-image: linear-gradient(to right, black 90%, transparent 100%); }
        .sticker { max-width: ${420 * scale}px; max-height: ${420 * scale}px; display: block; }
        .s-avatar-area { width: ${38 * scale}px !important; margin-right: 6px !important; }
        .s-avatar { width: ${38 * scale}px !important; height: ${38 * scale}px !important; }
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