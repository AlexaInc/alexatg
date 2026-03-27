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

      let text = msg.text.split(/\s+/).slice(1).join(' ');
      let entities = [];

      if (text) {
        const originalOffset = msg.text.indexOf(text);
        if (originalOffset !== -1) {
          entities = (msg.entities || []).filter(e => e.offset >= originalOffset).map(e => ({ ...e, offset: e.offset - originalOffset }));
        }
      } else if (msg.reply_to_message) {
        text = msg.reply_to_message.text || msg.reply_to_message.caption || '';
        entities = msg.reply_to_message.entities || msg.reply_to_message.caption_entities || [];
      }

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
        replySenderColor,
        entities
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
    }
  });

  bot.onText(/^\/q(?:\s|$|@)/, async (msg) => {
    if (!deps.handlers.checkCommand(msg, '/q', deps.BOT_USERNAME)) return;
    const chatId = msg.chat.id;
    if (!msg.reply_to_message) {
      return bot.sendMessage(chatId, "Reply to a message with `/q` to create a quote sticker. Use `/q r` to include the reply context.", { parse_mode: 'Markdown' });
    }

    const targetMsg = msg.reply_to_message;
    const args = msg.text.split(/\s+/).slice(1).map(a => a.toLowerCase());
    const withReply = args.includes('r');

    try {
      const from = targetMsg.from;
      const { getProfilePhoto, downloadImage, getUserbotClient, getJoinedEntity } = deps.handlers;

      const userPhotourl = await getProfilePhoto(bot, from.id);
      const userPhoto = userPhotourl ? await downloadImage(userPhotourl) : null;
      const chat = await bot.getChat(from.id).catch(() => ({}));

      let replymsgUser = null;
      let replymsgContent = null;
      let replySenderColor = null;

      if (withReply) {
        const client = await getUserbotClient();
        if (client) {
          try {
            const chatEntity = await getJoinedEntity(client, bot, chatId);
            const messages = await client.getMessages(chatEntity, { ids: [targetMsg.message_id] });
            const fullTargetMsg = messages[0];

            if (fullTargetMsg && fullTargetMsg.replyTo) {
              const gfId = fullTargetMsg.replyTo.replyToMsgId;
              const gfMsgs = await client.getMessages(chatEntity, { ids: [gfId] });
              const gfMsg = gfMsgs[0];

              if (gfMsg) {
                const gfSender = gfMsg.sender;
                replymsgUser = (gfSender ? (gfSender.firstName || '') + ' ' + (gfSender.lastName || '') : 'Unknown').trim() || 'Deleted User';
                replymsgContent = gfMsg.message || gfMsg.caption || 'Media';
                replySenderColor = (gfSender && gfSender.color) ? gfSender.color.colorId : (Math.floor(Math.random() * 7));
              }
            }
          } catch (e) {
            console.warn("Userbot failed to fetch GF message:", e.message);
          } finally {
            await client.disconnect().catch(() => { });
          }
        }
      } else if (targetMsg.reply_to_message) {
        // Fallback to bot API if bot happens to have the replied message in cache
        const rFrom = targetMsg.reply_to_message.from;
        replymsgUser = `${rFrom.first_name} ${rFrom.last_name || ''}`.trim() || 'Unknown';
        replymsgContent = targetMsg.reply_to_message.text || targetMsg.reply_to_message.caption || null;
        const rChat = await bot.getChat(rFrom.id).catch(() => ({}));
        replySenderColor = rChat.accent_color_id;
      }

      const text = targetMsg.text || targetMsg.caption || '';
      const entities = targetMsg.entities || targetMsg.caption_entities || [];

      const stickerBuffer = await createQuoteSticker(
        from.first_name || '',
        from.last_name || '',
        chat.emoji_status_custom_emoji_id,
        text,
        chat.accent_color_id,
        userPhoto,
        replymsgUser,
        replymsgContent,
        replySenderColor,
        entities
      );

      await bot.sendSticker(chatId, stickerBuffer, {
        reply_to_message_id: msg.message_id
      }, { filename: 'quote.webp', contentType: 'image/webp' });

    } catch (err) {
      console.error("Q command error:", err);
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
