/**
 * aii.js — AI layer for the Telegram bot, powered by `alexa-ai`.
 *
 * The alexa-ai engine (DeepAI + PostgreSQL) speaks "WhatsApp jids", so this
 * adapter maps Telegram ids onto that namespace:
 *
 *   Telegram user  123456789          ->  123456789@lid        (one person)
 *   Telegram group -1001234567890     ->  -1001234567890@g.us  (one thread)
 *
 * Memory is therefore per-person across every chat, and each group keeps its
 * own conversation thread — exactly like the WhatsApp bot.
 *
 * Required .env:
 *   DEEPAI_API_KEY=tryit-...      (a free anonymous key works for chat)
 *   POSTGRES_URL=postgres://...   (e.g. a free Neon/Supabase database)
 *
 * The engine is created LAZILY and never throws at require time — a missing
 * key must not take the bot (or the Space) down.
 */

const AlexaAI = require('alexa-ai');

/** Singleton engine — one PostgreSQL pool for the whole process. */
let engine = null;
let engineTried = false;
let engineError = null;

function getEngine() {
  if (engineTried) return engine;
  engineTried = true;
  try {
    const key = process.env.DEEPAI_API_KEY || process.env.DEEPAI_KEY;
    const postgresUrl = process.env.POSTGRES_URL || process.env.DATABASE_URL;
    if (!key || !postgresUrl) {
      engineError = 'Missing DEEPAI_API_KEY / POSTGRES_URL in the environment.';
      console.error(`[aii] AI engine disabled: ${engineError}`);
      return null;
    }
    engine = new AlexaAI({
      key,
      postgresUrl,
      assistantName: process.env.AI_NAME || 'Alexa',
      creator: process.env.AI_CREATOR || 'Hansaka',
    });
    console.log(`[aii] alexa-ai engine v${engine.version} initialised.`);
  } catch (e) {
    engineError = e.message;
    console.error('[aii] Failed to initialise alexa-ai:', e.message);
  }
  return engine;
}

/** Telegram user id -> engine user jid */
function toUserJid(telegramId) {
  return `${telegramId}@lid`;
}

/** Telegram chat id -> engine group jid ('' for private chats) */
function toGroupJid(chatId, chatType) {
  if (!chatType || chatType === 'private') return '';
  return `${chatId}@g.us`;
}

const NOT_CONFIGURED_MSG =
  '🤖 The AI service is not configured yet. ' +
  'The owner needs to set DEEPAI_API_KEY and POSTGRES_URL.';

/**
 * Main entry point used by /ai.
 *
 * @param {object} params
 * @param {string} params.message      the user's prompt
 * @param {number} params.userId       Telegram user id of the sender
 * @param {number} [params.chatId]     Telegram chat id (omit/DM for private)
 * @param {string} [params.chatType]   'private' | 'group' | 'supergroup' | 'channel'
 * @param {string} [params.userName]   sender display name
 * @param {string} [params.chatName]   group title
 * @param {object} [params.image]      Buffer / data URI / URL of an attached image
 * @param {string} [params.messageId]  Telegram message id (dedup)
 * @returns {Promise<string>} WhatsApp-ready reply text (never throws)
 */
async function aiChat(params = {}) {
  const ai = getEngine();
  if (!ai) return NOT_CONFIGURED_MSG;

  const {
    message,
    userId,
    chatId,
    chatType,
    userName,
    chatName,
    image,
    messageId,
  } = params;

  if (!message && !image) {
    return 'Please add a prompt, e.g. <code>/ai What is a bot?</code>';
  }

  try {
    const result = await ai.chat({
      message: message || '',
      userId: toUserJid(userId),
      groupId: toGroupJid(chatId, chatType),
      userName: userName || 'there',
      groupName: chatName || undefined,
      image: image || undefined,
      messageId: messageId ? String(messageId) : undefined,
    });

    if (result && result.error) {
      if (result.error === 'DEEPAI_QUOTA_EXCEEDED') {
        return '⏳ The AI service is at its quota right now — please try again in a little while.';
      }
      if (result.error === 'user_blocked') {
        return '🚫 You are blocked from using the AI.';
      }
      if (result.error === 'group_disabled') {
        return ''; // AI disabled in this group — stay silent
      }
    }

    const text = (result && result.text) || '';
    if (!text) return '🤖 The AI could not answer that — please try again.';
    return text;
  } catch (e) {
    console.error('[aii] ai.chat error:', e.message);
    return '❌ The AI service encountered an error. Please try again later.';
  }
}

/**
 * Backwards-compatible signature: callToAi(prompt, uid)
 * where uid is either a chatId (DM) or `${chatId}@${userId}` (group).
 */
async function callToAi(prompt, uid) {
  const at = String(uid || '').indexOf('@');
  if (at === -1) {
    // private chat — uid is the user's own chat id
    return aiChat({ message: prompt, userId: uid, chatId: uid, chatType: 'private' });
  }
  const chatId = Number(String(uid).slice(0, at));
  const userId = Number(String(uid).slice(at + 1));
  return aiChat({
    message: prompt,
    userId,
    chatId,
    chatType: chatId === userId ? 'private' : 'group',
  });
}

// Expose the legacy function as the module default (commands/common.js shape)
module.exports = callToAi;

// ...plus the richer API and helpers
module.exports.aiChat = aiChat;
module.exports.callToAi = callToAi;
module.exports.getEngine = getEngine;
module.exports.toUserJid = toUserJid;
module.exports.toGroupJid = toGroupJid;

// Lazy proxies to useful engine extras (image generation, web search)
module.exports.generateImage = async (...args) => {
  const ai = getEngine();
  if (!ai) throw new Error(NOT_CONFIGURED_MSG);
  return ai.generateImage(...args);
};
module.exports.searchWeb = async (...args) => {
  const ai = getEngine();
  if (!ai) throw new Error(NOT_CONFIGURED_MSG);
  return ai.searchWeb(...args);
};
