const callToAi = require('../aii.js');
const createQuoteSticker = require('../generatequote2');

module.exports = function (bot, deps) {
  const { Specialuser, updateUserCount_Optimized, checkUserCount } = deps;
  const { START_IMAGE_FILE_ID, getStartMessage, startKeyboard, helpMainKeyboard } = require('../utils/ui');

  bot.onText(/^\/start(?:\s|$|@)/, (msg) => {
    if (!deps.handlers.checkCommand(msg, '/start', deps.BOT_USERNAME)) return;
    const chatId = msg.chat.id;
    const senderName = msg.from.first_name || 'User';
    const caption = getStartMessage(senderName);

    bot.sendPhoto(chatId, START_IMAGE_FILE_ID, {
      caption: caption,
      parse_mode: 'HTML',
      reply_markup: startKeyboard
    }).catch((err) => {
      bot.sendMessage(chatId, caption, {
        parse_mode: 'HTML',
        reply_markup: startKeyboard
      });
    });
  });

  bot.onText(/^\/help(?:\s|$|@)/, (msg) => {
    if (!deps.handlers.checkCommand(msg, '/help', deps.BOT_USERNAME)) return;
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, 'Please select a command category:', {
      reply_markup: helpMainKeyboard,
      parse_mode: 'HTML'
    });
  });

  bot.onText(/^\/ai(?:\s|$|@)/, async (msg) => {
    if (!deps.handlers.checkCommand(msg, '/ai', deps.BOT_USERNAME)) return;
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const isSpecialUser = Specialuser.includes(userId);
    const text = msg.text || '';

    const usermsg = text.includes(' ') ? text.substring(text.indexOf(' ') + 1) : '';

    if (!usermsg && !isSpecialUser) {
      return bot.sendMessage(chatId, "Please provide a prompt. \nExample: `/ai What is a bot?`", { reply_to_message_id: msg.message_id, parse_mode: 'Markdown' });
    }

    let uid = (chatId == userId) ? chatId : `${chatId}@${userId}`;

    try {
      if (isSpecialUser) {
        const aimsg = await callToAi(usermsg, uid);
        bot.sendMessage(chatId, aimsg, { reply_to_message_id: msg.message_id });
      } else {
        const countWasIncremented = await updateUserCount_Optimized(uid);
        if (countWasIncremented) {
          const aimsg = await callToAi(usermsg, uid);
          bot.sendMessage(chatId, aimsg, { reply_to_message_id: msg.message_id });
        } else {
          bot.sendMessage(chatId, "Your daily AI limit has been reached.", { reply_to_message_id: msg.message_id });
        }
      }
    } catch (err) {
      console.error("AI command error:", err);
      bot.sendMessage(chatId, "❌ AI service encountered an error.");
    }
  });

  bot.onText(/^\/aic(?:\s|$|@)/, async (msg) => {
    if (!deps.handlers.checkCommand(msg, '/aic', deps.BOT_USERNAME)) return;
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const isSpecialUser = Specialuser.includes(userId);
    let uid = (chatId == userId) ? chatId : `${chatId}@${userId}`;

    if (isSpecialUser) {
      return bot.sendMessage(chatId, "You are a special user with unlimited AI usage! 🚀");
    }

    try {
      const { currentCount, dailyLimit } = await checkUserCount(uid);
      const remaining = dailyLimit - currentCount;
      bot.sendMessage(chatId, `📊 **AI Usage Stats**\nUsed: \`${currentCount}\`\nRemaining: \`${remaining}\`\nDaily Limit: \`${dailyLimit}\``, { parse_mode: 'Markdown' });
    } catch (err) {
      bot.sendMessage(chatId, "❌ Could not check AI limit status.");
    }
  });

  bot.onText(/^\/(send|go)(?:\s|$|@)/, async (msg) => {
    const cmd = msg.text.split(' ')[0].toLowerCase().split('@')[0];
    if (cmd !== '/send' && cmd !== '/go') return;
    if (msg.text.includes('@') && !msg.text.includes(`@${deps.BOT_USERNAME}`)) return;
    const chatId = msg.chat.id;
    try {
      const from = msg.from;
      const { getProfilePhoto, downloadImage } = deps.handlers;
      const userPhotourl = await getProfilePhoto(bot, from.id);
      const userPhoto = userPhotourl ? await downloadImage(userPhotourl) : null;
      const chat = await bot.getChat(from.id).catch(() => ({}));

      let replymsgUser = null;
      let replymsgContent = null;
      let replySenderColor = null;

      if (msg.reply_to_message) {
        const rFrom = msg.reply_to_message.from;
        replymsgUser = `${rFrom.first_name} ${rFrom.last_name || ''}`.trim() || 'Unknown';
        replymsgContent = msg.reply_to_message.text || msg.reply_to_message.caption || null;
        const rChat = await bot.getChat(rFrom.id).catch(() => ({}));
        replySenderColor = rChat.accent_color_id;
      }

      const text = msg.text.split(/\s+/).slice(1).join(' ') || (msg.reply_to_message ? msg.reply_to_message.text : '');
      if (!text) return;

      const stickerBuffer = await createQuoteSticker(
        from.first_name || '',
        from.last_name || '',
        chat.emoji_status_custom_emoji_id,
        text,
        chat.accent_color_id,
        userPhoto,
        replymsgUser,
        replymsgContent,
        replySenderColor
      );

      const fileOptions = {
        filename: 'quote_sticker.webp',
        contentType: 'image/webp'
      };

      await bot.sendSticker(chatId, stickerBuffer, {
        reply_to_message_id: msg.reply_to_message?.message_id
      }, fileOptions);

    } catch (err) {
      console.error("Quote command error:", err);
      bot.sendMessage(chatId, "❌ Failed to generate quote sticker.");
    }
  });

  bot.onText(/^\/id(?:\s|$|@)/, (msg) => {
    if (!deps.handlers.checkCommand(msg, '/id', deps.BOT_USERNAME)) return;
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    let text = `ID information:\nChat ID: \`${chatId}\`\nUser ID: \`${userId}\``;
    if (msg.reply_to_message) {
      text += `\nReplied User ID: \`${msg.reply_to_message.from.id}\``;
    }
    bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
  });
};
