const TelegramBot = require("node-telegram-bot-api");
const mongoose = require("mongoose");
const fetch = require("node-fetch"); // alternative to node-fetch
require('dotenv').config();
const axios = require('axios');
const path = require('path');
const { spawn } = require('child_process');
const userAccountID = process.env.userAccountID;
const { TelegramClient, Api } = require("telegram");
const { StringSession } = require("telegram/sessions");
const https = require('https'); // We will use the built-in https module
const fs = require('fs');
const apiId = 24388624;
const apiHash = "aa6e6675a9a88534f8ded7f318394d5f";
const moment = require('moment-timezone');
// const alexasock2 = require('ws');
const sharp = require('sharp'); // npm install sharp
const createQuoteSticker = require('./generatequote2')
const DB_FILE = path.join(__dirname, 'groups.json');
const { readIds, writeIds, loadIdsToVariable } = require('./idsManager');
let allIds = loadIdsToVariable();
const callToAi = require('./aii.js');

// --- HELPER IMPORTS ---
const helpers = require('./utils/helpers');
const { sendEditCountdown, leaderboardCountdown } = require('./utils/countdown');

// Destructure common helpers for ease of use in index.js
const {
    getMessageType,
    parseFilterTriggers,
    wrapTextSmart,
    getBuffer,
    downloadImage,
    getProfilePhoto,
    checkAdminPermissions: _checkAdminPermissions,
    saveUserMap: _saveUserMap,
    resolveUsername: _resolveUsername,
    getTarget: _getTarget,
    handleAnonymous: _handleAnonymous
} = helpers;

// --- WRAPPER FUNCTIONS (to preserve original signatures) ---
async function checkAdminPermissions(bot, msg) {
    return await _checkAdminPermissions(bot, msg, botOWNER_IDS, BOT_ID);
}

async function saveUserMap(chatId, user) {
    return await _saveUserMap(UserMap, chatId, user);
}

async function resolveUsername(chatId, username) {
    return await _resolveUsername(bot, UserMap, chatId, username);
}

async function getTarget(msg, args) {
    return await _getTarget(bot, UserMap, msg, args);
}

async function handleAnonymous(msg, action, targetId, targetName, extra = "") {
    return await _handleAnonymous(bot, msg, action, targetId, extra);
}
const activeQuizzes = {}; // track per group
const botOWNER_IDS = [7829175087, 1700916606, 8445943463, 7498127359, 7734136119, 8229093349, 8232798620];
let Specialuser = [...botOWNER_IDS, ...allIds]
const noPermissions = {
    can_send_messages: false,
    can_send_audios: false,
    can_send_documents: false,
    can_send_photos: false,
    can_send_videos: false,
    can_send_video_notes: false,
    can_send_voice_notes: false,
    can_send_polls: false,
    can_send_other_messages: false,
    can_add_web_page_previews: false,
    can_change_info: false,
    can_invite_users: false,
    can_pin_messages: false,
};
// const db = require('./db');
const nsfwCommands = [
    "/anal", "/ass", "/boobs", "/gonewild",
    "/hanal", "/hass", "/hboobs", "/hentai",
    "/hkitsune", "/hmidriff", "/hneko", "/hthigh",
    "/neko", "/paizuri", "/pgif", "/pussy",
    "/tentacle", "/thigh", "/yaoi"
];
const userRegistrationState = {};
const FilterManager = require('filtermatics');
function getGreeting() {
    const hour = moment().tz("Asia/Colombo").hour();
    return (hour >= 5 && hour < 12) && "Good Morning ☀️" ||
        (hour >= 12 && hour < 17) && "Good Afternoon ☀️" ||
        (hour >= 17 && hour < 20) && "Good Evening 🌆" ||
        "Good Night 🌙";
}
// 2. Create a single instance and tell it where to save files
// This will create a 'filters' folder in your bot's root directory
const Filters = new FilterManager({
    dbPath: './filters'
});

// START SECONDARY_BOT PROCESS
const secondaryBotProcess = spawn('node', [path.join(__dirname, 'secondary_bot.js')], { stdio: 'inherit' });
secondaryBotProcess.on('error', (err) => {
    console.error('Failed to start secondary_bot.js:', err);
});
secondaryBotProcess.on('exit', (code, signal) => {
    console.log(`Secondary bot process exited with code ${code} and signal ${signal}`);
});
let purgeSessions = {}
// ================== CONFIG ==================
const BOT_TOKEN = process.env.BOT_TOKEN;
const mongouri = process.env.mongouri;

// Setup DB Connections
const db = require('./db/index');
const { Invite, UserMap, BannedUser, NSFWSetting, accceptMap } = db;
db.connectToDatabases();

// --- MODULE INITIALIZATION ---
require('./modules/hangman')(bot, { leaderboardFile: 'leaderboard.json', wordsFile: 'words.txt' });
require('./modules/wordchain')(bot, { dictionaryFile: 'dictionary.txt' });
const quizModule = require('./modules/quiz')(bot, db);
const { startQuiz } = quizModule;

let quizActive = false; // Still used by some global checks?
const LEADERBOARD_FILE = 'leaderboard.json';
const CHAIN_DICTIONARY_FILE = 'dictionary.txt';
const FILE_PATH = 'words.txt';
// ... other constants removed ...
// Game sessions moved to modules/
// purgeSessions, userRegistrationState, Specialuser already defined above.






// Helpers moved to utils/ directory





// Logic moved to utils/ directory









// wrapTextSmart exported to utils/helpers.js

// ================== MONGODB SETUP ==================
// Schemas and connections extracted to db/index.js

// getBuffer exported to utils/helpers.js

// ================== BOT SETUP ==================
// const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const bot = new TelegramBot(BOT_TOKEN, {
    polling: true,
    request: {
        agentOptions: {
            keepAlive: true,
            family: 4 // Forces IPv4 to prevent AggregateError
        }
    }
});
let BOT_ID;
bot.getMe().then(me => {
    BOT_ID = me.id;
    console.log(`Bot initialized. ID: ${BOT_ID}`);
}).catch(err => {
    console.error("CRITICAL: Failed to get bot's own ID.", err);
});

// Utilities moved to utils/ directory


// Quiz logic moved to modules/quiz/index.js

// ================== MESSAGE HANDLER ==================




const START_IMAGE_FILE_ID = 'AgACAgUAAxkDAAIDe2kKsn9Ijyv6SWG4-qVKhBVjV6djAAJUDGsbBrMxVLtQ3xtIwyecAQADAgADdwADNgQ';

// --- MESSAGE CONTENT & KEYBOARDS ---

// 👇 We define the variable here, but it will be filled on startup
let contactKeyboard = null;

// Helper function to get the main start message
const getStartMessage = (senderName) => {
    return `ʜᴇʏ <b>${senderName}</b> , 🥀
๏ ɪ'ᴍ alexa ʜᴇʀᴇ ᴛᴏ ʜᴇʟᴘ ʏᴏᴜ ᴍᴀɴᴀɢᴇ ʏᴏᴜʀ ɢʀᴏᴜᴘs!
ʜɪᴛ ʜᴇʟᴘ ᴛᴏ ғɪɴᴅ ᴏᴜᴛ ᴍᴏʀᴇ ᴀʙᴏᴜᴛ ʜᴏᴡ ᴛᴏ ᴜsᴇ ᴍᴇ ɪɴ ᴍʏ ғᴜʟʟ ᴘᴏᴛᴇɴᴛɪᴀʟ!
➻ ᴛʜᴇ ᴍᴏsᴛ ᴩᴏᴡᴇʀғᴜʟ ᴛᴇʟᴇɢʀᴀᴍ ɢʀᴏᴜᴩ ᴍᴀɴᴀɢᴇᴍᴇɴᴛ ʙᴏᴛ ᴀɴᴅ ɪ ʜᴀᴠᴇ sᴏᴍᴇ ᴀᴡᴇsᴏᴍᴇ , fun ᴀɴᴅ ᴜsᴇғᴜʟ ғᴇᴀᴛᴜʀᴇs.`;
};

// Main start menu keyboard
const startKeyboard = {
    inline_keyboard: [
        [
            { text: 'Contact Us', callback_data: 'contact_us' },
            { text: 'Help & Commands', callback_data: 'help_main' }
        ],
        [
            { text: 'join official channel', url: 'https://t.me/AlexaInc_updates' },
            { text: 'use on whatsapp', url: 'wa.me/+94771058234?text=Hello%2C+I+want+to+talk+to+Alexa' }
        ],
        [
            { text: 'Add me to your group', url: 'https://t.me/alexaIncbot?startgroup=bot_setup' }
        ]
    ]
};

// "Help & Commands" main keyboard
const helpMainKeyboard = {
    inline_keyboard: [
        [{ text: 'Bot Owner Commands', callback_data: 'help_owner' }],
        [{ text: 'Bot Premium Commands', callback_data: 'help_premium' }],
        [{ text: 'NSFW Commands', callback_data: 'help_nsfw' }],
        [{ text: 'Group Admin Commands', callback_data: 'help_admin' }],
        [{ text: 'Other Commands', callback_data: 'help_ai' }],
        [{ text: '🔙 Back', callback_data: 'start_menu' }]
    ]
};

// "Back" keyboard for sub-help menus
const backToHelpKeyboard = {
    inline_keyboard: [
        [{ text: '🔙 Back', callback_data: 'help_main' }]
    ]
};




// index.js

// ... (other code)
// index.js

// bot.onText(/\/settings/, async (msg) => {
//     const chatId = msg.chat.id;

//     if (msg.chat.type !== 'private') {
//         return;
//     }

//     try {
//         const res = await db.query(
//             'SELECT profile_complete FROM users WHERE user_id = $1',
//             [chatId]
//         );

//         if (!res.rows[0] || !res.rows[0].profile_complete) {
//             return bot.sendMessage(chatId, "Please complete your profile first using /start.");
//         }

//         // Send the settings menu
//         bot.sendMessage(chatId, "⚙️ **Profile Settings**\n\nWhat would you like to update?", {
//             parse_mode: 'Markdown',
//             reply_markup: {
//                 inline_keyboard: [
//                     // Profile Updates
//                     [{ text: '📝 Update Bio', callback_data: 'setting_update_bio' }],
//                     [{ text: '🖼️ Update Photo', callback_data: 'setting_update_photo' }],

//                     // Matching Preference Updates
//                     [{ text: '🔎 Seeking Gender/Age', callback_data: 'setting_update_seeking' }],
//                     [{ text: '🗺️ Max Distance', callback_data: 'setting_update_distance' }],

//                     // General Options
//                     [{ text: '❌ Delete Profile', callback_data: 'setting_delete_profile' }],
//                 ]
//             }
//         });

//     } catch (err) {
//         console.error("Database error in /settings:", err);
//         bot.sendMessage(chatId, "An error occurred fetching your settings. Please try again.");
//     }
// });


// Word Chain logic moved to modules/wordchain/index.js
// index.js (Corrected /start handler)

bot.onText(/^\/purgefrom/, async (msg) => { // <-- 1. Added 'async'
    try {
        // --- START PERMISSION CHECK ---
        const permError = await checkAdminPermissions(bot, msg);
        if (permError) {
            bot.sendMessage(msg.chat.id, permError);
            return;
        }
        // --- END PERMISSION CHECK ---

        const chatId = msg.chat.id;
        const userId = msg.from.id;

        // Check if it's a reply
        if (!msg.reply_to_message) {
            bot.sendMessage(chatId, "Usage: Reply to the *first* message you want to delete with /purgefrom.");
            return;
        }

        const fromId = msg.reply_to_message.message_id;

        if (!purgeSessions[chatId]) {
            purgeSessions[chatId] = {};
        }
        purgeSessions[chatId][userId] = { fromId: fromId };

        bot.sendMessage(chatId, `✅ Start message set (ID: ${fromId}).\n\nNow, reply to the *last* message you want to delete with /purgeto.`);
        bot.deleteMessage(chatId, msg.message_id).catch(() => { });

    } catch (error) {
        console.error("Error in /purgefrom:", error);
        bot.sendMessage(msg.chat.id, "An error occurred. Make sure I have permission to delete messages.");
    }
});

// This helper function splits an array into chunks of a specific size
const chunkArray = (array, size) => {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
        chunks.push(array.slice(i, i + size));
    }
    return chunks;
};

// This helper function adds a delay
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

bot.onText(/^\/purgeto/, async (msg) => {
    try {
        // --- START PERMISSION CHECK ---
        const permError = await checkAdminPermissions(bot, msg);
        if (permError) {
            bot.sendMessage(msg.chat.id, permError);
            return;
        }
        // --- END PERMISSION CHECK ---

        const chatId = msg.chat.id;
        const userId = msg.from.id;

        if (!msg.reply_to_message) {
            bot.sendMessage(chatId, "Usage: Reply to the *last* message you want to delete with /purgeto.");
            return;
        }

        if (!purgeSessions[chatId] || !purgeSessions[chatId][userId] || !purgeSessions[chatId][userId].fromId) {
            bot.sendMessage(chatId, "You need to set a start message first. Reply to a message with /purgefrom.");
            return;
        }

        const toId = msg.reply_to_message.message_id;
        const fromId = purgeSessions[chatId][userId].fromId;

        delete purgeSessions[chatId][userId];
        const startId = Math.min(fromId, toId);
        const endId = Math.max(fromId, toId);

        const messageIdsToDelete = [];
        for (let i = startId; i <= endId; i++) {
            messageIdsToDelete.push(i);
        }
        messageIdsToDelete.push(msg.message_id);

        const initialCount = messageIdsToDelete.length;
        bot.sendMessage(chatId, `♻️ Purging ${initialCount} messages...`).then(sentMsg => {
            // Clean up the report message
            setTimeout(() => bot.deleteMessage(chatId, sentMsg.message_id).catch(() => { }), 10000);
        });

        // --- START NEW FAST LOGIC ---

        // 1. Split the IDs into chunks of 100
        const idChunks = chunkArray(messageIdsToDelete, 100);

        let deletedCount = 0;
        let failedCount = 0;

        // 2. Loop through each CHUNK of 100
        for (const chunk of idChunks) {
            try {
                // 3. Delete the entire chunk at once
                await bot.deleteMessages(chatId, chunk);
                deletedCount += chunk.length;
            } catch (err) {
                // 4. Handle errors (rate limits or old messages)
                if (err.response && err.response.statusCode === 429) {
                    // Rate limit error: Wait and retry this chunk
                    const retryAfter = err.response.parameters.retry_after || 1;
                    console.warn(`Rate limit hit. Waiting ${retryAfter} seconds...`);
                    await sleep((retryAfter + 1) * 1000);

                    try {
                        await bot.deleteMessages(chatId, chunk);
                        deletedCount += chunk.length;
                    } catch (retryErr) {
                        console.warn(`Failed to delete chunk after retry:`, retryErr.message);
                        failedCount += chunk.length;
                    }
                } else {
                    // Other error (e.g., "400 Bad Request" if ALL messages in the chunk are old)
                    // We'll just count this whole chunk as failed
                    console.warn(`Failed to delete chunk:`, err.message);
                    failedCount += chunk.length;
                }
            }

            // Add a small 1-second delay between chunks to be safe
            await sleep(1000);
        }
        // --- END NEW FAST LOGIC ---

        // 5. Send final confirmation
        let reportMsg = `✅ Purge complete.\n\n- Successfully deleted: ~${deletedCount}`;
        if (failedCount > 0) {
            reportMsg += `\n- Failed to delete: ~${failedCount} (messages were likely > 48 hours old)`;
        }

        bot.sendMessage(chatId, reportMsg);

    } catch (error) {
        console.error("Error in /purgeto:", error);
        bot.sendMessage(msg.chat.id, "An error occurred during the purge.");
    }
});
bot.onText(/^\/purge/, async (msg) => { // Use $ to match /purge exactly
    if (msg.text.includes('purgeto') || msg.text.includes('purgefrom')) return
    try {
        // 1. Check permissions (uses the function we already built)
        const permError = await checkAdminPermissions(bot, msg);
        if (permError) {
            bot.sendMessage(msg.chat.id, permError);
            return;
        }

        const chatId = msg.chat.id;

        // 2. Check if it's a reply
        if (!msg.reply_to_message) {
            bot.sendMessage(chatId, "Usage: Reply to the message you want to *start* deleting from, and type /purge.");
            return;
        }

        // 3. Get message IDs
        const startId = msg.reply_to_message.message_id;
        const endId = msg.message_id; // The /purge command itself

        // 4. Create list of IDs
        const messageIdsToDelete = [];
        for (let i = startId; i <= endId; i++) {
            messageIdsToDelete.push(i);
        }

        const initialCount = messageIdsToDelete.length;
        if (initialCount <= 1) {
            // Failsafe in case something is wrong
            bot.deleteMessage(chatId, endId).catch(() => { });
            return;
        }

        bot.sendMessage(chatId, `♻️ Purging ${initialCount} messages...`).then(sentMsg => {
            // Clean up the report message
            setTimeout(() => bot.deleteMessage(chatId, sentMsg.message_id).catch(() => { }), 20000);
        });

        // 5. Use the fast chunking logic
        const idChunks = chunkArray(messageIdsToDelete, 100);
        let deletedCount = 0;
        let failedCount = 0;

        for (const chunk of idChunks) {
            try {
                // Delete the entire chunk at once
                await bot.deleteMessages(chatId, chunk);
                deletedCount += chunk.length;
            } catch (err) {
                // Handle rate limits or old messages
                if (err.response && err.response.statusCode === 429) {
                    const retryAfter = err.response.parameters.retry_after || 1;
                    console.warn(`Rate limit hit. Waiting ${retryAfter} seconds...`);
                    await sleep((retryAfter + 1) * 1000);

                    try {
                        await bot.deleteMessages(chatId, chunk);
                        deletedCount += chunk.length;
                    } catch (retryErr) {
                        console.warn(`Failed to delete chunk after retry:`, retryErr.message);
                        failedCount += chunk.length;
                    }
                } else {
                    // "400 Bad Request" (old messages, etc.)
                    console.warn(`Failed to delete chunk:`, err.message);
                    failedCount += chunk.length;
                }
            }
            // Add a small 1-second delay between chunks to be safe
            await sleep(1000);
        }

        // 6. Send final report (and delete it after 10 seconds)
        let reportMsg = `✅ Purge complete.\n\n- Successfully deleted: ~${deletedCount}`;
        if (failedCount > 0) {
            reportMsg += `\n- Failed to delete: ~${failedCount} (messages were likely > 48 hours old)`;
        }

        bot.sendMessage(chatId, reportMsg).then(sentMsg => {
            // Clean up the report message
            setTimeout(() => bot.deleteMessage(chatId, sentMsg.message_id).catch(() => { }), 10000);
        });

    } catch (error) {
        console.error("Error in /purge:", error);
        bot.sendMessage(msg.chat.id, "An error occurred during the purge.");
    }
});












