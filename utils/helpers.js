const axios = require('axios');
const https = require('https');

const adminCache = {};

function getMessageType(msg) {
  if (!msg) return null;

  if (msg.photo)
    return { type: "image", file_id: msg.photo[msg.photo.length - 1].file_id };

  if (msg.video)
    return { type: "video", file_id: msg.video.file_id };

  if (msg.document)
    return { type: "document", file_id: msg.document.file_id };

  if (msg.sticker)
    return { type: "sticker", file_id: msg.sticker.file_id };

  if (msg.animation)
    return { type: "gif", file_id: msg.animation.file_id };

  if (msg.audio)
    return { type: "audio", file_id: msg.audio.file_id };

  if (msg.voice)
    return { type: "voice", file_id: msg.voice.file_id };

  if (msg.video_note)
    return { type: "video_note", file_id: msg.video_note.file_id };

  if (msg.text)
    return { type: "text", file_id: msg.text };

  return null;
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

module.exports = {
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
  getGreeting,
  chunkArray,
  sleep
};
