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
    const map = new Map([[0, '#FF516A'], [1, '#FF9442'], [2, '#C66FFF'], [3, '#50D892'], [4, '#64D4F5'], [5, '#5095ED'], [6, '#FF66A6'], [7, '#FF8280'], [8, '#EDD64E'], [9, '#C66FFF']]);
    return map.get(id) || '#64b5f6';
}

function escapeHtml(t) {
    return t ? t.toString().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;") : '';
}

// ─── node-canvas: whole-chunk name rendering (spacing fix) ────────────────────
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
    let res = '';
    let chunk = '';
    const flushChunk = () => {
        if (!chunk) return;
        res += `<img src="${renderChunkImg(chunk, fontSize, color)}" style="height:1em;vertical-align:middle;margin:0;padding:0;display:inline-block;"/>`;
        chunk = '';
    };
    for (const { segment: c } of seg.segment(text)) {
        if (IS_EMOJI.test(c)) {
            flushChunk();
            res += `<img src="${toTwemojiUrl(c)}" class="emoji" onerror="this.style.display='none'"/>`;
        } else {
            chunk += c;
        }
    }
    flushChunk();
    return res;
}

// ─── Twemoji URL helper ───────────────────────────────────────────────────────
function toTwemojiUrl(emoji) {
    const r = []; let c = 0, p = 0;
    for (let i = 0; i < emoji.length; i++) {
        c = emoji.charCodeAt(i);
        if (p) { r.push((0x10000 + ((p - 0xD800) << 10) + (c - 0xDC00)).toString(16)); p = 0; }
        else if (0xD800 <= c && c <= 0xDBFF) p = c;
        else r.push(c.toString(16));
    }
    let cp = r.join('-');
    if (!cp.includes('200d')) cp = cp.replace(/-fe0f/g, '');
    return `https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.0.3/assets/svg/${cp}.svg`;
}

const IS_EMOJI = /(\p{Emoji_Presentation}|\p{Emoji}\uFE0F|\p{Emoji_Modifier_Base})/u;

// ─── Premium / Custom Emoji cache ────────────────────────────────────────────
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

// ─── Message HTML (entities + twemoji + link highlight) ───────────────────────
async function msgToHtml(text, entities = []) {
    if (!text) return '';
    const cEntities = (entities || []).filter(e => e.type === 'custom_emoji').sort((a, b) => b.offset - a.offset);
    let parts = []; let tail = text.length;
    for (const e of cEntities) {
        const b64 = await getPremiumEmojiB64(e.custom_emoji_id);
        if (b64) {
            parts.unshift(text.substring(e.offset + e.length, tail));
            parts.unshift(`<img src="${b64}" class="msg-emoji"/>`);
            tail = e.offset;
        }
    }
    parts.unshift(text.substring(0, tail));
    const seg = new Intl.Segmenter();
    // Negative lookbehind prevents matching /path inside t.me/path URLs
    const LINK_RE = /(https?:\/\/[^\s]+|www\.[^\s]+|@\w+|(?<![\w.])\/\w+(?:@\w+)?)/g;
    return parts.map(part => {
        if (part.startsWith('<img')) return part;
        const highlighted = part.replace(LINK_RE, p => `<span class="link">${escapeHtml(p)}</span>`);
        return highlighted.split(/(<span[^>]*>[^<]*<\/span>)/).map(sub => {
            if (sub.startsWith('<span')) return sub;
            let out = '';
            for (const { segment: c } of seg.segment(sub)) {
                if (IS_EMOJI.test(c)) out += `<img src="${toTwemojiUrl(c)}" class="emoji"/>`;
                else out += escapeHtml(c);
            }
            return out.replace(/\n/g, '<br/>');
        }).join('');
    }).join('');
}

