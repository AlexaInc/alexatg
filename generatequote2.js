require('dotenv').config();
const proxyHelper = require('./utils/proxyHelper');
proxyHelper.configureAxios();
proxyHelper.configureGlobal();

const puppeteer = require('puppeteer');
const { createCanvas, registerFont } = require('canvas');
const fs = require('fs');
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

const CANVAS_FONT = "'Noto Sans', 'Noto Sans SC', 'Noto Sans Symbols', sans-serif";
const BOT_TOKEN = '7961409784:AAH34SqtPohk5YydJVH9Fw9BfsxnSsAPIf8';

// ─── Colour helpers ───────────────────────────────────────────────────────────
function getTelegramColor(id) {
    const cid = (parseInt(id) || 0) % 8;
    const map = ['#fb6169', '#ff9f4f', '#c07df0', '#53ed9d', '#56d3f2', '#50a7ea', '#f479a0', '#64b5f6'];
    return map[cid] || '#50a7ea';
}

function escapeHtml(t) {
    return t ? t.toString().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;") : '';
}

function renderChunkImg(text, fontSize, color) {
    const tmp = createCanvas(1, 1); const tc = tmp.getContext('2d');
    tc.font = `600 ${fontSize}px ${CANVAS_FONT}`;
    const w = Math.max(1, tc.measureText(text).width);
    const h = Math.max(1, fontSize * 1.4);
    const cv = createCanvas(w, h); const ctx = cv.getContext('2d');
    ctx.font = `600 ${fontSize}px ${CANVAS_FONT}`;
    ctx.fillStyle = color; ctx.textBaseline = 'middle';
    ctx.fillText(text, 0, h / 2);
    return `data:image/png;base64,${cv.toBuffer('image/png').toString('base64')}`;
}

function nameToHtml(text, color, fontSize) {
    if (!text) return '';
    const seg = new Intl.Segmenter();
    let res = ''; let chunk = '';
    const flushChunk = () => { if (!chunk) return; res += `<img src="${renderChunkImg(chunk, fontSize, color)}" style="height:1em;vertical-align:middle;margin:0;padding:0;display:inline-block;"/>`; chunk = ''; };
    for (const { segment: c } of seg.segment(text)) {
        if (IS_EMOJI.test(c)) { flushChunk(); res += `<img src="${toAppleEmojiUrl(c)}" class="emoji" onerror="this.style.display='none'"/>`; }
        else { chunk += c; }
    }
    flushChunk(); return res;
}

function toAppleEmojiUrl(emoji) {
    const r = []; let c = 0, p = 0;
    for (let i = 0; i < emoji.length; i++) {
        c = emoji.charCodeAt(i);
        if (p) { r.push((0x10000 + ((p - 0xD800) << 10) + (c - 0xDC00)).toString(16)); p = 0; }
        else if (0xD800 <= c && c <= 0xDBFF) p = c;
        else r.push(c.toString(16));
    }
    let cp = r.join('-');
    // Standardize codepoint format for apple-datasource
    if (!cp.includes('200d')) cp = cp.replace(/-fe0f/g, '');
    return `https://cdn.jsdelivr.net/npm/emoji-datasource-apple/img/apple/64/${cp}.png`;
}
const IS_EMOJI = /(\p{Emoji_Presentation}|\p{Emoji}\uFE0F|\p{Emoji_Modifier_Base})/u;

const ECACHE = new Map();
async function getPremiumEmojiB64(id) {
    if (ECACHE.has(id)) return ECACHE.get(id);
    try {
        const { data: d1 } = await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/getCustomEmojiStickers`, { custom_emoji_ids: [id] });
        const st = d1.result?.[0]; if (!st) return null;
        const { data: d2 } = await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/getFile`, { file_id: st.thumbnail?.file_id || st.file_id });
        const { data: raw } = await axios.get(`https://api.telegram.org/file/bot${BOT_TOKEN}/${d2.result.file_path}`, { responseType: 'arraybuffer' });
        const b64 = `data:image/png;base64,${(await sharp(raw).resize(128, 128).png().toBuffer()).toString('base64')}`;
        ECACHE.set(id, b64); return b64;
    } catch { return null; }
}