/**
 * Loads the list of group IDs from groups.json
 * @returns {Set<number>} A Set of group chat IDs
 */
function loadGroupIds() {
    try {
        // Check if the file exists
        if (fs.existsSync(DB_FILE)) {
            const data = fs.readFileSync(DB_FILE, 'utf8');
            const ids = JSON.parse(data);
            // Ensure it's an array and convert to a Set
            if (Array.isArray(ids)) {
                console.log(`Loaded ${ids.length} group IDs from ${DB_FILE}`);
                return new Set(ids);
            }
        }
        // File doesn't exist or is empty/corrupt
        console.log(`No valid ${DB_FILE} found. Starting with an empty set.`);
        return new Set();
    } catch (error) {
        console.error(`Error loading ${DB_FILE}: ${error.message}. Starting with an empty set.`);
        return new Set();
    }
}

/**
 * Saves the current list of group IDs to groups.json
 */
function saveGroupIds() {
    try {
        // Convert the Set to an Array for JSON compatibility
        const idsArray = [...groupChatIds];
        // Stringify with pretty-printing (null, 2)
        const data = JSON.stringify(idsArray, null, 2);
        // Write synchronously to the file
        fs.writeFileSync(DB_FILE, data, 'utf8');
        // console.log(`Saved ${idsArray.length} group IDs to ${DB_FILE}`); // Uncomment for debugging
    } catch (error) {
        console.error(`Error saving ${DB_FILE}: ${error.message}`);
    }
}
const userIdsPath = "./users.json";
let userChatIds = new Set();

function saveUserIds() {
    fs.writeFileSync(userIdsPath, JSON.stringify([...userChatIds], null, 2));
}

function loadUserIds() {
    if (fs.existsSync(userIdsPath)) {
        userChatIds = new Set(JSON.parse(fs.readFileSync(userIdsPath)));
    }
}

loadUserIds();


// --- 2. INITIALIZE GROUP SET ---

// Load existing group IDs from the file on startup
const groupChatIds = loadGroupIds();


const aicountFilePath = path.join(__dirname, 'aicount.json');

// Define a default limit (used if file doesn't exist yet)
const DEFAULT_DAILY_LIMIT = 20;

// =================================================================
// 
//  CORE FUNCTIONS (Place these near the top of your file)
// 
// =================================================================

/**
 * (UPDATED Version)
 * Reads the count file, checks/resets daily counts, checks user limit,
 * and increments the count for a specific user.
 *
/**
 * (UPDATED Version)
 * Reads the count file, checks/resets daily counts, checks user limit,
 * and increments the count for a specific user.
 *
 * @param {string|number} userId - The ID of the user to update.
 * @returns {Promise<boolean>} - Returns true if count was incremented, 
 * false if limit was reached.
 */
async function updateUserCount_Optimized(userId) {

    const todayDateString = new Date().toISOString().split('T')[0];

    // Default data structure
    let data = {
        lastResetDate: todayDateString,
        dailyLimit: DEFAULT_DAILY_LIMIT,
        counts: {}
    };

    try {
        // 1. Try to read and parse
        // --- CHANGED HERE ---
        const fileContents = await fsPromises.readFile(aicountFilePath, 'utf8');
        data = JSON.parse(fileContents);

        // 2. Safety checks and migration
        if (typeof data.counts !== 'object' || Array.isArray(data.counts) || !data.lastResetDate) {
            console.warn('aicount.json has invalid structure. Resetting counts.');
            data.counts = {};
        }
        if (typeof data.dailyLimit === 'undefined') {
            console.log('Migrating old aicount.json, adding default dailyLimit.');
            data.dailyLimit = DEFAULT_DAILY_LIMIT;
        }

    } catch (error) {
        if (error.code === 'ENOENT' || error instanceof SyntaxError) {
            console.log('aicount.json not found or corrupt. Creating new file.');
        } else {
            console.error('Error reading aicount.json:', error);
            return false;
        }
    }

    // 3. Check for Daily Reset
    if (data.lastResetDate !== todayDateString) {
        console.log(`New day detected. Resetting all user counts.`);
        data.counts = {};
        data.lastResetDate = todayDateString;
    }

    // 4. Check Usage Limit
    const currentCount = data.counts[userId] || 0;
    const currentLimit = data.dailyLimit;

    if (currentCount >= currentLimit) {
        console.log(`User ${userId} limit reached (${currentLimit}). Try tomorrow or contact owner.`);
        // Write file back (in case date was reset) but return false
        // --- CHANGED HERE ---
        await fsPromises.writeFile(aicountFilePath, JSON.stringify(data, null, 2), 'utf8');
        return false;
    }

    // 5. Increment and Write
    data.counts[userId] = currentCount + 1;

    try {
        // --- CHANGED HERE ---
        await fsPromises.writeFile(aicountFilePath, JSON.stringify(data, null, 2), 'utf8');
        console.log(`Successfully updated count for user ${userId}. New count: ${data.counts[userId]}`);
        return true;

    } catch (error) {
        console.error('Error writing to aicount.json:', error);
        return false;
    }
}

/**
 * (UPDATED Version - Read-Only)
 * Checks the current usage count and daily limit for a user.
 *
 * @param {string|number} userId - The ID of the user to check.
 * @returns {Promise<{currentCount: number, dailyLimit: number}>}
 */
async function checkUserCount(userId) {

    const todayDateString = new Date().toISOString().split('T')[0];

    try {
        // 1. Try to read and parse
        // --- CHANGED HERE ---
        const fileContents = await fsPromises.readFile(aicountFilePath, 'utf8');
        const data = JSON.parse(fileContents);

        // Get the limit, or use default if missing
        const dailyLimit = data.dailyLimit || DEFAULT_DAILY_LIMIT;

        // 2. Check if data is for today
        if (data.lastResetDate !== todayDateString) {
            return { currentCount: 0, dailyLimit: dailyLimit }; // Counts are old
        }

        // 3. Return today's count and limit
        const currentCount = data.counts[userId] || 0;
        return { currentCount: currentCount, dailyLimit: dailyLimit };

    } catch (error) {
        // 4. Handle errors
        if (error.code === 'ENOENT' || error instanceof SyntaxError) {
            // File not found, return defaults
            return { currentCount: 0, dailyLimit: DEFAULT_DAILY_LIMIT };
        } else {
            console.error('Error reading aicount.json for check:', error);
            throw new Error('Could not check user count.');
        }
    }
}



// bot.onText(/\/dating/, async (msg) => {
//     const chatId = msg.chat.id;

//     if (msg.chat.type !== 'private') {
//         return;
//     }

//     // ⭐️ FIX: Declare userRecord outside the try block
//     let userRecord = null; 

//     try {
//         const res = await db.query(
//             'SELECT profile_complete FROM users WHERE user_id = $1',
//             [chatId]
//         );

//         userRecord = res.rows[0]; // Assign value to the outer scope variable

//         if (userRecord && userRecord.profile_complete === true) {
//             return bot.sendMessage(
//                 chatId,
//                 "You already have a complete profile! Send /find to check out matches or /settings to update your preferences."
//             );
//         }

//         // Removed redundant message sending from the original logic here
//         // The final prompt is handled below based on the userRecord state.

//     } catch (err) {
//         console.error("Database error during /start check:", err);
//         return bot.sendMessage(chatId, "An error occurred while checking your profile status. Please try again.");
//     }

//     // 3. Initialize/Resume Registration State and send the prompt

//     // Determine the starting step for registration/resume
//     let initialStep = 'awaiting_name'; 
//     let initialPrompt = "Hi! Welcome to the Dating Bot. Let's create your profile.\n\nWhat's your first name?";

//     if (userRecord && userRecord.profile_complete === false) {
//         // Assuming 'awaiting_gender' is the next logical step if they failed to finish
//         initialStep = 'awaiting_gender'; 
//         initialPrompt = "Welcome back! It looks like you didn't finish your profile. Let's start with your gender.";
//     }

//     userRegistrationState[chatId] = {
//         step: initialStep, 
//         profile: {},
//     };

//     bot.sendMessage(chatId, initialPrompt);
// });


bot.onText(/\/start/, (msg) => {
    if (msg.text !== "/start" && msg.text !== "/start@alexaIncbot") return;

    if (msg.text.includes('starthang')) return;
    const chatId = msg.chat.id;
    const senderName = msg.from.first_name || 'User';
    const caption = getStartMessage(senderName);

    bot.sendPhoto(chatId, START_IMAGE_FILE_ID, {
        caption: caption,
        parse_mode: 'HTML',
        reply_markup: startKeyboard
    }).catch((err) => {
        console.error("Error sending /start photo. Is the file_id correct?", err.message);
        bot.sendMessage(chatId, caption, {
            parse_mode: 'HTML',
            reply_markup: startKeyboard
        });
    });
});





// Hangman commands moved to modules/hangman/index.js


// Leaderboard command moved to modules/hangman/index.js