// ─── Dummy avatar via canvas ──────────────────────────────────────────────────
async function dummyAvatar(f, l, color) {
    const S = 200;
    const cv = createCanvas(S, S); const ctx = cv.getContext('2d');
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = `bold ${S * 0.38}px ${CANVAS_FONT}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(((f?.[0] || '') + (l?.[0] || '')).toUpperCase().substring(0, 2) || '?', S / 2, S / 2);
    return cv.toBuffer('image/png');
}

// ─── Main export ──────────────────────────────────────────────────────────────
async function createImage(firstName, lastName, customemojiid, message, nameColorId, inputImageBuffer, replySender, replyMessage, replysendercolor, messageEntities = []) {
    let msgList = Array.isArray(firstName)
        ? firstName
        : [{ firstName, lastName, customemojiid, message, nameColorId, inputImageBuffer, replySender, replyMessage, replysendercolor, entities: messageEntities, id: '1' }];

    // Resolving data
    const SCALE = 5;
    const PP_SIZE = 42 * SCALE;
    const NAME_FS = 18 * SCALE;
    const MSG_FS = 17 * SCALE;

    const rows = await Promise.all(msgList.map(async (d, idx) => {
        const name = `${d.firstName || ''} ${d.lastName || ''}`.trim() || 'User';
        const color = getTelegramColor(d.nameColorId);
        const nameHtml = nameToHtml(name, color, NAME_FS);

        const rawAvatar = d.inputImageBuffer
            ? await sharp(d.inputImageBuffer).png().toBuffer()
            : await dummyAvatar(d.firstName, d.lastName, color);
        const avatarB64 = `data:image/png;base64,${rawAvatar.toString('base64')}`;

        let mediaB64 = null;
        if (d.mediaBuffer) {
            try {
                const mb = await sharp(d.mediaBuffer)
                    .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
                    .png()
                    .toBuffer();
                mediaB64 = `data:image/png;base64,${mb.toString('base64')}`;
            } catch (err) {
                console.error("Sharp media processing failed:", err.message);
            }
        }
        const isSticker = !!mediaB64 && (!d.message || !d.message.trim());

        const rColor = getTelegramColor(d.replysendercolor || 0);
        const rName = d.replySender ? nameToHtml(d.replySender, rColor, NAME_FS * 0.85) : '';

        const fName = d.forwardName ? nameToHtml(d.forwardName, '#64b5f6', NAME_FS * 0.75) : '';

        const statusB64 = d.customemojiid ? await getPremiumEmojiB64(d.customemojiid) : null;
        const msgHtml = await msgToHtml(d.message || '', d.entities || []);

        return { name, color, nameHtml, avatarB64, mediaB64, isSticker, rColor, rName, rMsg: d.replyMessage, statusB64, msgHtml, userId: d.id || name, fName };
    }));

    const items = rows.map((m, i) => {
        const prev = rows[i - 1], next = rows[i + 1];
        const samePrev = prev && prev.userId === m.userId && !m.fName;
        const sameNext = next && next.userId === m.userId && !next.fName;

        let groupClass = 'last-in-group';
        if (samePrev && sameNext) groupClass = 'middle-in-group last-in-group group-member';
        else if (samePrev) groupClass = 'last-in-group group-member';
        else if (sameNext) groupClass = 'first-in-group';

        const breakClass = (!samePrev && i > 0) ? 'sender-break' : '';
        const showName = !samePrev && !m.isSticker;
        const showAvatar = !sameNext;
        return { ...m, groupClass, breakClass, showName, showAvatar };
    });

    const MSG_IN = '#111112';
    const css = `
:root { --r: ${18 * SCALE}px; --rs: ${5 * SCALE}px; }
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Inter','Noto Sans','Noto Sans SC','Noto Sans Symbols',sans-serif; background: transparent; color: #fff; -webkit-font-smoothing: antialiased; }
#wrap { display: inline-flex; flex-direction: column; gap: 0; padding: ${8 * SCALE}px; }
.bubble-container { display: flex; align-items: flex-end; position: relative; max-width: ${280 * SCALE}px; }
.bubble-container.sender-break { margin-top: ${10 * SCALE}px; }
.bubble-pp { width: ${PP_SIZE}px; height: ${PP_SIZE}px; border-radius: 50%; flex-shrink: 0; margin-right: ${6 * SCALE}px; background-size: cover; background-position: center; }
.bubble-pp.hidden { opacity: 0; }
.bubble { position: relative; padding: ${10 * SCALE}px ${14 * SCALE}px; border-radius: var(--r); background: ${MSG_IN}; color: #fff; font-size: ${MSG_FS}px; line-height: 1.45; overflow-wrap: break-word; word-break: normal; box-shadow: 0 1px ${3 * SCALE}px rgba(0,0,0,.25); max-width: 100%; }
.bubble-container.in.last-in-group .bubble { border-top-left-radius: var(--r); border-bottom-left-radius: 0; }
.bubble-container.in.first-in-group .bubble { border-top-left-radius: var(--r); border-bottom-left-radius: var(--rs); }
.bubble-container.in.middle-in-group .bubble { border-top-left-radius: var(--rs); border-bottom-left-radius: var(--rs); }
.bubble-container.in.last-in-group.group-member .bubble { border-top-left-radius: var(--rs); border-bottom-left-radius: 0; }
.bubble::before { content: ""; display: none; position: absolute; }
.bubble-container.in.last-in-group .bubble::before { display: block; bottom: 0; left: -${8 * SCALE}px; width: 0; height: 0; border-style: solid; border-width: 0 0 ${10 * SCALE}px ${8 * SCALE}px; border-color: transparent transparent ${MSG_IN} transparent; }
.bubble-container.is-sticker .bubble { background: transparent !important; box-shadow: none !important; padding: 0 !important; }
.sticker-img { max-width: ${250 * SCALE}px; max-height: ${250 * SCALE}px; display: block; }
.bubble-name { font-size: ${NAME_FS}px; font-weight: 600; margin-bottom: ${3 * SCALE}px; display: flex; align-items: center; gap: ${4 * SCALE}px; }
.f-line { font-size: ${MSG_FS * 0.8}px; color: #64b5f6; margin-bottom: ${4 * SCALE}px; font-weight: 500; }
.premium-emoji { width: ${18 * SCALE}px; height: ${18 * SCALE}px; border-radius: ${3 * SCALE}px; object-fit: cover; }
.reply-block { background: rgba(255,255,255,.07); border-radius: ${6 * SCALE}px; padding: ${6 * SCALE}px ${10 * SCALE}px; border-left: ${4 * SCALE}px solid; margin-bottom: ${8 * SCALE}px; }
.reply-name { font-size: ${MSG_FS * 0.75}px; font-weight: 600; margin-bottom: 2px; }
.reply-text { font-size: ${MSG_FS * 0.7}px; color: #7f91a4; white-space: nowrap; overflow: hidden; -webkit-mask-image: linear-gradient(to right, black 88%, transparent 100%); }
.emoji { height: 1.15em; width: 1.15em; vertical-align: middle; margin: 0 1px; }
.msg-emoji { height: 1.25em; width: 1.25em; vertical-align: middle; margin: 0 2px; }
.link { color: #64b5f6; }
`;

    const htmlBody = items.map(m => {
        let bInner = '';
        if (m.isSticker) bInner = `<img src="${m.mediaB64}" class="sticker-img" />`;
        else {
            if (m.fName) bInner += `<div class="f-line">Forwarded from ${m.fName}</div>`;
            if (m.showName) bInner += `<div class="bubble-name" style="color:${m.color}">${m.nameHtml}${m.statusB64 ? `<img src="${m.statusB64}" class="premium-emoji"/>` : ''}</div>`;
            if (m.rName) bInner += `<div class="reply-block" style="border-left-color:${m.rColor}"><div class="reply-name" style="color:${m.rColor}">${m.rName}</div><div class="reply-text">${escapeHtml(m.rMsg)}</div></div>`;
            if (m.mediaB64) bInner += `<img src="${m.mediaB64}" class="sticker-img" style="margin-bottom:${4 * SCALE}px;" />`;
            if (m.msgHtml) bInner += `<div class="bubble-content">${m.msgHtml}</div>`;
        }
        return `
<div class="bubble-container in ${m.groupClass} ${m.isSticker ? 'is-sticker' : ''} ${m.breakClass}">
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
    return await sharp(ss).trim({ threshold: 5 }).resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true }).webp({ quality: 100, lossless: true }).toBuffer();
}

module.exports = createImage;