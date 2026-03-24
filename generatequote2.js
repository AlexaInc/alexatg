const puppeteer = require('puppeteer');
// *** RESTORED: createCanvas, registerFont from 'canvas' ***
const { createCanvas, registerFont } = require('canvas');
const fs = require('fs');
const fsPromises = require('fs').promises;
const path = require('path');
const sharp = require('sharp');
const axios = require('axios');
const proxyHelper = require('./utils/proxyHelper');
proxyHelper.configureAxios();
proxyHelper.configureGlobal();
// const { text } = require('stream/consumers'); // <-- Removed, this was unused

// --- CONFIGURATION ---
const BOT_TOKEN = '7961409784:AAH34SqtPohk5YydJVH9Fw9BfsxnSsAPIf8'; // IMPORTANT: Replace with your token

// --- FONT DEFINITIONS ---
const fontMap = {
    '/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf': 'Noto Sans',
    '/usr/share/fonts/truetype/noto/NotoSansSinhala-Regular.ttf': 'Noto Sans Sinhala',
    '/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf': 'Noto Color Emoji',
    '/usr/share/fonts/truetype/noto/NotoSansSymbols-Regular.ttf': 'Noto Sans Symbols',
    '/usr/share/fonts/truetype/noto/NotoSansSymbols2-Regular.ttf': 'Noto Sans Symbols 2',
    '/usr/share/fonts/truetype/noto/NotoSansMath-Regular.ttf': 'Noto Sans Math',
    '/usr/share/fonts/truetype/noto/NotoSansMeeteiMayek-Regular.ttf': 'Noto Sans Meetei Mayek'
};

// --- FONT LOADING FOR NODE-CANVAS (Used by generateNameHtml) ---
console.log('Registering fonts for node-canvas...');
Object.entries(fontMap).forEach(([fontPath, familyName]) => {
    try {
        if (fs.existsSync(fontPath)) {
            registerFont(fontPath, { family: familyName });
            console.log(`Registered for node-canvas: ${fontPath} as "${familyName}"`);
        } else {
            console.warn(`⚠️ node-canvas: Font file not found at ${fontPath}`);
        }
    } catch (e) {
        console.warn(`⚠️ node-canvas: Could not register font at ${fontPath}: ${e.message}`);
    }
});

// --- FONT LOADING FOR PUPPETEER (REMOVED) ---
// Font-face rules are no longer injected. Puppeteer will use system-installed fonts.

// This is the CSS font-family stack Puppeteer will now use
// This is the CSS font-family stack Puppeteer will now use
const FONT_STACK = "'Noto Sans', 'Noto Sans Sinhala', 'Noto Sans Meetei Mayek', 'Noto Sans Math', 'Noto Sans Symbols', 'Noto Sans Symbols 2', 'Noto Color Emoji'";
// This stack is for the dummy avatar, which also runs in Puppeteer
const DUMMY_AVATAR_FONT_STACK = "'Noto Color Emoji', 'Noto Sans'";


// --- HELPER FUNCTIONS ---

function getTelegramDarkThemeColor(id) { const map = new Map([[0, '#FF516A'], [1, '#FF9442'], [2, '#C66FFF'], [3, '#50D892'], [4, '#64D4F5'], [5, '#5095ED'], [6, '#FF66A6'], [7, '#FF8280'], [8, '#EDD64E'], [9, '#C66FFF']]); return map.get(id) || '#00ffff'; }

