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
      return bot.sendMessage(chatId, "Reply to a message with `/q` or `/q [count]` to create a quote sticker. Use `/q r` to include reply context.", { parse_mode: 'Markdown' });
    }

    const args = msg.text.split(/\s+/).slice(1);
    let count = 1;
    let withReply = false;
    for (const arg of args) {
      const low = arg.toLowerCase();
      if (low === 'r') withReply = true;
      else if (!isNaN(arg)) count = Math.min(20, Math.max(1, parseInt(arg)));
    }

    const targetMsg = msg.reply_to_message;
    const { getProfilePhoto, downloadImage, getUserbotClient, getJoinedEntity } = deps.handlers;

    try {
      let messagesToProcess = [];
      const client = await getUserbotClient();

      if (client) {
        try {
          const chatEntity = await getJoinedEntity(client, bot, chatId);
          const startId = targetMsg.message_id;
          const fetched = await client.getMessages(chatEntity, {
            ids: Array.from({ length: count }, (_, i) => startId + i)
          });

          for (let i = 0; i < fetched.length; i++) {
            const m = fetched[i];
            if (!m || (!m.message && !m.caption && !m.media)) continue;

            const sender = m.sender || await client.getEntity(m.fromId).catch(() => null);

            // 1. DOWNLOAD PHOTO VIA USERBOT (Avoids Bot API Timeout/DC errors)
            let photo = null;
            if (sender) {
              try {
                photo = await client.downloadProfilePhoto(sender).catch(() => null);
              } catch (e) { }
            }

            // 2. DOWNLOAD MEDIA (Stickers)
            // Use Bot API for sticker thumbnails as it's more robust for static extraction
            let mediaBuffer = null;
            if (m.media) {
              try {
                const doc = m.media.document;
                const isSticker = doc && doc.attributes.some(a => a.className === 'DocumentAttributeSticker');

                if (doc && isSticker) {
                  // Attempt Bot API thumbnail fetch first for animations
                  try {
                    const sFile = await bot.getFile(doc.id.toString());
                    const sLink = await bot.getFileLink(sFile.file_id);
                    mediaBuffer = await downloadImage(sLink);
                  } catch (e) {
                    // Fallback to GramJS if Bot API fails
                    mediaBuffer = await client.downloadMedia(m.media).catch(() => null);
                  }
                } else if (m.media.className === 'MessageMediaPhoto') {
                  mediaBuffer = await client.downloadMedia(m.media).catch(() => null);
                }
              } catch (e) { }
            }

            const entities = (m.entities || []).map(e => {
              let type = 'unknown';
              if (e.className === 'MessageEntityBold') type = 'bold';
              else if (e.className === 'MessageEntityItalic') type = 'italic';
              else if (e.className === 'MessageEntityCode') type = 'code';
              else if (e.className === 'MessageEntityCustomEmoji') type = 'custom_emoji';
              else if (e.className === 'MessageEntityUrl' || e.className === 'MessageEntityTextUrl') type = 'url';
              else if (e.className === 'MessageEntityMention') type = 'mention';
              else if (e.className === 'MessageEntityBotCommand') type = 'bot_command';
              return { type, offset: e.offset, length: e.length, custom_emoji_id: e.documentId?.toString() };
            });

            // Forward info
            let fName = null;
            if (m.fwdFrom) {
              if (m.fwdFrom.fromName) fName = m.fwdFrom.fromName;
              else if (m.fwdFrom.fromId) {
                try {
                  const fwdEntity = await client.getEntity(m.fwdFrom.fromId).catch(() => null);
                  fName = fwdEntity ? (fwdEntity.title || `${fwdEntity.firstName || ''} ${fwdEntity.lastName || ''}`.trim()) : "Forwarded";
                } catch (e) { fName = "Forwarded"; }
              }
            }

            // Reply info (only first message in chain)
            let rUser = null, rText = null, rColor = null;
            if (i === 0 && withReply && m.replyTo) {
              try {
                const gfMsgs = await client.getMessages(chatEntity, { ids: [m.replyTo.replyToMsgId] });
                const gf = gfMsgs[0];
                if (gf) {
                  const s = gf.sender || await client.getEntity(gf.fromId).catch(() => null);
                  rUser = s ? (s.title || `${s.firstName || ''} ${s.lastName || ''}`.trim()) : 'User';
                  rText = gf.message || gf.caption || (gf.media ? "Media" : null);
                  rColor = s?.color?.colorId || 0;
                }
              } catch (e) { }
            }

            messagesToProcess.push({
              firstName: sender ? (sender.firstName || sender.title || 'User') : 'User',
              lastName: sender?.lastName || '',
              customemojiid: sender?.emojiStatus?.documentId?.toString(),
              message: m.message || m.caption || (m.media ? "" : " "),
              nameColorId: sender?.color?.colorId || 0,
              inputImageBuffer: photo,
              forwardName: fName,
              replySender: rUser,
              replyMessage: rText,
              replysendercolor: rColor,
              entities, mediaBuffer,
              id: sender ? sender.id.toString() : '1'
            });
          }
        } catch (e) {
          console.error("Userbot quote error:", e);
        } finally {
          await client.disconnect().catch(() => { });
        }
      }

      // FALLBACK TO BOT API ONLY IF USERBOT FAILED OR IS UNAVAILABLE
      if (messagesToProcess.length === 0) {
        const from = targetMsg.from;
        const photoUrl = await getProfilePhoto(bot, from.id);
        const photo = photoUrl ? await downloadImage(photoUrl) : null;
        const chat = await bot.getChat(from.id).catch(() => ({}));

        let mediaBuffer = null;
        if (targetMsg.sticker) {
          try {
            // Animated or Video stickers can't be rendered directly, so we use the static thumbnail
            const isAnimated = targetMsg.sticker.is_animated || targetMsg.sticker.is_video;
            const fileId = (isAnimated && targetMsg.sticker.thumbnail) ? targetMsg.sticker.thumbnail.file_id : targetMsg.sticker.file_id;
            const stickerLink = await bot.getFileLink(fileId);
            mediaBuffer = await downloadImage(stickerLink);
          } catch (e) { }
        }

        let fName = null;
        if (targetMsg.forward_from) fName = `${targetMsg.forward_from.first_name} ${targetMsg.forward_from.last_name || ''}`.trim();
        else if (targetMsg.forward_from_chat) fName = targetMsg.forward_from_chat.title;
        else if (targetMsg.forward_sender_name) fName = targetMsg.forward_sender_name;

        let rUser = null, rText = null, rColor = null;
        if (withReply && targetMsg.reply_to_message) {
          const rf = targetMsg.reply_to_message.from;
          rUser = `${rf.first_name} ${rf.last_name || ''}`.trim() || 'User';
          rText = targetMsg.reply_to_message.text || targetMsg.reply_to_message.caption || (targetMsg.reply_to_message.sticker ? "Sticker" : "Media");
          rColor = rf.id % 7;
        }

        messagesToProcess.push({
          firstName: from.first_name,
          lastName: from.last_name,
          customemojiid: chat.emoji_status_custom_emoji_id || (chat.emoji_status && chat.emoji_status.custom_emoji_id),
          message: targetMsg.text || targetMsg.caption || (targetMsg.sticker ? "" : " "),
          nameColorId: chat.accent_color_id || 0,
          inputImageBuffer: photo,
          forwardName: fName,
          replySender: rUser,
          replyMessage: rText,
          replysendercolor: rColor,
          entities: targetMsg.entities || targetMsg.caption_entities || [],
          mediaBuffer,
          id: from.id.toString()
        });
      }

      const stickerBuffer = await createQuoteSticker(messagesToProcess);

      if (count >= 4) {
        await bot.sendDocument(chatId, stickerBuffer, { reply_to_message_id: targetMsg.message_id }, { filename: 'quote.png', contentType: 'image/png' });
      } else {
        await bot.sendSticker(chatId, stickerBuffer, { reply_to_message_id: targetMsg.message_id }, { filename: 'quote.webp', contentType: 'image/webp' }).catch(() => {
          bot.sendSticker(chatId, stickerBuffer, {}, { filename: 'quote.webp', contentType: 'image/webp' }).catch(() => { });
        });
      }

    } catch (err) {
      console.error("Q command total error:", err);
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
