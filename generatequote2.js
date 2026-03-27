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
Object.entries(fontMap).forEach(([f, n]) => { if (fs.existsSync(f)) { try { registerFont(f, { family: n }); } catch (e) {} } });

const FONT_STACK = "'Noto Sans', 'Noto Sans SC', 'Noto Sans Symbols', 'Arial Unicode MS', sans-serif";
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

function generateNameHtml(text, color, fontSize, entities = []) {
    if (!text) return '';
    const seg = new Intl.Segmenter();
    let res = '';
    for (const s of seg.segment(text)) {
        const c = s.segment;
        if (/\p{Emoji}/u.test(c)) res += `<span class="name-emoji" style="font-size: ${fontSize}px;">${escapeHtml(c)}</span>`;
        else if (c.match(/^\s+$/)) res += `<span style="white-space: pre;">${c}</span>`;
        else {
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
        const buf = await sharp(i.data).resize(100, 100).png().toBuffer();
        const b64 = `data:image/png;base64,${buf.toString('base64')}`;
        EMOJI_CACHE.set(eId, b64); return b64;
    } catch (e) { return null; }
}

async function processMessageHtml(text, entities = []) {
    if (!text) return '';
    let html = escapeHtml(text);
    
    // Sort entities descending to replace from end (prevents offset shifting)
    const sortedEntities = (entities || []).filter(e => e.type === 'custom_emoji').sort((a,b) => b.offset - a.offset);
    
    for (const e of sortedEntities) {
        const b64 = await getCustomEmojiBase64(e.custom_emoji_id);
        if (b64) {
            const start = e.offset; const end = e.offset + e.length;
            // Get original substring and replace it with img
            const pre = text.substring(0, start); const post = text.substring(end);
            const img = `<img src="${b64}" class="msg-emoji" />`;
            text = pre + "PLACEHOLDER" + post; // This is simplistic, let's do it better
        }
    }

    // Better way: character array replacement
    let chars = [...text];
    for (const e of sortedEntities) {
        const b64 = await getCustomEmojiBase64(e.custom_emoji_id);
        if (b64) {
            chars.splice(e.offset, e.length, `<img src="${b64}" class="msg-emoji" />`);
        }
    }
    
    let res = chars.join('');
    // Apply URL/Mentions highlighting on the remaining text parts (ignoring img tags)
    const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+|@\w+|\/\w+)/g;
    return res.split(/(<img[^>]+>)/).map(part => {
        if (part.startsWith('<img')) return part;
        return part.replace(urlRegex, (p) => `<span style="color: #6ab8ed; text-decoration: underline;">${escapeHtml(p)}</span>`).replace(/\n/g, '<br/>');
    }).join('');
}