async function msgToHtml(text, entities = []) {
    if (!text) return '';
    const sorted = (entities || []).sort((a, b) => a.offset - b.offset || b.length - a.length);
    let tags = [];
    for (const e of sorted) {
        tags.push({ pos: e.offset, type: 'open', info: e });
        tags.push({ pos: e.offset + e.length, type: 'close', info: e });
    }
    tags.sort((a, b) => a.pos - b.pos || (a.type === 'close' ? -1 : 1));

    let html = '', cursor = 0;
    const seg = new Intl.Segmenter();

    const applyText = (str) => {
        let out = '';
        if (!str) return '';
        for (const { segment: c } of seg.segment(str)) {
            if (IS_EMOJI.test(c)) out += `<img src="${toAppleEmojiUrl(c)}" class="emoji"/>`;
            else out += escapeHtml(c);
        }
        return out.replace(/\n/g, '<br/>');
    };

    for (let i = 0; i < tags.length; i++) {
        const t = tags[i];
        if (t.pos > cursor) {
            html += applyText(text.substring(cursor, t.pos));
            cursor = t.pos;
        }

        if (t.type === 'open') {
            const e = t.info;
            // Aggressive Smart Break: Force links/mentions to start fresh even if there is a space
            if (e.type === 'url' || e.type === 'text_url' || e.type === 'mention' || e.type === 'bot_command' || e.type === 'custom_emoji') {
                if (html.length > 0 && !html.endsWith('<br/>')) {
                    html += '<br/>';
                }
            }

            if (e.type === 'bold') html += '<b>';
            else if (e.type === 'italic') html += '<i>';
            else if (e.type === 'underline') html += '<u>';
            else if (e.type === 'strikethrough') html += '<s>';
            else if (e.type === 'code') html += '<code>';
            else if (e.type === 'url' || e.type === 'text_url' || e.type === 'mention' || e.type === 'bot_command') html += '<span class="link">';
            else if (e.type === 'custom_emoji') {
                const b64 = await getPremiumEmojiB64(e.custom_emoji_id);
                if (b64) html += `<img src="${b64}" class="msg-emoji"/>`;
                cursor = e.offset + e.length;
                while (i + 1 < tags.length && tags[i + 1].info === e) { i++; }
            }
        } else {
            const e = t.info;
            if (e.type === 'bold') html += '</b>';
            else if (e.type === 'italic') html += '</i>';
            else if (e.type === 'underline') html += '</u>';
            else if (e.type === 'strikethrough') html += '</s>';
            else if (e.type === 'code') html += '</code>';
            else if (e.type === 'url' || e.type === 'text_url' || e.type === 'mention' || e.type === 'bot_command') html += '</span>';
        }
    }
    html += applyText(text.substring(cursor));
    return html;
}

