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

// --- SHARED BROWSER FOR SPEED ---
let sharedBrowser = null;
async function getBrowser() {
    if (sharedBrowser && sharedBrowser.connected) return sharedBrowser;
    sharedBrowser = await puppeteer.launch({
        headless: true,
        args: [
            '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
            '--no-zygote', '--single-process', '--hide-scrollbars'
        ]
    });
    sharedBrowser.on('disconnected', () => { sharedBrowser = null; });
    return sharedBrowser;
}

// --- FONT MAP FOR NODE-CANVAS (Direct to System Files) ---
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

Object.entries(fontMap).forEach(([fontPath, familyName]) => {
    if (fs.existsSync(fontPath)) {
        try { registerFont(fontPath, { family: familyName }); } catch (e) { }
    }
});

const FONT_STACK = "'Noto Sans', 'Noto Sans SC', 'Noto Sans Symbols', 'Noto Sans Symbols 2', 'Noto Sans Math', 'Arial Unicode MS', sans-serif";

const BOT_TOKEN = '7961409784:AAH34SqtPohk5YydJVH9Fw9BfsxnSsAPIf8';

function getTelegramDarkThemeColor(id) { const map = new Map([[0, '#FF516A'], [1, '#FF9442'], [2, '#C66FFF'], [3, '#50D892'], [4, '#64D4F5'], [5, '#5095ED'], [6, '#FF66A6'], [7, '#FF8280'], [8, '#EDD64E'], [9, '#C66FFF']]); return map.get(id) || '#00ffff'; }

function escapeHtml(text) { return text ? text.toString().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;") : ''; }

function createTextChunkImageBuffer(text, fontSize, color) {
    const canvas = createCanvas(1, 1);
    const ctx = canvas.getContext('2d');
    ctx.font = `bold ${fontSize}px ${FONT_STACK}`;
    const metrics = ctx.measureText(text);
    const width = Math.max(1, metrics.width);
    const height = Math.max(1, fontSize * 1.5);
    const textCanvas = createCanvas(width, height);
    const tCtx = textCanvas.getContext('2d');
    tCtx.font = `bold ${fontSize}px ${FONT_STACK}`;
    tCtx.fillStyle = color;
    tCtx.textBaseline = 'middle';
    tCtx.fillText(text, 0, height / 2);
    return textCanvas.toBuffer('image/png');
}

/**
 * The "LyoSU" secret: Render every grapheme (letter+symbols) into an image via node-canvas!
 * This ensures the character shape is LOCKED even if Puppeteer can't reach web servers.
 */
function generateNameHtml(text, color, fontSize) {
    if (!text) return '';
    const segmenter = new Intl.Segmenter();
    let html = '';
    const segments = [...segmenter.segment(text)];
    for (const s of segments) {
        const char = s.segment;
        if (/\p{Emoji}/u.test(char)) {
            html += `<span class="name-emoji">${escapeHtml(char)}</span>`;
        } else if (char.match(/^\s+$/)) {
            html += `<span style="white-space: pre;">${char}</span>`;
        } else {
            const buf = createTextChunkImageBuffer(char, fontSize, color);
            html += `<img src="data:image/png;base64,${buf.toString('base64')}" class="name-chunk" />`;
        }
    }
    return html;
}

const EMOJI_STATUS_CACHE_DIR = './emoji_status';
if (!fs.existsSync(EMOJI_STATUS_CACHE_DIR)) fs.mkdirSync(EMOJI_STATUS_CACHE_DIR);

async function getEmojiStatusBuffer(emojiId) {
    const cachePath = `${EMOJI_STATUS_CACHE_DIR}/${emojiId}.png`;
    if (fs.existsSync(cachePath)) return fs.readFileSync(cachePath);
    try {
        const sRes = await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/getCustomEmojiStickers`, { custom_emoji_ids: [emojiId] });
        const sticker = sRes.data.result?.[0];
        if (!sticker) return null;
        const fRes = await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/getFile`, { file_id: sticker.thumbnail?.file_id || sticker.file_id });
        const iRes = await axios.get(`https://api.telegram.org/file/bot${BOT_TOKEN}/${fRes.data.result.file_path}`, { responseType: 'arraybuffer' });
        const png = await sharp(iRes.data).resize(100, 100).png().toBuffer();
        fs.writeFileSync(cachePath, png); return png;
    } catch (e) { return null; }
}

