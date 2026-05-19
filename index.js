require('dotenv').config();

// USE GRAMJS WRAPPER INSTEAD OF node-telegram-bot-api
// This routes ALL communication through MTProto datacenters
// NO HTTP calls to api.telegram.org at all
const GramJSBot = require('./gramjs_wrapper');
require('./web');

const mongoose = require("mongoose");

const { spawn } = require('child_process');
const path = require('path');
const moment = require('moment-timezone');
const FilterManager = require('filtermatics');

// Globally suppress harmless GramJS TIMEOUT reconnects from spamming the console
process.on('unhandledRejection', (reason, promise) => {
  const errorStr = String(reason.stack || reason);
  if (errorStr.includes('TIMEOUT') && errorStr.includes('telegram/client/updates.js')) {
    return; // Suppress
  }
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// --- UTILS & DB ---
const helpers = require('./utils/helpers');
const { loadGroupIds, saveGroupIds, saveUserIds, loadUserIds } = require('./utils/storage');
const { updateUserCount_Optimized, checkUserCount, updateUserLimit } = require('./utils/aiLimit');
const db = require('./db/index');
const { Invite, UserMap, BannedUser, NSFWSetting, accceptMap, Antilink, AntilinkWarning, Warning, BroadcastId, CleanCommand, WelcomeSettings, SpecialUser, Activity, GlobalUserStats, GlobalGroupStats, BadWord } = db;

// --- CONFIG ---
const BOT_TOKEN = process.env.BOT_TOKEN;
const botOWNER_IDS = process.env.botOWNER_IDS.split(',').map(id => parseInt(id));
// We will load Special Users from MongoDB after connection
let allIds = [];
let Specialuser = [...botOWNER_IDS];
const logGrpid = process.env.logGrpid;
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
const filterspath = process.env.filterspath || './filters';
const Filters = new FilterManager({ dbPath: filterspath });
const activeQuizzes = {};
const userRegistrationState = {};

// --- BOT INSTANCE (GRAMJS - MTProto, NO api.telegram.org) ---
const bot = new GramJSBot(BOT_TOKEN, {
  polling: {
    autoStart: false,
  }
});

let BOT_ID;
let BOT_USERNAME;
let contactKeyboard = null;

// Safe polling start via GramJS
const startPollingClean = async () => {
  // Wait for any old instance to fully die
  await new Promise(r => setTimeout(r, 3000));
  try {
    await bot.startPolling();
    const me = await bot.getMe();
    BOT_ID = me.id;
    BOT_USERNAME = me.username;
    console.log(`Bot started as @${BOT_USERNAME} (${BOT_ID}) via GramJS MTProto`);
    console.log('NO api.telegram.org calls - all through MTProto datacenters!');
    // Send bootup message to log group
    if (logGrpid) {
      bot.sendMessage(logGrpid, `✅ Main bot @${BOT_USERNAME} started (GramJS MTProto)`).catch(() => { });
    }
  } catch (e) {
    console.error('Failed to start polling:', e.message);
    // Retry after delay
    setTimeout(startPollingClean, 5000);
  }
};

// --- INITIALIZATION ---
db.connectToDatabases().then(async () => {
  const fs = require('fs');
  const path = require('path');
  const idsFilePath = path.join(__dirname, 'ids.json');

  // Load existing special users from MongoDB
  try {
    const specialUsers = await SpecialUser.find({});
    allIds = specialUsers.map(u => u.userId);

    // Migration from ids.json to MongoDB
    if (fs.existsSync(idsFilePath)) {
      try {
        const fileData = JSON.parse(fs.readFileSync(idsFilePath, 'utf8'));
        const newIds = fileData.filter(id => !allIds.includes(id));

        if (newIds.length > 0) {
          console.log(`🚀 Migrating ${newIds.length} IDs from ids.json to MongoDB...`);
          for (const id of newIds) {
            await SpecialUser.updateOne({ userId: id }, { $set: { userId: id } }, { upsert: true });
          }
          // Reload allIds after migration
          const updatedSpecialUsers = await SpecialUser.find({});
          allIds = updatedSpecialUsers.map(u => u.userId);
          console.log(`✅ Migration complete. Total special users: ${allIds.length}`);
        }
      } catch (err) {
        console.error("❌ Error during migration from ids.json:", err);
      }
    }

    Specialuser = [...botOWNER_IDS, ...allIds];
    console.log(`✅ ${allIds.length} special users loaded from MongoDB.`);
  } catch (err) {
    console.error("❌ Error loading special users:", err);
  }

  // Start polling after DB is connected
  startPollingClean();
});

const CustomQuizModel = db.getCustomQuizModel();
const UserQuizScoreModel = db.getUserQuizScoreModel();

// Spawn secondary bot
const secondaryBotProcess = spawn('node', [path.join(__dirname, 'secondary_bot.js')], { stdio: 'inherit' });
secondaryBotProcess.on('error', (err) => console.error('Failed to start secondary_bot.js:', err));

// Graceful shutdown helper
const stopBots = async () => {
  console.log('Stopping bots and cleaning up...');
  try {
    if (bot.isPolling()) {
      await bot.stopPolling();
      console.log('Main bot polling stopped.');
    }
  } catch (e) {
    console.error('Error stopping main bot polling:', e.message);
  }

  if (secondaryBotProcess) {
    console.log('Killing secondary bot...');
    const killPromise = new Promise((resolve) => {
      secondaryBotProcess.once('exit', resolve);
      secondaryBotProcess.kill('SIGINT');
      setTimeout(() => {
        secondaryBotProcess.kill('SIGKILL');
        resolve();
      }, 4000);
    });
    await killPromise;
    console.log('Secondary bot process cleaned up.');
  }

  await new Promise(r => setTimeout(r, 1000));
};

const shutdown = async () => {
  await stopBots();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Dependency Injection Object
const deps = {
  logGrpid,
  botOWNER_IDS,
  get Specialuser() { return Specialuser; },
  setSpecialuser: (newVal) => { Specialuser = newVal; },
  allIds: () => allIds,
  setAllIds: (newVal) => { allIds = newVal; },
  SpecialUser,
  updateUserCount_Optimized,
  checkUserCount,
  updateUserLimit,
  handlers: helpers,
  Filters,
  Invite,
  UserMap,
  BannedUser,
  accceptMap,
  NSFWSetting,
  Antilink,
  AntilinkWarning,
  Warning,
  BroadcastId,
  CleanCommand,
  WelcomeSettings,
  Activity,
  GlobalUserStats,
  GlobalGroupStats,
  BadWord,
  get CustomQuizModel() { return db.getCustomQuizModel(); },
  get UserQuizScoreModel() { return db.getUserQuizScoreModel(); },
  get DatingProfileModel() { return db.getDatingProfileModel(); },
  get DatingLikeModel() { return db.getDatingLikeModel(); },
  groupChatIds: loadGroupIds(),
  userChatIds: loadUserIds(),
  saveGroupIds,
  saveUserIds,
  saveUserMap: (chatId, user) => helpers.saveUserMap(UserMap, chatId, user),
  noPermissions,
  activeQuizzes,
  userRegistrationState,
  get BOT_ID() { return BOT_ID; },
  get BOT_USERNAME() { return BOT_USERNAME; },
  getContactKeyboard: () => contactKeyboard,
  stopBots,
  db,
};

// --- LOAD COMMAND MODULES ---
require('./commands/admin')(bot, deps);
require('./commands/common')(bot, deps);
require('./commands/owner')(bot, deps);
require('./commands/ranking')(bot, deps);
require('./commands/welcome')(bot, deps);
require('./commands/games')(bot, deps);

// Load sub-modules
try {
  const quizModule = require('./modules/quiz')(bot, deps.db);
  deps.quiz = quizModule;
} catch (e) { console.log('Quiz module not loaded:', e.message); }
try {
  const hangmanModule = require('./modules/hangman')(bot, deps.db);
  deps.hangman = hangmanModule;
} catch (e) { console.log('Hangman module not loaded:', e.message); }
try {
  const wordchainModule = require('./modules/wordchain')(bot, deps.db);
  deps.wordchain = wordchainModule;
} catch (e) { console.log('Wordchain module not loaded:', e.message); }
try { require('./modules/moderation')(bot, deps); } catch (e) { console.log('Moderation module not loaded:', e.message); }
try { require('./modules/dating')(bot, deps); } catch (e) { console.log('Dating module not loaded:', e.message); }

// Load event handlers
require('./events/callbackQuery')(bot, deps);

// --- Activity Tracking ---
const { handleActivity } = require('./utils/activity');
bot.on('message', async (msg) => {
  try {
    await handleActivity(bot, deps, msg);
  } catch (e) { /* ignore */ }

  // Track group/user IDs
  if (msg.chat) {
    const chatId = msg.chat.id;
    if (msg.chat.type === 'group' || msg.chat.type === 'supergroup') {
      if (!deps.groupChatIds.has(chatId)) {
        deps.groupChatIds.add(chatId);
        saveGroupIds(deps.groupChatIds);
      }
      // Sync to broadcast DB
      BroadcastId.updateOne({ chatId: String(chatId) }, { $set: { type: msg.chat.type } }, { upsert: true }).catch(() => { });
    } else if (msg.chat.type === 'private') {
      if (!deps.userChatIds.has(chatId)) {
        deps.userChatIds.add(chatId);
        saveUserIds(deps.userChatIds);
      }
      BroadcastId.updateOne({ chatId: String(chatId) }, { $set: { type: 'private' } }, { upsert: true }).catch(() => { });
    }
  }

  // Save user mapping
  if (msg.from && msg.chat && (msg.chat.type === 'group' || msg.chat.type === 'supergroup')) {
    helpers.saveUserMap(UserMap, msg.chat.id, msg.from).catch(() => { });
  }

  // Clean command
  if (msg.text && msg.text.startsWith('/')) {
    try {
      const setting = await CleanCommand.findOne({ groupId: msg.chat.id });
      if (setting && setting.enabled) {
        const mode = setting.mode || 'all';
        if (mode === 'all' || (mode === 'other' && msg.from.id !== BOT_ID) || (mode === 'me' && msg.from.id === BOT_ID)) {
          setTimeout(() => {
            bot.deleteMessage(msg.chat.id, msg.message_id).catch(() => { });
          }, 2000);
        }
      }
    } catch (e) { /* ignore */ }
  }

  // Filter matching is handled by modules/moderation/index.js (Filters.checkFilters)
  // Do NOT duplicate it here — it causes double triggers

  // Bad word detection
  if (msg.text && msg.chat && (msg.chat.type === 'group' || msg.chat.type === 'supergroup')) {
    try {
      const badWordData = await BadWord.findOne({ groupId: String(msg.chat.id) });
      if (badWordData && badWordData.words.length > 0) {
        const text = msg.text.toLowerCase();
        const found = badWordData.words.some(w => text.includes(w.toLowerCase()));
        if (found) {
          // Check if user is admin
          const admins = await helpers.getAdmins(bot, msg.chat.id);
          const isAdmin = admins.some(a => a.user.id === msg.from.id);
          if (!isAdmin && !botOWNER_IDS.includes(msg.from.id)) {
            bot.deleteMessage(msg.chat.id, msg.message_id).catch(() => { });
            bot.sendMessage(msg.chat.id, `⚠️ [${msg.from.first_name}](tg://user?id=${msg.from.id}), your message was deleted for containing a banned word.`, {
              parse_mode: 'Markdown',
            }).catch(() => { });
          }
        }
      }
    } catch (e) { /* ignore */ }
  }
});

// --- Welcome / Goodbye Handler ---
bot.on('message', async (msg) => {
  // new_chat_members
  if (msg.new_chat_members) {
    for (const member of msg.new_chat_members) {
      try {
        const settings = await WelcomeSettings.findOne({ groupId: String(msg.chat.id) });
        if (!settings || !settings.welcomeEnabled) continue;

        const text = (settings.welcomeMessage || 'Welcome to {gname}, {first}!')
          .replace(/{first}/g, member.first_name || '')
          .replace(/{last}/g, member.last_name || '')
          .replace(/{user}/g, member.username ? `@${member.username}` : member.first_name)
          .replace(/{id}/g, member.id)
          .replace(/{mention}/g, `<a href="tg://user?id=${member.id}">${member.first_name}</a>`)
          .replace(/{gname}/g, msg.chat.title || '')
          .replace(/{greating}/g, helpers.getGreeting())
          .replace(/{time}/g, moment().tz('Asia/Colombo').format('HH:mm'))
          .replace(/{date}/g, moment().tz('Asia/Colombo').format('YYYY-MM-DD'))
          .replace(/{day}/g, moment().tz('Asia/Colombo').format('dddd'));

        let sentMsg;
        if (settings.welcomeType === 'photo' && settings.welcomeFileId) {
          sentMsg = await bot.sendPhoto(msg.chat.id, settings.welcomeFileId, { caption: text, parse_mode: 'HTML' });
        } else if (settings.welcomeType === 'video' && settings.welcomeFileId) {
          sentMsg = await bot.sendVideo(msg.chat.id, settings.welcomeFileId, { caption: text, parse_mode: 'HTML' });
        } else {
          sentMsg = await bot.sendMessage(msg.chat.id, text, { parse_mode: 'HTML' });
        }

        // Clean welcome
        if (settings.cleanWelcome && sentMsg) {
          setTimeout(() => {
            bot.deleteMessage(msg.chat.id, sentMsg.message_id).catch(() => { });
          }, 5 * 60 * 1000);
        }
      } catch (e) {
        console.error('Welcome handler error:', e.message);
      }
    }
  }

  // left_chat_member
  if (msg.left_chat_member) {
    try {
      const settings = await WelcomeSettings.findOne({ groupId: String(msg.chat.id) });
      if (!settings || !settings.goodbyeEnabled) return;

      const member = msg.left_chat_member;
      const text = (settings.goodbyeMessage || 'Goodbye, {first}!')
        .replace(/{first}/g, member.first_name || '')
        .replace(/{last}/g, member.last_name || '')
        .replace(/{user}/g, member.username ? `@${member.username}` : member.first_name)
        .replace(/{id}/g, member.id)
        .replace(/{mention}/g, `<a href="tg://user?id=${member.id}">${member.first_name}</a>`)
        .replace(/{gname}/g, msg.chat.title || '');

      if (settings.goodbyeType === 'photo' && settings.goodbyeFileId) {
        await bot.sendPhoto(msg.chat.id, settings.goodbyeFileId, { caption: text, parse_mode: 'HTML' });
      } else if (settings.goodbyeType === 'video' && settings.goodbyeFileId) {
        await bot.sendVideo(msg.chat.id, settings.goodbyeFileId, { caption: text, parse_mode: 'HTML' });
      } else {
        await bot.sendMessage(msg.chat.id, text, { parse_mode: 'HTML' });
      }
    } catch (e) {
      console.error('Goodbye handler error:', e.message);
    }
  }
});

// --- Invite Tracking ---
bot.on('message', async (msg) => {
  if (msg.new_chat_members && msg.from) {
    for (const member of msg.new_chat_members) {
      if (member.id !== msg.from.id) {
        // Someone was added by msg.from
        try {
          await Invite.updateOne(
            { groupId: String(msg.chat.id), userId: String(msg.from.id) },
            { $inc: { count: 1 } },
            { upsert: true }
          );
        } catch (e) { /* ignore */ }
      }
    }
  }
});

// --- Contact Keyboard Builder ---
(async () => {
  // Wait until bot is actually connected
  while (!BOT_ID) {
    await new Promise(r => setTimeout(r, 2000));
  }
  await new Promise(r => setTimeout(r, 3000));
  try {
    const ownerButtons = [];
    for (const ownerId of botOWNER_IDS) {
      try {
        const chat = await bot.getChat(ownerId);
        const name = chat.first_name || 'Owner';
        ownerButtons.push([{ text: `👤 ${name}`, url: `https://t.me/user?id=${ownerId}` }]);
      } catch (e) {
        // ownerButtons.push([{ text: `👤 Owner ${ownerId}`, url: `https://t.me/user?id=${ownerId}` }]);
      }
    }
    ownerButtons.push([{ text: '🔙 Back', callback_data: 'start_menu' }]);
    contactKeyboard = { inline_keyboard: ownerButtons };
    console.log('✅ Contact keyboard built.');
  } catch (e) {
    console.error('Error building contact keyboard:', e.message);
  }
})();

console.log('===========================================');
console.log('  Alexa Bot - GramJS MTProto Edition');
console.log('  NO api.telegram.org HTTP calls!');
console.log('  All via MTProto datacenter connections');
console.log('===========================================');
