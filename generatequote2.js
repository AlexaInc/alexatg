require('dotenv').config();

const axios = require('axios');
const sharp = require('sharp');
const { createCanvas, registerFont } = require('canvas');
const fs = require('fs');
const path = require('path');

// --- DUMMY AVATAR LOGIC (Matches authentic Telegram style) ---
const fontMap = {
    '/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf': 'Noto Sans',
    '/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf': 'Noto Sans',
    '/usr/share/fonts/truetype/noto/NotoSansSymbols-Regular.ttf': 'Noto Sans Symbols',
    '/usr/share/fonts/truetype/noto/NotoSansMath-Regular.ttf': 'Noto Sans Math',
    '/usr/share/fonts/truetype/noto/NotoSansSC-Bold.otf': 'Noto Sans SC'
};
Object.entries(fontMap).forEach(([f, n]) => { if (fs.existsSync(f)) { try { registerFont(f, { family: n }); } catch (e) { } } });
const CANVAS_FONT = "'Noto Sans', 'Noto Sans SC', 'Noto Sans Symbols', sans-serif";

function getTelegramColor(id) {
    const map = new Map([[0, '#FF516A'], [1, '#FF9442'], [2, '#C66FFF'], [3, '#50D892'], [4, '#64D4F5'], [5, '#5095ED'], [6, '#FF66A6'], [7, '#FF8280'], [8, '#EDD64E'], [9, '#C66FFF']]);
    return map.get(parseInt(id) % 10) || '#00ffff';
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

/**
 * Generates a Telegram-style quote sticker using the remote Quote API.
 * Following the "perfect" method from test_run.js: uses plain text and entities.
 */
async function createImage(firstName, lastName, customemojiid, message, nameColorId, inputImageBuffer, replySender, replyMessage, replysendercolor, messageEntities = []) {
    // Standardize input into a list of messages
    const rawList = Array.isArray(firstName) ? firstName : [{
        firstName,
        lastName,
        customemojiid,
        message,
        nameColorId,
        inputImageBuffer,
        replySender,
        replyMessage,
        replysendercolor,
        entities: messageEntities,
        id: '1',
        isAbsoluteLast: true
    }];

    const API_URL = 'https://quotlytga-quoteapi.hf.space/api/generate';

    const processedMessages = await Promise.all(rawList.map(async (msg, idx) => {
        const color = getTelegramColor(msg.nameColorId);

        // 1. Process Avatar to Base64
        let avatarBase64 = "";
        if (msg.inputImageBuffer) {
            try {
                // Resize for efficiency
                const av = await sharp(msg.inputImageBuffer).resize(200, 200).png().toBuffer();
                avatarBase64 = `data:image/png;base64,${av.toString('base64')}`;
            } catch (e) {
                const dummy = await dummyAvatar(msg.firstName, msg.lastName, color);
                avatarBase64 = `data:image/png;base64,${dummy.toString('base64')}`;
            }
        } else {
            const dummy = await dummyAvatar(msg.firstName, msg.lastName, color);
            avatarBase64 = `data:image/png;base64,${dummy.toString('base64')}`;
        }

        // 2. Process Media/Sticker to Base64
        let mediaBase64 = "";
        if (msg.mediaBuffer) {
            try {
                const mb = await sharp(msg.mediaBuffer)
                    .resize(1024, 1024, { fit: 'inside' })
                    .png()
                    .toBuffer();
                mediaBase64 = `data:image/png;base64,${mb.toString('base64')}`;
            } catch (e) {
                console.error("[QuoteAPI] Media processing failed:", e.message);
            }
        }

        // 3. Map to API Schema (Exactly as in test_run.js)
        return {
            id: String(msg.id || idx + 1),
            firstName: msg.firstName || "User",
            lastName: msg.lastName || "",
            avatarBase64: avatarBase64,
            customemojiid: msg.customemojiid || null,
            message: msg.message || "", // PLAIN TEXT ONLY (API handles styling via entities)
            nameColorId: parseInt(msg.nameColorId) || 0,
            entities: msg.entities || [], // STYLES GO HERE
            mediaBase64: mediaBase64 || null,
            isSticker: !!msg.mediaBuffer && (!msg.message || !msg.message.trim()),
            replySender: msg.replySender || null,
            replyMessage: msg.replyMessage || null,
            replysendercolor: parseInt(msg.replysendercolor) || 0,
            forwardName: msg.forwardName || null,
            isAbsoluteLast: msg.isAbsoluteLast !== undefined ? msg.isAbsoluteLast : (idx === rawList.length - 1)
        };
    }));

    console.log(`🚀 [QuoteAPI] Sending ${processedMessages.length} messages to remote renderer...`);

    // Force bypass proxy (fixes the SSL port HTTP misrouting since Quote API is functional without proxy)
    try {
        const response = await axios.post(API_URL, { messages: processedMessages }, {
            responseType: 'arraybuffer',
            headers: { 'Content-Type': 'application/json' },
            timeout: 60000,
            proxy: false,
            httpAgent: false,
            httpsAgent: false
        });
        console.log(`✅ [QuoteAPI] Sticker generated successfully (${response.data.length} bytes)`);
        return Buffer.from(response.data);
    } catch (err2) {
        const errorMsg2 = err2.response ? err2.response.data.toString() : err2.message;
        console.error('❌ [QuoteAPI] Error:', errorMsg2);
        throw new Error(`Quote API rendering failed: ${errorMsg2}`);
    }
}

module.exports = createImage;