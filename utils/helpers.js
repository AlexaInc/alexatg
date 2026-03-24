const axios = require('axios');
const https = require('https');
const moment = require('moment-timezone');

const adminCache = {};

function getMessageType(msg) {
  if (!msg) return null;

  const result = {
    type: null,
    file_id: null,
    caption: msg.caption || null,
    entities: msg.caption_entities || msg.entities || null
  };

  if (msg.photo) {
    result.type = "image";
    result.file_id = msg.photo[msg.photo.length - 1].file_id;
  } else if (msg.video) {
    result.type = "video";
    result.file_id = msg.video.file_id;
  } else if (msg.document) {
    result.type = "document";
    result.file_id = msg.document.file_id;
  } else if (msg.sticker) {
    result.type = "sticker";
    result.file_id = msg.sticker.file_id;
  } else if (msg.animation) {
    result.type = "gif";
    result.file_id = msg.animation.file_id;
  } else if (msg.audio) {
    result.type = "audio";
    result.file_id = msg.audio.file_id;
  } else if (msg.voice) {
    result.type = "voice";
    result.file_id = msg.voice.file_id;
  } else if (msg.video_note) {
    result.type = "video_note";
    result.file_id = msg.video_note.file_id;
  } else if (msg.text) {
    result.type = "text";
    result.file_id = msg.text;
  } else {
    return null;
  }

  return result;
}

function checkCommand(msg, cmd, botUsername) {
  if (!msg.text) return false;
  const parts = msg.text.split(/\s+/)[0].toLowerCase().split('@');
  const mainCmd = parts[0];
  const username = parts[1];

  if (mainCmd !== cmd.toLowerCase()) return false;
  if (username && botUsername && username.toLowerCase() !== botUsername.toLowerCase()) return false;
  return true;
}

function parseFilterTriggers(commandText) {
  const args = commandText.trim().split(/ +/).slice(1);
  const txt = args.join(" ");
  if (!txt) return [];

  const match = txt.match(/^\(\s*([\s\S]*?)\s*\)$/);
  if (match) {
    const inside = match[1];
    return inside
      .split(",")
      .map(x => x.trim())
      .filter(x => x.length > 0);
  }
  return [txt];
}

function wrapTextSmart(text, maxCharsPerLine = 30) {
  const words = text.split(' ');
  const lines = [];
  let currentLine = '';

  for (const word of words) {
    if ((currentLine + (currentLine ? ' ' : '') + word).length <= maxCharsPerLine) {
      currentLine += (currentLine ? ' ' : '') + word;
    } else {
      if (currentLine) lines.push(currentLine + '   ');
      currentLine = word;
    }
  }

  if (currentLine) lines.push(currentLine + '   ');
  return lines.join('\n');
}

async function getBuffer(url) {
  try {
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    return Buffer.from(response.data, 'binary');
  } catch (err) {
    console.error("Error downloading buffer:", err);
    return null;
  }
}

