const TelegramBot = require("node-telegram-bot-api");
const mongoose = require("mongoose");
require('dotenv').config();
const { spawn } = require('child_process');
const path = require('path');
const moment = require('moment-timezone');
const FilterManager = require('filtermatics');

// --- UTILS & DB ---
const helpers = require('./utils/helpers');
const { loadGroupIds, saveGroupIds, saveUserIds, loadUserIds } = require('./utils/storage');
const { updateUserCount_Optimized, checkUserCount, updateUserLimit } = require('./utils/aiLimit');
const db = require('./db/index');
const { Invite, UserMap, BannedUser, NSFWSetting, accceptMap, Antilink, AntilinkWarning, Warning, BroadcastId, CleanCommand, WelcomeSettings, SpecialUser } = db;

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

const Filters = new FilterManager({ dbPath: './filters' });
const activeQuizzes = {};
const userRegistrationState = {};

// --- BOT INSTANCE ---
// Start with polling OFF — we do a safe startup below
const bot = new TelegramBot(BOT_TOKEN, {
  polling: false,
  request: {
    agentOptions: {
      keepAlive: true,
      family: 4
    }
  }
});

let BOT_ID;
let BOT_USERNAME;
let contactKeyboard = null;

// Safe polling start — waits for old instance to release, drops stale updates
const startPollingClean = async () => {
  // Wait for any old instance to fully die and release the connection
  await new Promise(r => setTimeout(r, 3000));
  try {
    // Drop any pending updates so we don't conflict with old instance
    await bot.getUpdates({ timeout: 0, offset: -1 });
    console.log('Dropped pending updates.');
  } catch (e) {
    console.log('Could not drop pending updates (safe to ignore):', e.message);
  }
  bot.startPolling();
  console.log('Polling started cleanly.');
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
    // 1. Stop polling first to stop receiving new updates
    if (bot.isPolling()) {
      await bot.stopPolling();
      console.log('Main bot polling stopped.');
    }
  } catch (e) {
    console.error('Error stopping main bot polling:', e.message);
  }

  // 2. Kill secondary bot and wait for it
  if (secondaryBotProcess) {
    console.log('Killing secondary bot...');
    const killPromise = new Promise((resolve) => {
      secondaryBotProcess.once('exit', resolve);
      secondaryBotProcess.kill('SIGINT');

      // Hard kill after 4 seconds if SIGINT doesn't work
      setTimeout(() => {
        secondaryBotProcess.kill('SIGKILL');
        resolve();
      }, 4000);
    });
    await killPromise;
    console.log('Secondary bot process cleaned up.');
  }

  // 3. Small buffer to let network connections close
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
  SpecialUser, // Add SpecialUser model here
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
  get CustomQuizModel() { return db.getCustomQuizModel(); },
  get UserQuizScoreModel() { return db.getUserQuizScoreModel(); },
  groupChatIds: loadGroupIds(),
  userChatIds: loadUserIds(),
  saveGroupIds,
  saveUserIds,
  saveUserMap: (chatId, user) => helpers.saveUserMap(UserMap, chatId, user),
  resolveUsername: (chatId, username) => helpers.resolveUsername(bot, UserMap, chatId, username),
  activeQuizzes,
  userRegistrationState,
  noPermissions,
  getContactKeyboard: () => contactKeyboard,
  get BOT_ID() { return BOT_ID; },
  get BOT_USERNAME() { return BOT_USERNAME; },
  stopBots
};

// --- MODULES ---
deps.hangman = require('./modules/hangman')(bot, { leaderboardFile: 'leaderboard.json', wordsFile: 'words.txt' });
deps.wordchain = require('./modules/wordchain')(bot, { dictionaryFile: 'dictionary.txt' });
const quizModule = require('./modules/quiz')(bot, db);
deps.quiz = quizModule;
deps.startQuiz = quizModule.startQuiz; // Backward compatibility
deps.stopQuiz = quizModule.stopQuiz;   // Backward compatibility

require('./commands/common')(bot, deps);
require('./commands/admin')(bot, deps);
require('./commands/owner')(bot, deps);
require('./commands/games')(bot, deps);
require('./commands/welcome')(bot, deps);

const datingModule = require('./modules/dating')(bot, deps);
deps.dating = datingModule;
deps.findPotentialMatch = datingModule.findPotentialMatch;
deps.handleDatingState = datingModule.handleDatingState;

require('./events/callbackQuery')(bot, deps);
require('./modules/moderation')(bot, deps);

// --- GLOBAL MESSAGE HANDLER (Persistent State & Broadcast Sync) ---
bot.on('message', async (msg) => {
  const chatId = msg.chat.id.toString();
  const chatType = msg.chat.type;
  const isPrivate = chatType === 'private';

  try {
    await deps.saveUserMap(msg.chat.id, msg.from);

    // Check local Sets for fast response
    let isNew = false;
    if (isPrivate) {
      if (!deps.userChatIds.has(msg.chat.id)) {
        deps.userChatIds.add(msg.chat.id);
        deps.saveUserIds(deps.userChatIds);
        isNew = true;
      }
    } else {
      if (!deps.groupChatIds.has(msg.chat.id)) {
        deps.groupChatIds.add(msg.chat.id);
        deps.saveGroupIds(deps.groupChatIds);
        isNew = true;
      }
    }

    // Sync to MongoDB if it's potentially new OR periodically
    // (We also use upsert to be safe)
    if (isNew) {
      await deps.BroadcastId.updateOne(
        { chatId: chatId },
        { $set: { type: chatType } },
        { upsert: true }
      ).catch(e => console.error("Error saving ChatId to MongoDB:", e.message));
    }

    // Route to dating state machine if active
    if (isPrivate && deps.handleDatingState) {
      const handled = await deps.handleDatingState(msg);
      if (handled) return;
    }
  } catch (err) { }
});

// --- STARTUP LOGIC ---
const initializeBot = async () => {
  try {
    const me = await bot.getMe();
    BOT_ID = me.id;
    BOT_USERNAME = me.username;
    console.log(`Bot starting... Logged in as ${me.username}`);
    bot.sendMessage(logGrpid, `Bot starting... Logged in as ${me.username}`);
    const promises = botOWNER_IDS.map(id => bot.getChat(id).catch(() => null));
    const results = await Promise.all(promises);
    const ownerChats = results.filter(c => c !== null);

    const ownerButtons = ownerChats.map(chat => {
      const name = `${chat.first_name} ${chat.last_name || ''}`.trim();
      return [{ text: name, url: `tg://user?id=${chat.id}` }];
    });

    contactKeyboard = {
      inline_keyboard: [
        ...ownerButtons,
        [{ text: '🔙 Back', callback_data: 'start_menu' }]
      ]
    };

    console.log(`✅ ${ownerChats.length} contacts loaded. Bot is running!`);
  } catch (error) {
    console.error('CRITICAL ERROR on startup:', error.message);
  }
};

bot.on('polling_error', (error) => console.log(`Polling error: ${error.code} - ${error.message}`));

// Boot sequence: safe startup then initialize
(async () => {
  await startPollingClean();
  await initializeBot();
})();