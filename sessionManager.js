/**
 * sessionManager.js
 *
 * Manages GramJS bot sessions stored in MongoDB.
 * - First launch: creates a new session using bot token auth, stores in MongoDB.
 * - Next launches: loads session string, validates it, reconnects.
 * - If session is expired/invalid/corrupt: deletes and re-creates automatically.
 */

require('dotenv').config();
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const Session = require('../db/models/session');

const API_ID = Number(process.env.API_ID);
const API_HASH = process.env.API_HASH;

/**
 * Create a brand-new GramJS bot session using bot token auth.
 * Returns { client, sessionString }
 */
async function createBotSession(botToken, label) {
  console.log(`[SessionManager] 🔨 Creating new GramJS session for [${label}]...`);

  const client = new TelegramClient(new StringSession(''), API_ID, API_HASH, {
    connectionRetries: 5,
    requestRetries: 3,
    retryDelay: 2000,
    autoReconnect: true,
    useIPV6: false,
  });
  client.setLogLevel('error');

  await client.start({ botAuthToken: botToken });

  const sessionString = client.session.save();
  console.log(`[SessionManager] ✅ New session created for [${label}].`);
  return { client, sessionString };
}

/**
 * Load a session string from MongoDB by key.
 * Always returns a plain string or null — never an object.
 */
async function loadSessionString(key) {
  try {
    const doc = await Session.findOne({ key });
    if (!doc) return null;
    const val = doc.value;
    // Ensure we return a plain string, not an object
    if (typeof val === 'string') return val.trim() || null;
    if (val && typeof val === 'object' && val.session) return String(val.session).trim() || null;
    return null;
  } catch (err) {
    console.error(`[SessionManager] ❌ Failed to load session [${key}]:`, err.message);
    return null;
  }
}

/**
 * Save a session string to MongoDB by key (upsert).
 */
async function saveSessionString(key, value) {
  try {
    await Session.findOneAndUpdate(
      { key },
      { value: String(value) },
      { upsert: true, new: true }
    );
    console.log(`[SessionManager] 💾 Session [${key}] saved to MongoDB.`);
  } catch (err) {
    console.error(`[SessionManager] ❌ Failed to save session [${key}]:`, err.message);
  }
}

/**
 * Delete a session from MongoDB by key.
 */
async function deleteSessionString(key) {
  try {
    await Session.deleteOne({ key });
    console.log(`[SessionManager] 🗑️ Session [${key}] deleted from MongoDB.`);
  } catch (err) {
    console.error(`[SessionManager] ❌ Failed to delete session [${key}]:`, err.message);
  }
}

/**
 * Validate a stored session string.
 * Returns true if usable, false if it must be recreated.
 */
async function validateSession(sessionString) {
  // Sanity check — must be a non-empty string
  if (!sessionString || typeof sessionString !== 'string' || !sessionString.trim()) {
    console.warn(`[SessionManager] ⚠️ Session value is not a valid string — will recreate.`);
    return false;
  }

  let client;
  try {
    // StringSession constructor throws "Not a valid string" for bad format
    const session = new StringSession(sessionString.trim());

    client = new TelegramClient(session, API_ID, API_HASH, {
      connectionRetries: 3,
      requestRetries: 2,
      retryDelay: 1000,
      autoReconnect: false,
      useIPV6: false,
    });
    client.setLogLevel('none');
    await client.connect();
    await client.getMe();
    await client.disconnect();
    return true;
  } catch (err) {
    if (client) {
      try { await client.disconnect(); } catch (_) {}
    }
    const msg = err.message || '';

    // These definitively mean the session is bad — must recreate
    const invalidMarkers = [
      'AUTH_KEY', 'SESSION_EXPIRED', 'SESSION_REVOKED',
      'UNAUTHORIZED', 'not authorized', 'Not a valid string',
      'USER_DEACTIVATED', 'CONNECTION_DEVICE_MODEL_INVALID',
    ];
    if (invalidMarkers.some(s => msg.includes(s))) {
      console.warn(`[SessionManager] ⚠️ Session invalid/expired (${msg}) — will recreate.`);
      return false;
    }

    // Network/timeout errors — keep session, it may work on next connect
    console.warn(`[SessionManager] ⚠️ Session validation network error (keeping session): ${msg}`);
    return true;
  }
}

/**
 * Main entry: get or create a valid connected GramJS bot client.
 *
 * @param {string} dbKey      MongoDB session key (e.g. 'bot_session_str')
 * @param {string} botToken   Telegram bot token
 * @param {string} label      Human-readable label for logs
 * @returns {TelegramClient}  Connected GramJS client
 */
async function getOrCreateBotClient(dbKey, botToken, label) {
  let sessionString = await loadSessionString(dbKey);

  if (sessionString) {
    console.log(`[SessionManager] 🔍 Found session [${dbKey}] in MongoDB. Validating...`);
    const isValid = await validateSession(sessionString);

    if (!isValid) {
      console.warn(`[SessionManager] ♻️ Session [${dbKey}] invalid — deleting and recreating...`);
      await deleteSessionString(dbKey);
      sessionString = null;
    } else {
      console.log(`[SessionManager] ✅ Session [${dbKey}] is valid.`);
    }
  } else {
    console.log(`[SessionManager] 📭 No session found for [${dbKey}] — creating new...`);
  }

  if (!sessionString) {
    const { client: newClient, sessionString: newString } = await createBotSession(botToken, label);
    await saveSessionString(dbKey, newString);
    await newClient.disconnect().catch(() => {});
    sessionString = newString;
  }

  // Final connection with the confirmed valid session string
  const trimmed = sessionString.trim();
  const client = new TelegramClient(new StringSession(trimmed), API_ID, API_HASH, {
    connectionRetries: 10,
    requestRetries: 5,
    retryDelay: 2000,
    autoReconnect: true,
    useIPV6: false,
  });
  client.setLogLevel('error');

  await client.connect();
  console.log(`[SessionManager] 🚀 GramJS client [${label}] connected.`);
  return client;
}

module.exports = {
  getOrCreateBotClient,
  loadSessionString,
  saveSessionString,
  deleteSessionString,
  validateSession,
};
