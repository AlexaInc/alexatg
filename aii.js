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

/**
 * Force IPv4 DNS resolution for this process.
 *
 * Many container platforms have no IPv6 route at all. When a database host
 * has both A and AAAA records, node prefers IPv6 — every connection then
 * fails with ENETUNREACH (e.g. "Cannot connect to PostgreSQL: ENETUNREACH
 * 2406:da12:...:5432"). Pinning DNS to IPv4 makes pg (and everything else)
 * dial the A record. Disable with AI_FORCE_IPV4=false.
 */
if (String(process.env.AI_FORCE_IPV4 || 'true').toLowerCase() !== 'false') {
  const dns = require('dns');
  const origLookup = dns.lookup.bind(dns);
  dns.lookup = (hostname, options, callback) => {
    if (typeof options === 'function') { callback = options; options = {}; }
    if (typeof options === 'number') options = { family: options };
    options = Object.assign({}, options, { family: 4 });
    return origLookup(hostname, options, callback);
  };
}

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

    // Keep the engine's DEFAULT persona (identity rules, triggers, memory
    // tracking) and append a hard language rule — without it the free
    // "standard" model sometimes answers in Chinese even for English input.
    const defaultPrompt = (typeof AlexaAI.SYSTEM_PROMPT === 'string' && AlexaAI.SYSTEM_PROMPT.length > 0)
      ? AlexaAI.SYSTEM_PROMPT
      : '';
    const languageRule = [
      '',
      'LANGUAGE RULE (highest priority):',
      '- Always reply in the SAME language the user wrote in.',
      '- If the message is in English, reply in English. If it is in Sinhala, reply in Sinhala.',
      '- NEVER write Chinese, Japanese or Korean characters unless the user explicitly wrote in that language first.',
      '- All punctuation, quotes and symbols must be standard Latin or the user\'s own script.',
    ].join('\n');
    const extraRules = process.env.AI_SYSTEM_PROMPT_EXTRA
      ? `\n${process.env.AI_SYSTEM_PROMPT_EXTRA}\n`
      : '';

    engine = new AlexaAI({
      key,
      postgresUrl,
      assistantName: process.env.AI_NAME || 'Alexa',
      creator: process.env.AI_CREATOR || 'Hansaka',
      model: process.env.AI_MODEL || undefined,
      fallbackModels: process.env.AI_FALLBACK_MODELS
        ? process.env.AI_FALLBACK_MODELS.split(',').map(s => s.trim()).filter(Boolean)
        : undefined,
      systemPrompt: defaultPrompt
        ? defaultPrompt + languageRule + extraRules
        : undefined,
    });
    console.log(`[aii] alexa-ai engine v${engine.version} initialised (IPv4 DNS, language rule${process.env.AI_MODEL ? `, model: ${process.env.AI_MODEL}` : ''}).`);

    // Startup connectivity self-check (fire-and-forget, non-fatal): prints a
    // precise verdict right after boot so a bad POSTGRES_URL is obvious
    // immediately after a restart instead of only on the first message.
    setTimeout(() => {
      (async () => {
        let client;
        try {
          const { Client } = require('pg');
          client = new Client({ connectionString: postgresUrl, connectionTimeoutMillis: 10000 });
          await client.connect();
          await client.query('SELECT 1');
          console.log('[aii] database check: CONNECTED ✓');
        } catch (e) {
          const msg = String((e && e.message) || e);
          console.error('[aii] database check FAILED:', msg);
          if (/password authentication failed/i.test(msg)) {
            console.error(
              '[aii] -> the database password is wrong. Fix: Supabase dashboard -> Settings -> Database -> ' +
              'reset the database password (plain letters/digits are safest), then update the POSTGRES_URL secret ' +
              'with it — NO square brackets, URL-encode special characters (@->%40, #->%23) — and RESTART this ' +
              'service: changed secrets only apply after a restart.'
            );
          } else if (/ENOTFOUND|ENETUNREACH/i.test(msg)) {
            console.error(
              '[aii] -> database host unreachable. Use the Supabase POOLER connection string ' +
              '(Connect -> Connection pooling -> Session mode) and check the project is not paused.'
            );
          } else if (/timeout|ETIMEDOUT/i.test(msg)) {
            console.error('[aii] -> database connection timed out — check the project is not paused.');
          }
        } finally {
          try { if (client) await client.end(); } catch (e2) { /* ignore */ }
        }
      })().catch(() => { /* never block startup */ });
    }, 1500);
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
    // Targeted hint for the most common misconfiguration: Supabase's direct
    // db.<ref>.supabase.co hostnames are IPv6-only and unreachable from
    // platforms without an IPv6 route — the pooler URL is the fix.
    const m = String(e.message || '');
    if (/ENOTFOUND|ENETUNREACH/.test(m) && /supabase\.co|supabase\.com/.test(m)) {
      console.error(
        '[aii] Hint: Supabase direct db.*.supabase.co hosts are IPv6-only and unreachable here. ' +
        'Use the POOLER connection string (Supabase dashboard -> Connect -> Connection pooling), e.g. ' +
        'postgresql://postgres.<project-ref>:<PASSWORD>@aws-0-<region>.pooler.supabase.com:5432/postgres ' +
        '— set it as the POSTGRES_URL secret. Also check the project is not paused (free tier pauses after inactivity).'
      );
    }
    return '❌ The AI service encountered an error. Please try again later.';
  }
}

/**
 * Stateless, anonymous single-turn chat — used by the public web demo.
 *
 * Unlike aiChat() this NEVER touches the database: no conversation row, no
 * message history, no memory rows, no usage log. The persona (including the
 * language rule) is rebuilt from the engine config on every call and the
 * reply is generated in one shot — nothing about the caller is persisted.
 *
 * @param {object} params
 * @param {string} params.message the visitor's prompt
 * @returns {Promise<{reply?:string, error?:string}>}
 */
async function aiChatEphemeral({ message } = {}) {
  const ai = getEngine();
  if (!ai) return { error: 'not_configured' };

  const text = String(message || '').trim();
  if (!text) return { error: 'empty' };

  try {
    const messages = ai.prompts.build({
      message: text,
      history: [],        // no thread history — fully stateless
      memories: {},       // no memory lookups (and no memory writes)
      userName: 'Web visitor',
      isGroup: false,
      groupName: null,
      imageContext: null,
      knownFromOtherRooms: false,
    });

    const answer = await ai.deepai.chatDetailed(messages, {});

    let reply = String((answer && answer.text) || '').trim();
    // Same cosmetic scrubbing the full pipeline applies — minus anything
    // persistent. @MEMORY tags never carry facts here (no memories exist),
    // but strip any the model volunteers anyway.
    if (/@\s*MEMORY/i.test(reply)) {
      reply = reply.replace(/@\s*MEMORY[^\n]*/gi, '').trim();
    }
    if (ai.identityGuard && typeof ai.identityGuard.sanitise === 'function') {
      try { reply = ai.identityGuard.sanitise(reply, false); } catch (e) { /* cosmetic only */ }
    }
    if (!reply) return { error: 'empty_reply' };
    return { reply };
  } catch (e) {
    const code = String((e && e.code) || '');
    if (code === 'DEEPAI_QUOTA_EXCEEDED' || /quota/i.test(String((e && e.message) || ''))) {
      return { error: 'quota' };
    }
    console.error('[aii] ephemeral chat error:', (e && e.message) || e);
    return { error: 'engine' };
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
module.exports.aiChatEphemeral = aiChatEphemeral;
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
