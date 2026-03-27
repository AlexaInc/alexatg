require('dotenv').config();
const proxyHelper = require('./utils/proxyHelper');
proxyHelper.configureAxios();
proxyHelper.configureGlobal();

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const axios = require('axios');

// --- CONFIGURATION ---
const BOT_TOKEN = '7961409784:AAH34SqtPohk5YydJVH9Fw9BfsxnSsAPIf8';

// Comprehensive font stack for global coverage
const FONT_STACK = "'Noto Sans', 'Noto Sans Symbols', 'Noto Sans Symbols 2', 'Noto Sans Math', 'Noto Color Emoji', 'Inter', 'Roboto', 'Segoe UI', 'Segoe UI Emoji', sans-serif";

function getTelegramDarkThemeColor(id) { const map = new Map([[0, '#FF516A'], [1, '#FF9442'], [2, '#C66FFF'], [3, '#50D892'], [4, '#64D4F5'], [5, '#5095ED'], [6, '#FF66A6'], [7, '#FF8280'], [8, '#EDD64E'], [9, '#C66FFF']]); return map.get(id) || '#00ffff'; }

async function createDummyAvatarBuffer(f, l, c, scale = 1) {
    const avatarSize = 140 * scale;
    let initialText = '';
    const firstChar = f ? (Array.from(f)[0] || '') : '';
    if (/\p{Emoji}/u.test(firstChar)) initialText = firstChar; else initialText = (firstChar + (l ? (Array.from(l)[0] || '') : '')).toUpperCase().trim();
    if (!initialText) initialText = '?';
    const fontSize = Array.from(initialText).length === 1 ? 72 * scale : 48 * scale;
    const html = `<html><head><style>body { margin: 0; padding: 0; width: ${avatarSize}px; height: ${avatarSize}px; font-family: ${FONT_STACK}; } #avatar { width: 100%; height: 100%; background-color: ${c}; border-radius: 50%; display: flex; justify-content: center; align-items: center; color: #FFF; font-size: ${fontSize}px; font-weight: bold; }</style></head><body><div id="avatar">${escapeHtml(initialText)}</div></body></html>`;

    let browser;
    try {
        browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu'] });
        const page = await browser.newPage();
        await page.setViewport({ width: avatarSize, height: avatarSize });
        await page.setContent(html);
        return await (await page.$('#avatar')).screenshot({ omitBackground: true });
    } finally { if (browser) await browser.close(); }
}

const EMOJI_STATUS_CACHE_DIR = './emoji_status';
if (!fs.existsSync(EMOJI_STATUS_CACHE_DIR)) fs.mkdirSync(EMOJI_STATUS_CACHE_DIR);

async function getEmojiStatusBuffer(emojiId) {
    const cachePath = `${EMOJI_STATUS_CACHE_DIR}/${emojiId}.png`;
    if (fs.existsSync(cachePath)) return fs.readFileSync(cachePath);
    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            const stickerResponse = await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/getCustomEmojiStickers`, { custom_emoji_ids: [emojiId] }, { family: 4 });
            const sticker = stickerResponse.data.result?.[0];
            if (!sticker) return null;
            let file_id = sticker.thumbnail?.file_id || (!sticker.is_animated && !sticker.is_video ? sticker.file_id : null);
            if (!file_id) return null;
            const fileResponse = await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/getFile`, { file_id }, { family: 4 });
            const imageResponse = await axios.get(`https://api.telegram.org/file/bot${BOT_TOKEN}/${fileResponse.data.result.file_path}`, { responseType: 'arraybuffer', family: 4 });
            const png = await sharp(imageResponse.data).resize(100, 100).png().toBuffer();
            fs.writeFileSync(cachePath, png); return png;
        } catch (e) { await new Promise(r => setTimeout(r, 500)); }
    }
    return null;
}