bot.on("message", async (msg) => {
    const me = await bot.getMe();
    botId = me.id;
    const chatId = msg.chat.id.toString();

    const userId = msg.from.id;
    const userState = userRegistrationState[chatId];
    // Use the local variable you defined for text safely
    const text = msg.text || ''; // Ensure it's an empty string if undefined for safety
    const isbotOwner = botOWNER_IDS.includes(msg.from.id);
    const isspecial = Specialuser.includes(msg.from.id)

    // Log the current state (this line works, so we keep it before the problematic code)
    //console.log(`[DEBUG] Received message from ${chatId}. Current state: ${userState ? userState.step : 'NONE'}`);

    // ⭐️ ADD A CONCISE MESSAGE LOG HERE (less prone to blocking)
    //   if (msg.text) {
    //       console.log(`[DEBUG] Message Text: ${msg.text}`);
    //   } else if (msg.photo) {
    //       console.log(`[DEBUG] Message Type: Photo`);
    //   } else if (msg.location) {
    //       console.log(`[DEBUG] Message Type: Location`);
    //   }



    try {

        let command = (msg.text || '').toLowerCase().split(' ')[0];
        let fullText = msg.text || "";


        // Remove bot username if present
        if (command.includes("@")) {

            const parts = command.split("@");
            command = parts[0];
            // if not for this bot → stop
            if (parts[1].toLowerCase() !== me.username.toLowerCase()) return;

        }
        const args = fullText.substring(fullText.indexOf(" ") + 1).trim().split(" ").filter(v => v);

        //const text = msg.text || '';


        // Game guesses (Hangman & Word Chain) moved to respective modules

        if (command === '/ai') {

            // Helper function to get text after the command
            function getArguments(command) {
                const firstSpaceIndex = command.indexOf(' ');
                if (firstSpaceIndex === -1) {
                    return '';
                }
                return command.substring(firstSpaceIndex + 1);
            }

            // Get the user's prompt
            const usermsg = getArguments(msg.text);
            if (!usermsg && !isspecial) {
                bot.sendMessage(msg.chat.id, "Please provide a prompt. \nExample: `/ai What is a bot?`", { reply_to_message_id: msg.message_id, parse_mode: 'Markdown' });
                return;
            }

            // Get your unique ID logic
            let uid;
            if (msg.chat.id == msg.from.id) {
                uid = msg.chat.id; // Private chat
            } else {
                uid = msg.chat.id + '@' + msg.from.id; // Group chat
            }

            // 1. Handle Special Users (Bypass Limit)
            if (isspecial) {
                console.log(`Special user ${uid} used /ai. Bypassing limit.`);

                // Proceed directly to AI call
                const aimsg = await callToAi(usermsg, uid);
                bot.sendMessage(msg.chat.id, aimsg, { reply_to_message_id: msg.message_id });

                // --- Placeholder for testing ---
                // bot.sendMessage(msg.chat.id, "AI response (special user)", { reply_to_message_id: msg.message_id });

            } else {

                // 2. Handle Regular Users (Check Limit)
                console.log(`User ${uid} used /ai. Checking limit...`);

                // Await the function to check/update the count
                const countWasIncremented = await updateUserCount_Optimized(uid);

                // 3. Check the Result
                if (countWasIncremented) {
                    // Limit OK. Proceed with AI call.
                    console.log(`Limit OK. Running AI for user ${uid}.`);

                    const aimsg = await callToAi(usermsg, uid);
                    bot.sendMessage(msg.chat.id, aimsg, { reply_to_message_id: msg.message_id });

                    // --- Placeholder for testing ---
                    // bot.sendMessage(msg.chat.id, "AI response (regular user)", { reply_to_message_id: msg.message_id });

                } else {
                    // Limit was reached. Do NOT call the AI.
                    bot.sendMessage(
                        msg.chat.id,
                        "Your daily AI limit has been reached. Please try again tomorrow or contact the owner.",
                        { reply_to_message_id: msg.message_id }
                    );
                }
            }
        }


        // ---------------------------------
        //  COMMAND: /aic (Check count)
        // ---------------------------------
        if (command === '/aic') {

            let uid;
            if (msg.chat.id == msg.from.id) {
                uid = msg.chat.id;
            } else {
                uid = msg.chat.id + '@' + msg.from.id;
            }

            try {
                if (isspecial) {
                    // 1. Handle Special Users
                    bot.sendMessage(
                        msg.chat.id,
                        "you can use unlimited baby because you are a special user 💖",
                        { reply_to_message_id: msg.message_id }
                    );

                } else {
                    // 2. Handle Regular Users

                    // Call the read-only function
                    const { currentCount, dailyLimit } = await checkUserCount(uid);

                    const remainingCount = Math.max(0, dailyLimit - currentCount);

                    // Send the count message
                    bot.sendMessage(
                        msg.chat.id,
                        `You have **${remainingCount} / ${dailyLimit}** AI uses left for today.`,
                        {
                            reply_to_message_id: msg.message_id,
                            parse_mode: 'Markdown' // To make the count bold
                        }
                    );
                }
            } catch (error) {
                // This catches errors from checkUserCount
                console.error("Failed to handle /aic command:", error);
                bot.sendMessage(
                    msg.chat.id,
                    "Sorry, I couldn't check your count right now.",
                    { reply_to_message_id: msg.message_id }
                );
            }
        }


        // ---------------------------------
        //  COMMAND: /uail (Update AI Limit)
        // ---------------------------------
        if (command === '/uail') {

            // 1. Check if user is the bot owner
            if (!isbotOwner) {
                bot.sendMessage(
                    msg.chat.id,
                    "Sorry, this command is for the bot owner only.",
                    { reply_to_message_id: msg.message_id }
                );
                return; // Stop execution
            }

            // 2. Get the argument (the new limit number)
            const args = msg.text.split(' ')[1];
            const newLimit = parseInt(args, 10);

            // 3. Validate the input
            if (isNaN(newLimit) || newLimit <= 0) {
                bot.sendMessage(
                    msg.chat.id,
                    "Please provide a valid number. \nExample: `/uail 30`",
                    { reply_to_message_id: msg.message_id }
                );
                return;
            }

            // 4. Read, Modify, and Write the file
            let data;
            const todayDateString = new Date().toISOString().split('T')[0];

            try {
                // Try to read existing data
                const fileContents = await fsPromises.readFile(aicountFilePath, 'utf8');
                data = JSON.parse(fileContents);
            } catch (error) {
                // File not found or corrupt, create a new structure
                console.log('aicount.json not found or corrupt, creating for /uail');
                data = {
                    lastResetDate: todayDateString,
                    dailyLimit: DEFAULT_DAILY_LIMIT,
                    counts: {}
                };
            }

            // 5. Update the limit
            data.dailyLimit = newLimit;

            // 6. Write back to file
            try {
                await fsPromises.writeFile(aicountFilePath, JSON.stringify(data, null, 2), 'utf8');
                bot.sendMessage(
                    msg.chat.id,
                    `✅ Success! The daily AI limit is now set to **${newLimit}**.`,
                    {
                        reply_to_message_id: msg.message_id,
                        parse_mode: 'Markdown'
                    }
                );
            } catch (writeError) {
                console.error("Error writing updated limit:", writeError);
                bot.sendMessage(
                    msg.chat.id,
                    "An error occurred while writing the new limit.",
                    { reply_to_message_id: msg.message_id }
                );
            }
        }

        if (msg.text === "/setquiz" || msg.text === "!setquiz") {
            const secondaryBotUsername = process.env.SECONDARY_BOT_USERNAME;
            return bot.sendMessage(chatId, "Want to create your own quiz? Click the button below to go to our Quiz Builder bot!", {
                reply_markup: {
                    inline_keyboard: [[
                        { text: "🛠 Create Quiz", url: `https://t.me/${secondaryBotUsername}?start=setquiz` }
                    ]]
                }
            });
        }

        if (text.startsWith('/fq')) {
            // This assumes 'isbotOwner' is defined elsewhere in your code.
            if (!isspecial) return await bot.sendMessage(msg.chat.id, 'you are not a special user');

            // Helper function to validate the JSON structure
            const hasRequiredJson = (jsonString) => {
                if (!jsonString) return false;
                try {
                    const data = JSON.parse(jsonString);
                    return (
                        typeof data === 'object' && data !== null &&
                        Number.isInteger(data.sender) &&
                        typeof data.massage === 'string' &&
                        Number.isInteger(data.rsender) &&
                        typeof data.rmassage === 'string'
                    );
                } catch (error) {
                    return false;
                }
            };
            try {
                await bot.deleteMessage(msg.chat.id, msg.message_id)
            } catch (error) {

            }
            const isReply = !!msg.reply_to_message;
            const contentAfterCommand = text.replace(/^\/fq\s*/, '').trim();
            const hasValidPayload = hasRequiredJson(contentAfterCommand);

            if (isReply && contentAfterCommand === "") {
                return await bot.sendMessage(msg.chat.id, 'plase send text after /fq ex:- /fq hello world');
            }

            // If it's NOT a reply, it MUST have the JSON data.
            if (!isReply && !hasValidPayload) {
                // CORRECTED: Formatted the error message to be much cleaner using Markdown.
                const exampleJson = `{
  "sender": 8409611364,
  "massage": "test",
  "rsender": 8358822568,
  "rmassage": "test"
}`
                const errorMessage = `The /fq command requires you to either reply to a message or include valid JSON data\\.\n\n*Example:* \n\`\`\`text\n${exampleJson}\n\`\`\``;
                return await bot.sendMessage(msg.chat.id, errorMessage, { parse_mode: 'MarkdownV2' });
            }

            // Define variables
            let firstName, lastName, msgtextt, replysender, replycontent, replysendercolor, chat, userphotourl;

            try {
                if (hasValidPayload) {
                    const massagejson = JSON.parse(contentAfterCommand);
                    chat = await bot.getChat(massagejson.sender);
                    const rchat = await bot.getChat(massagejson.rsender);

                    firstName = chat.first_name || '';
                    lastName = chat.last_name || '';
                    replysendercolor = rchat.accent_color_id || 3;
                    msgtextt = massagejson.massage;
                    replysender = (rchat.first_name || '') + ' ' + (rchat.last_name || '');
                    replycontent = massagejson.rmassage;
                    userphotourl = await getProfilePhoto(bot, massagejson.sender);

                } else if (isReply) {
                    const reply = msg.reply_to_message.from;
                    chat = await bot.getChat(reply.id);

                    firstName = reply.first_name || '';
                    lastName = reply.last_name || '';
                    replycontent = null;
                    replysender = null;
                    replysendercolor = null;
                    userphotourl = await getProfilePhoto(bot, reply.id);
                    msgtextt = contentAfterCommand;
                }

                if (!isbotOwner && botOWNER_IDS.includes(msg.reply_to_message.from.id || massagejson.rsender)) return bot.sendMessage(msg.chat.id, 'You can\'t create sticker for the bot owner')

                // --- CORRECTED LOGIC FOR HANDLING NO PROFILE PHOTO ---
                let userphoto = null; // 1. Default the userphoto to null.
                if (userphotourl) {
                    // 2. Only try to download the image if a URL was returned.
                    userphoto = await downloadImage(userphotourl);
                }
                // --- END OF CORRECTION ---

                const emojiStatusId = chat.emoji_status_custom_emoji_id || null;
                const colorId = chat.accent_color_id;



                // 'userphoto' will now be either an image Buffer or null
                const stickerBuffer = await createQuoteSticker(
                    firstName, lastName, emojiStatusId, msgtextt,
                    colorId, userphoto, replysender, replycontent, replysendercolor
                );

                if (!stickerBuffer) {
                    throw new Error("Sticker generation failed and returned an empty buffer.");
                }

                const fileOptions = {
                    filename: 'quote_sticker.webp',
                    contentType: 'image/webp'
                };

                try {
                    // console.log('Sending sticker file directly...');

                    // You still need fileOptions to tell Telegram it's a PNG/WEBP


                    // Step 1: Send the sticker using the buffer directly.
                    // DO NOT use uploadStickerFile.
                    await bot.sendSticker(
                        msg.chat.id,
                        stickerBuffer, // <-- Pass the buffer itself
                        {
                            // Pass reply options in the third argument
                            reply_to_message_id: msg.reply_to_message?.message_id,
                        },
                        fileOptions // <-- Pass fileOptions as the fourth argument
                    );

                    // console.log('Sticker sent successfully!');

                } catch (error) {
                    // Log the full error for debugging
                    console.error(
                        'Failed to send sticker:',
                        error.response ? error.response.body : error.message
                    );

                    // Send a user-friendly error message
                    if (error.response) {
                        console.log(
                            msg.chat.id,
                            `Error: ${error.response.body.description}`
                        );
                    } else {
                        console.log(msg.chat.id, 'An unknown error occurred.');
                    }
                }

                // try {
                //     await bot.sendSticker(msg.chat.id, stickerBuffer, { reply_to_message_id: msg.reply_to_message?.message_id }, fileOptions);
                //     console.log('Sticker sent successfully!');
                // } catch (error) {
                //     console.error('Error sending sticker:', error.response ? error.response.body : error);
                // }

            } catch (err) {
                console.error('Error generating sticker:', err);
                await bot.sendMessage(msg.chat.id, 'Sorry, an error occurred while creating your sticker.');
            }
        }

        if (msg.chat.type === "private") {

            //console.log(msg) // Keep this for debugging the full message object!

            // If the user is not in the registration process, ignore.
            if (!userState) {

                // 1. If it's a command (like /start, /find), let other listeners handle it
                if (text && text.startsWith('/')) {
                    return;
                }

                // 2. If it's *any other message* (text, photo, location, etc.) 
                //    and they aren't in a state, inform them and RETURN.
                bot.sendMessage(chatId, "Please send /start to begin.");
                return;
            }

            // This switch statement acts as our "Scene" or "Conversation" manager

            switch (userState.step) {
                case 'awaiting_name':
                    // Ignore if it's a command
                    if (text.startsWith('/')) return;

                    userState.profile.name = text;
                    userState.step = 'awaiting_gender';
                    bot.sendMessage(chatId, "Great. What's your gender?", {
                        reply_markup: {
                            keyboard: [['Male', 'Female', 'Other']],
                            one_time_keyboard: true,
                            resize_keyboard: true,
                        },
                    });
                    break;

                case 'awaiting_gender':
                    if (!['Male', 'Female', 'Other'].includes(text)) {
                        return bot.sendMessage(chatId, 'Please select a gender from the keyboard.');
                    }
                    userState.profile.gender = text;
                    userState.step = 'awaiting_age';
                    bot.sendMessage(chatId, 'How old are you? (Please send just the number)', {
                        reply_markup: {
                            remove_keyboard: true,
                        },
                    });
                    break;

                case 'awaiting_age':
                    const parsedAge = parseInt(text, 10);
                    if (isNaN(parsedAge) || parsedAge < 18) {
                        return bot.sendMessage(chatId, 'Please send a valid age (18 or older).');
                    }
                    userState.profile.age = parsedAge;
                    userState.step = 'awaiting_photo';
                    bot.sendMessage(chatId, 'Awesome. Now, please send a photo for your profile.');
                    break;

                case 'awaiting_photo':
                    console.log('[DEBUG] --- START AWAITING_PHOTO CASE ---');
                    let photoFileId;

                    // 1. Check for standard Photo array
                    if (msg.photo && msg.photo.length > 0) {
                        photoFileId = msg.photo[msg.photo.length - 1].file_id;
                        console.log('[DEBUG] Detected as standard Photo.');

                        // 2. Check for Document (sent as a file)
                    } else if (msg.document && msg.document.mime_type && msg.document.mime_type.startsWith('image/')) {
                        photoFileId = msg.document.file_id;
                        console.log('[DEBUG] Detected as image Document.');

                    } else {
                        // Message is not a photo/image
                        console.log('[DEBUG] Message is NOT a valid image. Reprompting.');
                        return bot.sendMessage(chatId, 'That\'s not a valid image. Please send a photo directly or as a file.');
                    }

                    userState.profile.photo_id = photoFileId;
                    userState.step = 'awaiting_location';

                    bot.sendMessage(chatId, 'Nice photo! Now, please share your location so we can find matches near you.', {
                        reply_markup: {
                            keyboard: [
                                [{ text: 'Share My Location', request_location: true }]
                            ],
                            one_time_keyboard: true,
                            resize_keyboard: true,
                        },
                    });
                    console.log('[DEBUG] --- END AWAITING_PHOTO CASE (Success) ---');
                    break;

                case 'awaiting_location':
                    if (!msg.location) {
                        return bot.sendMessage(chatId, 'Please use the button to share your location.');
                    }
                    userState.profile.latitude = msg.location.latitude;
                    userState.profile.longitude = msg.location.longitude;
                    userState.step = 'awaiting_bio';
                    bot.sendMessage(chatId, 'Got it. Finally, write a short bio about yourself.', {
                        reply_markup: {
                            remove_keyboard: true,
                        },
                    });
                    break;

                case 'awaiting_bio':
                    userState.profile.bio = text;
                    userState.step = 'saving'; // Move to a final step

                    // --- Save to Database ---
                    const user_id = msg.from.id;
                    const { name, gender, age, photo_id, latitude, longitude, bio } = userState.profile;

                    const queryText = `
            INSERT INTO users (
                user_id, first_name, gender, age, profile_photo_file_id, 
                latitude, longitude, bio, profile_complete,
                location_geom
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, ST_SetSRID(ST_MakePoint($10, $11), 4326))
            ON CONFLICT (user_id) DO UPDATE SET
                first_name = EXCLUDED.first_name,
                gender = EXCLUDED.gender,
                age = EXCLUDED.age,
                profile_photo_file_id = EXCLUDED.profile_photo_file_id,
                latitude = EXCLUDED.latitude,
                longitude = EXCLUDED.longitude,
                bio = EXCLUDED.bio,
                profile_complete = EXCLUDED.profile_complete,
                location_geom = EXCLUDED.location_geom;
        `;

                    try {
                        await db.query(queryText, [
                            user_id, name, gender, age, photo_id,
                            latitude, longitude, bio, true,
                            longitude, latitude // Note: ST_MakePoint is (long, lat)
                        ]);

                        bot.sendMessage(chatId, "Your profile is complete! Send /find to start matching.");
                        delete userRegistrationState[chatId];
                    } catch (err) {
                        console.error("Database error in registration:", err);
                        bot.sendMessage(chatId, "Something went wrong saving your profile. Please try /start again.");
                        delete userRegistrationState[chatId];
                    }
                    break;
                case 'awaiting_update_bio':
                    await db.query('UPDATE users SET bio = $1 WHERE user_id = $2', [text, chatId]);
                    bot.sendMessage(chatId, "✅ Bio successfully updated! Send /find to check out profiles.");
                    delete userRegistrationState[chatId];
                    break;

                case 'awaiting_update_photo':
                    let updatePhotoId;

                    // Robust check for photo/document
                    if (msg.photo && msg.photo.length > 0) {
                        updatePhotoId = msg.photo[msg.photo.length - 1].file_id;
                    } else if (msg.document && msg.document.mime_type && msg.document.mime_type.startsWith('image/')) {
                        updatePhotoId = msg.document.file_id;
                    } else {
                        return bot.sendMessage(chatId, 'That\'s not a valid photo. Please send an image file.');
                    }

                    await db.query('UPDATE users SET profile_photo_file_id = $1 WHERE user_id = $2', [updatePhotoId, chatId]);
                    bot.sendMessage(chatId, "✅ Profile photo updated!");
                    delete userRegistrationState[chatId];
                    break;

                case 'awaiting_update_distance':
                    const distance = parseInt(text, 10);
                    if (isNaN(distance) || distance < 1 || distance > 500) {
                        return bot.sendMessage(chatId, 'Please enter a valid number between 1 and 500 for the distance.');
                    }
                    await db.query('UPDATE users SET seeking_max_distance_km = $1 WHERE user_id = $2', [distance, chatId]);
                    bot.sendMessage(chatId, `✅ Max search distance set to ${distance} km.`);
                    delete userRegistrationState[chatId];
                    break;

                case 'awaiting_update_seeking_gender':
                    if (!['Male', 'Female', 'Other'].includes(text)) {
                        return bot.sendMessage(chatId, 'Please select a gender from the keyboard.');
                    }
                    await db.query('UPDATE users SET seeking_gender = $1 WHERE user_id = $2', [text, chatId]);
                    bot.sendMessage(chatId, `✅ Seeking preference updated to ${text}.`);
                    delete userRegistrationState[chatId];
                    break;

                // Add a 'default' case to handle unexpected inputs
                default:
                    // You can simply ignore or inform the user
                    // console.log(`[DEBUG] Unhandled state: ${userState.step}`);
                    break;
            }



        }

        // =================================================================
        // ⭐️ FIX: Stop processing if it was a private message
        // This prevents group-only logic from running in a private chat
        // =================================================================
        if (msg.chat.type === "private") {
            if (!userChatIds.has(msg.chat.id)) {
                userChatIds.add(msg.chat.id);
                saveUserIds();
            }
            return;
        }

        if (!groupChatIds.has(msg.chat.id)) {
            console.log(`Discovered new group: ${msg.chat.title} (${msg.chat.id})`);
            groupChatIds.add(msg.chat.id);
            saveGroupIds(); // Save the updated list to file
        }

        await saveUserMap(chatId, msg.from);

        const member = await bot.getChatMember(chatId, userId);
        const isAdmin = ["administrator", "creator"].includes(member.status) || botOWNER_IDS.includes(userId);

        // ====== START QUIZ ======
        // ====== START QUIZ ======



        switch (command) {
            case '/nsfw': {
                const nsfwMenu = `
🔞 *NSFW Commands:*
${nsfwCommands.join("\n")}
`;
                bot.sendMessage(chatId, nsfwMenu, { parse_mode: 'Markdown' });
                break;
            }

            case '/nsfwon':
            case '/nsfwoff': {
                // Only admins can change
                const member = await bot.getChatMember(chatId, userId);
                const isbotOwner = botOWNER_IDS.includes(msg.from.id)
                const isAdmin = ["administrator", "creator"].includes(member.status);
                if (!isAdmin && !isbotOwner) return bot.sendMessage(chatId, "❌ Only admins can toggle NSFW.");

                const enable = command === '/nsfwon';
                await NSFWSetting.updateOne(
                    { groupId: chatId },
                    { enabled: enable },
                    { upsert: true }
                );

                return bot.sendMessage(chatId, `🔞 NSFW commands are now *${enable ? "ENABLED" : "DISABLED"}*`, { parse_mode: 'Markdown' });
                break
            }

            // case '/accepton':
            // case '/acceptoff': {
            //   console.log('a')
            //     const member = await bot.getChatMember(chatId, userId);
            //     const isAdmin = ["administrator", "creator"].includes(member.status);

            //     if (!isAdmin && !isbotOwner) {
            //         return bot.sendMessage(chatId, "❌ Only admins can toggle acceptmode.");
            //     }

            //     // -------------------------
            //     // Detect enable or disable
            //     // -------------------------
            //     const enable = command.startsWith('/accepton');
            // console.log(enable)
            //     // -------------------------
            //     // Extract count number
            //     // Example:
            //     // /accepton 7  → acceptcount = 7
            //     // /accepton     → acceptcount = 5
            //     // /acceptoff    → acceptcount = 0
            //     // -------------------------
            //     let acceptcount = 5; // default

            //     if (enable) {

            //         const parts = commandText.split(" ").filter(v => v.trim());
            //         if (parts[1] && !isNaN(parts[1])) {
            //             acceptcount = Number(parts[1]);
            //         }
            //     } else {
            //         acceptcount = 0;
            //     }
            // console.log(acc)
            //     // -------------------------
            //     // Save to DB
            //     // -------------------------
            //     await accceptMap.updateOne(
            //         { groupId: chatId },
            //         {
            //             $set: {
            //                 enabled: enable,
            //                 count: acceptcount
            //             }
            //         },
            //         { upsert: true }
            //     );

            //     return bot.sendMessage(
            //         chatId,
            //         `Accept mode is now *${enable ? "ENABLED" : "DISABLED"}*.\nCount: *${acceptcount}*`,
            //         { parse_mode: "Markdown" }
            //     );
            // }


            default: {
                // Check if the message is an NSFW command
                if (nsfwCommands.includes(command)) {
                    const nsfwSetting = await NSFWSetting.findOne({ groupId: chatId });
                    const nsfwEnabled = nsfwSetting ? nsfwSetting.enabled : false;

                    if (!nsfwEnabled) {
                        return bot.sendMessage(chatId, "❌ NSFW commands are currently disabled in this group.");
                    }

                    try {
                        const category = command.slice(1); // remove leading slash
                        const response = await axios.get(`https://api.night-api.com/images/nsfw/${category}`, {
                            headers: { authorization: process.env.NIGHTAPI_AUTH }
                        });

                        const imageUrl = response.data.content.url_full || response.data.content.url;
                        if (!imageUrl) return bot.sendMessage(chatId, "Couldn't fetch the image.");

                        const buffer = await getBuffer(imageUrl);
                        if (!buffer) return bot.sendMessage(chatId, "Error downloading the file.");

                        const ext = path.extname(imageUrl).toLowerCase();

                        if (ext === '.gif') await bot.sendAnimation(chatId, buffer, { caption: category });
                        else if (['.jpg', '.jpeg', '.png'].includes(ext)) {
                            await bot.sendDocument(chatId, buffer, {
                                caption: category,
                                filename: 'image' + ext,
                                contentType: ext === '.png' ? 'image/png' : 'image/jpeg'
                            });
                        } else if (['.mp4', '.webm'].includes(ext)) await bot.sendVideo(chatId, buffer, { caption: category });
                        else await bot.sendMessage(chatId, "The file type is not supported.");
                    } catch (err) {
                        console.error("Error fetching NSFW content:", err);
                        return bot.sendMessage(chatId, "Can't send now, I will send later.");
                    }
                }
                break;
            }
        }


        if (command === "/accepton") {

            const member = await bot.getChatMember(chatId, userId);
            const isAdmin = ["administrator", "creator"].includes(member.status);

            if (!isAdmin && !isbotOwner) {
                return bot.sendMessage(chatId, "❌ Only admins can enable accept mode.");
            }

            // Default count = 5
            let acceptcount = 5;
            if (args[0] && !isNaN(args[0])) {
                acceptcount = Number(args[0]);
            }

            // Save to DB
            await accceptMap.updateOne(
                { groupId: chatId },
                { $set: { enabled: true, count: acceptcount } },
                { upsert: true }
            );

            return bot.sendMessage(
                chatId,
                `✅ Accept mode ENABLED.\nRequired invites: *${acceptcount}*`,
                { parse_mode: "Markdown" }
            );
        }

        // -------------------------
        // ACCEPTOFF
        // -------------------------
        if (command === "/acceptoff") {

            const member = await bot.getChatMember(chatId, userId);
            const isAdmin = ["administrator", "creator"].includes(member.status);

            if (!isAdmin && !isbotOwner) {
                return bot.sendMessage(chatId, "❌ Only admins can disable accept mode.");
            }

            // Disable accept mode
            await accceptMap.updateOne(
                { groupId: chatId },
                { $set: { enabled: false, count: 0 } },
                { upsert: true }
            );

            return bot.sendMessage(
                chatId,
                `🛑 Accept mode DISABLED`,
                { parse_mode: "Markdown" }
            );
        }
        if (command === '/addspecial') {
            if (!msg.reply_to_message)
                return bot.sendMessage(
                    msg.chat.id,
                    'Please reply to the user you want to add as special',
                    { reply_to_message_id: msg.message_id }
                );

            const useridd = msg.reply_to_message.from.id;

            // Add user
            if (allIds.includes(useridd)) return await bot.sendMessage(
                msg.chat.id,
                `[${msg.reply_to_message.from.first_name}](tg://user?id=${useridd}) is already a special user`,
                { parse_mode: "Markdown" }
            );
            allIds.push(useridd)
            writeIds(allIds);

            // Create Set properly
            Specialuser = [...allIds, ...botOWNER_IDS];

            await bot.sendMessage(
                msg.chat.id,
                `[${msg.reply_to_message.from.first_name}](tg://user?id=${useridd}) is now a special user`,
                { parse_mode: "Markdown" }
            );
        }

        if (command === '/remspecial') {
            if (!msg.reply_to_message)
                return bot.sendMessage(
                    msg.chat.id,
                    'Please reply to the user you want to remove from special',
                    { reply_to_message_id: msg.message_id }
                );

            const useridd = msg.reply_to_message.from.id;

            // Remove user
            allIds = allIds.filter(id => id !== useridd);
            writeIds(allIds);

            // Update Set
            Specialuser = [...allIds, ...botOWNER_IDS];

            await bot.sendMessage(
                msg.chat.id,
                `[${msg.reply_to_message.from.first_name}](tg://user?id=${useridd}) is no longer a special user`,
                { parse_mode: "Markdown" }
            );
        }





        if (command === '/sweep') {
            const chatId = msg.chat.id;
            const senderId = msg.from.id;
            let client;

            try {
                // 1. PERMISSION CHECKS
                const caller = await bot.getChatMember(chatId, senderId);
                if (caller.status !== 'creator' && !isbotOwner) {
                    return bot.sendMessage(chatId, "❌ Only the Creator can trigger a full sweep.");
                }

                // 2. INITIALIZE CLIENT
                const sessionData = fs.readFileSync("session.txt", "utf8").trim();
                client = new TelegramClient(new StringSession(sessionData), apiId, apiHash, {
                    connectionRetries: 3,
                    receiveUpdates: false, // Critical to stop TIMEOUT logs
                    autoReconnect: false,
                });

                // Start connection
                await client.connect();
                let wasAlreadyMember = true;
                let entity;

                // 3. RESOLVE CHAT
                try {
                    console.log(`[Sweep] Attempting to get entity for chatId: ${chatId} (${typeof chatId})`);
                    entity = await client.getEntity(chatId);
                    console.log(`[Sweep] Successfully got entity for ${chatId}`);
                } catch (e) {
                    wasAlreadyMember = false;
                    console.log(`[Sweep] Assistant not in chat ${chatId} or entity resolution failed: ${e.message}`);

                    let inviteLink;
                    try {
                        console.log(`[Sweep] Attempting to export fresh invite link for ${chatId}...`);
                        inviteLink = await bot.exportChatInviteLink(chatId);
                        console.log(`[Sweep] Exported invite link: ${inviteLink}`);
                    } catch (exportErr) {
                        console.warn(`[Sweep] Failed to export invite link: ${exportErr.message}`);
                        const chat = await bot.getChat(chatId);
                        inviteLink = chat.invite_link;
                        console.log(`[Sweep] Using existing invite link: ${inviteLink}`);
                    }

                    if (!inviteLink) {
                        throw new Error("Could not get an invite link. Make sure the bot is an admin with 'Invite Users' permission.");
                    }

                    const hash = inviteLink.split('/').pop().replace('+', '');
                    console.log(`[Sweep] Extracted hash: "${hash}"`);

                    try {
                        const check = await client.invoke(new Api.messages.CheckChatInvite({ hash }));
                        console.log(`[Sweep] CheckChatInvite result:`, JSON.stringify(check, (key, value) => typeof value === 'bigint' ? value.toString() : value));
                    } catch (checkErr) {
                        console.error(`[Sweep] CheckChatInvite failed: ${checkErr.message}`);
                    }

                    console.log(`[Sweep] Invoking ImportChatInvite with hash: ${hash}`);
                    await client.invoke(new Api.messages.ImportChatInvite({ hash }));
                    console.log(`[Sweep] Successfully joined chat via invite.`);
                    await client.getDialogs();
                    entity = await client.getEntity(chatId);
                }

                // 4. PROMOTE
                await bot.promoteChatMember(chatId, userAccountID, { can_delete_messages: true });

                // 5. MARK BOUNDARY
                const statusMsg = await bot.sendMessage(chatId, "🧹 **Sweep started...** (Oldest ➔ Newest)", { parse_mode: 'Markdown' });
                const endBoundaryId = statusMsg.message_id;

                console.log(`[Sweep] Stopping at ID: ${endBoundaryId}`);

                // 6. THE CLEANING LOOP
                let totalDeleted = 0;
                let keepCleaning = true;
                let lastProcessedId = 0;

                while (keepCleaning) {
                    const messages = await client.getMessages(entity, {
                        limit: 100,
                        reverse: true, // Up-to-down
                        offsetId: lastProcessedId
                    });

                    if (!messages || messages.length === 0) break;

                    let idsToDelete = [];
                    for (const m of messages) {
                        if (m.id >= endBoundaryId) {
                            keepCleaning = false;
                            idsToDelete.push(m.id);
                            break;
                        }
                        idsToDelete.push(m.id);
                    }

                    if (idsToDelete.length > 0) {
                        try {
                            await client.deleteMessages(entity, idsToDelete, { revoke: true });
                            totalDeleted += idsToDelete.length;
                            lastProcessedId = idsToDelete[idsToDelete.length - 1];
                        } catch (delErr) {
                            console.error("[Sweep] Batch deletion error, skipping batch...");
                        }
                    }

                    // Small delay for Telegram's flood protection
                    await new Promise(r => setTimeout(r, 1500));
                }

                // 7. LEAVE IF NECESSARY
                if (!wasAlreadyMember) {
                    await client.invoke(new Api.channels.LeaveChannel({ channel: entity })).catch(() => { });
                }

                // 8. FINAL BOT NOTIFICATION
                await bot.sendMessage(chatId, `✅ **Full Sweep Complete**\n\n- Deleted: \`${totalDeleted}\` messages.\n- Direction: Oldest to Newest.\n- Log Status: Clean Exit.`, { parse_mode: 'Markdown' });

            } catch (err) {
                console.error("SWEEP ERROR:", err);
                bot.sendMessage(chatId, "❌ Sweep Error: " + err.message);
            } finally {
                if (client) {
                    try {
                        // Force shutdown internal workers before disconnecting
                        client._keepAlive = false;
                        if (client._updateLoopHandle) {
                            clearTimeout(client._updateLoopHandle);
                        }
                        await client.disconnect();
                        if (client._sender) {
                            client._sender.disconnect();
                            client._sender.userDisconnected = true;
                        }
                        client.destroy();
                        console.log("GramJS Client Forcefully Closed in /sweep.");
                    } catch (finalErr) {
                        console.error("[Sweep] Cleanup error:", finalErr);
                    }
                }
            }
        }


        if (command === '/vc') {
            const args = text.split(' ').slice(1);
            const action = args[0] ? args[0].toLowerCase() : '';
            const chatId = msg.chat.id;
            const senderId = msg.from.id;

            if (!['start', 'on', 'end', 'off'].includes(action)) {
                return bot.sendMessage(chatId, "⚠️ Usage: `/vc start` or `/vc end`.");
            }

            let client;
            let shouldLeave = false; // Flag to track if we need to leave

            try {
                // 1. PERMISSION CHECKS
                const caller = await bot.getChatMember(chatId, senderId);
                if (['end', 'off'].includes(action)) {
                    const isOwner = botOWNER_IDS.includes(senderId.toString());
                    const canEnd = ["creator"].includes(caller.status) || caller.can_manage_video_chats || isOwner;
                    if (!canEnd) return bot.sendMessage(chatId, "❌ Only admins with 'Manage Video Chats' can end the VC.");
                }

                // 2. BOT PERMISSION CHECK
                const botMember = await bot.getChatMember(chatId, botId);
                if (!botMember.can_manage_video_chats || !botMember.can_promote_members) {
                    return bot.sendMessage(chatId, "❌ Bot lacks 'Manage Video Chats' or 'Add Admins' rights.");
                }

                // 3. INITIALIZE GRAMJS
                const sessionData = fs.readFileSync("session.txt", "utf8").trim();
                client = new TelegramClient(new StringSession(sessionData), apiId, apiHash, {
                    connectionRetries: 5,
                    receiveUpdates: false
                });
                await client.connect();

                // 4. PRE-CHECK MEMBERSHIP (The Fix)
                let entity;
                try {
                    // Check if the assistant is ALREADY in the group
                    // First try to get entity directly, which might fail if not known/in channel
                    entity = await client.getEntity(chatId);

                    const participant = await client.invoke(new Api.channels.GetParticipant({
                        channel: entity,
                        participant: userAccountID
                    }));
                    shouldLeave = false; // It's already a member
                } catch (e) {
                    // If error, it means the assistant is NOT a member or entity not found
                    shouldLeave = true;
                    console.log(`[VC] Assistant not in chat ${chatId}, attempting to join...`);

                    let inviteLink;
                    try {
                        // Always try to export a fresh link to avoid EXPIRED errors
                        inviteLink = await bot.exportChatInviteLink(chatId);
                    } catch (exportErr) {
                        console.warn("[VC] Failed to export invite link, trying to get existing one:", exportErr.message);
                        const chat = await bot.getChat(chatId);
                        inviteLink = chat.invite_link;
                    }

                    if (!inviteLink) {
                        throw new Error("Could not get an invite link for the assistant to join. Make sure the bot is an admin with 'Invite Users' permission.");
                    }

                    const hash = inviteLink.split('/').pop().replace('+', '');

                    await client.invoke(new Api.messages.ImportChatInvite({ hash }));
                    await client.getDialogs();
                    entity = await client.getEntity(chatId);
                }

                // 5. PROMOTE ASSISTANT
                await bot.promoteChatMember(chatId, userAccountID, { can_manage_video_chats: true });

                // 6. EXECUTION
                if (action === 'start' || action === 'on') {
                    await client.invoke(new Api.phone.CreateGroupCall({
                        peer: entity,
                        randomId: Math.floor(Math.random() * 1000000)
                    })).catch(err => { if (err.errorMessage !== 'GROUPCALL_ALREADY_EXISTS') throw err; });

                    bot.sendMessage(chatId, "✅ Video Chat started.");
                }
                else if (action === 'end' || action === 'off') {
                    const fullChat = await client.invoke(new Api.channels.GetFullChannel({ channel: entity }));
                    if (fullChat.fullChat.call) {
                        await client.invoke(new Api.phone.DiscardGroupCall({ call: fullChat.fullChat.call }));
                        bot.sendMessage(chatId, "🛑 Video Chat ended.");
                    } else {
                        bot.sendMessage(chatId, "ℹ️ No active Video Chat found.");
                    }
                }

                // 7. LEAVE LOGIC (Modified)
                // If it started or ended, and it wasn't a member before, it leaves NOW.
                if (shouldLeave) {
                    console.log("Assistant leaving group...");
                    await client.invoke(new Api.channels.LeaveChannel({ channel: entity }));
                }

            } catch (err) {
                console.error("VC Error:", err);
                bot.sendMessage(chatId, "❌ Error: " + err.message);
            } finally {
                if (client) {
                    try {
                        client._keepAlive = false;
                        if (client._updateLoopHandle) {
                            clearTimeout(client._updateLoopHandle);
                        }
                        await client.disconnect();
                        if (client._sender) {
                            client._sender.disconnect();
                            client._sender.userDisconnected = true;
                        }
                        client.destroy();
                        console.log("GramJS Client Forcefully Closed in /vc.");
                    } catch (finalErr) {
                        console.error("[VC] Cleanup error:", finalErr);
                    }
                }
            }
        }


        if (command === '/promme') {
            console.log("Handling /promote command");
            const me = await bot.getMe();
            botId = me.id;
            // Get parameters (this part is the same)
            const fullText = msg.text || ' ';
            const argsText = fullText.substring(command.length).trim() + ' full';
            const args = argsText.toLowerCase().split(/\s+/).filter(Boolean);

            // Checks (this part is the same)


            const userToPromote = msg.from;



            try {
                // Check if user is admin (using your existing variables)
                if (!isbotOwner) {
                    bot.sendMessage(chatId, "You must be the bot owner to use this command.");
                    return;
                }

                const pmember = await bot.getChatMember(chatId, userToPromote.id);
                const pisAdmin = ["administrator", "creator"].includes(pmember.status) && !msg.text.toLocaleLowerCase().includes('anno');
                if (pisAdmin) return bot.sendMessage(chatId, 'you are already admin in this group')


                // --- NEW LOGIC STARTS HERE ---

                // 1. Get the bot's *own* permissions
                //    (botId was set at the top of your file)
                const botMember = await bot.getChatMember(chatId, botId);

                // 2. Build the "ideal" permissions object based on user args
                let idealPerms = {
                    can_change_info: false,
                    can_delete_messages: false,
                    can_invite_users: false,
                    can_manage_video_chats: false,
                    can_restrict_members: false,
                    can_post_stories: false,
                    can_edit_stories: false,
                    can_delete_stories: false,
                    can_pin_messages: false,
                    can_promote_members: false,
                    is_anonymous: false,
                };

                if (args.includes('full')) {
                    idealPerms = {
                        can_change_info: true,
                        can_delete_messages: true,
                        can_invite_users: true,
                        can_manage_video_chats: true,
                        can_restrict_members: true,
                        can_post_stories: true,
                        can_edit_stories: true,
                        can_delete_stories: true,
                        can_pin_messages: true,
                        can_promote_members: true,
                    };
                    if (args.includes('anno')) {
                        idealPerms = {
                            can_change_info: true,
                            can_delete_messages: true,
                            can_invite_users: true,
                            can_manage_video_chats: true,
                            can_restrict_members: true,
                            can_post_stories: true,
                            can_edit_stories: true,
                            can_delete_stories: true,
                            can_pin_messages: true,
                            can_promote_members: true,
                            is_anonymous: true,
                        };
                    }
                }
                //console.log(botMember)

                // 3. Create the "final" permissions object
                //    It only sets a permission to 'true' IF the bot also has it.
                const finalPerms = {
                    can_change_info: idealPerms.can_change_info && botMember.can_change_info,
                    can_delete_messages: idealPerms.can_delete_messages && botMember.can_delete_messages,
                    can_invite_users: idealPerms.can_invite_users && botMember.can_invite_users,
                    can_restrict_members: idealPerms.can_restrict_members && botMember.can_restrict_members,
                    can_pin_messages: idealPerms.can_pin_messages && botMember.can_pin_messages,
                    can_post_stories: idealPerms.can_post_stories && botMember.can_post_stories,
                    can_edit_stories: idealPerms.can_edit_stories && botMember.can_edit_stories,
                    can_delete_stories: idealPerms.can_delete_stories && botMember.can_delete_stories,
                    can_manage_video_chats: idealPerms.can_manage_video_chats && botMember.can_manage_video_chats,
                    can_promote_members: idealPerms.can_promote_members && botMember.can_promote_members,
                    is_anonymous: idealPerms.is_anonymous && botMember.is_anonymous,
                };

                // --- NEW LOGIC ENDS HERE ---

                // 4. Promote the user with the filtered, safe permissions
                await bot.promoteChatMember(chatId, userToPromote.id, finalPerms).then(async () => {
                    await bot.setChatAdministratorCustomTitle(chatId, userToPromote.id, 'ㅤㅤㅤ');
                })
                // bot.promoteChatMember(1,1,)
                // 5. Create a helpful response
                let skippedPerms = [];
                for (const key in idealPerms) {
                    if (idealPerms[key] && !finalPerms[key]) {
                        // User wanted it, but bot didn't have it
                        skippedPerms.push(key);
                    }
                }

                let response = `✅ Success! [${msg.from.first_name || '' + msg.from.last_name || ''}](tg://user?id=${msg.from.id}). you are now an admin.`;
                if (skippedPerms.length > 0) {
                    response += `\n\n(Note: I couldn't grant these permissions because I don't have them: \`${skippedPerms.join(', ')}\`)`;
                }

                bot.sendMessage(chatId, response, { parse_mode: "Markdown" });

            } catch (error) {
                console.error(error);
                bot.sendMessage(chatId, "❌ Failed. Make sure I am an admin in this group and have the 'Can promote new members' permission.");
            }
        }

        if (command === '/filter') {
            if (!isAdmin && !isbotOwner) {
                bot.sendMessage(chatId, "You must be an admin or the bot owner to use this command.");
                return;
            }
            if (!msg.text) return;

            const text = msg.text.trim();
            const triggers = parseFilterTriggers(text);

            // Must reply + must type triggers
            const triggerMode = triggers.length > 0;

            // ❌ No triggers? Stop.
            if (!triggerMode) {
                return bot.sendMessage(
                    msg.chat.id,
                    `❌ You must type triggers after the command.

Example usage:
• Single trigger: \`/filter hello\`
• Multiple triggers: \`/filter (hi,hello,bye)\`

Available replacements in replies:
• {name} → Sender's first + last name
• {gname} → Group name
• {time} → Current time (HH:mm:ss)
• {date} → Current date (MMMM Do YYYY)
• {day} → Day of the week
• {greating} → Greeting based on time (Good morning / afternoon / evening)
`,
                    {
                        parse_mode: "Markdown",
                        reply_to_message_id: msg.message_id
                    }
                );

            }

            // ❌ No reply? Stop.
            if (!msg.reply_to_message) {
                return bot.sendMessage(
                    msg.chat.id,
                    "❌ You must reply to a message.\nCorrect example:\n\nReply → `/filter hello`",
                    { parse_mode: "Markdown", reply_to_message_id: msg.message_id }
                );
            }

            // Reply type detection
            const replied = msg.reply_to_message;
            const result = getMessageType(replied);

            if (!result) {
                return bot.sendMessage(
                    msg.chat.id,
                    "❌ Unsupported reply type.\nYou must reply to a text, image, video, sticker, gif, voice, audio, or document.",
                    { parse_mode: "Markdown", reply_to_message_id: msg.message_id }
                );
            }

            // Save filter
            const newFilter = {
                triggers: triggers,
                type: result.type,
                reply: result.type === "text" ? result.text : result.file_id
            };
            try {
                Filters.addFilter(String(msg.chat.id), newFilter)

                return bot.sendMessage(
                    msg.chat.id,
                    "✔ Filter saved!\n\nTriggers:\n" + triggers.map(x => `• ${x}`).join("\n"),
                    { parse_mode: "Markdown", reply_to_message_id: msg.message_id }
                );
            } catch (error) {
                return bot.sendMessage(msg.chat.id, "❌ Error saving filter.", { reply_to_message_id: msg.message_id });
            }



        }

        if (command === '/stop') {
            if (!isAdmin && !isbotOwner) {
                bot.sendMessage(chatId, "You must be an admin or the bot owner to use this command.");
                return;
            }
            if (!msg.text) return;

            const chatId = msg.chat.id;
            const triggers = parseFilterTriggers(msg.text);

            if (triggers.length === 0) {
                return bot.sendMessage(chatId,
                    "❌ You must provide trigger(s) to remove.\nExample:\n/stop ('hi','hello')\n/stop hello world",
                    { parse_mode: "Markdown", reply_to_message_id: msg.message_id }
                );
            }

            let removedCount = 0;
            console.log(triggers)
            triggers.forEach(trigger => {
                const removed = Filters.removeFilter(String(msg.chat.id), trigger);
                if (removed) removedCount++;
                // console.log(removed)
            });

            if (removedCount > 0) {
                bot.sendMessage(chatId,
                    `✅ Removed ${removedCount} filter(s).\nTriggers:\n` + triggers.join(", "),
                    { parse_mode: "Markdown", }
                );
            } else {
                bot.sendMessage(chatId, "❌ No matching filters found.", {});
            }
        }
        // console.log(await getGreeting())
        if (command === '/filters') {
            // const chatId = msg.chat.id;

            const allFilters = Filters.getFilters(String(msg.chat.id)); // assume this returns an array of filter objects

            if (!allFilters || allFilters.length === 0) {
                return bot.sendMessage(chatId, "❌ There are no filters in this chat.", { reply_to_message_id: msg.message_id });
            }

            let filterList = `📋 *Filters in this chat: ${allFilters.length}*\n\n`;

            allFilters.forEach((filter, index) => {
                const triggersText = filter.triggers.map(t => `\`${t}\``).join(', ');
                let replyText = '';

                if (filter.type === 'text') {
                    replyText = filter.reply;
                } else {
                    replyText = `<code>${filter.reply}</code>`; // file_id for media
                }

                filterList += `*${index + 1}.* *Type:* ${filter.type}\n`;
                filterList += `   *Triggers:* ${triggersText}\n`;
            });

            bot.sendMessage(chatId, filterList, { parse_mode: "Markdown", reply_to_message_id: msg.message_id });
        }

        const content =
            msg.text?.trim() ||
            msg.sticker?.emoji ||
            "";

        const matchedFilter = Filters.checkFilters(
            String(msg.chat.id),
            content
        );;


        // Send reply based on type
        if (matchedFilter) {
            switch (matchedFilter.type) {
                case 'text': {
                    let reptxt = matchedFilter.reply;

                    const senderfirstname = msg.from?.first_name || "";
                    const lastname = msg.from?.last_name || "";
                    const name = (senderfirstname + " " + lastname).trim();

                    const groupname = msg.chat?.title || "";

                    reptxt = reptxt
                        .replace(/\{name\}|<name>/gi, name)
                        .replace(/\{gname\}|<gname>|\{group name\}|<group name>/gi, groupname)
                        .replace(/\{time\}/gi, moment.tz('Asia/Colombo').format('HH:mm:ss'))
                        .replace(/\{date\}/gi, moment.tz('Asia/Colombo').format('MMMM Do YYYY'))
                        .replace(/\{day\}/gi, moment.tz('Asia/Colombo').format('dddd'))
                        .replace(/\{greating\}/gi, await getGreeting());

                    bot.sendMessage(msg.chat.id, reptxt, {
                        reply_to_message_id: msg.message_id
                    });
                }
                    break;



                case 'sticker':
                    bot.sendSticker(msg.chat.id, matchedFilter.reply, { reply_to_message_id: msg.message_id }); // reply is file_id
                    break;

                case 'image':
                    bot.sendPhoto(msg.chat.id, matchedFilter.reply, { reply_to_message_id: msg.message_id }); // reply is file_id or URL
                    break;

                case 'video':
                    bot.sendVideo(msg.chat.id, matchedFilter.reply, { reply_to_message_id: msg.message_id }); // reply is file_id or URL
                    break;

                case 'gif':
                    bot.sendAnimation(msg.chat.id, matchedFilter.reply, { reply_to_message_id: msg.message_id }); // reply is file_id or URL
                    break;

                case 'audio':
                    bot.sendAudio(msg.chat.id, matchedFilter.reply, { reply_to_message_id: msg.message_id }); // reply is file_id or URL
                    break;

                case 'voice':
                    bot.sendVoice(msg.chat.id, matchedFilter.reply, { reply_to_message_id: msg.message_id }); // reply is file_id
                    break;

                case 'document':
                    bot.sendDocument(msg.chat.id, matchedFilter.reply, { reply_to_message_id: msg.message_id }); // reply is file_id or URL
                    break;

                case 'video_note':
                    bot.sendVideoNote(msg.chat.id, matchedFilter.reply, { reply_to_message_id: msg.message_id }); // reply is file_id
                    break;

                default:
                    break;
            }
        }
        if (command === '/ano') {
            // Check if the sender is the anonymous bot identity
            if (msg.from.username === 'GroupAnonymousBot') {
                await bot.sendMessage(msg.chat.id, "🛡️ **Identity Unmasking**\nClick the button below to remove your anonymous status. This will reveal your real account in this group but keep all your current admin permissions.", {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [[
                            { text: "🔓 Unmask My Identity", callback_data: `unmask_admin` }
                        ]]
                    }
                });
            } else {
                // Optional: tell regular users they aren't anonymous
                bot.sendMessage(msg.chat.id, "⚠️ This command is only for admins currently posting anonymously.");
            }
        }


        if (msg.text && (command == '/send' || command == '/go')) {
            try {
                const from = msg.from;
                const userPhotourl = await getProfilePhoto(bot, from.id);
                const userPhoto = await downloadImage(userPhotourl)
                const chat = await bot.getChat(msg.from.id);

                let replymassageuser;
                let replymassagecontent;
                let replysendercolor;

                if (msg.reply_to_message) {
                    const firstName = msg.reply_to_message.from.first_name || '';
                    const lastName = msg.reply_to_message.from.last_name || '';
                    replysendercolor = (await bot.getChat(msg.reply_to_message.from.id)).accent_color_id

                    if (firstName && lastName) {
                        replymassageuser = `${firstName} ${lastName}`;
                    } else {
                        replymassageuser = firstName || lastName || 'Unknown';
                    }

                    replymassagecontent = msg.reply_to_message.text || null;
                } else {
                    replymassageuser = null;
                    replymassagecontent = null;
                    replysendercolor = null;
                }

                //console.log(userPhoto)


                const stickerBuffer = await createQuoteSticker(from.first_name || '', from.last_name || '', chat.emoji_status_custom_emoji_id, msg.text, chat.accent_color_id, userPhoto, replymassageuser, replymassagecontent, replysendercolor)


                const fileOptions = {
                    // This tells Telegram that the buffer is a file
                    // The filename extension is crucial for Telegram to recognize it as a sticker
                    filename: 'quote_sticker.webp',
                    // This explicitly tells Telegram the content type
                    contentType: 'image/webp'
                };

                try {
                    await bot.sendSticker(chatId, stickerBuffer, {
                        reply_to_message_id: msg.reply_to_message?.message_id
                    }, fileOptions);
                    // console.log('Sticker sent successfully!');
                } catch (error) {
                    console.error('Error sending sticker:', error.response.body);
                    // You will likely get an error here if the WEBP file does not meet Telegram's sticker criteria 
                    // (e.g., 512x512 dimensions, < 512KB size).
                }




                console.log('Sticker sent!');
            } catch (err) {
                console.error('Error generating sticker:', err);
            }
        }




        if (msg.text === "!qstart" && isAdmin) {
            if (activeQuizzes[chatId]) {
                return bot.sendMessage(chatId, "❌ A quiz is already active in this group.");
            }

            // Pre-quiz message with button
            const preQuizMsg = await bot.sendMessage(chatId, "📝 20 General knowladge questions\n Friendshub Quiz time \n\n \nPress 'I am ready' to start countdown.", {
                reply_markup: {
                    inline_keyboard: [[{ text: "I am ready", callback_data: "ready_quiz_default" }]]
                }
            });

            activeQuizzes[chatId] = {
                preQuizMsgId: preQuizMsg.message_id,
                quizStarted: false,
                polls: [],
                stopRequested: false,
                customQuizData: null
            };
            return;
        }

        // ====== START CUSTOM QUIZ VIA COMMAND ======
        if (msg.text && msg.text.startsWith("/quiz ") && msg.chat.type.includes("group")) {
            if (activeQuizzes[chatId]) {
                return bot.sendMessage(chatId, "❌ A quiz is already active in this group.");
            }

            const quizId = msg.text.split(" ")[1];
            if (!quizId) {
                return bot.sendMessage(chatId, "❌ Please provide a quiz ID. Usage: /quiz <quizId>");
            }

            if (!CustomQuizModel) {
                return bot.sendMessage(chatId, "❌ Secondary database is not connected.");
            }

            try {
                const customQuiz = await CustomQuizModel.findOne({ quizId: quizId });
                if (!customQuiz) {
                    return bot.sendMessage(chatId, "❌ Quiz not found. Invalid ID.");
                }

                const preQuizMsg = await bot.sendMessage(chatId, `📝 ${customQuiz.title || 'Custom'} Quiz Time!\nContains ${customQuiz.questions.length} questions.\n\nPress 'I am ready' to start.`, {
                    reply_markup: {
                        inline_keyboard: [[{ text: "I am ready", callback_data: "ready_quiz_custom" }]]
                    }
                });

                activeQuizzes[chatId] = {
                    preQuizMsgId: preQuizMsg.message_id,
                    quizStarted: false,
                    polls: [],
                    stopRequested: false,
                    customQuizData: customQuiz
                };
            } catch (e) {
                console.error("Error fetching custom quiz:", e);
                return bot.sendMessage(chatId, "❌ An error occurred while fetching the quiz.");
            }
            return;
        }

        // ====== QUIZ LEADERBOARD ======
        if (msg.text === "/qlead" || msg.text === "!qlead") {
            if (!UserQuizScoreModel) return bot.sendMessage(chatId, "❌ Database not connected.");

            try {
                const topUsers = await UserQuizScoreModel.find({ groupId: chatId.toString() })
                    .sort({ score: -1 })
                    .limit(10);

                if (topUsers.length === 0) {
                    return bot.sendMessage(chatId, "📊 No quiz scores recorded in this group yet.");
                }

                let text = "🏆 *Group Quiz Leaderboard* 🏆\n\n";
                topUsers.forEach((u, i) => {
                    const mention = u.username ? `@${u.username}` : `[${u.firstName || 'User'}](tg://user?id=${u.userId})`;
                    text += `${i + 1}. ${mention} — ${u.score} points\n`;
                });

                return bot.sendMessage(chatId, text, {
                    parse_mode: "Markdown",
                    reply_markup: {
                        inline_keyboard: [[
                            { text: "🌍 Global Leaderboard", callback_data: `qlead_global_0` },
                            { text: "🔄 Refresh", callback_data: `qlead_group_0` }
                        ]]
                    }
                });
            } catch (err) {
                console.error("Error fetching leaderboard:", err);
                return bot.sendMessage(chatId, "❌ An error occurred while fetching the leaderboard.");
            }
        }    // ====== STOP QUIZ ======
        if (msg.text === "!qstop" && isAdmin) {
            const session = activeQuizzes[chatId];
            if (!session) return bot.sendMessage(chatId, "❌ No active quiz to stop.");

            session.stopRequested = true;

            // Delete pre-quiz message
            if (session.preQuizMsgId) await bot.deleteMessage(chatId, session.preQuizMsgId).catch(() => { });

            // Delete active polls
            if (session.polls.length) {
                for (const pollId of session.polls) {
                    await bot.stopPoll(chatId, pollId).catch(() => { });
                }
            }

            delete activeQuizzes[chatId];
            quizActive = false;
            return bot.sendMessage(chatId, "🛑 Quiz stopped by admin.");
        }



        // ====== EXISTING INVITE LOGIC ======

        // ⭐️ CLEANUP: Removed redundant private chat check and saveUserMap call
        // They are already handled at the top of the message handler.

        // Check if sender is admin
        // const member = await bot.getChatMember(chatId, userId);
        // const isAdmin = ["administrator", "creator"].includes(member.status);


        // ====== !free command for admins ======
        if (msg.text && msg.text.startsWith("!free")) {
            if (!isAdmin) return;

            if (msg.entities) {
                const mentions = msg.entities.filter(
                    (e) => e.type === "text_mention" || e.type === "mention"
                );

                for (let mention of mentions) {
                    let mentionedUserId = null;

                    if (mention.type === "text_mention") {
                        mentionedUserId = mention.user.id;
                        await saveUserMap(chatId, mention.user);
                    } else if (mention.type === "mention") {
                        const username = msg.text
                            .substr(mention.offset, mention.length)
                            .replace("@", "");
                        mentionedUserId = await resolveUsername(chatId, username);

                        if (!mentionedUserId) {
                            bot.sendMessage(
                                chatId,
                                `❌ Cannot unlock @${username}. They must be in the group at least once.`
                            );
                            continue;
                        }
                    }

                    // Update invite count
                    let userInvite = await Invite.findOne({
                        groupId: chatId,
                        userId: mentionedUserId,
                    });
                    if (!userInvite) {
                        userInvite = new Invite({
                            groupId: chatId,
                            userId: mentionedUserId,
                            count: 11,
                        });
                    } else {
                        userInvite.count = userInvite.count + 11;
                    }
                    await userInvite.save();

                    bot.sendMessage(
                        chatId,
                        `✅ User <a href="tg://user?id=${mentionedUserId}">unlocked</a> to send messages`,
                        { parse_mode: "HTML" }
                    );
                }
            } else {
                bot.sendMessage(chatId, "❌ Please mention a user to unlock.");
            }
            return;
        }
        // ====== ADDCOUNT LEADERBOARD ======
        // ====== ADDCOUNT LEADERBOARD ======
        // ====== ADDCOUNT LEADERBOARD ======
        if (msg.text && msg.text.startsWith("!addcount")) {
            // if (!isAdmin) return;
            // Fetch all users in the group sorted by count (highest first)
            const allUsers = await Invite.find({ groupId: chatId }).sort({ count: -1 }).limit(25);

            if (!allUsers.length) {
                return bot.sendMessage(chatId, "📊 No invites recorded yet.");
            }

            const numEmojis = {
                0: "0️⃣", 1: "1️⃣", 2: "2️⃣", 3: "3️⃣", 4: "4️⃣",
                5: "5️⃣", 6: "6️⃣", 7: "7️⃣", 8: "8️⃣", 9: "9️⃣", 10: "🔟"
            };

            let leaderboard = "🏆 Invite Leaderboard 🏆\n\n";

            for (let i = 0; i < allUsers.length; i++) {
                const u = allUsers[i];
                const userMap = await UserMap.findOne({ groupId: chatId, userId: u.userId });

                const name = userMap?.firstName || userMap?.username || `User ${u.userId}`;
                const rank = i + 1;

                // Use emoji if available, otherwise construct multi-digit emoji
                let medal = "";
                if (numEmojis[rank]) {
                    medal = numEmojis[rank];
                } else {
                    medal = rank.toString().split("").map(d => numEmojis[d]).join("");
                }

                leaderboard += `${medal} <a href="tg://user?id=${u.userId}">${name}</a> — ${u.count} invites\n`;
            }

            return bot.sendMessage(chatId, leaderboard, { parse_mode: "HTML" });
        }



        // // inside bot.on("message", async (msg) => { ... })
        // if (msg.text === "!mute" && msg.reply_to_message && isAdmin) {
        //   const targetUser = msg.reply_to_message.from;
        //   const reason = "link or bad word"; // you can customize later
        //       const mmember = await bot.getChatMember(chatId, targetUser.id);
        //     const isAdaamin = ["administrator", "creator"].includes(mmember.status);
        // if (isAdaamin) return;
        //   // Save banned user
        //   await BannedUser.updateOne(
        //     { groupId: chatId, userId: targetUser.id },
        //     { reason },
        //     { upsert: true }
        //   );

        //   // Delete the message that admin replied to
        //   await bot.deleteMessage(chatId, msg.reply_to_message.message_id).catch(() => {});
        //   // Delete the command message itself
        //   await bot.deleteMessage(chatId, msg.message_id).catch(() => {});

        //   // Announce ban with button
        //   await bot.sendMessage(chatId,
        //     `🚫 <a href="tg://user?id=${targetUser.id}"><b>${targetUser.first_name}</b></a>  has been <b>banned</b> because of ${reason}.`,
        //     {
        //       parse_mode: "HTML",
        //       reply_markup: {
        //         inline_keyboard: [
        //           [{ text: "🔓 Unban", callback_data: `unban_${targetUser.id}_${chatId}` }]
        //         ]
        //       }
        //     }
        //   );

        //   return;
        // }
        // if(msg.text && msg.text.startsWith("!unmute")){
        //         if (msg.entities) {
        //         const mentions = msg.entities.filter(
        //           (e) => e.type === "text_mention" || e.type === "mention"
        //         );

        //         for (let mention of mentions) {
        //           let mentionedUserId = null;

        //           if (mention.type === "text_mention") {
        //             mentionedUserId = mention.user.id;
        //             await saveUserMap(chatId, mention.user);
        //           } else if (mention.type === "mention") {
        //             const username = msg.text
        //               .substr(mention.offset, mention.length)
        //               .replace("@", "");
        //             mentionedUserId = await resolveUsername(chatId, username);

        //             if (!mentionedUserId) {
        //               bot.sendMessage(
        //                 chatId,
        //                 `❌ Cannot unlock @${username}. They must be in the group at least once.`
        //               );
        //               continue;
        //             }
        //           }

        //           // let userInvite = await Invite.findOne({
        //           //   //groupId: chatId,
        //           //   userId: mentionedUserId,
        //           // });

        //             await BannedUser.deleteOne({ chatId, userId: mentionedUserId });

        //   // await bot.answerCallbackQuery(query.id, { text: "✅ User unbanned!" });

        //   await bot.sendMessage(
        //     chatId,
        //     `✅ <a href="tg://user?id=${mentionedUserId}">${mention.user.first_name}</a> has been <b>unbanned</b> by a admin.`,
        //     { parse_mode: "HTML" }
        //   );
        //           // if (!userInvite) {
        //           //   userInvite = new Invite({
        //           //     groupId: chatId,
        //           //     userId: mentionedUserId,
        //           //     count: 11,
        //           //   });
        //           // } else {
        //           //   userInvite.count = 11;
        //           // }
        //           // await userInvite.save();

        //           // bot.sendMessage(
        //           //   chatId,
        //           //   `✅ User <a href="tg://user?id=${mentionedUserId}">unlocked</a> to send messages`,
        //           //   { parse_mode: "HTML" }
        //           // );
        //         }
        //       } else {
        //         bot.sendMessage(chatId, "❌ Please mention a user to unban.");
        //       }

        // }




        // --- Permissions ---
        // A complete "no permissions" object for muting


        // A complete "all permissions" object for unmuting
        const fullPermissions = {
            can_send_messages: true,
            can_send_audios: true,
            can_send_documents: true,
            can_send_photos: true,
            can_send_videos: true,
            can_send_video_notes: true,
            can_send_voice_notes: true,
            can_send_polls: true,
            can_send_other_messages: true,
            can_add_web_page_previews: true,
            can_change_info: true,
            can_invite_users: true,
            can_pin_messages: true,
        };


        // --- MUTE COMMAND ---
        if (command === '/mu') {
            const args = text.split(' ').slice(1);
            if (!msg.reply_to_message && !args.length) return bot.sendMessage(msg.chat.id, "⚠️ Reply to a user or provide their ID to use this command.");

            try {
                const { targetUserId, targetUserName, durationArgs, error } = await getTarget(msg, args);
                if (error) return bot.sendMessage(msg.chat.id, error);
                const durationInMinutes = durationArgs[0] ? parseInt(durationArgs[0], 10) : null;
                const duration = durationArgs[0] || "0";


                // Permission Check: Admin must have 'can_restrict_members'
                const caller = await bot.getChatMember(msg.chat.id, msg.from.id);
                const canMute = caller.status === 'creator' || caller.can_restrict_members || botOWNER_IDS.includes(msg.from.id.toString());
                if (await handleAnonymous(msg, "mu", targetUserId, targetUserName, duration)) return;
                if (!canMute) return bot.sendMessage(msg.chat.id, "❌ You don't have the 'Restrict Members' permission.");

                const targetmember = await bot.getChatMember(msg.chat.id, targetUserId);
                const targetIsStaff = ["administrator", "creator"].includes(targetmember.status) || botOWNER_IDS.includes(targetUserId.toString());
                if (targetIsStaff) return bot.sendMessage(msg.chat.id, `⚠️ [${targetUserName}](tg://user?id=${targetUserId}) is staff and cannot be muted.`, { parse_mode: 'Markdown' });



                let perms = { ...noPermissions };
                let responseMessage = `User [${targetUserName}](tg://user?id=${targetUserId}) has been muted indefinitely.`;

                if (durationInMinutes && !isNaN(durationInMinutes)) {
                    perms.until_date = Math.floor(Date.now() / 1000) + (durationInMinutes * 60);
                    responseMessage = `User [${targetUserName}](tg://user?id=${targetUserId}) has been muted for ${durationInMinutes} minute(s).`;
                }

                await bot.restrictChatMember(msg.chat.id, targetUserId, perms);
                bot.sendMessage(msg.chat.id, responseMessage, { parse_mode: 'Markdown' });

            } catch (err) {
                console.error(err);
                bot.sendMessage(msg.chat.id, "An error occurred. Make sure I have 'Restrict Members' permissions.");
            }
        }

        // --- UNMUTE COMMAND ---
        if (command === '/unmu') {
            const args = text.split(' ').slice(1);
            if (!msg.reply_to_message && !args.length) return bot.sendMessage(msg.chat.id, "⚠️ Reply to a user or provide their ID.");

            try {
                const { targetUserId, targetUserName, error } = await getTarget(msg, args);
                if (error) return bot.sendMessage(msg.chat.id, error);

                // Permission Check: Caller must have 'can_restrict_members'
                const caller = await bot.getChatMember(msg.chat.id, msg.from.id);
                const canUnmute = caller.status === 'creator' || caller.can_restrict_members || botOWNER_IDS.includes(msg.from.id.toString());
                if (await handleAnonymous(msg, "unmu", targetUserId, targetUserName)) return;

                if (!canUnmute) return bot.sendMessage(msg.chat.id, "❌ You don't have the 'Restrict Members' permission.");


                const chat = await bot.getChat(msg.chat.id);
                await bot.restrictChatMember(msg.chat.id, targetUserId, chat.permissions);
                bot.sendMessage(msg.chat.id, `✅ User [${targetUserName}](tg://user?id=${targetUserId}) has been unmuted.`, { parse_mode: 'Markdown' });

            } catch (err) {
                bot.sendMessage(msg.chat.id, "An error occurred. Make sure I am an admin.");
            }
        }

        // --- BAN COMMAND ---
        if (command === '/ba') {
            const args = text.split(' ').slice(1);
            if (!msg.reply_to_message && !args.length) return bot.sendMessage(msg.chat.id, "⚠️ Reply to a user or provide their ID.");

            try {
                const { targetUserId, targetUserName, error } = await getTarget(msg, args);
                if (error) return bot.sendMessage(msg.chat.id, error);

                // Permission Check: Caller must have 'can_restrict_members'
                const caller = await bot.getChatMember(msg.chat.id, msg.from.id);
                const canBan = caller.status === 'creator' || caller.can_restrict_members || botOWNER_IDS.includes(msg.from.id.toString());
                if (await handleAnonymous(msg, "ba", targetUserId, targetUserName)) return;

                if (!canBan) return bot.sendMessage(msg.chat.id, "❌ You don't have the 'Restrict Members' permission.");

                const targetmember = await bot.getChatMember(msg.chat.id, targetUserId);
                if (["administrator", "creator"].includes(targetmember.status)) return bot.sendMessage(msg.chat.id, "⚠️ Cannot ban staff.");


                await bot.banChatMember(msg.chat.id, targetUserId);
                bot.sendMessage(msg.chat.id, `🚫 User [${targetUserName}](tg://user?id=${targetUserId}) has been banned.`, { parse_mode: 'Markdown' });

            } catch (err) {
                bot.sendMessage(msg.chat.id, "An error occurred while banning.");
            }
        }

        // --- UNBAN COMMAND ---
        if (command === '/unba') {
            const args = text.split(' ').slice(1);
            if (!msg.reply_to_message && !args.length) return bot.sendMessage(msg.chat.id, "⚠️ Reply to a user or provide their ID.");

            try {
                const { targetUserId, targetUserName, error } = await getTarget(msg, args);
                if (error) return bot.sendMessage(msg.chat.id, error);

                // Permission Check: Caller must have 'can_restrict_members'
                const caller = await bot.getChatMember(msg.chat.id, msg.from.id);
                const canUnban = caller.status === 'creator' || caller.can_restrict_members || botOWNER_IDS.includes(msg.from.id.toString());
                if (await handleAnonymous(msg, "unba", targetUserId, targetUserName)) return;

                if (!canUnban) return bot.sendMessage(msg.chat.id, "❌ You don't have the 'Restrict Members' permission.");


                await bot.unbanChatMember(msg.chat.id, targetUserId);
                bot.sendMessage(msg.chat.id, `✅ User [${targetUserName}](tg://user?id=${targetUserId}) has been unbanned.`, { parse_mode: 'Markdown' });

            } catch (err) {
                bot.sendMessage(msg.chat.id, "An error occurred while unbanning.");
            }
        }

        // --- PROMOTE COMMAND ---
        if (command === '/prom') {
            const args = (msg.text || '').substring(command.length).trim().toLowerCase().split(/\s+/).filter(Boolean);
            if (!msg.reply_to_message) return bot.sendMessage(msg.chat.id, "Please reply to the user you want to promote.");
            if (args.length === 0) return bot.sendMessage(msg.chat.id, "Please provide permissions (e.g., 'full', 'ban', 'pin').");

            try {
                // Permission Check: Caller must have 'can_promote_members'
                const caller = await bot.getChatMember(msg.chat.id, msg.from.id);
                const canPromote = caller.status === 'creator' || caller.can_promote_members || botOWNER_IDS.includes(msg.from.id.toString());

                const userToPromote = msg.reply_to_message.from;
                const userToPromotename = userToPromote.first_name || '';
                if (await handleAnonymous(msg, "prom", userToPromote.id, userToPromotename, args.join('|'))) return;

                if (!canPromote) return bot.sendMessage(msg.chat.id, "❌ You don't have the 'Add New Admins' permission.");

                const targetStatus = await bot.getChatMember(msg.chat.id, userToPromote.id);
                if (["administrator", "creator"].includes(targetStatus.status)) return bot.sendMessage(msg.chat.id, "User is already admin.");


                const botMember = await bot.getChatMember(msg.chat.id, botId);
                let idealPerms = {
                    can_change_info: args.includes('info') || args.includes('full'),
                    can_delete_messages: args.includes('del') || args.includes('ban') || args.includes('full'),
                    can_invite_users: args.includes('invite') || args.includes('full'),
                    can_restrict_members: args.includes('ban') || args.includes('full'),
                    can_pin_messages: args.includes('pin') || args.includes('full'),
                    can_promote_members: args.includes('promote') || args.includes('full'),
                    can_manage_video_chats: args.includes('full'),
                    is_anonymous: args.includes('anno')
                };

                const finalPerms = {};
                Object.keys(idealPerms).forEach(key => {
                    finalPerms[key] = idealPerms[key] && botMember[key];
                });

                await bot.promoteChatMember(msg.chat.id, userToPromote.id, finalPerms);
                bot.sendMessage(msg.chat.id, `✅ [${userToPromotename}](tg://user?id=${userToPromote.id}) has been promoted.`, { parse_mode: "Markdown" });

            } catch (error) {
                console.log(error)
                bot.sendMessage(msg.chat.id, "❌ Promotion failed. Ensure I have 'Add New Admins' rights.");
            }
        }

        // --- DEMOTE COMMAND ---
        if (command === '/dem') {
            if (!msg.reply_to_message) return bot.sendMessage(msg.chat.id, "Please reply to the user you want to demote.");

            try {
                const caller = await bot.getChatMember(msg.chat.id, msg.from.id);
                const canDemote = caller.status === 'creator' || caller.can_promote_members || botOWNER_IDS.includes(msg.from.id.toString());

                const userToDemote = msg.reply_to_message.from;
                if (await handleAnonymous(msg, "dem", userToDemote.id, userToDemote.first_name)) return;

                if (!canDemote) return bot.sendMessage(msg.chat.id, "❌ You need 'Add New Admins' permission to demote.");

                await bot.promoteChatMember(msg.chat.id, userToDemote.id, {
                    can_change_info: false,
                    can_delete_messages: false,
                    can_invite_users: false,
                    can_restrict_members: false,
                    can_pin_messages: false,
                    can_promote_members: false,
                });

                bot.sendMessage(msg.chat.id, `✅ User has been demoted.`, { parse_mode: "Markdown" });
            } catch (error) {
                bot.sendMessage(msg.chat.id, "❌ Demotion failed.");
            }
        }


        const qqqsession = activeQuizzes[chatId];

        if (qqqsession) return bot.deleteMessage(chatId, msg.message_id).catch(() => { });

        // ====== Skip admins and bots ======
        if (isAdmin || msg.from.is_bot) return;

        // Check banned users
        const banned = await BannedUser.findOne({ groupId: chatId, userId });
        if (banned) {
            // Delete every message from this user
            await bot.deleteMessage(chatId, msg.message_id).catch(() => { });

            // Re-send ban notice (only if needed)
            await bot.sendMessage(chatId,
                `🚫 <a href="tg://user?id=${msg.from.id}"><b>${msg.from.first_name}</b></a> you are banned user. Reason: ${banned.reason}`,
                {
                    parse_mode: "HTML",
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "🔓 Unban", callback_data: `unban_${msg.from.id}_${chatId}` }]
                        ]
                    }
                }
            ).catch(() => { });
            return;
        }



        // ====== Restrict messages for users with <10 invites ======
        const inviteData = await Invite.findOne({ groupId: chatId, userId });

        const acceptsss = await accceptMap.findOne({ groupId: chatId });

        const acceptemabled = acceptsss?.enabled ?? false;
        const counttoadd = acceptsss?.count ?? 0;
        //console.log(acceptemabled)
        if (!acceptemabled) return;


        if (!inviteData || inviteData.count < counttoadd) {
            const userName = msg.from.first_name || msg.from.username || "User";

            bot.sendMessage(
                chatId,
                `🚫 <a href="tg://user?id=${userId}">${userName}</a>, to message in this group, add ${counttoadd} friends first! (You added ${inviteData ? inviteData.count : 0
                }/${counttoadd})`,
                {
                    parse_mode: "HTML",
                    reply_markup: {
                        inline_keyboard: [
                            [
                                {
                                    text: `📊 My Invites (${inviteData ? inviteData.count : 0}/${counttoadd})`,
                                    callback_data: `check_${userId}_${chatId}`,
                                },
                                {
                                    text: "🔓 Unmute",
                                    callback_data: `unmute_${userId}_${chatId}`,
                                },
                            ],
                        ],
                    },
                }
            );


            bot.deleteMessage(chatId, msg.message_id).catch(() => { });
        }

        // ...all your existing invite logic stays exactly as it is
    } catch (err) {
        //console.error("❌ Error handling message:", err.message);
    }
});

