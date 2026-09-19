/**
 * Load-time smoke test: requires every command/module/event file with a stub
 * bot + deps. Catches missing requires, ReferenceErrors and bad imports
 * without needing Telegram or MongoDB.
 */
process.env.BOT_TOKEN = process.env.BOT_TOKEN || '0:test';
process.env.botOWNER_IDS = process.env.botOWNER_IDS || '1,2';
process.env.mongouri = process.env.mongouri || 'mongodb://127.0.0.1:27099/none';

const EventEmitter = require('events');
const assert = require('assert');

const registered = { onText: 0, on: 0 };

function stubBot() {
  const b = new EventEmitter();
  b.onText = (re, cb) => { registered.onText++; b.on('__text__' + re.source, cb); };
  b.startPolling = async () => { };
  b.stopPolling = async () => { };
  b.isPolling = () => false;
  b.getMe = async () => ({ id: 999, is_bot: true, first_name: 'T', username: 'testbot' });
  b.sendMessage = async () => ({ message_id: 1 });
  b.sendPhoto = async () => ({ message_id: 1 });
  return b;
}

function stubModel() {
  const m = function () { };
  m.findOne = async () => null;
  m.find = async () => [];
  m.findOneAndUpdate = async () => null;
  m.updateOne = async () => null;
  m.deleteOne = async () => null;
  m.deleteMany = async () => null;
  m.countDocuments = async () => 0;
  m.aggregate = async () => [];
  return m;
}

const deps = {
  logGrpid: null,
  botOWNER_IDS: [1, 2],
  Specialuser: [1, 2],
  setSpecialuser: () => { },
  allIds: () => [],
  setAllIds: () => { },
  SpecialUser: stubModel(),
  updateUserCount_Optimized: async () => true,
  checkUserCount: async () => ({ currentCount: 0, dailyLimit: 20 }),
  updateUserLimit: async () => { },
  handlers: new Proxy({}, { get: () => async () => true }),
  Filters: { checkFilters: async () => null },
  Invite: stubModel(),
  UserMap: stubModel(),
  BannedUser: stubModel(),
  accceptMap: stubModel(),
  NSFWSetting: stubModel(),
  Antilink: stubModel(),
  AntilinkWarning: stubModel(),
  Warning: stubModel(),
  BroadcastId: stubModel(),
  CleanCommand: stubModel(),
  WelcomeSettings: stubModel(),
  Activity: stubModel(),
  GlobalUserStats: stubModel(),
  GlobalGroupStats: stubModel(),
  BadWord: stubModel(),
  CustomQuizModel: stubModel(),
  UserQuizScoreModel: stubModel(),
  DatingProfileModel: stubModel(),
  DatingLikeModel: stubModel(),
  groupChatIds: new Set(),
  userChatIds: new Set(),
  saveGroupIds: () => { },
  saveUserIds: () => { },
  saveUserMap: async () => { },
  noPermissions: {},
  activeQuizzes: {},
  userRegistrationState: {},
  BOT_ID: 999,
  BOT_USERNAME: 'testbot',
  getContactKeyboard: () => null,
  stopBots: async () => { },
  db: {
    getCustomQuizModel: stubModel,
    getUserQuizScoreModel: stubModel,
    getDatingProfileModel: stubModel,
    getDatingLikeModel: stubModel,
  },
};

const files = [
  './commands/admin',
  './commands/common',
  './commands/owner',
  './commands/ranking',
  './commands/welcome',
  './commands/games',
  './modules/moderation',
  './modules/dating',
];

const bot = stubBot();
for (const f of files) {
  require(f)(bot, deps);
  console.log(`✓ loaded ${f}`);
}

// quiz/hangman/wordchain take (bot, db)
for (const f of ['./modules/quiz', './modules/hangman', './modules/wordchain']) {
  require(f)(bot, deps.db);
  console.log(`✓ loaded ${f}`);
}

// events
require('./events/callbackQuery')(bot, deps);
console.log('✓ loaded ./events/callbackQuery');

// aii.js
const aii = require('./aii');
assert.strictEqual(typeof aii, 'function', 'aii default export is the legacy fn');
assert.strictEqual(typeof aii.aiChat, 'function', 'aii.aiChat exists');
assert.strictEqual(typeof aii.getEngine, 'function', 'aii.getEngine exists');
console.log('✓ loaded ./aii (alexa-ai adapter)');

assert.ok(registered.onText > 50, `expected many onText handlers, got ${registered.onText}`);
console.log(`\n${registered.onText} command handlers, ${registered.on} event handlers registered.`);
console.log('ALL MODULE LOAD TESTS PASSED ✅');
process.exit(0);