function escapeHtml(text) { return text ? text.toString().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;") : ''; }

function highlightTextPatterns(wrappedText) {
    const patternRegex = /(https?:\/\/[^\s]+|www\.[^\s]+|@\w+|\/\w+)/g;
    const parts = wrappedText.split(patternRegex).filter(Boolean);
    let output = '';
    for (const part of parts) {
        if (part.match(/^(https?:\/\/[^\s]+|www\.[^\s]+|@\w+|(\/)\w+)$/)) output += `<span style="color: #6ab8ed; text-decoration: underline;">${escapeHtml(part)}</span>`;
        else output += escapeHtml(part).replace(/\n/g, '<br/>');
    }
    return output;
}

async function renderMessageHTML(text, entities) {
    const rawText = String(text || '');
    if (!entities || entities.length === 0) return highlightTextPatterns(rawText);
    const sorted = [...entities].sort((a, b) => a.offset - b.offset);
    let html = ''; let last = 0;
    for (const e of sorted) {
        if (e.offset >= rawText.length) continue;
        const start = e.offset; if (start < last) continue;
        if (start > last) html += highlightTextPatterns(rawText.substring(last, start));
        const end = Math.min(start + e.length, rawText.length);
        const eText = rawText.substring(start, end);
        let p = '';
        if (e.type === 'custom_emoji') {
            const buf = await getEmojiStatusBuffer(e.custom_emoji_id);
            p = buf ? `<img src="data:image/png;base64,${buf.toString('base64')}" class="message-custom-emoji" />` : escapeHtml(eText);
        } else if (['url', 'mention', 'bot_command', 'mention_name', 'text_link'].includes(e.type)) p = `<span style="color: #6ab8ed; text-decoration: underline;">${escapeHtml(eText)}</span>`;
        else if (e.type === 'bold') p = `<b>${escapeHtml(eText)}</b>`;
        else if (e.type === 'italic') p = `<i>${escapeHtml(eText)}</i>`;
        else if (e.type === 'code') p = `<code style="background: rgba(255,255,255,0.1); padding: 0 4px; border-radius: 4px;">${escapeHtml(eText)}</code>`;
        else p = escapeHtml(eText);
        html += p.replace(/\n/g, '<br/>');
        last = end;
    }
    if (last < rawText.length) html += highlightTextPatterns(rawText.substring(last));
    return html || highlightTextPatterns(rawText);
}

async function createImage(firstName, lastName, customemojiid, message, nameColorId, inputImageBuffer, replySender, replyMessage, replysendercolor, messageEntities = []) {
    let messageDataList = Array.isArray(firstName) ? firstName : [{ firstName, lastName, customemojiid, message, nameColorId, inputImageBuffer, replySender, replyMessage, replysendercolor, messageEntities }];
    const options = Array.isArray(firstName) ? (lastName || {}) : {};
    const scale = 4;
    const forceImage = options.forceImage || messageDataList.length >= 4;

    const processedMessages = await Promise.all(messageDataList.map(async (data) => {
        const username = `${data.firstName || ''} ${data.lastName || ''}`.trim() || 'Unknown';
        const nameColor = getTelegramDarkThemeColor(data.nameColorId);
        const highlighted = await renderMessageHTML(data.message, data.entities || data.messageEntities || []);
        let rColorId = data.replysendercolor || 0; const rColor = getTelegramDarkThemeColor(rColorId);
        let pRMsg = data.replyMessage; if (pRMsg && pRMsg.length > 50) pRMsg = pRMsg.substring(0, 50);
        let avatar = data.inputImageBuffer ? await sharp(data.inputImageBuffer).png().toBuffer() : await createDummyAvatarBuffer(data.firstName || 'U', data.lastName || '', nameColor, scale);
        const eStatus = data.customemojiid ? await getEmojiStatusBuffer(data.customemojiid) : null;
        return {
            avatar: `data:image/png;base64,${avatar.toString('base64')}`,
            username,
            eStatus: eStatus ? `data:image/png;base64,${eStatus.toString('base64')}` : null,
            replySender: data.replySender, pRMsg, highlighted, nameColor, rColor
        };
    }));

    // Added all required Noto fonts for symbols and global characters
    const htmlContent = `<html><head>
        <link href="https://fonts.googleapis.com/css2?family=Noto+Sans:wght@700&family=Noto+Sans+JP:wght@700&family=Noto+Sans+KR:wght@700&family=Noto+Sans+SC:wght@700&family=Noto+Sans+TC:wght@700&family=Noto+Sans+Symbols:wght@700&family=Noto+Sans+Symbols+2:wght@700&family=Noto+Sans+Math:wght@700&family=Noto+Emoji:wght@700&display=swap" rel="stylesheet">
        <style>
        body { margin: 0; padding: ${40 * scale}px; font-family: ${FONT_STACK}; background: transparent; display: flex; justify-content: center; align-items: flex-start; }
        #capture { display: flex; flex-direction: column; gap: ${25 * scale}px; width: fit-content; padding: ${10 * scale}px; }
        .msg-group { display: flex; align-items: flex-end; width: fit-content; }
        .avatar { width: ${75 * scale}px; height: ${75 * scale}px; border-radius: 50%; margin-right: ${15 * scale}px; flex-shrink: 0; }
        .bubble { background: #2a2233; border-radius: ${25 * scale}px ${25 * scale}px ${25 * scale}px 0; padding: ${20 * scale}px ${30 * scale}px; position: relative; min-width: ${250 * scale}px; max-width: ${850 * scale}px; display: flex; flex-direction: column; }
        .bubble::after { content: ''; position: absolute; bottom: 0; left: -${22 * scale}px; width: ${22 * scale}px; height: ${22 * scale}px; background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3Cpath fill='%232a2233' d='M22 0 V22 H0 C11 22 22 11 22 0 Z'/%3E%3C/svg%3E"); background-size: contain; }
        .name-line { display: flex; align-items: center; margin-bottom: ${14 * scale}px; font-size: ${28 * scale}px; font-weight: bold; white-space: nowrap; }
        .e-status { width: ${28 * 1.5 * scale}px; height: ${28 * 1.5 * scale}px; margin-left: ${10 * scale}px; border-radius: 15%; }
        .message { font-size: ${28 * scale}px; line-height: 1.5; color: #fefcff; word-break: break-word; }
        .message-custom-emoji { width: 1.2em; height: 1.2em; vertical-align: middle; }
        .reply { background: rgba(255,255,255,0.06); border-radius: ${12 * scale}px; position: relative; padding: ${10 * scale}px ${12 * scale}px ${10 * scale}px ${14 * scale}px; margin-bottom: ${12 * scale}px; border-left: ${5 * scale}px solid; }
        .reply-sender { font-weight: bold; font-size: ${26 * scale}px; margin-bottom: ${5 * scale}px; }
        .reply-msg { color: #b0b0b0; white-space: nowrap; overflow: hidden; -webkit-mask-image: linear-gradient(to right, black 92%, transparent 100%); font-size: ${24 * scale}px; }
    </style></head><body>
        <div id="capture">
            ${processedMessages.map(m => `
                <div class="msg-group">
                    <img src="${m.avatar}" class="avatar" />
                    <div class="bubble">
                        <div class="name-line" style="color: ${m.nameColor}">
                            <span>${escapeHtml(m.username)}</span>
                            ${m.eStatus ? `<img src="${m.eStatus}" class="e-status" />` : ''}
                        </div>
                        ${m.replySender ? `<div class="reply" style="border-left-color: ${m.rColor};"><div class="reply-sender" style="color: ${m.rColor}">${escapeHtml(m.replySender)}</div><div class="reply-msg">${escapeHtml(m.pRMsg)}</div></div>` : ''}
                        <div class="message">${m.highlighted}</div>
                    </div>
                </div>
            `).join('')}
        </div>
    </body></html>`;

    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 4000, height: 4000 });
    await page.setContent(htmlContent, { waitUntil: 'networkidle2' });
    const screenshot = await (await page.$('#capture')).screenshot({ omitBackground: true });
    await browser.close();

    if (forceImage) return await sharp(screenshot).png().toBuffer();

    const scaled = await sharp(screenshot).resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true }).toBuffer();
    const meta = await sharp(scaled).metadata();
    const padX = Math.floor((512 - meta.width) / 2);
    const padY = Math.floor((512 - meta.height) / 2);
    return await sharp(scaled).extend({ top: padY, bottom: 512 - meta.height - padY, left: padX, right: 512 - meta.width - padX, background: { r: 0, g: 0, b: 0, alpha: 0 } }).webp({ quality: 90 }).toBuffer();
}

module.exports = createImage;