// ================== NEW MEMBER HANDLER ==================
// ================== NEW MEMBER HANDLER ==================
bot.on("new_chat_members", async (msg) => {
    const chatId = msg.chat.id;
    const adder = msg.from;
    const newMembers = msg.new_chat_members;

    let newAddedCount = 0;

    for (const member of newMembers) {
        // Skip self-joins
        if (adder.id === member.id) continue;

        try {
            await bot.deleteMessage(chatId, msg.message_id).catch(() => { });
        } catch (erroer) {

        }
        // Save mapping (your existing helper)
        await saveUserMap(chatId, member);

        // Delete system join message
        await bot.deleteMessage(chatId, msg.message_id).catch(() => { });

        newAddedCount++;
    }

    if (newAddedCount > 0) {
        const result = await Invite.findOneAndUpdate(
            { groupId: chatId, userId: adder.id },
            { $inc: { count: newAddedCount } },
            { new: true, upsert: true }
        );
        const acceptsss = await accceptMap.findOne({ groupId: chatId });
        const acceptemabled = acceptsss ? acceptsss.enabled : false;
        //console.log(acceptemabled)
        if (!acceptemabled) return;
        bot.sendMessage(
            chatId,
            `👋 ${adder.first_name} added ${newAddedCount} new members! Total invites: ${result.count}.`
        );
    }





    bot.getMe().then((me) => {
        msg.new_chat_members.forEach((member) => {
            if (member.id === me.id) {
                // The bot itself was added
                console.log(`Added to new group: ${msg.chat.title} (${msg.chat.id})`);
                if (!groupChatIds.has(msg.chat.id)) {
                    groupChatIds.add(msg.chat.id);
                    saveGroupIds(); // Save the updated list to file
                }
            }
        });
    });
});