function downloadImage(url) {
  return new Promise((resolve, reject) => {
    const options = { family: 4 };
    const request = https.get(url, options, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to get image, status code: ${response.statusCode}`));
        return;
      }

      const data = [];
      response.on('data', (chunk) => {
        data.push(chunk);
      });

      response.on('end', () => {
        resolve(Buffer.concat(data));
      });
    });

    request.on('error', (err) => {
      reject(err);
    });
  });
}

async function getProfilePhoto(bot, userId) {
  try {
    const photos = await bot.getUserProfilePhotos(userId, { limit: 1 });
    if (photos.total_count > 0) {
      const fileId = photos.photos[0][photos.photos[0].length - 1].file_id;
      return await bot.getFileLink(fileId);
    }
  } catch (e) { /* ignore */ }
  try {
    const chat = await bot.getChat(userId);
    if (chat.photo) {
      const fileId = chat.photo.big_file_id;
      return await bot.getFileLink(fileId);
    }
  } catch (e) { /* ignore */ }
  return undefined;
}

async function getAdmins(bot, chatId, forceRefresh = false) {
  if (!forceRefresh && adminCache[chatId]) {
    return adminCache[chatId];
  }
  try {
    const admins = await bot.getChatAdministrators(chatId);
    adminCache[chatId] = admins;
    return admins;
  } catch (err) {
    console.error(`Error fetching admins for ${chatId}:`, err);
    return adminCache[chatId] || [];
  }
}

async function checkAdminPermissions(bot, msg, botOWNER_IDS, BOT_ID, requiredPermission = null, forceRefresh = false) {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const chatType = msg.chat.type;

  if (chatType !== 'group' && chatType !== 'supergroup') {
    return "This command can only be used in group chats.";
  }

  try {
    const admins = await getAdmins(bot, chatId, forceRefresh);
    const isBotOwner = botOWNER_IDS.includes(userId);

    const userMember = admins.find(a => a.user.id === userId);
    const isAdmin = ['creator', 'administrator'].includes(userMember?.status);

    if (!isBotOwner && !isAdmin) {
      return "You must be an admin in this group (or the bot owner) to use this command.";
    }

    if (requiredPermission && !isBotOwner) {
      if (userMember.status !== 'creator' && !userMember[requiredPermission]) {
        // Instead of returning error, return an object indicating missing permission
        // to trigger the "pin request" logic if needed.
        return { errorType: 'MISSING_PERMISSION', missingPermission: requiredPermission };
      }
    }

    if (!BOT_ID) {
      return "Bot is still initializing, please try again in a moment.";
    }

    const botMember = admins.find(a => a.user.id === BOT_ID);
    if (!botMember || botMember.status !== 'administrator') {
      return "I must be an admin in this chat to work.";
    }

    if (requiredPermission && !botMember[requiredPermission]) {
      return `I am an admin, but I am missing the '${requiredPermission.replace('can_', '').replace(/_/g, ' ')}' permission.`;
    }

    // Default check if no specific permission is requested
    if (!requiredPermission && !botMember.can_delete_messages) {
      return "I'm an admin, but I'm missing the 'Can delete messages' permission.";
    }

    return null;
  } catch (err) {
    console.error(`Error checking permissions in chat ${chatId}:`, err);
    return "An error occurred while checking permissions.";
  }
}

async function saveUserMap(UserMap, chatId, user) {
  if (!user) return;
  await UserMap.updateOne(
    { groupId: chatId, userId: user.id },
    { username: user.username || null, firstName: user.first_name },
    { upsert: true }
  );
}

async function resolveUsername(bot, UserMap, chatId, username) {
  try {
    const member = await bot.getChatMember(chatId, username);
    return member.user.id;
  } catch {
    const mapping = await UserMap.findOne({ groupId: chatId, username });
    return mapping ? mapping.userId : null;
  }
}

async function getTarget(bot, UserMap, msg, args) {
  const chatId = msg.chat.id;
  let targetUserId = null;
  let targetUserName = null;
  let durationArgs = [...args];

  try {
    if (msg.reply_to_message) {
      targetUserId = msg.reply_to_message.from.id;
      targetUserName = msg.reply_to_message.from.first_name;
    } else if (msg.entities) {
      const mention = msg.entities.find(
        (e) => e.type === "text_mention" || e.type === "mention"
      );

      if (mention) {
        let mentionText = '';
        if (mention.type === "text_mention") {
          targetUserId = mention.user.id;
          targetUserName = mention.user.first_name;
          mentionText = msg.text.substr(mention.offset, mention.length);
          await saveUserMap(UserMap, chatId, mention.user);
        } else if (mention.type === "mention") {
          const username = msg.text
            .substr(mention.offset, mention.length)
            .replace("@", "");
          mentionText = `@${username}`;
          targetUserId = await resolveUsername(bot, UserMap, chatId, username);

          if (!targetUserId) {
            return { error: `❌ Cannot find @${username}. They must be in the group at least once.` };
          }
          targetUserName = `@${username}`;
        }
        durationArgs = args.filter(arg => arg !== mentionText);
      }
    }

    if (!targetUserId && args[0] && /^\d+$/.test(args[0])) {
      targetUserId = args[0];
      targetUserName = `User (${targetUserId})`;
      durationArgs = args.slice(1);
    }

    if (!targetUserId) {
      return { error: "You must reply to a user, provide their User ID, or @mention them." };
    }

    return { targetUserId, targetUserName, durationArgs };
  } catch (e) {
    console.error(e);
    return { error: "An internal error occurred while finding the user." };
  }
}

async function handleAnonymous(bot, msg, action, targetId, extra = "") {
  if (msg.from.username === 'GroupAnonymousBot') {
    const callbackData = `verify_${action}_${targetId}_${extra}`.substring(0, 64);
    await bot.sendMessage(msg.chat.id, "⚠️ You appear to be anonymous. Please click the button below to verify your admin status and perform this action.", {
      reply_markup: {
        inline_keyboard: [[
          { text: "✅ Prove I'm Admin & Execute", callback_data: callbackData }
        ]]
      }
    });
    return true;
  }
  return false;
}

/**
 * Splits an array into chunks of a specific size
 */
function chunkArray(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

/**
 * Adds a delay (Promise-based)
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Returns a greeting based on the current time in Asia/Colombo.
 * @returns {string}
 */
function getGreeting() {
  const hour = moment().tz("Asia/Colombo").hour();
  if (hour >= 5 && hour < 12) return "Good Morning ☀️";
  if (hour >= 12 && hour < 17) return "Good Afternoon ☀️";
  if (hour >= 17 && hour < 20) return "Good Evening 🌆";
  return "Good Night 🌙";
}

/**
 * Escapes HTML special characters.
 */
const escapeHTML = (str) => str.replace(/[&<>"']/g, m => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[m]);

/**
 * Converts Telegram message with entities to HTML string.
 */
function toHTML(text, entities) {
  if (!text) return "";
  if (!entities || entities.length === 0) return escapeHTML(text);

  const tags = [];
  entities.forEach(e => {
    let start = "";
    let end = "";
    switch (e.type) {
      case 'bold': start = "<b>"; end = "</b>"; break;
      case 'italic': start = "<i>"; end = "</i>"; break;
      case 'underline': start = "<u>"; end = "</u>"; break;
      case 'strikethrough': start = "<s>"; end = "</s>"; break;
      case 'code': start = "<code>"; end = "</code>"; break;
      case 'pre': start = "<pre>"; end = "</pre>"; break;
      case 'text_link': start = `<a href="${e.url}">`; end = "</a>"; break;
      case 'spoiler': start = '<span class="tg-spoiler">'; end = "</span>"; break;
      case 'custom_emoji': start = `<tg-emoji emoji-id="${e.custom_emoji_id}">`; end = "</tg-emoji>"; break;
      case 'text_mention': start = `<a href="tg://user?id=${e.user.id}">`; end = "</a>"; break;
      case 'blockquote': start = "<blockquote>"; end = "</blockquote>"; break;
      case 'expandable_blockquote': start = "<blockquote expandable>"; end = "</blockquote>"; break;
    }
    if (start) {
      tags.push({ pos: e.offset, tag: start, type: 'start' });
      tags.push({ pos: e.offset + e.length, tag: end, type: 'end' });
    }
  });

  tags.sort((a, b) => a.pos - b.pos || (a.type === 'end' ? -1 : 1));

  let html = "";
  let lastPos = 0;
  tags.forEach(t => {
    html += escapeHTML(text.substring(lastPos, t.pos));
    html += t.tag;
    lastPos = t.pos;
  });
  html += escapeHTML(text.substring(lastPos));
  return html;
}

module.exports = {
  toHTML,
  escapeHTML,
  getMessageType,
  parseFilterTriggers,
  wrapTextSmart,
  getBuffer,
  downloadImage,
  getProfilePhoto,
  checkAdminPermissions,
  getAdmins,
  saveUserMap,
  resolveUsername,
  getTarget,
  handleAnonymous,
  checkCommand,
  getGreeting,
  chunkArray,
  sleep,
  getUserbotClient,
  getJoinedEntity,
  setCachedUserbotId,
  getCachedUserbotId
};

let cachedUserbotId = null;

function setCachedUserbotId(id) {
  cachedUserbotId = String(id);
}

function getCachedUserbotId() {
  return cachedUserbotId;
}

async function getUserbotClient() {
  const { TelegramClient } = require('telegram');
  const { StringSession } = require('telegram/sessions');
  const fs = require('fs');

  try {
    let sessionData = process.env.SESSION_STRING;

    if (!sessionData && fs.existsSync("session.txt")) {
      sessionData = fs.readFileSync("session.txt", "utf8").trim();
    }

    if (!sessionData) return null;

    if (!process.env.API_ID || !process.env.API_HASH) {
      console.error("❌ API_ID or API_HASH is missing in .env. Userbot features will not work.");
      return null;
    }

    const client = new TelegramClient(new StringSession(sessionData), Number(process.env.API_ID), process.env.API_HASH, {
      connectionRetries: 10,
      requestRetries: 5,
      retryDelay: 2000,
      receiveUpdates: false,
      autoReconnect: true,
    });
    await client.connect();
    return client;
  } catch (err) {
    console.error("Userbot client error:", err);
    return null;
  }
}

async function getJoinedEntity(client, bot, chatId) {
  const { Api } = require('telegram');
  try {
    return await client.getEntity(chatId);
  } catch (e) {
    let inviteLink = await bot.exportChatInviteLink(chatId).catch(() => bot.getChat(chatId).then(c => c.invite_link));
    if (!inviteLink) throw new Error("Could not get an invite link.");
    const hash = inviteLink.split('/').pop().replace('+', '');
    await client.invoke(new Api.messages.ImportChatInvite({ hash }));
    return await client.getEntity(chatId);
  }
}
