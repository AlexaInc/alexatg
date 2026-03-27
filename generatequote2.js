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
    '/usr/share/fonts/truetype/noto/NotoSansSinhala-Regular.ttf': 'Noto Sans Sinhala',
    '/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf': 'Noto Color Emoji',
    '/usr/share/fonts/truetype/noto/NotoSansSymbols-Regular.ttf': 'Noto Sans Symbols',
    '/usr/share/fonts/truetype/noto/NotoSansSymbols2-Regular.ttf': 'Noto Sans Symbols 2',
    '/usr/share/fonts/truetype/noto/NotoSansMath-Regular.ttf': 'Noto Sans Math',
    '/usr/share/fonts/truetype/noto/NotoSansSC-Bold.otf': 'Noto Sans SC'
};
Object.entries(fontMap).forEach(([f, n]) => {
    if (fs.existsSync(f)) { try { registerFont(f, { family: n }); } catch (e) { } }
});

const FONT_STACK = "'Noto Sans', 'Noto Sans SC', 'Noto Sans Symbols', 'Noto Sans Symbols 2', 'Noto Sans Math', 'Arial Unicode MS', sans-serif";
const BOT_TOKEN = '7961409784:AAH34SqtPohk5YydJVH9Fw9BfsxnSsAPIf8';

function getTelegramDarkThemeColor(id) { const map = new Map([[0, '#FF516A'], [1, '#FF9442'], [2, '#C66FFF'], [3, '#50D892'], [4, '#64D4F5'], [5, '#5095ED'], [6, '#FF66A6'], [7, '#FF8280'], [8, '#EDD64E'], [9, '#C66FFF']]); return map.get(id) || '#00ffff'; }