// --- NEW PUPPETEER-BASED AVATAR FUNCTION ---
async function createDummyAvatarBuffer(f, l, c, scale = 1) {
    const avatarSize = 140 * scale;

    // 1. Determine Initial Text (Unicode-safe)
    let initialText = '';
    const firstChar = f ? (Array.from(f)[0] || '') : '';
    const isFirstCharEmoji = /\p{Emoji}/u.test(firstChar);

    if (isFirstCharEmoji) {
        initialText = firstChar;
    } else {
        const firstInitial = firstChar;
        const lastInitial = l ? (Array.from(l)[0] || '') : '';
        initialText = (firstInitial + lastInitial).toUpperCase().trim();
    }

    if (!initialText) {
        initialText = '?';
    }

    // 2. Determine Font Size
    const graphemeCount = Array.from(initialText).length;
    const isSingleEmoji = graphemeCount === 1 && /\p{Emoji}/u.test(initialText);

    let fontSize;
    let fontWeight = 'bold';
    if (isSingleEmoji) {
        fontSize = 72 * scale;
        fontWeight = 'normal'; // Emojis look better as normal weight
    } else if (graphemeCount === 1) {
        fontSize = 64 * scale;
    } else {
        fontSize = 48 * scale;
    }

    // 3. Generate HTML for the avatar
    const htmlContent = `
        <html><head><style>
            /* --- Font-face rules removed --- */

            body {
                margin: 0;
                padding: 0;
                width: ${avatarSize}px;
                height: ${avatarSize}px;
                font-family: ${DUMMY_AVATAR_FONT_STACK}; /* Use the font stack */
            }
            #avatar {
                width: 100%;
                height: 100%;
                background-color: ${c};
                border-radius: 50%;
                display: flex;
                justify-content: center;
                align-items: center;
                color: #FFF;
                font-size: ${fontSize}px;
                font-weight: ${fontWeight};
                line-height: 1;
                text-align: center;
                overflow: hidden; /* Just in case */
            }
        </style></head>
        <body>
            <div id="avatar">${escapeHtml(initialText)}</div>
        </body></html>
    `;

    // 4. Launch a *separate, minimal* Puppeteer instance to render it
    let browser;
    let pngBuffer;
    try {
        browser = await puppeteer.launch({ headless: true, executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-gpu'] });
        const page = await browser.newPage();
        await page.setViewport({ width: avatarSize, height: avatarSize });
        await page.setContent(htmlContent, { waitUntil: 'domcontentloaded' }); // Reverted from networkidle0

        const element = await page.$('#avatar');
        pngBuffer = await element.screenshot({ omitBackground: true }); // Screenshot just the circle

    } catch (e) {
        console.error("❌ Error creating dummy avatar with Puppeteer:", e.message);
        return null; // Fallback
    } finally {
        if (browser) {
            await browser.close();
        }
    }

    return pngBuffer;
}


// --- HELPER FUNCTION: Fetches and CONVERTS to PNG ---
const EMOJI_STATUS_CACHE_DIR = './emoji_status';
if (!fs.existsSync(EMOJI_STATUS_CACHE_DIR)) {
    fs.mkdirSync(EMOJI_STATUS_CACHE_DIR);
}
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function getEmojiStatusBuffer(emojiId) {
    const cachePath = `${EMOJI_STATUS_CACHE_DIR}/${emojiId}.png`;
    if (fs.existsSync(cachePath)) {
        return fs.readFileSync(cachePath);
    }

    const maxRetries = 6;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const stickerApiUrl = `https://api.telegram.org/bot${BOT_TOKEN}/getCustomEmojiStickers`;
            const stickerResponse = await axios.post(stickerApiUrl, { custom_emoji_ids: [emojiId] });

            const stickers = stickerResponse.data.result;
            if (!stickers || stickers.length === 0) throw new Error("Sticker not found for ID.");

            const sticker = stickers[0];
            if (!sticker.thumbnail) throw new Error("Sticker does not have a static thumbnail.");

            const file_id = sticker.thumbnail.file_id;

            const fileApiUrl = `https://api.telegram.org/bot${BOT_TOKEN}/getFile`;
            const fileResponse = await axios.post(fileApiUrl, { file_id: file_id });
            const file_path = fileResponse.data.result.file_path;

            const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${file_path}`;
            const imageResponse = await axios.get(fileUrl, { responseType: 'arraybuffer' });

            const pngBuffer = await sharp(imageResponse.data).png().toBuffer();

            fs.writeFileSync(cachePath, pngBuffer);
            return pngBuffer;

        } catch (error) {
            console.warn(`[Attempt ${attempt}/${maxRetries}] Failed to fetch emoji status: ${error.message}`);
            if (attempt === maxRetries) {
                console.error(`❌ Final attempt failed. Could not fetch emoji status for ID ${emojiId}.`);
                return null;
            }
            await sleep(2000);
        }
    }
    return null;
}


function escapeHtml(text) {
    if (!text) return '';
    // *** FIX: Corrected regex from /&g to /&/g ***
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

// *** RESTORED: createTextChunkImageBuffer function ***
function createTextChunkImageBuffer(text, { fontSize = 20, color = '#FFFFFF' }) {
    const canvas = createCanvas(1, 1);
    const ctx = canvas.getContext('2d');
    // Use the *exact* font stack from node-canvas registration
    ctx.font = `bold ${fontSize}px ${FONT_STACK}`;
    const metrics = ctx.measureText(text);
    const textHeight = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
    // *** FIX: Keep padding at 0 ***
    const padding = 0;

    // *** FIX: Ensure width and height are at least 1px ***
    const canvasWidth = Math.max(1, metrics.width + 2 * padding);
    const canvasHeight = Math.max(1, textHeight + 2 * padding);

    const textCanvas = createCanvas(canvasWidth, canvasHeight);
    const textCtx = textCanvas.getContext('2d');
    textCtx.font = `bold ${fontSize}px ${FONT_STACK}`; // Use the *exact* font stack
    textCtx.fillStyle = color;
    textCtx.textBaseline = 'alphabetic';
    // Draw text only if width > 0 to avoid potential issues
    if (metrics.width > 0) {
        textCtx.fillText(text, padding, metrics.actualBoundingBoxAscent + padding);
    }
    return textCanvas.toBuffer('image/png');
}

// *** RESTORED: generateNameHtml function ***
// *** RESTORED: generateNameHtml function ***
function generateNameHtml(text, color, fontSize) {
    const emojiRegex = /(\u00a9|\u00ae|[\u2000-\u3300]|\ud83c[\ud000-\udfff]|\ud83d[\ud000-\udfff]|\ud83e[\ud000-\udfff])/g;
    // Split by emoji AND whitespace 
    const chunks = text.split(/(\s+|(?:\u00a9|\u00ae|[\u2000-\u3300]|\ud83c[\ud000-\udfff]|\ud83d[\ud000-\udfff]|\ud83e[\ud000-\udfff]))/).filter(Boolean);
    let html = '';

    for (const chunk of chunks) {
        if (chunk.match(emojiRegex)) {
            // It's an emoji
            html += `<span class="name-emoji">${escapeHtml(chunk)}</span>`;

            // *** FIX: Check for whitespace chunk ***
        } else if (chunk.match(/^\s+$/)) {
            // It's whitespace. Render it as a span.
            // We use 'style="white-space: pre;"' to ensure it's rendered exactly as-is.
            html += `<span class="name-whitespace" style="white-space: pre;">${escapeHtml(chunk)}</span>`;
        } else {
            // It's a text chunk 
            const trimmedChunk = chunk.trim(); // We can trim, as spaces are handled separately
            if (trimmedChunk) {
                const chunkImageBuffer = createTextChunkImageBuffer(trimmedChunk, { fontSize: fontSize, color: color });
                const chunkImageBase64 = `data:image/png;base64,${chunkImageBuffer.toString('base64')}`;
                html += `<img class="name-chunk-image" src="${chunkImageBase64}" />`;
            }
        }
    }
    return html;
}


function wrapTextSmartly(text, maxWidth, font) {
    // This function is no longer used by createImage but is kept for potential other uses
    // Note: It relies on node-canvas, which might be removed if not used elsewhere
    const { createCanvas } = require('canvas'); // Moved import here
    const canvas = createCanvas(1, 1);
    const ctx = canvas.getContext('2d');
    ctx.font = font;

    const sanitizedText = text.replace(/\u200B/g, ' ').trim();
    if (!sanitizedText) return '';

    const words = sanitizedText.split(/\s+/);
    let line = '';
    let result = '';

    for (let n = 0; n < words.length; n++) {
        const word = words[n];
        const testLine = (line ? line + ' ' : '') + word;
        const metrics = ctx.measureText(testLine);
        const testWidth = metrics.width;

        if ((testWidth > maxWidth && line) || metrics.width > maxWidth) {
            result += line.trim() + '\n';
            line = word + ' ';
        } else {
            line = testLine + ' ';
        }
    }
    result += line.trim();
    return result;
}

/**
 * Highlights links, mentions, and commands by wrapping them in <span> tags,
 * and escapes all other HTML characters in the plain text segments.
 * Newline characters (\n) are converted to <br/> tags.
 * @param {string} wrappedText Text that *has not* been pre-wrapped. CSS will handle wrapping.
 * @returns {string} HTML string ready for direct insertion into the DOM.
 */
function highlightTextPatterns(wrappedText) {
    // Regex: Matches links (http/www), @mentions, or /commands
    const patternRegex = /(https?:\/\/[^\s]+|www\.[^\s]+|@\w+|\/\w+)/g;
    // Split the text by the highlighted patterns. This interleaves the patterns and the plain text.
    const parts = wrappedText.split(patternRegex).filter(p => p !== undefined && p !== null && p !== '');

    let outputHtml = '';
    const highlightColor = '#6ab8ed'; // Light blue for links/mentions/commands

    for (const part of parts) {
        // *** FIX: Corrected regex from @w+ to @\w+ ***
        if (part.match(/^(https?:\/\/[^\s]+|www\.[^\s]+|@\w+|(\/)\w+)$/)) {
            // It's a highlighted match.
            // 1. Escape the content in case the link/mention/command itself contains '<' or '&'.
            const escapedContent = escapeHtml(part);
            // 2. Wrap it in a span with the required style.
            outputHtml += `<span style="color: ${highlightColor}; text-decoration: underline;">${escapedContent}</span>`;
        } else {
            // It's plain text.
            // 1. Escape all HTML characters.
            const escapedText = escapeHtml(part);
            // 2. Convert any *intentional* \n line breaks to <br/>.
            //    The browser will handle the wrapping line breaks.
            outputHtml += escapedText.replace(/\n/g, '<br/>');
        }
    }
    return outputHtml;
}


// --- MAIN PUPPETEER FUNCTION ---
async function createImage(firstName, lastName, customemojiid, message, nameColorId, inputImageBuffer, replySender, replyMessage, replysendercolor) {
    const scale = 4;
    const username = `${firstName} ${lastName}`.trim().replace(/\u200B/g, '');
    const nameColor = getTelegramDarkThemeColor(nameColorId);

    // --- UNIVERSAL FONT SIZING ---
    // All text elements will use this single size.
    const UNIVERSAL_FONT_SIZE = 26 * scale;

    // Set all font sizes to the universal size
    let messageFontSize = UNIVERSAL_FONT_SIZE;
    let nameImageFontSize = UNIVERSAL_FONT_SIZE;
    let replySenderFontSize = UNIVERSAL_FONT_SIZE;
    let replyMessageFontSize = UNIVERSAL_FONT_SIZE;

    // Emoji size is relative to the text size
    let nameEmojiFontSize = nameImageFontSize;

    // Standardized layout values based on the universal font size
    let nameLineHeight = 34 * scale;
    let nameMarginBottom = 12 * scale;
    let messageLineHeight = 1.4;
    const replyLineHeight = 1.3;
    const replyMarginBottom = 10 * scale;
    // --- END UNIVERSAL FONT SIZING ---


    // --- Text Highlighting & Max Width ---
    const DEFAULT_MESSAGE_MAX_WIDTH = 650 * scale; // Max width for the MESSAGE text to wrap
    const BUBBLE_MIN_WIDTH = 250 * scale; // Minimum width for the bubble
    const REPLY_MESSAGE_MAX_LENGTH = 50; // Max characters for the reply message

    // Pass the *original* message directly to the highlighter.
    // CSS will handle all the wrapping.
    const highlightedMessageHtml = highlightTextPatterns(message);
    // ---------------------------------------------

    // *** RESTORED: nameContentHtml generation ***
    const nameContentHtml = generateNameHtml(username, nameColor, nameImageFontSize);

    // *** RESTORED: replySenderHtml generation ***
    let replySenderHtml = '';
    const replySenderColor = getTelegramDarkThemeColor(replysendercolor); // Green color
    if (replySender) {
        replySenderHtml = generateNameHtml(replySender.replace(/\u200B/g, ''), replySenderColor, replySenderFontSize);
    }

    // *** ADDED: Slicing logic for replyMessage ***
    let processedReplyMessage = replyMessage;
    if (replySender && processedReplyMessage && processedReplyMessage.length > REPLY_MESSAGE_MAX_LENGTH) {
        // Slice the message but don't add ellipsis, the CSS fade-out handles it
        processedReplyMessage = processedReplyMessage.substring(0, REPLY_MESSAGE_MAX_LENGTH);
    }

    let avatarBuffer = inputImageBuffer ? await sharp(inputImageBuffer).png().toBuffer() : await createDummyAvatarBuffer(firstName, lastName, nameColor, scale);
    const avatarBase64 = `data:image/png;base64,${avatarBuffer.toString('base64')}`;
    const emojiStatusBuffer = customemojiid ? await getEmojiStatusBuffer(customemojiid) : null;
    const emojiStatusBase64 = emojiStatusBuffer ? `data:image/png;base64,${emojiStatusBuffer.toString('base64')}` : null;

    const htmlContent = `
        <html><head><style>
            /* --- Font-face rules removed --- */

            body {
                margin: 0;
                padding: ${30 * scale}px; /* Body padding for spacing */
                font-family: ${FONT_STACK}, sans-serif; /* Use the full font stack */
                display: flex;
                justify-content: flex-start; /* Align content to start */
                align-items: flex-start;
                min-height: 100vh;
                background-color: transparent; 
            }

            .container { 
                display: flex; 
                align-items: flex-end; 
            }
            
            .avatar { 
                width: ${70 * scale}px; 
                height: ${70 * scale}px; 
                border-radius: 50%; 
                margin-right: ${15 * scale}px; 
                flex-shrink: 0; 
                object-fit: cover;
            }

            .bubble { 
                background-color: #2a2233; 
                border-radius: ${20 * scale}px ${20 * scale}px ${20 * scale}px 0; 
                padding: ${18 * scale}px ${25 * scale}px ${12 * scale}px ${25 * scale}px;
                position: relative;
                min-width: ${BUBBLE_MIN_WIDTH}px; /* Ensure bubble isn't too small */
                box-sizing: border-box; 
                flex-grow: 1; 
                display: flex; 
                flex-direction: column; 
                align-items: flex-start; 
            }

            .bubble::before {
                content: '';
                position: absolute;
                bottom: 0;
                left: -${20 * scale}px;
                width: ${20 * scale}px;
                height: ${20 * scale}px;
                background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20'%3E%3Cpath fill='%232a2233' d='M20 0 V20 H0 C10 20 20 10 20 0 Z'/%3E%3C/svg%3E");
                background-size: contain;
                background-repeat: no-repeat;
            }

/* FIX: Remove flex, rely on inline-block alignment */
.name-line { 
                display: flex; 
                align-items: center; /* Vertically center all items */
                margin-bottom: ${nameMarginBottom}px; 
                min-height: ${nameLineHeight}px; 
                font-size: ${nameEmojiFontSize}px; /* Base size for 'em' unit */
                font-weight: bold; 
                color: ${nameColor}; 
                line-height: 1; 
                white-space: nowrap;
            }
            
            /* * This targets all children (img, span) to make
             * them align properly as flex items.
             */
            .name-line > * {
                display: block; /* Make them blocks for flex alignment */
            }

            /* * KEY FIX: Set the max-height of the text-image to 1em
             * This will scale it down to match the font-size.
             */
            .name-line > .name-chunk-image {
                max-height: 1em; /* 1em = ${nameEmojiFontSize}px */
                width: auto;     /* Let width scale with aspect ratio */
            }
            
            /* FIX: Use inline-block and vertical-align. Remove forced height. */
            .name-chunk-image, .name-emoji { 
                /* height: 1em; REMOVED */
                display: inline-block;
                vertical-align: middle; 
            }
            .name-emoji {
               /* No specific rules needed */
            }

            /* FIX: Add this new rule for the whitespace span */
            .name-whitespace {
                display: inline-block;
                vertical-align: middle;
            }
            
            /* This targets the <img> tags generated by generateNameHtml for the name */
            .name-line .name-chunk-image {
                 /* height: ${nameImageFontSize}px !important; REMOVED -- THIS FIXES THE SIZE */
            }

            .emoji-status { 
                width: ${nameEmojiFontSize * 1.5}px; 
                height: ${nameEmojiFontSize * 1.5}px; 
                margin-left: ${8 * scale}px; /* Keep margin for status emoji */
                vertical-align: middle; 
                border-radius:15%;
                display: inline-block; /* Keep for status emoji alignment */
            }

            .message { 
                font-size: ${messageFontSize}px; /* UNIVERSAL SIZE */
                line-height: ${messageLineHeight}; 
                color: #fefcff; 
                word-break: break-word; 
                padding-bottom: ${10 * scale}px;
                text-align: left; 
                /* max-width is now set dynamically in Puppeteer */
                width: 100%; 
                box-sizing: border-box; 
            }

            .reply {
                background-color: ${replySenderColor}10; 
                border-radius: ${10 * scale}px;
                position: relative;
                padding-left: ${12 * scale}px; 
                padding-top: ${8 * scale}px;
                padding-bottom: ${8 * scale}px;
                padding-right: ${10 * scale}px;
                margin-bottom: ${replyMarginBottom}px; 
                display: flex;
                flex-direction: column;
                align-items: flex-start;
                width: 100%; 
                box-sizing: border-box; 
                /* gap removed */
            }

            .reply::before {
                content: '';
                position: absolute;
                left: ${4 * scale}px; 
                background-color: ${replySenderColor}; 
                border-radius: ${2 * scale}px;
                width: ${4 * scale}px;
                top: ${8 * scale}px; 
                bottom: ${8 * scale}px; 
            }

/* FIX: Remove flex, rely on inline-block alignment */
.reply-sender { 
                display: flex;
                align-items: center;
                font-size: ${replySenderFontSize}px; /* Base size for 'em' unit */
                font-weight: bold; 
                color: ${replySenderColor}; 
                margin-bottom: ${4 * scale}px; 
                line-height: ${replyLineHeight};
                text-align: left;
                padding-left: ${10 * scale}px; 
                white-space: nowrap; 
            }

            /* * Make all children of reply-sender align properly
             */
            .reply-sender > * {
                display: block;
            }

            /* * KEY FIX (Repeated): Scale the reply sender's
             * text-image down to match the font-size.
             */
            .reply-sender > .name-chunk-image {
                max-height: 1em;
                width: auto;
            }
            
            /* FIX: Use inline-block and vertical-align. Remove forced height. */
            .reply-sender .name-chunk-image, .reply-sender .name-emoji {
                /* height: 1em; REMOVED */
                display: inline-block;
                vertical-align: middle;
            }
            
            .reply-sender .name-chunk-image {
                 /* height: ${replySenderFontSize}px !important; REMOVED -- THIS FIXES THE SIZE */
            }

            .reply-message { 
                font-size: ${replyMessageFontSize}px; /* UNIVERSAL SIZE */
                line-height: ${replyLineHeight};
                color: #b0b0b0; 
                white-space: nowrap; 
                overflow: hidden; 
                /* Replaced ellipsis with a fade-out gradient mask */
                -webkit-mask-image: linear-gradient(to right, black 90%, transparent 100%);
                mask-image: linear-gradient(to right, black 90%, transparent 100%);
                text-align: left;
                padding-left: ${10 * scale}px; 
                width: 100%; 
                box-sizing: border-box;
            }
        </style></head>
        <body><div class="container" id="capture">
            <img src="${avatarBase64}" class="avatar" />
            <div class="bubble">
                 
                <div class="name-line">
                    ${nameContentHtml}
                    ${emojiStatusBase64 ? `<img src="${emojiStatusBase64}" class="emoji-status" />` : ''}
                </div>
                
                ${replySender && replyMessage ? `
                <div class="reply">
                   
                    <div class="reply-sender">${replySenderHtml}</div>
                    <div class="reply-message">${escapeHtml(processedReplyMessage)}</div>
                </div>
                ` : ''}
                <div class="message">${highlightedMessageHtml}</div>
            </div>
        </div></body></html>`;

    // ---PUPPETEER LAUNCH ---
    const AVATAR_WIDTH = 70 * scale;
    const AVATAR_MARGIN_RIGHT = 15 * scale;
    const BUBBLE_PADDING_HORIZONTAL = (25 + 25) * scale; // Left and right padding of the bubble
    const BUBBLE_TAIL_WIDTH = 20 * scale; // Width of the bubble tail (the '::before' element)
    const BODY_PADDING_HORIZONTAL = (30 + 30) * scale; // Left and right padding of the body

    const ESTIMATED_MAX_NAME_WIDTH = DEFAULT_MESSAGE_MAX_WIDTH * 1.5;

    const VIEWPORT_WIDTH = BODY_PADDING_HORIZONTAL + AVATAR_WIDTH + AVATAR_MARGIN_RIGHT + BUBBLE_TAIL_WIDTH + Math.max(ESTIMATED_MAX_NAME_WIDTH, DEFAULT_MESSAGE_MAX_WIDTH + BUBBLE_PADDING_HORIZONTAL) + (50 * scale); // Add extra buffer
    const VIEWPORT_HEIGHT = 1200 * scale; // Default height, will be cropped later

    const browser = await puppeteer.launch({ headless: true, executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox', '--disable-gpu', '--no-proxy-server'] });
    const page = await browser.newPage();
    await page.setViewport({ width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT });
    // Wait until dom is loaded (reverted from networkidle0)
    await page.setContent(htmlContent, { waitUntil: 'domcontentloaded' });

    // *** FIX: Smart function to dynamically set message max-width ***
    await page.evaluate((defaultMessageWidth) => {
        // Measure the whole name line now that it contains images/spans
        const nameWidth = document.querySelector('.name-line')?.scrollWidth || 0;

        const replySenderElement = document.querySelector('.reply-sender');
        const replyWidth = replySenderElement?.scrollWidth || 0;

        // Content width is the wider of the name line or reply sender
        const contentWidth = Math.max(nameWidth, replyWidth);

        // Message max-width is the wider of the content width or the default
        const newMaxWidth = Math.max(contentWidth, defaultMessageWidth);

        const messageElement = document.querySelector('.message');
        if (messageElement) {
            messageElement.style.maxWidth = newMaxWidth + 'px';
        }
    }, DEFAULT_MESSAGE_MAX_WIDTH); // Pass only the default width

    const element = await page.$('#capture');
    const finalPngBuffer = await element.screenshot({ omitBackground: true });
    await browser.close();

    // fs.writeFileSync('temp_quote.png', finalPngBuffer); // De-comment for debugging

    // --- DYNAMIC SIZING WITH INVISIBLE BORDER ---
    const stickerWidth = 2048;

    const scaledPngBuffer = await sharp(finalPngBuffer)
        .resize({ width: stickerWidth, fit: 'inside', withoutEnlargement: true })
        .toBuffer();

    const scaledMetadata = await sharp(scaledPngBuffer).metadata();
    const bubbleWidth = scaledMetadata.width || 0;

    const padding = Math.floor((stickerWidth - bubbleWidth) / 2);

    const webpBuffer = await sharp(scaledPngBuffer)
        .extend({
            top: 0,
            bottom: 0,
            left: padding > 0 ? padding : 0,
            right: padding > 0 ? padding : 0,
            background: { r: 0, g: 0, b: 0, alpha: 0 }
        })
        .webp({ quality: 90 })
        .toBuffer();

    return webpBuffer;
}

module.exports = createImage;