async function createDummyAvatarBuffer(f, l, color, scale) {
    const size = 140 * scale;
    const canvas = createCanvas(size, size);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#FFF';
    ctx.font = `bold ${50 * scale}px ${FONT_STACK}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const initial = ((f?.[0] || '') + (l?.[0] || '')).toUpperCase();
    ctx.fillText(initial || '?', size / 2, size / 2);
    return canvas.toBuffer('image/png');
}

function highlightTextPatterns(text) {
    const regex = /(https?:\/\/[^\s]+|www\.[^\s]+|@\w+|\/\w+)/g;
    return text.split(regex).map(p => {
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
        let mediaBase64 = null;
        if (data.mediaBuffer) {
            const b = await sharp(data.mediaBuffer).resize(400, 400, { fit: 'inside' }).png().toBuffer();
            mediaBase64 = `data:image/png;base64,${b.toString('base64')}`;
        }
        const isSticker = !!data.mediaBuffer && (!data.message || data.message.trim() === '');
        const rColor = getTelegramDarkThemeColor(data.replysendercolor || 0);
        const rNameHtml = data.replySender ? generateNameHtml(data.replySender, rColor, 24 * scale) : '';
        const eStatus = data.customemojiid ? await getEmojiStatusBuffer(data.customemojiid) : null;

        return {
            avatar: `data:image/png;base64,${avatar.toString('base64')}`,
            nameHtml,
            eStatus: eStatus ? `data:image/png;base64,${eStatus.toString('base64')}` : null,
            messageHtml: highlightTextPatterns(data.message || ''),
            mediaBase64, isSticker, rNameHtml, rMsg: data.replyMessage, rColor,
            nameColor: color
        };
    }));

    const googleFontsUrl = `https://fonts.googleapis.com/css2?family=Noto+Sans:wght@700&display=block`;

    const html = `<html><head>
        <link href="${googleFontsUrl}" rel="stylesheet">
        <style>
        body { margin: 0; padding: ${30 * scale}px; font-family: ${FONT_STACK}; background: transparent; display: flex;-webkit-font-smoothing: antialiased; }
        #capture { display: flex; flex-direction: column; gap: ${25 * scale}px; width: fit-content; }
        .group { display: flex; align-items: flex-end; }
        .avatar { width: ${45 * scale}px; height: ${45 * scale}px; border-radius: 50%; margin-right: ${12 * scale}px; flex-shrink: 0; }
        .s-avatar { width: ${30 * scale}px; height: ${30 * scale}px; margin-bottom: 0; }
        .bubble { background: #2a2233; border-radius: ${25 * scale}px ${25 * scale}px ${25 * scale}px 0; padding: ${18 * scale}px ${25 * scale}px; position: relative; max-width: ${800 * scale}px; display: flex; flex-direction: column; box-shadow: 0 4px 10px rgba(0,0,0,0.3); }
        .bubble::after { content: ''; position: absolute; bottom: 0; left: -${20 * scale}px; width: ${20 * scale}px; height: ${20 * scale}px; background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3Cpath fill='%232a2233' d='M20 0 V20 H0 C10 20 20 10 20 0 Z'/%3E%3C/svg%3E"); background-size: contain; }
        .s-bubble { background: transparent !important; box-shadow: none !important; padding: 0 !important; }
        .s-bubble::after { display: none !important; }
        .name-line { display: flex; align-items: center; margin-bottom: ${10 * scale}px; font-size: ${28 * scale}px; white-space: nowrap; }
        .name-chunk { height: 1em; vertical-align: middle; }
        .e-status { height: 1.2em; width: 1.2em; border-radius: 5px; margin-left: ${8 * scale}px; }
        .msg { color: #fff; font-size: ${26 * scale}px; line-height: 1.4; word-break: break-word; }
        .sticker { max-width: ${350 * scale}px; max-height: ${350 * scale}px; filter: drop-shadow(0 4px 12px rgba(0,0,0,0.5)); border-radius: 10px; }
        .reply { background: rgba(255,255,255,0.06); border-radius: 10px; padding: 10px; border-left: 4px solid; margin-bottom: 10px; }
        .r-name { font-weight: bold; margin-bottom: 3px; font-size: ${22 * scale}px; }
        .r-msg { color: #b0b0b0; font-size: ${20 * scale}px; white-space: nowrap; overflow: hidden; -webkit-mask-image: linear-gradient(to right, black 90%, transparent 100%); }
    </style></head><body>
        <div id="capture">
            ${processedMessages.map(m => `
                <div class="group">
                    <img src="${m.avatar}" class="avatar ${m.isSticker ? 's-avatar' : ''}" />
                    <div class="bubble ${m.isSticker ? 's-bubble' : ''}">
                        ${!m.isSticker ? `
                            <div class="name-line">
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
    await page.evaluateHandle('document.fonts.ready');
    const screenshot = await (await page.$('#capture')).screenshot({ omitBackground: true });
    await page.close();

    const final = await sharp(screenshot).resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true }).toBuffer();
    const meta = await sharp(final).metadata();
    const px = Math.floor((512 - meta.width) / 2); const py = Math.floor((512 - meta.height) / 2);
    return await sharp(final).extend({ top: py, bottom: 512 - meta.height - py, left: px, right: 512 - meta.width - px, background: { r: 0, g: 0, b: 0, alpha: 0 } }).webp({ quality: 90 }).toBuffer();
}

module.exports = createImage;