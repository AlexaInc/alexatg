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
async function createImage(firstName, lastName, customemojiid, message, nameColorId, inputImageBuffer, replySender, replyMessage, replysendercolor, messageEntities = [], replyEntities = []) {
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
        replyEntities: replyEntities,
        id: '1',
        isAbsoluteLast: true
    }];

    const API_URL = 'https://quotlytga-quotecpp.hf.space/api/generate';

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

        // 3. Map to API Schema (QuotlyNative C++ Structure)
        const messageObj = {
            text: msg.message || "",
            entities: msg.entities || [],
            from: {
                id: parseInt(msg.id) || 0,
                first_name: msg.firstName || "User",
                last_name: msg.lastName || "",
                emoji_status_custom_emoji_id: msg.customemojiid || null
            },
            avatarBase64: avatarBase64,
            nameColorId: parseInt(msg.nameColorId) || 0,
            id: parseInt(msg.id) || 0
        };

        if (mediaBase64) {
            const isSticker = msg.isSticker !== undefined ? msg.isSticker : (!msg.message || !msg.message.trim());
            messageObj.mediaType = isSticker ? "sticker" : "photo";
            messageObj.mediaBase64 = mediaBase64;
        }

        if (msg.replyMessage) {
            messageObj.reply_to = {
                text: msg.replyMessage,
                from: {
                    id: 0,
                    first_name: msg.replySender || "User",
                    last_name: ""
                },
                entities: msg.replyEntities || []
            };
            // Support flat structure as well for compatibility
            messageObj.replySender = msg.replySender || null;
            messageObj.replyMessage = msg.replyMessage || null;
            messageObj.replySenderColor = parseInt(msg.replysendercolor) || 0;
        }

        if (msg.forwardName) {
            messageObj.forwardName = msg.forwardName;
        }

        return messageObj;
    }));

    console.log(`🚀 [QuoteAPI] Sending ${processedMessages.length} messages to QuotlyNative renderer...`);

    const allEmojiIds = [];
    processedMessages.forEach(m => {
        if (m.from.emoji_status_custom_emoji_id) allEmojiIds.push(m.from.emoji_status_custom_emoji_id);
        m.entities.forEach(e => {
            if (e.type === 'custom_emoji' && e.custom_emoji_id) allEmojiIds.push(e.custom_emoji_id);
        });
    });

    const payload = {
        _info: {
            api: "QuotlyNative",
            endpoint: "POST /api/generate",
            telegram_user_id: parseInt(processedMessages[0]?.from?.id || 0),
            emoji_ids: [...new Set(allEmojiIds)]
        },
        transparent: true,
        messages: processedMessages
    };

    // Force bypass proxy (fixes the SSL port HTTP misrouting since Quote API is functional without proxy)
    try {
        const response = await axios.post(API_URL, payload, {
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