bot.on('left_chat_member', async (msg) => {
    try {
        await bot.deleteMessage(chatId, msg.message_id).catch(() => { });
    } catch (erroer) {

    }
    bot.getMe().then((me) => {
        if (msg.left_chat_member.id === me.id) {
            // The bot itself was kicked
            console.log(`Removed from group: ${msg.chat.id}`);
            if (groupChatIds.has(msg.chat.id)) {
                groupChatIds.delete(msg.chat.id);
                saveGroupIds(); // Save the updated list to file
            }
        }
    });
});


async function broadcast(msg) {
    // Owner check
    if (!botOWNER_IDS.includes(msg.from.id)) {
        return bot.sendMessage(msg.chat.id, "Sorry, you are not authorized to use this command.");
    }

    // Must reply to a message
    if (!msg.reply_to_message) {
        return bot.sendMessage(msg.chat.id, "Error: Please reply to the message you want to forward.");
    }

    const fromChatId = msg.reply_to_message.chat.id;
    const messageToForwardId = msg.reply_to_message.message_id;

    const allTargets = [...groupChatIds, ...userChatIds]; // 👈 Send to BOTH groups + users

    console.log(
        `Owner triggered broadcast. Forwarding message ${messageToForwardId} to ${allTargets.length} total chats...`
    );

    let successCount = 0;
    let errorCount = 0;
    let chatsChanged = false;

    const forwardPromises = [];

    for (const chatId of allTargets) {
        const promise = bot.forwardMessage(chatId, fromChatId, messageToForwardId)
            .then(() => {
                successCount++;
            })
            .catch(async (error) => {
                console.error(`Failed to forward to chat ${chatId}: ${error.code} ${error.message}`);
                errorCount++;

                // If chat no longer exists or user blocked bot → remove it
                if (error.response && (
                    error.response.body.description.includes("chat not found") ||
                    error.response.body.description.includes("bot was kicked") ||
                    error.response.body.description.includes("bot was blocked")
                )) {
                    console.log(`Removing inactive chat ID: ${chatId}`);

                    if (groupChatIds.has(chatId)) groupChatIds.delete(chatId);
                    if (userChatIds.has(chatId)) userChatIds.delete(chatId);

                    chatsChanged = true;
                }

                await new Promise(resolve => setTimeout(resolve, 50));
            });

        forwardPromises.push(promise);

        await new Promise(resolve => setTimeout(resolve, 100)); // avoid rate limit
    }

    await Promise.all(forwardPromises);

    if (chatsChanged) {
        console.log("Saving updated chat lists...");
        saveGroupIds();
        saveUserIds();
    }

    return bot.sendMessage(
        msg.chat.id,
        `✅ Broadcast Complete!\n\nSent to: ${successCount} chats\nFailed: ${errorCount} chats`
    );
}