async function createDummyAvatarBuffer(f, l, color, scale) {
    const s = 140 * scale;
    const canvas = createCanvas(s, s); const ctx = canvas.getContext('2d');
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(s/2, s/2, s/2, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#FFF'; ctx.font = `bold ${50*scale}px ${FONT_STACK}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const init = ((f?.[0]||'') + (l?.[0]||'')).toUpperCase().substring(0, 2);
    ctx.fillText(init || '?', s/2, s/2);
    return canvas.toBuffer('image/png');
}

async function createImage(firstName, lastName, customemojiid, message, nameColorId, inputImageBuffer, replySender, replyMessage, replysendercolor, messageEntities = []) {
    let msgList = Array.isArray(firstName) ? firstName : [{ firstName, lastName, customemojiid, message, nameColorId, inputImageBuffer, replySender, replyMessage, replysendercolor, messageEntities, id: '1' }];
    const scale = 4;
    
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
        const eStatus = data.customemojiid ? await getCustomEmojiBase64(data.customemojiid) : null;
        const messageHtml = await processMessageHtml(data.message || '', data.messageEntities || []);

        return {
            avatar: `data:image/png;base64,${avatar.toString('base64')}`,
            nameHtml, messageHtml, mediaBase64: mB64, isSticker: isS, rNameHtml: rName, rMsg: data.replyMessage, rColor, nameColor: color,
            userId: data.id || username, eStatus
        };
    }));

    const processedMessages = processedRaw.map((m, i) => {
        const next = processedRaw[i + 1]; const prev = processedRaw[i - 1];
        const nextIsSame = next && next.userId === m.userId;
        const prevIsSame = prev && prev.userId === m.userId;
        return { ...m, showName: !prevIsSame, showAvatar: !nextIsSame };
    });

    const html = `<html><head>
        <style>
        body { margin: 0; padding: 0; font-family: ${FONT_STACK}; background: transparent; -webkit-font-smoothing: antialiased; }
        #capture { display: inline-flex; flex-direction: column; gap: ${12 * scale}px; padding: ${18 * scale}px; width: fit-content; }
        .group { display: flex; align-items: flex-end; }
        .avatar-area { width: ${85 * scale}px; margin-right: ${12 * scale}px; display: flex; flex-direction: column; align-items: center; flex-shrink: 0; }
        .avatar { width: ${85 * scale}px; height: ${85 * scale}px; border-radius: 50%; opacity: 1; display: block; }
        .s-avatar-area { width: ${38 * scale}px !important; margin-right: ${8 * scale}px !important; }
        .s-avatar { width: ${38 * scale}px !important; height: ${38 * scale}px !important; }
        .hidden-avatar { opacity: 0; } 
        .bubble { background: #2a2233; border-radius: ${25 * scale}px; padding: ${18 * scale}px ${25 * scale}px; position: relative; max-width: ${950 * scale}px; display: flex; flex-direction: column; box-shadow: 0 4px 10px rgba(0,0,0,0.3); }
        .bubble-tail { border-radius: ${25 * scale}px ${25 * scale}px ${25 * scale}px 0; }
        .bubble-tail::after { 
            content: ''; position: absolute; bottom: 0; left: -${22 * scale}px; width: ${22 * scale}px; height: ${22 * scale}px; 
            background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3Cpath fill='%232a2233' d='M22 0 V22 H0 C11 22 22 11 22 0 Z'/%3E%3C/svg%3E"); 
            background-size: contain; 
        }
        .s-bubble { background: transparent !important; box-shadow: none !important; padding: 0 !important; }
        .s-bubble::after { display: none !important; }
        .name-line { display: flex; align-items: center; margin-bottom: 12px; font-size: ${32 * scale}px; font-weight: bold; line-height: 1; }
        .e-status { height: 1.1em; width: 1.1em; margin-left: 8px; border-radius: 3px; }
        .msg { color: #fff; font-size: ${30 * scale}px; line-height: 1.4; word-break: break-word; }
        .msg-emoji { height: 1.1em; width: 1.1em; vertical-align: middle; margin: 0 2px; }
        .sticker { max-width: ${420 * scale}px; max-height: ${420 * scale}px; filter: drop-shadow(0 4px 15px rgba(0,0,0,0.4)); display: block; border-radius: 12px; }
        .reply { background: rgba(255,255,255,0.06); border-radius: 10px; padding: 10px 14px; border-left: 5px solid; margin-bottom: 12px; max-width: 100%; box-sizing: border-box; overflow: hidden; }
        .r-name { font-weight: bold; margin-bottom: 4px; font-size: ${24 * scale}px; line-height: 1; }
        .r-msg { color: #b0b0b0; font-size: ${22 * scale}px; white-space: nowrap; overflow: hidden; -webkit-mask-image: linear-gradient(to right, black 90%, transparent 100%); }
    </style></head><body>
        <div id="capture">
            ${processedMessages.map(m => `
                <div class="group">
                    <div class="avatar-area ${m.isSticker ? 's-avatar-area' : ''}">
                        <img src="${m.avatar}" class="avatar ${m.isSticker ? 's-avatar' : ''} ${!m.showAvatar ? 'hidden-avatar' : ''}" />
                    </div>
                    <div class="bubble ${(m.showAvatar && !m.isSticker) ? 'bubble-tail' : ''} ${m.isSticker ? 's-bubble' : ''}">
                        ${m.showName && !m.isSticker ? `
                            <div class="name-line" style="color: ${m.nameColor}">
                                ${m.nameHtml}
                                ${m.eStatus ? `<img src="${m.eStatus}" class="e-status" />` : ''}
                            </div>
                        ` : ''}
                        ${m.rNameHtml && !m.isSticker ? `
                            <div class="reply" style="border-left-color: ${m.rColor}">
                                <div class="r-name" style="color: ${m.rColor}">${m.rNameHtml}</div>
                                <div class="r-msg">${escapeHtml(m.rMsg)}</div>
                            </div>
                        ` : ''}
                        ${m.mediaBase64 ? `<img src="${m.mediaBase64}" class="sticker" />` : ''}
                        ${m.messageHtml ? `<div class="msg">${m.messageHtml}</div>` : ''}
                    </div>
                </div>
            `).join('')}
        </div>
    </body></html>`;

    const browser = await getBrowser();
    const page = await browser.newPage();
    await page.setViewport({ width: 4000, height: 4000 });
    await page.setContent(html, { waitUntil: 'load' });
    const screenshot = await (await page.$('#capture')).screenshot({ omitBackground: true });
    await page.close();
    return await sharp(screenshot).trim({ threshold: 5 }).resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true }).webp({ quality: 100 }).toBuffer();
}

module.exports = createImage;