async function dummyAvatar(f, l, color) {
    const S = 200;
    const cv = createCanvas(S, S); const ctx = cv.getContext('2d');
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = `bold ${S * 0.38}px ${CANVAS_FONT}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(((f?.[0] || '') + (l?.[0] || '')).toUpperCase().substring(0, 2) || '?', S / 2, S / 2);
    return cv.toBuffer('image/png');
}

async function createImage(firstName, lastName, customemojiid, message, nameColorId, inputImageBuffer, replySender, replyMessage, replysendercolor, messageEntities = []) {
    let msgList = Array.isArray(firstName) ? firstName : [{ firstName, lastName, customemojiid, message, nameColorId, inputImageBuffer, replySender, replyMessage, replysendercolor, entities: messageEntities, id: '1', isAbsoluteLast: true }];

    // --- ULTRA HD OPTIMIZED SCALE ---
    const SCALE = 4.5;
    const PP_SIZE = 38 * SCALE;
    const NAME_FS = 16 * SCALE;
    const MSG_FS = 15.5 * SCALE;

    const rows = await Promise.all(msgList.map(async (d, idx) => {
        const name = `${d.firstName || ''} ${d.lastName || ''}`.trim() || 'User';
        const color = getTelegramColor(d.nameColorId);
        const nameHtml = nameToHtml(name, color, NAME_FS);
        const rawAvatar = d.inputImageBuffer ? await sharp(d.inputImageBuffer).png().toBuffer() : await dummyAvatar(d.firstName, d.lastName, color);
        const avatarB64 = `data:image/png;base64,${rawAvatar.toString('base64')}`;

        let mediaB64 = null;
        if (d.mediaBuffer) {
            try {
                const mb = await sharp(d.mediaBuffer)
                    .resize(1000, 1000, { fit: 'inside', kernel: 'lanczos3' })
                    .png()
                    .toBuffer();
                mediaB64 = `data:image/png;base64,${mb.toString('base64')}`;
            } catch (err) {
                // Return null if all else fails
                mediaB64 = null;
            }
        }
        const isSticker = !!d.mediaBuffer && (!d.message || !d.message.trim());
        const rColor = getTelegramColor(d.replysendercolor || 0);
        const rName = d.replySender ? nameToHtml(d.replySender, rColor, NAME_FS * 0.85) : '';
        const fName = d.forwardName ? nameToHtml(d.forwardName, '#64b5f6', NAME_FS * 0.75) : '';
        const statusB64 = d.customemojiid ? await getPremiumEmojiB64(d.customemojiid) : null;
        const msgHtml = await msgToHtml(d.message || '', d.entities || []);

        return { name, color, nameHtml, avatarB64, mediaB64, isSticker, rColor, rName, rMsg: d.replyMessage, statusB64, msgHtml, userId: d.id || name, fName, isAbsoluteLast: d.isAbsoluteLast };
    }));

    const items = rows.map((m, i) => {
        const prev = rows[i - 1], next = rows[i + 1];
        const samePrev = prev && prev.userId === m.userId && !m.fName;
        const sameNext = next && next.userId === m.userId && !next.fName;
        let groupClass = '';
        if (samePrev && sameNext) groupClass = 'middle-in-group';
        else if (samePrev) groupClass = 'last-in-group';
        else if (sameNext) groupClass = 'first-in-group';
        else groupClass = 'single-message';
        const breakClass = (!samePrev && i > 0) ? 'sender-break' : '';
        const showName = !samePrev && !m.isSticker;
        const showAvatar = !sameNext;
        return { ...m, groupClass, breakClass, showName, showAvatar };
    });

    const MSG_IN = '#111112';
    const css = `
:root { --r: ${18 * SCALE}px; --rs: ${5 * SCALE}px; }
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Inter','Noto Sans','Noto Sans SC','Noto Sans Symbols',sans-serif; background: transparent; -webkit-font-smoothing: antialiased; }
#wrap { display: inline-flex; flex-direction: column; gap: 0; padding: ${12 * SCALE}px; }
.bubble-container { display: flex; align-items: flex-end; position: relative; max-width: ${220 * SCALE}px; }
.bubble-container.sender-break { margin-top: ${10 * SCALE}px; }
.bubble-pp { width: ${PP_SIZE}px; height: ${PP_SIZE}px; border-radius: 50%; flex-shrink: 0; margin-right: ${10 * SCALE}px; background-size: cover; background-position: center; border: ${1 * SCALE}px solid rgba(255,255,255,0.05); }
.bubble-pp.hidden { opacity: 0; pointer-events: none; }
.bubble { position: relative; padding: ${10 * SCALE}px ${14 * SCALE}px; border-radius: var(--r); background: ${MSG_IN}; color: #fff; font-size: ${MSG_FS}px; line-height: 1.45; overflow-wrap: break-word; }
.bubble-container.in.last-in-group .bubble, .bubble-container.in.single-message .bubble { border-bottom-left-radius: 0; }
.bubble-container.in.first-in-group .bubble { border-bottom-left-radius: var(--rs); }
.bubble-container.in.middle-in-group .bubble { border-top-left-radius: var(--rs); border-bottom-left-radius: var(--rs); }
.bubble-container.in.last-in-group .bubble { border-top-left-radius: var(--rs); }
.bubble::before { content: ""; display: none; position: absolute; }
.bubble-container { max-width: 100%; display: flex; align-items: flex-end; position: relative; margin-bottom: ${6 * SCALE}px; gap: ${6 * SCALE}px; }
.bubble-container.in.last-in-group .bubble::before, .bubble-container.in.single-message .bubble::before { display: block; bottom: 0; left: -${8 * SCALE}px; width: 0; height: 0; border-style: solid; border-width: 0 0 ${10 * SCALE}px ${8 * SCALE}px; border-color: transparent transparent ${MSG_IN} transparent; }
.bubble-container.is-sticker { max-content: ${220 * SCALE}px; align-items: flex-end; margin-bottom: ${18 * SCALE}px; gap: 0; }
.bubble-container.is-sticker .bubble { background: transparent !important; box-shadow: none !important; padding: 0 !important; }
.bubble-container.is-sticker .bubble::before { display: none !important; }
.sticker-img { width: ${220 * SCALE}px; display: block; border-radius: ${8 * SCALE}px; }
.bubble-name { font-size: ${NAME_FS}px; font-weight: 600; margin-bottom: ${4 * SCALE}px; display: flex; align-items: center; white-space: nowrap; }
.f-line { font-size: ${MSG_FS * 0.75}px; color: #64b5f6; margin-bottom: ${4 * SCALE}px; opacity: 0.9; }
.premium-emoji { width: ${18 * SCALE}px; height: ${18 * SCALE}px; margin-left: ${2 * SCALE}px; }
.link { color: #64b5f6; display: inline-block; word-break: break-all; }
code { font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace; background: rgba(255,255,255,0.1); padding: 2px 4px; border-radius: 3px; }
.reply-block { background: rgba(255,255,255,0.06); border-radius: ${6 * SCALE}px; padding: ${6 * SCALE}px ${10 * SCALE}px; border-left: ${4 * SCALE}px solid; margin-bottom: ${10 * SCALE}px; max-width: 100%; }
.reply-name { font-size: ${MSG_FS * 0.72}px; font-weight: 600; margin-bottom: 2px; }
.reply-text { font-size: ${MSG_FS * 0.7}px; color: #7f91a4; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.emoji { height: 1.1em; width: 1.1em; vertical-align: middle; }
.msg-emoji { height: 1.2em; width: 1.2em; vertical-align: middle; }
.link { color: #64b5f6; text-decoration: none; }
`;

    const htmlBody = items.map(m => {
        let bInner = '';
        if (m.isSticker) {
            if (m.mediaB64) bInner = `<img src="${m.mediaB64}" class="sticker-img" />`;
            else bInner = `<div style="font-style:italic;color:#7f91a4;font-size:0.7em">[Animated/Video Sticker (failed to load frame)]</div>`;
        } else {
            if (m.fName) bInner += `<div class="f-line">Forwarded from ${m.fName}</div>`;
            if (m.showName) bInner += `<div class="bubble-name" style="color:${m.color}">${m.nameHtml}${m.statusB64 ? `<img src="${m.statusB64}" class="premium-emoji"/>` : ''}</div>`;
            if (m.rName) bInner += `<div class="reply-block" style="border-left-color:${m.rColor}"><div class="reply-name" style="color:${m.rColor}">${m.rName}</div><div class="reply-text">${escapeHtml(m.rMsg)}</div></div>`;
            if (m.mediaB64) bInner += `<img src="${m.mediaB64}" class="sticker-img" style="margin-bottom:${6 * SCALE}px;" />`;
            if (m.msgHtml) bInner += `<div class="bubble-content">${m.msgHtml}</div>`;
        }
        return `
<div class="bubble-container in ${m.groupClass} ${m.isAbsoluteLast ? 'is-absolute-last' : ''} ${m.isSticker ? 'is-sticker' : ''} ${m.breakClass}">
    <div class="bubble-pp ${m.showAvatar ? '' : 'hidden'}" style="background-image:url(${m.avatarB64})"></div>
    <div class="bubble">${bInner}</div>
</div>`;
    }).join('');

    const html = `<html><head><meta charset="UTF-8"><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet"><style>${css}</style></head><body><div id="wrap">${htmlBody}</div></body></html>`;

    const browser = await getBrowser(); const page = await browser.newPage();
    await page.setViewport({ width: 5000, height: 5000 });
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const ss = await (await page.$('#wrap')).screenshot({ omitBackground: true });
    await page.close();

    return await sharp(ss)
        .trim({ threshold: 5 })
        .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 100 })
        .toBuffer();
}

module.exports = createImage;