bot.onText(/\/bc/, broadcast);


////////////////////////////////////////////////////////////////////////////hifuihfhaofijidfpajda/////////////
async function findPotentialMatch(userId, userGeom, maxKm, minAge, maxAge, seekingGender) {
    const queryText = `
    SELECT user_id, first_name, age, bio, profile_photo_file_id
    FROM users
    WHERE
        profile_complete = TRUE
        AND user_id != $1
        AND gender = $2
        AND age BETWEEN $3 AND $4
        AND ST_Distance(location_geom, $5) <= $6
        AND user_id NOT IN (
            SELECT liked_user_id FROM likes WHERE liker_user_id = $1
        )
    LIMIT 1;
  `;
    try {
        const res = await db.query(queryText, [
            userId, seekingGender, minAge, maxAge,
            userGeom, // The user's own location_geom as text
            maxKm * 1000, // Convert km to meters
        ]);
        return res.rows[0]; // Returns the first row object, or undefined
    } catch (err) {
        console.error("Error finding match:", err);
        return null;
    }
}


// index.js (add this code)

bot.onText(/\/find/, async (msg) => {
    const chatId = msg.chat.id;
    if (msg.chat.type !== 'private') {
        bot.sendMessage(chatId, 'dating app only work is private chats')
        return; // Stop processing the message
    }
    // 1. Get current user's data from DB
    let userProfile;
    try {
        // ST_AsText gets the geography column in a format we can re-use
        const res = await db.query(
            'SELECT *, ST_AsText(location_geom) as geom_text FROM users WHERE user_id = $1',
            [chatId]
        );
        userProfile = res.rows[0];
    } catch (err) {
        console.error("Error fetching user profile:", err);
        return bot.sendMessage(chatId, "An error occurred. Please try again.");
    }

    if (!userProfile || !userProfile.profile_complete) {
        return bot.sendMessage(chatId, "Please complete your profile with /dating first.");
    }

    // 2. Find a match
    const match = await findPotentialMatch(
        chatId,
        userProfile.geom_text, // Use the user's saved location
        userProfile.seeking_max_distance_km,
        userProfile.seeking_min_age,
        userProfile.seeking_max_age,
        userProfile.seeking_gender || 'Female' // Default seeking gender
    );

    if (match) {
        const { user_id: matchUserId, first_name, age, bio, profile_photo_file_id } = match;
        const caption = `${first_name}, ${age}\n\n${bio}`;

        // 3. Send profile with inline buttons
        bot.sendPhoto(chatId, profile_photo_file_id, {
            caption: caption,
            reply_markup: {
                inline_keyboard: [
                    [
                        // The data string is what we'll get back in the callback_query
                        { text: '❤️ Like', callback_data: `like_${matchUserId}` },
                        { text: '❌ Next', callback_data: `next_${matchUserId}` }
                    ]
                ]
            }
        });
    } else {
        bot.sendMessage(chatId, "No new profiles found matching your criteria. Try again later!");
    }
});








