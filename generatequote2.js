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

// ─── HTML for sender name (whole-chunk canvas + twemoji) ─────────────────────
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
            flushChunk(); // render accumulated text first
            res += `<img src="${toTwemojiUrl(c)}" class="emoji" onerror="this.style.display='none'"/>`;
        } else {
            chunk += c; // accumulate into one chunk
        }
    }
    flushChunk(); // flush any remaining text
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

// ─── Message HTML (custom-emoji entities + twemoji + link highlight) ──────────
async function msgToHtml(text, entities = []) {
    if (!text) return '';

    // 1. Splice custom emoji entities (descending order → no offset shift)
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

    // 2. For each plain-text segment: twemoji + links
    const seg = new Intl.Segmenter();
    // Negative lookbehind prevents matching /path inside t.me/path URLs
    const LINK_RE = /(https?:\/\/[^\s]+|www\.[^\s]+|@\w+|(?<![\w.])\/\w+(?:@\w+)?)/g;
    return parts.map(part => {
        if (part.startsWith('<img')) return part;
        const highlighted = part.replace(LINK_RE, p => `<span class="link">${escapeHtml(p)}</span>`);
        // Split WITHOUT /s flag so . does NOT cross newlines
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
    // Normalise to array
    let msgList = Array.isArray(firstName)
        ? firstName
        : [{ firstName, lastName, customemojiid, message, nameColorId, inputImageBuffer, replySender, replyMessage, replysendercolor, entities: messageEntities, id: '1' }];

    // ── Resolve data for every message ────────────────────────────────────────
    const SCALE = 3;   // render at 3× then trim → sharp sticker
    const PP_SIZE = 42 * SCALE;   // avatar px
    const NAME_FS = 14 * SCALE;   // name font size (canvas)
    const MSG_FS = 15 * SCALE;   // message font size (px in CSS)

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
            const mb = await sharp(d.mediaBuffer).resize(512, 512, { fit: 'inside' }).png().toBuffer();
            mediaB64 = `data:image/png;base64,${mb.toString('base64')}`;
        }
        const isSticker = !!d.mediaBuffer && (!d.message || !d.message.trim());

        const rColor = getTelegramColor(d.replysendercolor || 0);
        const rName = d.replySender ? nameToHtml(d.replySender, rColor, NAME_FS * 0.85) : '';

        const statusB64 = d.customemojiid ? await getPremiumEmojiB64(d.customemojiid) : null;
        const msgHtml = await msgToHtml(d.message || '', d.entities || []);

        return { name, color, nameHtml, avatarB64, mediaB64, isSticker, rColor, rName, rMsg: d.replyMessage, statusB64, msgHtml, userId: d.id || name };
    }));

    // ── Compute grouping classes (mirrors chat.js logic) ─────────────────────
    const items = rows.map((m, i) => {
        const prev = rows[i - 1], next = rows[i + 1];
        const samePrev = prev && prev.userId === m.userId;
        const sameNext = next && next.userId === m.userId;

        let groupClass = 'last-in-group'; // always start as last
        if (samePrev && sameNext) groupClass = 'middle-in-group last-in-group group-member';
        else if (samePrev) groupClass = 'last-in-group group-member';
        else if (sameNext) groupClass = 'first-in-group';

        const breakClass = (!samePrev && i > 0) ? 'sender-break' : '';
        const showName = !samePrev && !m.isSticker;
        const showAvatar = !sameNext;

        return { ...m, groupClass, breakClass, showName, showAvatar };
    });

    // ── Build HTML using exact template CSS ───────────────────────────────────
    const MSG_IN = '#111112';
    const BGC = 'transparent';

    const css = `
:root {
    --bg-color: #0c141d;
    --msg-in: ${MSG_IN};
    --text-color: #ffffff;
    --text-secondary: #7f91a4;
    --user-link: #64b5f6;
    --r: ${18 * SCALE}px;
    --rs: ${5 * SCALE}px;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Inter','Noto Sans','Noto Sans SC','Noto Sans Symbols',sans-serif; background: ${BGC}; color: var(--text-color); -webkit-font-smoothing: antialiased; }
#wrap { display: inline-flex; flex-direction: column; gap: 0; padding: ${8 * SCALE}px; }

.bubble-container { display: flex; align-items: flex-end; position: relative; max-width: ${420 * SCALE}px; }
.bubble-container.sender-break { margin-top: ${10 * SCALE}px; }
.bubble-container.in  { align-self: flex-start; }

/* ── Avatar ── */
.bubble-pp { width: ${PP_SIZE}px; height: ${PP_SIZE}px; border-radius: 50%; flex-shrink: 0; margin-right: ${6 * SCALE}px; background-size: cover; background-position: center; opacity: 1; transition: opacity .15s; }
.bubble-pp.hidden { opacity: 0; }

/* ── Bubble ── */
.bubble { position: relative; padding: ${8 * SCALE}px ${12 * SCALE}px; border-radius: var(--r); background: var(--msg-in); color: #fff; font-size: ${MSG_FS}px; line-height: 1.45; word-break: break-word; box-shadow: 0 1px ${3 * SCALE}px rgba(0,0,0,.25); max-width: 100%; }

/* corner flow */
.bubble-container.in.last-in-group .bubble                                               { border-top-left-radius: var(--r); border-bottom-left-radius: 0; }
.bubble-container.in.first-in-group .bubble                                              { border-top-left-radius: var(--r); border-bottom-left-radius: var(--rs); }
.bubble-container.in.middle-in-group .bubble                                             { border-top-left-radius: var(--rs); border-bottom-left-radius: var(--rs); }
.bubble-container.in.last-in-group.first-in-group .bubble,
.bubble-container.in.last-in-group.middle-in-group .bubble,
.bubble-container.in.last-in-group.group-member .bubble                                  { border-top-left-radius: var(--rs); border-bottom-left-radius: 0; }

/* ── CSS triangle tail ── */
.bubble::before { content: ""; display: none; pointer-events: none; position: absolute; }
.bubble-container.in.last-in-group .bubble::before { display: block; bottom: 0; left: -${8 * SCALE}px; width: 0; height: 0; border-style: solid; border-width: 0 0 ${10 * SCALE}px ${8 * SCALE}px; border-color: transparent transparent ${MSG_IN} transparent; }

/* ── Sticker ── */
.bubble-container.is-sticker .bubble { background: transparent !important; box-shadow: none !important; padding: 0 !important; max-width: ${200 * SCALE}px; }
.bubble-container.is-sticker .bubble::before { display: none !important; }
.bubble-container.is-sticker img.sticker-img { max-width: ${200 * SCALE}px; max-height: ${200 * SCALE}px; display: block; }

/* ── Name ── */
.bubble-name { font-size: ${NAME_FS}px; font-weight: 600; margin-bottom: ${3 * SCALE}px; display: flex; align-items: center; gap: ${4 * SCALE}px; }
.premium-emoji { width: ${18 * SCALE}px; height: ${18 * SCALE}px; border-radius: ${3 * SCALE}px; object-fit: cover; flex-shrink: 0; }

/* ── Reply ── */
.reply-block { background: rgba(255,255,255,.07); border-radius: ${6 * SCALE}px; padding: ${6 * SCALE}px ${10 * SCALE}px; border-left: ${4 * SCALE}px solid; margin-bottom: ${8 * SCALE}px; overflow: hidden; }
.reply-name  { font-size: ${11 * SCALE}px; font-weight: 600; margin-bottom: 2px; }
.reply-text  { font-size: ${10 * SCALE}px; color: var(--text-secondary); white-space: nowrap; overflow: hidden; -webkit-mask-image: linear-gradient(to right, black 88%, transparent 100%); }

/* ── Inline media ── */
.emoji     { height: 1.15em; width: 1.15em; vertical-align: middle; margin: 0 1px; }
.msg-emoji { height: 1.25em; width: 1.25em; vertical-align: middle; margin: 0 2px; }
.link      { color: var(--user-link); }
`;

    const htmlBody = items.map(m => {
        const stickerCls = m.isSticker ? 'is-sticker' : '';
        const ppHidden = m.showAvatar ? '' : 'hidden';
        const ppStyle = `background-image:url(${m.avatarB64})`;

        let bubbleInner = '';

        if (m.isSticker) {
            // Pure sticker: transparent bubble, full image
            bubbleInner = `<img src="${m.mediaB64}" class="sticker-img" />`;
        } else {
            if (m.showName) {
                bubbleInner += `<div class="bubble-name" style="color:${m.color}">${m.nameHtml}${m.statusB64 ? `<img src="${m.statusB64}" class="premium-emoji"/>` : ''}</div>`;
            }
            if (m.rName) {
                bubbleInner += `<div class="reply-block" style="border-left-color:${m.rColor}"><div class="reply-name" style="color:${m.rColor}">${m.rName}</div><div class="reply-text">${escapeHtml(m.rMsg)}</div></div>`;
            }
            // Sticker/media WITH caption (mediaB64 present but message is also present)
            if (m.mediaB64) {
                bubbleInner += `<img src="${m.mediaB64}" class="sticker-img" style="margin-bottom:${4 * SCALE}px;" />`;
            }
            if (m.msgHtml) {
                bubbleInner += `<div class="bubble-content">${m.msgHtml}</div>`;
            }
        }

        return `
<div class="bubble-container in ${m.groupClass} ${stickerCls} ${m.breakClass}">
    <div class="bubble-pp ${ppHidden}" style="${ppStyle}"></div>
    <div class="bubble">${bubbleInner}</div>
</div>`;
    }).join('');

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>${css}</style></head>
<body><div id="wrap">${htmlBody}</div></body></html>`;

    const browser = await getBrowser();
    const page = await browser.newPage();
    await page.setViewport({ width: 5000, height: 5000 });
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const screenshot = await (await page.$('#wrap')).screenshot({ omitBackground: true });
    await page.close();

    return await sharp(screenshot)
        .trim({ threshold: 5 })
        .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 100 })
        .toBuffer();
}

module.exports = createImage;