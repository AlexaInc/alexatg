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
const { Invite, UserMap, BannedUser, NSFWSetting, accceptMap } = db;

// --- CONFIG ---
const BOT_TOKEN = process.env.BOT_TOKEN;
const botOWNER_IDS = process.env.botOWNER_IDS.split(',').map(id => parseInt(id));
const { readIds, writeIds, loadIdsToVariable } = require('./idsManager');
let allIds = loadIdsToVariable();
let Specialuser = [...botOWNER_IDS, ...allIds];
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
const bot = new TelegramBot(BOT_TOKEN, {
  polling: true,
  request: {
    agentOptions: {
      keepAlive: true,
      family: 4
    }
  }
});

let BOT_ID;
let contactKeyboard = null;

// --- INITIALIZATION ---
db.connectToDatabases();

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
  writeIds,
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

const datingModule = require('./modules/dating')(bot, deps);
deps.dating = datingModule;
deps.findPotentialMatch = datingModule.findPotentialMatch;
deps.handleDatingState = datingModule.handleDatingState;

require('./events/callbackQuery')(bot, deps);
require('./modules/moderation')(bot, deps);

// --- GLOBAL MESSAGE HANDLER (Persistent State) ---
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const isPrivate = msg.chat.type === 'private';
  try {
    await deps.saveUserMap(chatId, msg.from);
    if (isPrivate) {
      if (!deps.userChatIds.has(chatId)) {
        deps.userChatIds.add(chatId);
        saveUserIds();
      }
      // Route to dating state machine if active
      if (deps.handleDatingState) {
        const handled = await deps.handleDatingState(msg);
        if (handled) return;
      }
    } else {
      if (!deps.groupChatIds.has(chatId)) {
        deps.groupChatIds.add(chatId);
        saveGroupIds();
      }
    }
  } catch (err) { }
});

// --- STARTUP LOGIC ---
const initializeBot = async () => {
  try {
    const me = await bot.getMe();
    BOT_ID = me.id;
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

initializeBot();