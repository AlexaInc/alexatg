const createQuoteSticker = require('../generatequote2');
const fs = require('fs');
const { TelegramClient, Api } = require("telegram");
const { StringSession } = require("telegram/sessions");
const { exec } = require('child_process');

module.exports = function (bot, deps) {
  const { botOWNER_IDS, handlers, groupChatIds, userChatIds, saveGroupIds, saveUserIds, CustomQuizModel, Specialuser } = deps;
  const { getProfilePhoto, downloadImage, handleAnonymous, getTarget } = handlers;
  const apiId = 24388624;
  const apiHash = "aa6e6675a9a88534f8ded7f318394d5f";
  const userAccountID = process.env.userAccountID;

  async function broadcast(msg) {
    if (!botOWNER_IDS.includes(msg.from.id)) {
      return bot.sendMessage(msg.chat.id, "Sorry, you are not authorized.");
    }
    if (!msg.reply_to_message) {
      return bot.sendMessage(msg.chat.id, "Error: Please reply to the message you want to forward.");
    }

    const fromChatId = msg.reply_to_message.chat.id;
    const messageToForwardId = msg.reply_to_message.message_id;
    const allTargets = [...(groupChatIds || []), ...(userChatIds || [])];

    bot.sendMessage(msg.chat.id, `🚀 Starting broadcast to ${allTargets.length} chats...`);

    let successCount = 0;
    let errorCount = 0;
    let chatsChanged = false;

    for (const chatId of allTargets) {
      try {
        await bot.forwardMessage(chatId, fromChatId, messageToForwardId);
        successCount++;
      } catch (error) {
        errorCount++;
        if (error.response && (
          error.response.body.description.includes("chat not found") ||
          error.response.body.description.includes("bot was kicked") ||
          error.response.body.description.includes("bot was blocked")
        )) {
          if (groupChatIds && groupChatIds.has(chatId)) groupChatIds.delete(chatId);
          if (userChatIds && userChatIds.has(chatId)) userChatIds.delete(chatId);
          chatsChanged = true;
        }
      }
      await new Promise(r => setTimeout(r, 100));
    }

    if (chatsChanged) {
      saveGroupIds();
      saveUserIds();
    }

    return bot.sendMessage(msg.chat.id, `✅ Broadcast Complete!\n\nSent: ${successCount}\nFailed: ${errorCount}`);
  }

  bot.onText(/\/bc/, broadcast);

  // --- /stats Command ---
  bot.onText(/^\/stats/, async (msg) => {
    if (!botOWNER_IDS.includes(msg.from.id)) return;
    const stats = `📊 *Bot Stats:*
Groups: \`${groupChatIds.size}\`
Users (DM): \`${userChatIds.size}\`
Total: \`${groupChatIds.size + userChatIds.size}\``;
    bot.sendMessage(msg.chat.id, stats, { parse_mode: 'Markdown' });
  });

  bot.onText(/^\/update/, async (msg) => {
    if (!botOWNER_IDS.includes(msg.from.id)) return bot.sendMessage(msg.chat.id, 'you are not bot owner');
    bot.sendMessage(msg.chat.id, 'Updating started...');
    try {
      await bot.sendMessage(msg.chat.id, "🚀 Updating... Please wait.");

      // 1. මුලින්ම Polling නතර කරන්න (මෙය ඉතා වැදගත්)
      await bot.stopPolling();

      exec('git pull', (err, stdout, stderr) => {
        if (err) {
          bot.startPolling(); // Error එකක් ආවොත් නැවත Polling පටන් ගන්න
          return bot.sendMessage(msg.chat.id, `❌ Git Error: ${err.message}`);
        }

        // 2. Logs group එකට මැසේජ් එක යවන්න
        bot.sendMessage(logGrpid, "✅ Bot updated and restarting safely...")
          .then(() => {
            // 3. PM2 භාවිතා කරන්නේ නම් පමණක් restart කරන්න
            if (process.env.pm_id || process.env.PM2_HOME) {
              exec(`pm2 restart ${process.env.name || 'all'}`);
            } else {
              process.exit();
            }
          });
      });
    } catch (e) {
      console.error(e);
      bot.startPolling();
    }
  });
  bot.onText(/^\/restart/, async (msg) => {
    if (!botOWNER_IDS.includes(msg.from.id)) return bot.sendMessage(msg.chat.id, 'you are not bot owner');
    try {
      await bot.sendMessage(msg.chat.id, "Restarting...");

      // 2. දැනට පවතින Polling එක නතර කිරීම (Polling conflict මගහැරීමට)
      await bot.stopPolling();

      // 3. Log group එකට පණිවිඩය යැවීම
      // මෙහිදී 'logGrpid' විචල්‍යය භාවිතා කර ඇත
      await bot.sendMessage(logGrpid, "🚀 Bot Restart Initiated\n\nStatus: _Restarting safely..._", { parse_mode: 'Markdown' });

      // 4. PM2 හෝ Node හරහා restart කිරීම
      if (process.env.pm_id || process.env.PM2_HOME) {
        // PM2 හරහා නම්, වත්මන් app name එක ලබාගෙන restart කරයි
        const appName = process.env.name || 'all';
        exec(`pm2 restart ${appName}`);
      } else {
        // ඍජුවම node හරහා නම් process එක නතර කරයි
        // (Nodemon වැනි දෙයක් භාවිතා කරන්නේ නම් එය ස්වයංක්‍රීයව පණ ගැන්වේ)
        process.exit();
      }

    } catch (error) {
      console.error(error);
      bot.startPolling(); // දෝෂයක් ආවොත් නැවත polling පටන් ගන්න
      bot.sendMessage(msg.chat.id, `❌ Restart Error: ${error.message}`);
    }
  });
  // --- /fq Command (Sticker Generator) ---
  bot.onText(/^\/fq/, async (msg) => {
    const text = msg.text || '';
    const userId = msg.from.id;
    const isSpecial = Specialuser.includes(userId);

    if (!isSpecial) return bot.sendMessage(msg.chat.id, 'you are not a special user');

    const hasRequiredJson = (jsonString) => {
      try {
        const data = JSON.parse(jsonString);
        return data && typeof data === 'object' && data.sender && data.massage;
      } catch (e) { return false; }
    };

    try { await bot.deleteMessage(msg.chat.id, msg.message_id); } catch (e) { }

    const isReply = !!msg.reply_to_message;
    const content = text.replace(/^\/fq\s*/, '').trim();
    const hasValidPayload = hasRequiredJson(content);

    if (isReply && content === "") {
      return bot.sendMessage(msg.chat.id, 'please send text after /fq');
    }

    if (!isReply && !hasValidPayload) {
      return bot.sendMessage(msg.chat.id, 'Requires reply or valid JSON.');
    }

    let firstName, lastName, msgtextt, replysender, replycontent, replysendercolor, chat, userphotourl;

    try {
      if (hasValidPayload) {
        const data = JSON.parse(content);
        chat = await bot.getChat(data.sender);
        const rchat = data.rsender ? await bot.getChat(data.rsender) : null;

        firstName = chat.first_name || '';
        lastName = chat.last_name || '';
        replysendercolor = rchat ? rchat.accent_color_id || 3 : null;
        msgtextt = data.massage;
        replysender = rchat ? (rchat.first_name || '') + ' ' + (rchat.last_name || '') : null;
        replycontent = data.rmassage;
        userphotourl = await getProfilePhoto(bot, data.sender);
      } else {
        const reply = msg.reply_to_message.from;
        chat = await bot.getChat(reply.id);
        firstName = reply.first_name || '';
        lastName = reply.last_name || '';
        userphotourl = await getProfilePhoto(bot, reply.id);
        msgtextt = content;
      }

      let userphoto = userphotourl ? await downloadImage(userphotourl) : null;
      const stickerBuffer = await createQuoteSticker(
        firstName, lastName, chat.emoji_status_custom_emoji_id, msgtextt,
        chat.accent_color_id, userphoto, replysender, replycontent, replysendercolor
      );

      if (stickerBuffer) {
        await bot.sendSticker(msg.chat.id, stickerBuffer, {
          reply_to_message_id: msg.reply_to_message?.message_id
        }, { filename: 'quote.webp', contentType: 'image/webp' });
      }
    } catch (err) {
      console.error(err);
      bot.sendMessage(msg.chat.id, 'Error creating sticker.');
    }
  });

  // --- /send and /go (Sender's own quote) ---
  bot.onText(/^\/(send|go)/, async (msg) => {
    try {
      const userId = msg.from.id;
      if (botOWNER_IDS.includes(userId)) return;
      const from = msg.from;

      const userPhotourl = await getProfilePhoto(bot, from.id);
      const userPhoto = userPhotourl ? await downloadImage(userPhotourl) : null;
      const chat = await bot.getChat(from.id);

      let replysender = null, replycontent = null, replysendercolor = null;
      if (msg.reply_to_message) {
        const rfrom = msg.reply_to_message.from;
        replysender = `${rfrom.first_name} ${rfrom.last_name || ''}`.trim();
        replycontent = msg.reply_to_message.text || null;
        const rchat = await bot.getChat(rfrom.id).catch(() => ({}));
        replysendercolor = rchat.accent_color_id;
      }

      const stickerBuffer = await createQuoteSticker(
        from.first_name || '', from.last_name || '', chat.emoji_status_custom_emoji_id,
        msg.text.split(' ').slice(1).join(' ') || ' ', chat.accent_color_id, userPhoto,
        replysender, replycontent, replysendercolor
      );

      await bot.sendSticker(msg.chat.id, stickerBuffer, {
        reply_to_message_id: msg.reply_to_message?.message_id
      }, { filename: 'quote.webp', contentType: 'image/webp' });

    } catch (err) { console.error(err); }
  });

  // --- /uail Command (Update AI Limit) ---
  bot.onText(/^\/uail/, async (msg) => {
    const userId = msg.from.id;
    if (!botOWNER_IDS.includes(userId)) return;
    const newLimit = parseInt(msg.text.split(' ')[1], 10);
    if (isNaN(newLimit) || newLimit <= 0) return bot.sendMessage(msg.chat.id, "Usage: `/uail 30`", { parse_mode: 'Markdown' });

    try {
      updateUserLimit(newLimit);
      bot.sendMessage(msg.chat.id, `✅ Daily AI limit: **${newLimit}**.`, { parse_mode: 'Markdown' });
    } catch (e) { bot.sendMessage(msg.chat.id, "Error writing limit."); }
  });

  // --- /promme Command ---
  bot.onText(/^\/promme/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    if (!botOWNER_IDS.includes(userId)) return;
    const fullText = msg.text || ' ';
    const argsText = fullText.substring(command.length).trim() + ' full';
    const args = argsText.toLowerCase().split(/\s+/).filter(Boolean);

    try {
      const botMember = await bot.getChatMember(chatId, (await bot.getMe()).id);
      let idealPerms = {
        can_change_info: false,
        can_delete_messages: false,
        can_invite_users: false,
        can_manage_video_chats: false,
        can_restrict_members: false,
        can_post_stories: false,
        can_edit_stories: false,
        can_delete_stories: false,
        can_pin_messages: false,
        can_promote_members: false,
        is_anonymous: false,
      };

      if (args.includes('full')) {
        idealPerms = {
          can_change_info: true,
          can_delete_messages: true,
          can_invite_users: true,
          can_manage_video_chats: true,
          can_restrict_members: true,
          can_post_stories: true,
          can_edit_stories: true,
          can_delete_stories: true,
          can_pin_messages: true,
          can_promote_members: true,
        };
        if (args.includes('anno')) {
          idealPerms = {
            can_change_info: true,
            can_delete_messages: true,
            can_invite_users: true,
            can_manage_video_chats: true,
            can_restrict_members: true,
            can_post_stories: true,
            can_edit_stories: true,
            can_delete_stories: true,
            can_pin_messages: true,
            can_promote_members: true,
            is_anonymous: true,
          };
        }
      }
      //console.log(botMember)

      // 3. Create the "final" permissions object
      //    It only sets a permission to 'true' IF the bot also has it.
      const finalPerms = {
        can_change_info: idealPerms.can_change_info && botMember.can_change_info,
        can_delete_messages: idealPerms.can_delete_messages && botMember.can_delete_messages,
        can_invite_users: idealPerms.can_invite_users && botMember.can_invite_users,
        can_restrict_members: idealPerms.can_restrict_members && botMember.can_restrict_members,
        can_pin_messages: idealPerms.can_pin_messages && botMember.can_pin_messages,
        can_post_stories: idealPerms.can_post_stories && botMember.can_post_stories,
        can_edit_stories: idealPerms.can_edit_stories && botMember.can_edit_stories,
        can_delete_stories: idealPerms.can_delete_stories && botMember.can_delete_stories,
        can_manage_video_chats: idealPerms.can_manage_video_chats && botMember.can_manage_video_chats,
        can_promote_members: idealPerms.can_promote_members && botMember.can_promote_members,
        is_anonymous: idealPerms.is_anonymous && botMember.is_anonymous,
      };
      await bot.promoteChatMember(chatId, userId, finalPerms);
      await bot.setChatAdministratorCustomTitle(chatId, userId, 'Owner');
      bot.sendMessage(chatId, "✅ You are now an admin with full available rights.");
    } catch (e) { bot.sendMessage(chatId, "❌ Promotion failed."); }
  });

  // --- /sweep Command (GramJS) ---
  bot.onText(/^\/sweep/, async (msg) => {
    const chatId = msg.chat.id;
    if (!botOWNER_IDS.includes(msg.from.id)) return bot.sendMessage(chatId, "Only owners can sweep.");

    let client;
    try {
      const sessionData = fs.readFileSync("session.txt", "utf8").trim();
      client = new TelegramClient(new StringSession(sessionData), apiId, apiHash, { connectionRetries: 3 });
      await client.connect();

      let entity;
      try { entity = await client.getEntity(chatId); }
      catch (e) {
        const chat = await bot.getChat(chatId);
        const inviteLink = chat.invite_link || await bot.exportChatInviteLink(chatId);
        const hash = inviteLink.split('/').pop().replace('+', '');
        await client.invoke(new Api.messages.ImportChatInvite({ hash }));
        entity = await client.getEntity(chatId);
      }

      await bot.promoteChatMember(chatId, userAccountID, { can_delete_messages: true });
      const statusMsg = await bot.sendMessage(chatId, "🧹 **Sweep started...**", { parse_mode: 'Markdown' });
      const endId = statusMsg.message_id;

      let totalDeleted = 0;
      let lastProcessedId = 0;
      while (true) {
        const messages = await client.getMessages(entity, { limit: 100, reverse: true, offsetId: lastProcessedId });
        if (!messages.length) break;
        let idsToDelete = [];
        for (const m of messages) {
          if (m.id >= endId) break;
          idsToDelete.push(m.id);
        }
        if (!idsToDelete.length) break;
        await client.deleteMessages(entity, idsToDelete, { revoke: true });
        totalDeleted += idsToDelete.length;
        lastProcessedId = idsToDelete[idsToDelete.length - 1];
        await new Promise(r => setTimeout(r, 1000));
      }
      bot.sendMessage(chatId, `✅ Sweep Complete: ${totalDeleted} deleted.`);
    } catch (err) { bot.sendMessage(chatId, `❌ Sweep Error: ${err.message}`); }
    finally { if (client) await client.disconnect(); }
  });

  // --- /vc Command (GramJS) ---
  bot.onText(/^\/vc (start|on|end|off)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const action = match[1];
    if (!botOWNER_IDS.includes(msg.from.id)) return;

    let client;
    try {
      const sessionData = fs.readFileSync("session.txt", "utf8").trim();
      client = new TelegramClient(new StringSession(sessionData), apiId, apiHash, { connectionRetries: 3 });
      await client.connect();
      const entity = await client.getEntity(chatId);

      await bot.promoteChatMember(chatId, userAccountID, { can_manage_video_chats: true });

      if (action === 'start' || action === 'on') {
        await client.invoke(new Api.phone.CreateGroupCall({ peer: entity, randomId: Math.floor(Math.random() * 1000000) }))
          .catch(e => { if (e.errorMessage !== 'GROUPCALL_ALREADY_EXISTS') throw e; });
        bot.sendMessage(chatId, "✅ Video Chat started.");
      } else {
        const fullChat = await client.invoke(new Api.channels.GetFullChannel({ channel: entity }));
        if (fullChat.fullChat.call) {
          await client.invoke(new Api.phone.DiscardGroupCall({ call: fullChat.fullChat.call }));
          bot.sendMessage(chatId, "🛑 Video Chat ended.");
        }
      }
    } catch (err) { bot.sendMessage(chatId, `❌ VC Error: ${err.message}`); }
    finally { if (client) await client.disconnect(); }
  });

  // --- /setquiz Command ---
  bot.onText(/^\/setquiz/, async (msg) => {
    const secondaryBotUsername = process.env.SECONDARY_BOT_USERNAME || 'QuizBuilderBot';
    bot.sendMessage(msg.chat.id, "Want to create your own quiz? Click the button below!", {
      reply_markup: {
        inline_keyboard: [[{ text: "🛠 Create Quiz", url: `https://t.me/${secondaryBotUsername}?start=setquiz` }]]
      }
    });
  });

  // --- /addspecial Command ---
  bot.onText(/^\/addspecial/, async (msg) => {
    if (!botOWNER_IDS.includes(msg.from.id)) return;
    if (!msg.reply_to_message) return bot.sendMessage(msg.chat.id, 'Please reply to the user you want to add as special');

    const userId = msg.reply_to_message.from.id;
    let currentAllIds = deps.allIds();

    if (currentAllIds.includes(userId)) {
      return bot.sendMessage(msg.chat.id, `[${msg.reply_to_message.from.first_name}](tg://user?id=${userId}) is already a special user`, { parse_mode: "Markdown" });
    }

    currentAllIds.push(userId);
    deps.setAllIds(currentAllIds);
    deps.writeIds(currentAllIds);
    deps.setSpecialuser([...currentAllIds, ...botOWNER_IDS]);

    bot.sendMessage(msg.chat.id, `[${msg.reply_to_message.from.first_name}](tg://user?id=${userId}) is now a special user`, { parse_mode: "Markdown" });
  });

  // --- /remspecial Command ---
  bot.onText(/^\/remspecial/, async (msg) => {
    if (!botOWNER_IDS.includes(msg.from.id)) return;
    if (!msg.reply_to_message) return bot.sendMessage(msg.chat.id, 'Please reply to the user you want to remove from special');

    const userId = msg.reply_to_message.from.id;
    let currentAllIds = deps.allIds();

    if (!currentAllIds.includes(userId)) {
      return bot.sendMessage(msg.chat.id, `[${msg.reply_to_message.from.first_name}](tg://user?id=${userId}) is not a special user`, { parse_mode: "Markdown" });
    }

    currentAllIds = currentAllIds.filter(id => id !== userId);
    deps.setAllIds(currentAllIds);
    deps.writeIds(currentAllIds);
    deps.setSpecialuser([...currentAllIds, ...botOWNER_IDS]);

    bot.sendMessage(msg.chat.id, `[${msg.reply_to_message.from.first_name}](tg://user?id=${userId}) removed from special users`, { parse_mode: "Markdown" });
  });
};
