/**
 * sessionManager.js
 * 
 * Manages GramJS bot sessions stored in MongoDB.
 * - First launch: creates a new session using bot token (user-mode login),
 *   stores the session string in MongoDB.
 * - Next launches: loads session string from MongoDB, validates it.
 * - If session is expired/invalid: re-creates and stores new session string.
 * 
 * For bots: uses MTProto bot login (bot token auth) so no phone/code needed.
 */

require('dotenv').config();
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const Session = require('../db/models/session');

const API_ID = Number(process.env.API_ID);
const API_HASH = process.env.API_HASH;

/**
 * Create a brand-new GramJS client authenticated as a BOT using bot token.
 * Returns { client, sessionString }
 */
async function createBotSession(botToken, label) {
  console.log(`[SessionManager] Creating new GramJS session for [${label}]...`);

  const client = new TelegramClient(new StringSession(''), API_ID, API_HASH, {
    connectionRetries: 5,
    requestRetries: 3,
    retryDelay: 2000,
    autoReconnect: true,
    useIPV6: false,
  });
  client.setLogLevel('error');

  await client.start({
    botAuthToken: botToken,
  });

  const sessionString = client.session.save();
  console.log(`[SessionManager] ✅ New session created for [${label}].`);
  return { client, sessionString };
}

/**
 * Load a session string from MongoDB by key.
 * Returns the session string or null.
 */
async function loadSessionString(key) {
  try {
    const doc = await Session.findOne({ key });
    return doc ? doc.value : null;
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
      { value },
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
 * Validate a stored session by trying to connect and calling getMe().
 * Returns true if valid, false otherwise.
 */
async function validateSession(sessionString) {
  let client;
  try {
    client = new TelegramClient(new StringSession(sessionString), API_ID, API_HASH, {
      connectionRetries: 3,
      requestRetries: 2,
      retryDelay: 1000,
      autoReconnect: false,
      useIPV6: false,
    });
    client.setLogLevel('none');
    await client.connect();
    // Try a lightweight call to verify the session is authorized
    await client.getMe();
    await client.disconnect();
    return true;
  } catch (err) {
    if (client) {
      try { await client.disconnect(); } catch (_) {}
    }
    const msg = err.message || '';
    // AUTH_KEY_UNREGISTERED, SESSION_EXPIRED, SESSION_REVOKED, AUTH_KEY_INVALID
    if (
      msg.includes('AUTH_KEY') ||
      msg.includes('SESSION_EXPIRED') ||
      msg.includes('SESSION_REVOKED') ||
      msg.includes('UNAUTHORIZED') ||
      msg.includes('not authorized')
    ) {
      console.warn(`[SessionManager] ⚠️ Session is invalid/expired: ${msg}`);
      return false;
    }
    // Network/timeout errors — don't invalidate
    console.warn(`[SessionManager] ⚠️ Session validation network error (treating as valid): ${msg}`);
    return true;
  }
}

/**
 * Main entry point.
 * 
 * Gets or creates a valid GramJS client for a bot.
 * 
 * @param {string} dbKey         - MongoDB key, e.g. 'bot_session_str'
 * @param {string} botToken      - Telegram bot token
 * @param {string} label         - Human-readable label for logs
 * @returns {TelegramClient}     - Connected GramJS client
 */
async function getOrCreateBotClient(dbKey, botToken, label) {
  let sessionString = await loadSessionString(dbKey);

  if (sessionString) {
    console.log(`[SessionManager] 🔍 Found session [${dbKey}] in MongoDB. Validating...`);
    const isValid = await validateSession(sessionString);

    if (!isValid) {
      console.warn(`[SessionManager] ♻️ Session [${dbKey}] invalid. Re-creating...`);
      await deleteSessionString(dbKey);
      sessionString = null;
    } else {
      console.log(`[SessionManager] ✅ Session [${dbKey}] is valid. Using existing session.`);
    }
  } else {
    console.log(`[SessionManager] 📭 No session found for [${dbKey}]. Creating new session...`);
  }

  if (!sessionString) {
    const { client: newClient, sessionString: newString } = await createBotSession(botToken, label);
    await saveSessionString(dbKey, newString);

    // Re-connect with the saved string for consistency
    await newClient.disconnect().catch(() => {});
    sessionString = newString;
  }

  // Now connect the final client
  const client = new TelegramClient(new StringSession(sessionString), API_ID, API_HASH, {
    connectionRetries: 10,
    requestRetries: 5,
    retryDelay: 2000,
    autoReconnect: true,
    useIPV6: false,
  });
  client.setLogLevel('error');

  await client.connect();
  console.log(`[SessionManager] 🚀 GramJS client [${label}] is connected.`);
  return client;
}

module.exports = {
  getOrCreateBotClient,
  loadSessionString,
  saveSessionString,
  deleteSessionString,
  validateSession,
};