function escapeHtml(t) { return t ? t.toString().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;") : ''; }

function createTextChunkImageBuffer(text, fontSize, color) {
    const canvas = createCanvas(1, 2); // Initial estimate
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

function generateNameHtml(text, color, fontSize) {
    if (!text) return '';
    const seg = new Intl.Segmenter();
    let res = '';
    for (const s of seg.segment(text)) {
        const c = s.segment;
        if (/\p{Emoji}/u.test(c)) res += `<span class="name-emoji" style="font-size: ${fontSize}px;">${escapeHtml(c)}</span>`;
        else if (c.match(/^\s+$/)) res += `<span style="white-space: pre;">${c}</span>`;
        else {
            const b = createTextChunkImageBuffer(c, fontSize, color);
            res += `<img src="data:image/png;base64,${b.toString('base64')}" class="name-chunk" />`;
        }
    }
    return res;
}

async function getEmojiStatusBuffer(eId) {
    try {
        const s = await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/getCustomEmojiStickers`, { custom_emoji_ids: [eId] });
        const st = s.data.result?.[0]; if (!st) return null;
        const f = await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/getFile`, { file_id: st.thumbnail?.file_id || st.file_id });
        const i = await axios.get(`https://api.telegram.org/file/bot${BOT_TOKEN}/${f.data.result.file_path}`, { responseType: 'arraybuffer' });
        return await sharp(i.data).resize(100, 100).png().toBuffer();
    } catch (e) { return null; }
}

async function createDummyAvatarBuffer(f, l, color, scale) {
    const s = 140 * scale;
    const canvas = createCanvas(s, s); const ctx = canvas.getContext('2d');
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#FFF'; ctx.font = `bold ${50 * scale}px ${FONT_STACK}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const init = ((f?.[0] || '') + (l?.[0] || '')).toUpperCase().substring(0, 2);
    ctx.fillText(init || '?', s / 2, s / 2);
    return canvas.toBuffer('image/png');
}

function highlightTextPatterns(t) {
    const r = /(https?:\/\/[^\s]+|www\.[^\s]+|@\w+|\/\w+)/g;
    return t.split(r).map(p => {
        if (p.match(/^(https?:\/\/[^\s]+|www\.[^\s]+|@\w+|(\/)\w+)$/)) return `<span style="color: #6ab8ed; text-decoration: underline;">${escapeHtml(p)}</span>`;
        return escapeHtml(p).replace(/\n/g, '<br/>');
    }).join('');
}

async function createImage(firstName, lastName, customemojiid, message, nameColorId, inputImageBuffer, replySender, replyMessage, replysendercolor, messageEntities = []) {
    let msgList = Array.isArray(firstName) ? firstName : [{ firstName, lastName, customemojiid, message, nameColorId, inputImageBuffer, replySender, replyMessage, replysendercolor, messageEntities }];
    const scale = 4;

    const processedMessages = await Promise.all(msgList.map(async (data) => {
        const username = `${data.firstName || ''} ${data.lastName || ''}`.trim() || 'User';
        const color = getTelegramDarkThemeColor(data.nameColorId);
        const nameHtml = generateNameHtml(username, color, 28 * scale);
        let avatar = data.inputImageBuffer ? await sharp(data.inputImageBuffer).png().toBuffer() : await createDummyAvatarBuffer(data.firstName, data.lastName, color, scale);
        let mB64 = null;
        if (data.mediaBuffer) { const b = await sharp(data.mediaBuffer).resize(400, 400, { fit: 'inside' }).png().toBuffer(); mB64 = `data:image/png;base64,${b.toString('base64')}`; }
        const isS = !!data.mediaBuffer && (!data.message || data.message.trim() === '');
        const rColor = getTelegramDarkThemeColor(data.replysendercolor || 0);
        const rName = data.replySender ? generateNameHtml(data.replySender, rColor, 24 * scale) : '';
        const eS = data.customemojiid ? await getEmojiStatusBuffer(data.customemojiid) : null;

        return {
            avatar: `data:image/png;base64,${avatar.toString('base64')}`,
            nameHtml, eStatus: eS ? `data:image/png;base64,${eS.toString('base64')}` : null,
            messageHtml: highlightTextPatterns(data.message || ''),
            mediaBase64: mB64, isSticker: isS, rNameHtml: rName, rMsg: data.replyMessage, rColor, nameColor: color
        };
    }));

    const html = `<html><head>
        <style>
        body { margin: 0; padding: 0; font-family: ${FONT_STACK}; background: transparent; -webkit-font-smoothing: antialiased; }
        #capture { display: inline-flex; flex-direction: column; gap: ${12 * scale}px; padding: ${15 * scale}px; width: fit-content; background: transparent; }
        .group { display: flex; align-items: flex-end; }
        
        .avatar { width: ${45 * scale}px; height: ${45 * scale}px; border-radius: 50%; margin-right: ${10 * scale}px; flex-shrink: 0; }
        .s-avatar { width: ${30 * scale}px; height: ${30 * scale}px; margin-right: ${8 * scale}px; }

        .bubble { background: #2a2233; border-radius: ${20 * scale}px ${20 * scale}px ${20 * scale}px 0; padding: ${15 * scale}px ${22 * scale}px; position: relative; max-width: ${850 * scale}px; display: flex; flex-direction: column; box-shadow: 0 4px 10px rgba(0,0,0,0.3); }
        .bubble::after { content: ''; position: absolute; bottom: 0; left: -${18 * scale}px; width: ${18 * scale}px; height: ${18 * scale}px; background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3Cpath fill='%232a2233' d='M18 0 V18 H0 C9 18 18 9 18 0 Z'/%3E%3C/svg%3E"); background-size: contain; }
        
        .s-bubble { background: transparent !important; box-shadow: none !important; padding: 0 !important; }
        .s-bubble::after { display: none !important; }

        .name-line { display: flex; align-items: center; margin-bottom: ${10 * scale}px; font-size: ${28 * scale}px; font-weight: bold; white-space: nowrap; }
        .name-chunk { height: 1em; vertical-align: middle; }
        .e-status { height: 1.25em; width: 1.25em; border-radius: 5px; margin-left: ${10 * scale}px; }
        .msg { color: #fff; font-size: ${28 * scale}px; line-height: 1.4; word-break: break-word; }
        .sticker { max-width: ${350 * scale}px; max-height: ${350 * scale}px; filter: drop-shadow(0 4px 12px rgba(0,0,0,0.4)); margin: ${5 * scale}px 0; }
        .reply { background: rgba(255,255,255,0.06); border-radius: 10px; padding: 10px 14px; border-left: 5px solid; margin-bottom: 10px; }
        .r-name { font-weight: bold; margin-bottom: 4px; font-size: ${24 * scale}px; }
        .r-msg { color: #b0b0b0; font-size: ${22 * scale}px; white-space: nowrap; overflow: hidden; -webkit-mask-image: linear-gradient(to right, black 90%, transparent 100%); }
    </style></head><body>
        <div id="capture">
            ${processedMessages.map(m => `
                <div class="group">
                    <img src="${m.avatar}" class="avatar ${m.isSticker ? 's-avatar' : ''}" />
                    <div class="bubble ${m.isSticker ? 's-bubble' : ''}">
                        ${!m.isSticker ? `
                            <div class="name-line" style="color: ${m.nameColor}">
                                ${m.nameHtml}
                                ${m.eStatus ? `<img src="${m.eStatus}" class="e-status" />` : ''}
                            </div>
                            ${m.rNameHtml ? `<div class="reply" style="border-left-color: ${m.rColor}">
                                <div class="r-name" style="color: ${m.rColor}">${m.rNameHtml}</div>
                                <div class="r-msg">${escapeHtml(m.rMsg)}</div>
                            </div>` : ''}
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

    // FINAL FIX for the "Too Long" issue: 
    // We resize to 512 max WITHOUT forcing a 512x512 square if the original image is short.
    // This allows the image to be 512x200 (perfectly centered by Telegram).
    return await sharp(screenshot)
        .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 90 })
        .toBuffer();
}

module.exports = createImage;