// ================== CALLBACK QUERY HANDLER ==================
// ================== BUTTON HANDLER ==================

// ================== CALLBACK QUERY HANDLER ==================
bot.on("callback_query", async (query) => {
    const chatId = query.message.chat.id.toString();
    const data = query.data;
    const message = query.message;
    const from = query.from;
    const userId = query.from.id;
    const messageId = query.message.message_id;


    // Inside your existing bot.on('callback_query', ...) handler:

    if (data === 'unmask_admin') {
        const chatId = message.chat.id;
        const userId = from.id; // This is the real ID of the person who clicked

        try {
            // 1. Get current member data to see existing permissions
            const member = await bot.getChatMember(chatId, userId);

            // 2. Check if they are actually an admin
            if (!["administrator", "creator"].includes(member.status)) {
                return bot.answerCallbackQuery(query.id, {
                    text: "❌ You must be an admin to use this.",
                    show_alert: true
                });
            }

            // 3. Prepare the promotion object using their CURRENT permissions
            // We only change is_anonymous to false
            const updatedPerms = {
                is_anonymous: false,
                can_manage_chat: member.can_manage_chat,
                can_change_info: member.can_change_info,
                can_delete_messages: member.can_delete_messages,
                can_invite_users: member.can_invite_users,
                can_restrict_members: member.can_restrict_members,
                can_pin_messages: member.can_pin_messages,
                can_promote_members: member.can_promote_members,
                can_manage_video_chats: member.can_manage_video_chats,
                can_post_stories: member.can_post_stories,
                can_edit_stories: member.can_edit_stories,
                can_delete_stories: member.can_delete_stories
            };

            // 4. Apply the update
            await bot.promoteChatMember(chatId, userId, updatedPerms);

            // 5. Success feedback
            await bot.editMessageText(`✅ **Success!**\n[${from.first_name}](tg://user?id=${from.id}) is no longer anonymous.`, {
                chat_id: chatId,
                message_id: message.message_id,
                parse_mode: 'Markdown'
            });

            bot.answerCallbackQuery(query.id, { text: "You are now visible!" });

        } catch (err) {
            console.error("Unmask Error:", err);
            bot.answerCallbackQuery(query.id, {
                text: "Failed to unmask. Make sure I have 'Add New Admins' permissions.",
                show_alert: true
            });
        }
    }


    if (data.startsWith('verify_')) {
        const [_, action, targetId, extra] = data.split('_');
        const chatId = message.chat.id;

        try {
            // --- START OF NEW PERMISSION CHECK LOGIC ---
            const clicker = await bot.getChatMember(chatId, from.id);
            const isOwner = botOWNER_IDS.includes(from.id.toString());
            const isCreator = clicker.status === 'creator';

            // 1. Check for Restriction Permissions (Mute/Ban)
            if (['mu', 'unmu', 'ba', 'unba'].includes(action)) {
                if (!isCreator && !isOwner && !clicker.can_restrict_members) {
                    return bot.answerCallbackQuery(query.id, {
                        text: "❌ You don't have 'Restrict Members' permission!",
                        show_alert: true
                    });
                }
            }

            // 2. Check for Promotion Permissions (Promote/Demote)
            if (['prom', 'dem'].includes(action)) {
                if (!isCreator && !isOwner && !clicker.can_promote_members) {
                    return bot.answerCallbackQuery(query.id, {
                        text: "❌ You don't have 'Add New Admins' permission!",
                        show_alert: true
                    });
                }
            }
            // --- END OF NEW PERMISSION CHECK LOGIC ---

            if (action === 'prom') {

                const args = extra.split('|');
                const botMember = await bot.getChatMember(chatId, botId);

                // Calculate Ideal Perms (Same logic as your command)
                let idealPerms = { can_change_info: false, can_delete_messages: false, can_invite_users: false, can_restrict_members: false, can_pin_messages: false, can_promote_members: false, is_anonymous: false };

                if (args.includes('full')) {
                    idealPerms = { can_change_info: true, can_delete_messages: true, can_invite_users: true, can_restrict_members: true, can_pin_messages: true, can_promote_members: true, is_anonymous: args.includes('anno') };
                } else {
                    args.forEach(arg => {
                        switch (arg) {
                            case 'info':
                                idealPerms.can_change_info = true,
                                    idealPerms.can_delete_messages = true,
                                    can_manage_video_chats = true,
                                    can_post_stories = true,
                                    can_edit_stories = true,
                                    can_delete_stories = true; break;
                            case 'del': idealPerms.can_delete_messages = true, idealPerms.can_pin_messages = true, can_manage_video_chats = true,
                                can_post_stories = true,
                                can_edit_stories = true,
                                can_delete_stories = true; break;
                            case 'invite': idealPerms.can_invite_users = true; break;
                            case 'ban':
                                idealPerms.can_restrict_members = true;
                                idealPerms.can_pin_messages = true;
                                idealPerms.can_delete_messages = true;
                                break;
                            case 'pin': idealPerms.can_pin_messages = true, can_manage_video_chats = true,
                                can_post_stories = true,
                                can_edit_stories = true,
                                can_delete_stories = true; break;
                            case 'promote': idealPerms.can_promote_members = true; break;
                            case 'anno': idealPerms.is_anonymous = true; break;
                        }
                    });
                }

                // Filter by Bot's own perms
                const finalPerms = {};
                for (let key in idealPerms) {
                    finalPerms[key] = idealPerms[key] && botMember[key];
                }

                await bot.promoteChatMember(chatId, targetId, finalPerms);
                bot.editMessageText(`✅ Verified: Admin promoted user with permissions: ${args.join(', ')}`, { chat_id: chatId, message_id: message.message_id });
            }
            else if (action === 'dem') {
                await bot.promoteChatMember(chatId, targetId, {
                    can_change_info: false,
                    can_delete_messages: false,
                    can_invite_users: false,
                    can_restrict_members: false,
                    can_pin_messages: false,
                    can_promote_members: false,
                });
                bot.editMessageText(`✅ Verified: Admin demoted the user.`, { chat_id: chatId, message_id: message.message_id });
            }
            // 2. Perform the action based on the callback data
            if (action === 'mu') {
                const untilDate = extra !== "0" ? Math.floor(Date.now() / 1000) + (parseInt(extra) * 60) : null;
                const perms = { ...noPermissions };
                if (untilDate) perms.until_date = untilDate;

                await bot.restrictChatMember(chatId, targetId, perms);
                bot.editMessageText(`✅ Verified: Admin unmasked. User restricted.`, { chat_id: chatId, message_id: message.message_id });
            }

            else if (action === 'unmu') {
                const chat = await bot.getChat(chatId);
                await bot.restrictChatMember(chatId, targetId, chat.permissions);
                bot.editMessageText(`✅ Verified: Admin unmasked. User unmuted.`, { chat_id: chatId, message_id: message.message_id });
            }

            else if (action === 'ba') {
                await bot.banChatMember(chatId, targetId);
                bot.editMessageText(`✅ Verified: Admin unmasked. User banned.`, { chat_id: chatId, message_id: message.message_id });
            }

            else if (action === 'unba') {
                await bot.unbanChatMember(chatId, targetId);
                bot.editMessageText(`✅ Verified: Admin unmasked. User unbanned.`, { chat_id: chatId, message_id: message.message_id });
            }

            bot.answerCallbackQuery(query.id, { text: "Action executed!" });

        } catch (err) {
            console.error(err);
            bot.answerCallbackQuery(query.id, { text: "Error executing action.", show_alert: true });
        }
    };







    // Acknowledge the button press
    bot.answerCallbackQuery(query.id);

    const [action, targetUserIdStr] = data.split('_');
    const targetUserId = parseInt(targetUserIdStr, 10);






    const isOwner = () => botOWNER_IDS.includes(userId);

    const editMessage = (text, markup) => {
        bot.editMessageCaption(text, {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'HTML',
            reply_markup: markup
        }).catch(err => {
            // Ignore "message is not modified" errors
        });
    };
    let cmds;
    if (data.startsWith("check_")) {
        const [, userId, groupId] = data.split("_");
        const inviteData = await Invite.findOne({ groupId, userId });
        const count = inviteData ? inviteData.count : 0;

        return bot.answerCallbackQuery(query.id, {
            text: `📊 You have invited ${count} members.`,
            show_alert: true,
        });
    }


    if (data.startsWith("unban_")) {
        const [, targetUserId, groupId] = data.split("_");

        // Only admins can unban
        const member = await bot.getChatMember(groupId, query.from.id);
        const isAdmin = ["administrator", "creator"].includes(member.status);
        if (!isAdmin) {
            return bot.answerCallbackQuery(query.id, {
                text: "❌ Only admins can unban.",
                show_alert: true
            });
        }

        // Remove from DB
        await BannedUser.deleteOne({ groupId, userId: targetUserId });

        await bot.answerCallbackQuery(query.id, { text: "✅ User unbanned!" });

        await bot.sendMessage(
            groupId,
            `✅ <a href="tg://user?id=${targetUserId}">User</a> has been <b>unbanned</b> by ${query.from.first_name}.`,
            { parse_mode: "HTML" }
        );
    }

    // ====== UNMUTE BUTTON ======
    if (data.startsWith("unmute_")) {
        const [, targetUserId, groupId] = data.split("_");

        // Check if clicker is admin
        const member = await bot.getChatMember(groupId, query.from.id);
        const isAdmin = ["administrator", "creator"].includes(member.status);

        if (!isAdmin) {
            return bot.answerCallbackQuery(query.id, {
                text: "❌ Only admins can unmute users.",
                show_alert: true,
            });
        }

        // Update invite count like !free
        let userInvite = await Invite.findOne({ groupId, userId: targetUserId });
        //console.log(userInvite)
        if (!userInvite) {
            userInvite = new Invite({ groupId, userId: targetUserId, count: 11 });
        } else {
            userInvite.count = userInvite.count + 11;
        }
        await userInvite.save();

        await bot.answerCallbackQuery(query.id, {
            text: "✅ User unmuted successfully!",
            show_alert: true,
        });

        // Notify group
        bot.sendMessage(
            groupId,
            `✅ User <a href="tg://user?id=${targetUserId}">unlocked</a> by admin ${query.from.first_name}`,
            { parse_mode: "HTML" }
        );
    }
    // Use a switch to handle different button data
    switch (data) {

        // --- Back to Main Menu ---
        case 'start_menu':
            editMessage(getStartMessage(query.from.first_name || 'User'), startKeyboard);
            break;

        // --- Contact Us ---
        case 'contact_us':
            if (contactKeyboard) {
                // Keyboard is loaded, just send it
                editMessage('Here are the contacts for my owners:', contactKeyboard);
            } else {
                // Fallback in case bot is still starting
                bot.answerCallbackQuery(query.id, {
                    text: 'Contacts are still loading, please try again in a moment.',
                    show_alert: true
                });
            }
            break;

        // --- Help Main Menu ---
        case 'help_main':
            editMessage('Please select a command category:', helpMainKeyboard);
            break;

        // --- Help Sub-Menus ---

        case 'help_owner':
            cmds = `<b>Owner Commands:</b>\n\n/bc - Send a message\n /stats - Get bot stats`
            if (isOwner()) {

                editMessage(cmds, backToHelpKeyboard);
            } else {
                bot.answerCallbackQuery(query.id, {
                    text: 'This is not for you!',
                    show_alert: true
                });
            }
            break;

        case 'help_premium':
            cmds = `
/fq -create fake sticker
and you can use ai function unlimited
`
            editMessage(cmds, backToHelpKeyboard);
            break;

        case 'help_nsfw':
            cmds = nsfwCommands.join("\n")
            editMessage(cmds, backToHelpKeyboard);
            break;

        case 'help_admin':
            editMessage('<b>Group Admin Commands:</b>\n\n/ba - Ban a user\n/mu - Mute a user\n/filter - filter a message\nfilters - get filters list\n/stop - stop filter', backToHelpKeyboard);
            break;

        case 'help_ai':
            editMessage('<b>Al Commands:</b>\n\n/ai - ask from ai\n/aic - check how many lef today', backToHelpKeyboard);
            break;

        default:
            bot.answerCallbackQuery(query.id, { text: 'Unknown button!' });
            break;
    }






    if (action === 'like') {
        try {
            // 1. Insert the like
            await db.query(
                'INSERT INTO likes (liker_user_id, liked_user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
                [userId, targetUserId]
            );

            // 2. Check for a mutual match
            const res = await db.query(
                'SELECT EXISTS (SELECT 1 FROM likes WHERE liker_user_id = $1 AND liked_user_id = $2)',
                [targetUserId, userId] // Note the reversed IDs
            );

            const isMutual = res.rows[0].exists;

            if (isMutual) {
                // 3. IT'S A MATCH!
                bot.editMessageCaption("It's a match! 🎉", {
                    chat_id: chatId,
                    message_id: messageId,
                });

                // Notify both users (you'd fetch their names for a nicer message)
                bot.sendMessage(userId, `You matched with user ${targetUserId}!`);
                bot.sendMessage(targetUserId, `You matched with user ${userId}!`);
            } else {
                // Not a mutual match yet
                bot.editMessageCaption('Liked! 👍', {
                    chat_id: chatId,
                    message_id: messageId,
                });
            }
        } catch (err) {
            console.error("Error processing like:", err);
            bot.sendMessage(chatId, "An error occurred.");
        }
    } else if (action === 'next') {
        // Just edit the caption to show it was skipped
        bot.editMessageCaption('Next profile...', {
            chat_id: chatId,
            message_id: messageId,
        });
        // You could also insert this as a "dislike" into the likes table
        // to prevent this user from appearing again.
    } else if (data.startsWith('qlead_')) {
        if (!UserQuizScoreModel) return bot.answerCallbackQuery(query.id, { text: "❌ Database not connected." });

        try {
            let topUsers = [];
            let headerText = "";
            let newButtons = [];

            if (data.startsWith('qlead_group')) {
                topUsers = await UserQuizScoreModel.find({ groupId: chatId.toString() })
                    .sort({ score: -1 })
                    .limit(10);
                headerText = "🏆 *Group Quiz Leaderboard* 🏆";
                newButtons = [[
                    { text: "🌍 Global Leaderboard", callback_data: `qlead_global_0` },
                    { text: "🔄 Refresh", callback_data: `qlead_group_0` }
                ]];
            } else if (data.startsWith('qlead_global')) {
                // Aggregate all scores by user across all groups
                topUsers = await UserQuizScoreModel.aggregate([
                    {
                        $group: {
                            _id: "$userId",
                            totalScore: { $sum: "$score" },
                            firstName: { $first: "$firstName" },
                            username: { $first: "$username" }
                        }
                    },
                    { $sort: { totalScore: -1 } },
                    { $limit: 10 }
                ]);
                headerText = "🌍 *Global Quiz Leaderboard* 🌍";
                newButtons = [[
                    { text: "🏆 Group Leaderboard", callback_data: `qlead_group_0` },
                    { text: "🔄 Refresh", callback_data: `qlead_global_0` }
                ]];
            }

            let text = `${headerText}\n\n`;
            if (topUsers.length === 0) {
                text += "📊 No quiz scores recorded yet.";
            } else {
                topUsers.forEach((u, i) => {
                    // u._id is the userId from aggregate, u.userId is from group find
                    const targetId = u._id || u.userId;
                    const score = u.totalScore || u.score;
                    const mention = u.username ? `@${u.username}` : `[${u.firstName || 'User'}](tg://user?id=${targetId})`;
                    text += `${i + 1}. ${mention} — ${score} points\n`;
                });
            }

            await bot.editMessageText(text, {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: "Markdown",
                reply_markup: { inline_keyboard: newButtons }
            });
            bot.answerCallbackQuery(query.id);
        } catch (err) {
            console.error("Leaderboard Callback Error:", err);
            bot.answerCallbackQuery(query.id, { text: "❌ Error fetching leaderboard." });
        }
    } // index.js (Inside bot.on('callback_query', ...))

    // ... (existing logic for 'like' and 'next')

    else if (data.startsWith('setting_')) {
        const settingAction = data.substring(8); // e.g., 'update_bio'

        // Acknowledge the query and dismiss the loading state
        bot.answerCallbackQuery(query.id);

        switch (settingAction) {
            case 'update_bio':
                // 1. Set the conversation state
                userRegistrationState[userId] = {
                    step: 'awaiting_update_bio'
                };
                // 2. Prompt the user
                bot.sendMessage(chatId, "✍️ Please send your new profile bio now:");
                // 3. Edit the original settings message to acknowledge the action
                bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
                    chat_id: chatId,
                    message_id: messageId
                }).catch(() => { }); // Catch error if message was already modified/deleted
                break;

            case 'update_photo':
                userRegistrationState[userId] = {
                    step: 'awaiting_update_photo'
                };
                bot.sendMessage(chatId, "📸 Please send your new profile photo now:");
                bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: messageId }).catch(() => { });
                break;

            case 'update_distance':
                userRegistrationState[userId] = {
                    step: 'awaiting_update_distance'
                };
                bot.sendMessage(chatId, "🗺️ What is the **maximum distance** (in kilometers) you're willing to search? (e.g., send `50`)");
                bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: messageId }).catch(() => { });
                break;

            case 'update_seeking':
                // For seeking preferences, you might need a multi-step conversation, 
                // but for simplicity, let's just update the gender choice first.
                userRegistrationState[userId] = {
                    step: 'awaiting_update_seeking_gender'
                };
                bot.sendMessage(chatId, "Who are you seeking?", {
                    reply_markup: {
                        keyboard: [['Male', 'Female', 'Other']],
                        one_time_keyboard: true,
                        resize_keyboard: true,
                    },
                });
                bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: messageId }).catch(() => { });
                break;

            case 'delete_profile':
                // Confirmation step is critical for deletion!
                bot.editMessageCaption("⚠️ **Are you sure you want to delete your profile? This action is permanent.**", {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: 'Yes, Delete Permanently', callback_data: 'confirm_delete_profile' }],
                            [{ text: 'No, Cancel', callback_data: 'setting_cancel' }]
                        ]
                    }
                });
                break;

            case 'setting_cancel':
                bot.editMessageCaption("Cancelled. You can send /settings again anytime.", {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'Markdown'
                });
                break;

            case 'confirm_delete_profile':
                // Perform the DELETE operation here
                await db.query('DELETE FROM likes WHERE liker_user_id = $1 OR liked_user_id = $1', [userId]);
                await db.query('DELETE FROM users WHERE user_id = $1', [userId]);
                delete userRegistrationState[userId];
                bot.editMessageCaption("✅ Your profile and all matching data have been permanently deleted.", {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: 'Markdown'
                });
                break;
        }
    }

    // Optional: Automatically send the next profile by calling
    // the same logic inside bot.onText('/find', ...)













    // ====== QUIZ READY BUTTON ======
    if (data === "ready_quiz_default" || data === "ready_quiz_custom") {
        const session = activeQuizzes[chatId];
        if (!session || session.quizStarted) {
            return bot.answerCallbackQuery(query.id, { text: "❌ Quiz already started or no active quiz." });
        }

        session.quizStarted = true;
        bot.answerCallbackQuery(query.id, { text: "Starting countdown..." });

        // Try to remove button
        try {
            await bot.editMessageReplyMarkup(
                { inline_keyboard: [] },
                { chat_id: chatId, message_id: session.preQuizMsgId }
            );
        } catch (e) { }

        // Countdown logic
        const nums = ["3️⃣", "2️⃣", "1️⃣", "🚀\n\n **Go!** \n\n_Good Luck._ "];
        await sendEditCountdown(bot, chatId, "⏱️ Starting in", nums);

        // ================== START QUIZ ==================
        try {
            let questions = [];
            if (session.customQuizData) {
                questions = session.customQuizData.questions;
            } else {
                const response = await fetch("https://raw.githubusercontent.com/AlexaInc/questionjson/refs/heads/main/quiz.json");
                questions = await response.json();
            }
            const leaderboard = {};
            let lastPollMessageId = null;

            for (let i = 0; i < questions.length; i++) {
                if (session.stopRequested) break;
                const q = questions[i];

                // Stop previous poll if exists
                if (lastPollMessageId) {
                    await bot.stopPoll(chatId, lastPollMessageId).catch(() => { });
                }

                // 🔹 Send "next question" countdown except before first question
                // if (i > 0 && i < questions.length) {
                //   await sendEditCountdown(bot, chatId, "⏳ Next question in", ["5️⃣","4️⃣","3️⃣","2️⃣","1️⃣"]);
                // }

                // Send poll
                const sentMessage = await bot.sendPoll(chatId, q.question, q.options, {
                    type: 'quiz',
                    correct_option_id: q.answer,
                    is_anonymous: false,
                    explanation: q.explanation || '',
                    open_period: 20
                });

                lastPollMessageId = sentMessage.message_id;
                session.polls.push(lastPollMessageId);

                // Track answers
                const onPollAnswer = async (pollAnswer) => {
                    if (pollAnswer.poll_id === sentMessage.poll.id) {
                        const userId = pollAnswer.user.id;
                        const firstName = pollAnswer.user.first_name || "User";
                        const username = pollAnswer.user.username || "";
                        if (pollAnswer.option_ids.includes(q.answer)) {
                            if (!leaderboard[userId]) leaderboard[userId] = { id: userId, name: firstName, username: username, score: 0 };
                            leaderboard[userId].score++;
                        }
                    }
                };
                bot.on("poll_answer", onPollAnswer);
                if (i === questions.length - 1) {
                    // Wait 20s for the last question
                    await new Promise(res => setTimeout(res, 20000));
                } else {
                    // Wait 15s, then do a 5s countdown (which handles its own deletion)
                    await new Promise(res => setTimeout(res, 15000));
                    await sendEditCountdown(bot, chatId, "⏳ Next question in", ["5️⃣", "4️⃣", "3️⃣", "2️⃣", "1️⃣"]);
                }

                // Remove listener
                bot.removeListener("poll_answer", onPollAnswer);

                // 🔹 If last question → show end countdown
                // if (i === questions.length - 1) {
                //   await sendEditCountdown(bot, chatId, "🏁 Quiz time ends in", ["🔟","9️⃣","8️⃣","7️⃣","6️⃣","5️⃣","4️⃣","3️⃣","2️⃣","1️⃣"], " ⏳");
                //   await bot.sendMessage(chatId, "✅ Quiz ended!");
                // }
            }

            // Stop last poll
            if (lastPollMessageId) await bot.stopPoll(chatId, lastPollMessageId).catch(() => { });

            // 🔹 Leaderboard countdown
            if (!session.stopRequested) {
                //  await leaderboardCountdown(bot, chatId);

                // Show leaderboard
                const sorted = Object.values(leaderboard).sort((a, b) => b.score - a.score);
                if (sorted.length === 0) {
                    bot.sendMessage(chatId, "📊 Quiz completed! No one answered correctly.");
                } else {
                    let text = "🏆 Quiz Completed! Leaderboard 🏆\n\n";

                    // Use a traditional for loop to handle the async DB saves
                    for (let i = 0; i < sorted.length; i++) {
                        const u = sorted[i];

                        // Format Mention
                        const mention = u.username ? `@${u.username}` : `[${u.name}](tg://user?id=${u.id})`;
                        text += `${i + 1}. ${mention} — ${u.score} points\n`;

                        // Save to secondary DB if connected
                        if (UserQuizScoreModel) {
                            await UserQuizScoreModel.findOneAndUpdate(
                                { userId: u.id.toString(), groupId: chatId.toString() },
                                {
                                    $inc: { score: u.score },
                                    $set: { firstName: u.name, username: u.username || "" }
                                },
                                { upsert: true, new: true }
                            ).catch(err => console.error("Error saving user quiz score:", err));
                        }
                    }

                    bot.sendMessage(chatId, text, { parse_mode: "Markdown" });
                }
            }

            delete activeQuizzes[chatId];
        } catch (err) {
            //console.error("❌ Error running quiz:", err.message);
            delete activeQuizzes[chatId];
        }
        return;
    }

    // ... your other buttons (check_, unmute_) remain the same
    // ====== CHECK INVITES BUTTON ======

});







// --- BOT INITIALIZATION ---

/**
 * This async function runs once when the bot starts.
 * It fetches the owner names and builds the contactKeyboard.
 */
const initializeBot = async () => {
    try {
        // 1. Check if bot token is valid
        const me = await bot.getMe();
        console.log(`Bot starting... Logged in as ${me.username}`);

        // 2. Fetch owner names and build the contact keyboard
        console.log('Fetching owner contact details...');

        // Create a promise for each ID
        const promises = botOWNER_IDS.map(id => bot.getChat(id));

        // Use Promise.allSettled - this will NOT fail if one ID is bad
        const results = await Promise.allSettled(promises);

        // Filter out any failed promises and get the successful 'chat' objects
        const ownerChats = results
            .filter(result => result.status === 'fulfilled')
            .map(result => result.value); // Get the 'value' (the chat object)

        // Log any owners who could not be found
        const failedCount = results.filter(result => result.status === 'rejected').length;
        if (failedCount > 0) {
            console.warn(`Warning: Failed to fetch ${failedCount} owner details. They may have blocked the bot or have an invalid ID.`);
        }

        // 3. Build the buttons from the successful chats
        const ownerButtons = ownerChats.map(chat => {
            const name = `${chat.first_name} ${chat.last_name || ''}`.trim();
            // Each button is wrapped in its own array to make it a new row
            return [{ text: name, url: `tg://user?id=${chat.id}` }];
        });

        //console.log(ownerButtons)
        // 4. Assign the complete keyboard to the global variable
        contactKeyboard = {
            inline_keyboard: [
                ...ownerButtons, // Spread the owner buttons (each one is a row)
                [{ text: '🔙 Back', callback_data: 'start_menu' }] // Add the back button
            ]
        };

        console.log(`✅ ${ownerChats.length} contacts loaded. Bot is running successfully!`);

    } catch (error) {
        console.error('CRITICAL ERROR on startup:', error.message);
        // Create a fallback keyboard
        contactKeyboard = {
            inline_keyboard: [
                [{ text: 'Error loading contacts', callback_data: 'nil' }],
                [{ text: '🔙 Back', callback_data: 'start_menu' }]
            ]
        };
        console.error('Using fallback contact keyboard.');
    }
};

// Log any errors to the console
bot.on('polling_error', (error) => {
    console.log(`Polling error: ${error.code} - ${error.message}`);
});

// Bot initialized.
initializeBot();