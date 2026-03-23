module.exports = function (bot, deps) {
  const { botOWNER_IDS, UserMap, handlers } = deps;
  const { getTarget, handleAnonymous, escapeHTML } = handlers;

  // --- MUTE COMMAND ---
  bot.onText(/^\/mu/, async (msg) => {
    const text = msg.text || '';
    const command = text.split(' ')[0].toLowerCase();
    const args = text.split(' ').slice(1);
    const chatId = msg.chat.id;

    if (!msg.reply_to_message && !args.length) return bot.sendMessage(chatId, "⚠️ Reply to a user or provide their ID.");

    try {
      const { targetUserId, targetUserName, error } = await getTarget(bot, UserMap, msg, args);
      if (error) return bot.sendMessage(chatId, error);

      const caller = await bot.getChatMember(chatId, msg.from.id);
      const isOwner = botOWNER_IDS.includes(msg.from.id);
      const canMute = caller.status === 'creator' || caller.can_restrict_members || isOwner;

      if (await handleAnonymous(bot, msg, "mu", targetUserId, targetUserName)) return;
      if (!canMute) return bot.sendMessage(chatId, "❌ You don't have the 'Restrict Members' permission.");

      // Staff Protection
      const targetMember = await bot.getChatMember(chatId, targetUserId);
      const targetIsStaff = ["administrator", "creator"].includes(targetMember.status) || botOWNER_IDS.includes(targetUserId);
      if (targetIsStaff) return bot.sendMessage(chatId, `⚠️ [${targetUserName}](tg://user?id=${targetUserId}) is staff and cannot be muted.`, { parse_mode: 'Markdown' });

      const durationMatch = text.match(/\d+[smhd]/);
      let durationInMinutes = null;
      if (durationMatch) {
        const val = parseInt(durationMatch[0]);
        const unit = durationMatch[0].slice(-1);
        if (unit === 's') durationInMinutes = val / 60;
        else if (unit === 'm') durationInMinutes = val;
        else if (unit === 'h') durationInMinutes = val * 60;
        else if (unit === 'd') durationInMinutes = val * 60 * 24;
      }

      const perms = { can_send_messages: false };
      let responseMessage = `User [${targetUserName}](tg://user?id=${targetUserId}) has been muted indefinitely.`;

      if (durationInMinutes) {
        perms.until_date = Math.floor(Date.now() / 1000) + (durationInMinutes * 60);
        responseMessage = `User [${targetUserName}](tg://user?id=${targetUserId}) has been muted for ${durationInMinutes} minute(s).`;
      }

      await bot.restrictChatMember(chatId, targetUserId, perms);
      bot.sendMessage(chatId, responseMessage, { parse_mode: 'Markdown' });

    } catch (err) {
      console.error(err);
      bot.sendMessage(chatId, "An error occurred. Make sure I have 'Restrict Members' permissions.");
    }
  });

  // --- UNMUTE COMMAND ---
  bot.onText(/^\/unmu/, async (msg) => {
    const args = (msg.text || '').split(' ').slice(1);
    const chatId = msg.chat.id;
    if (!msg.reply_to_message && !args.length) return bot.sendMessage(chatId, "⚠️ Reply or ID required.");

    try {
      const { targetUserId, targetUserName, error } = await getTarget(bot, UserMap, msg, args);
      if (error) return bot.sendMessage(chatId, error);

      const caller = await bot.getChatMember(chatId, msg.from.id);
      const canUnmute = caller.status === 'creator' || caller.can_restrict_members || botOWNER_IDS.includes(msg.from.id);

      if (await handleAnonymous(bot, msg, "unmu", targetUserId, targetUserName)) return;
      if (!canUnmute) return bot.sendMessage(chatId, "❌ No permission.");

      const chat = await bot.getChat(chatId);
      await bot.restrictChatMember(chatId, targetUserId, chat.permissions);
      bot.sendMessage(chatId, `✅ Unmuted [${targetUserName}](tg://user?id=${targetUserId})`, { parse_mode: 'Markdown' });
    } catch (err) {
      bot.sendMessage(chatId, "Error unmuting.");
    }
  });

  // --- BAN COMMAND ---
  bot.onText(/^\/ba/, async (msg) => {
    const args = (msg.text || '').split(' ').slice(1);
    const chatId = msg.chat.id;
    if (!msg.reply_to_message && !args.length) return bot.sendMessage(chatId, "⚠️ Reply or ID required.");

    try {
      const { targetUserId, targetUserName, error } = await getTarget(bot, UserMap, msg, args);
      if (error) return bot.sendMessage(chatId, error);

      const caller = await bot.getChatMember(chatId, msg.from.id);
      const isOwner = botOWNER_IDS.includes(msg.from.id);
      const canBan = caller.status === 'creator' || caller.can_restrict_members || isOwner;

      if (await handleAnonymous(bot, msg, "ba", targetUserId, targetUserName)) return;
      if (!canBan) return bot.sendMessage(chatId, "❌ No permission.");

      const targetMember = await bot.getChatMember(chatId, targetUserId);
      const targetIsStaff = ["administrator", "creator"].includes(targetMember.status) || botOWNER_IDS.includes(targetUserId);
      if (targetIsStaff) return bot.sendMessage(chatId, "⚠️ Cannot ban staff.");

      await bot.banChatMember(chatId, targetUserId);
      bot.sendMessage(chatId, `🚫 Banned [${targetUserName}](tg://user?id=${targetUserId})`, { parse_mode: 'Markdown' });
    } catch (err) {
      bot.sendMessage(chatId, "Error banning.");
    }
  });

  // --- UNBAN COMMAND ---
  bot.onText(/^\/unba/, async (msg) => {
    const args = (msg.text || '').split(' ').slice(1);
    const chatId = msg.chat.id;
    if (!msg.reply_to_message && !args.length) return bot.sendMessage(chatId, "⚠️ Reply or ID required.");

    try {
      const { targetUserId, targetUserName, error } = await getTarget(bot, UserMap, msg, args);
      if (error) return bot.sendMessage(chatId, error);

      const caller = await bot.getChatMember(chatId, msg.from.id);
      const isOwner = botOWNER_IDS.includes(msg.from.id);
      const canUnban = caller.status === 'creator' || caller.can_restrict_members || isOwner;

      if (await handleAnonymous(bot, msg, "unba", targetUserId, targetUserName)) return;
      if (!canUnban) return bot.sendMessage(chatId, "❌ No permission.");

      await bot.unbanChatMember(chatId, targetUserId);
      bot.sendMessage(chatId, `✅ Unbanned [${targetUserName}](tg://user?id=${targetUserId})`, { parse_mode: 'Markdown' });
    } catch (err) {
      bot.sendMessage(chatId, "Error unbanning.");
    }
  });

  // --- NEW PROM COMMAND (Interactive - Version 2 with ALL perms) ---
  const PROM_PERMS = [
    { code: 'i', label: 'Change Info', key: 'can_change_info' },
    { code: 'e', label: 'Delete Msgs', key: 'can_delete_messages' },
    { code: 'j', label: 'Invite Users', key: 'can_invite_users' },
    { code: 'g', label: 'Restrict Members', key: 'can_restrict_members' },
    { code: 'k', label: 'Pin Messages', key: 'can_pin_messages' },
    { code: 'h', label: 'Add New Admins', key: 'can_promote_members' },
    { code: 'f', label: 'Manage VC', key: 'can_manage_video_chats' },
    { code: 'a', label: 'Anonymous', key: 'is_anonymous' },
    { code: 'b', label: 'Manage Chat', key: 'can_manage_chat' },
    { code: 'c', label: 'Post (Chan)', key: 'can_post_messages' },
    { code: 'd', label: 'Edit (Chan)', key: 'can_edit_messages' },
    { code: 'l', label: 'Manage Topics', key: 'can_manage_topics' },
    { code: 'm', label: 'Post Stories', key: 'can_post_stories' },
    { code: 'n', label: 'Edit Stories', key: 'can_edit_stories' },
    { code: 'o', label: 'Delete Stories', key: 'can_delete_stories' }
  ];

  function getPromKeyboard(targetId, selectedCodes = []) {
    const rows = [];
    const COLUMNS = 3;
    for (let i = 0; i < PROM_PERMS.length; i += COLUMNS) {
      const row = [];
      const chunk = PROM_PERMS.slice(i, i + COLUMNS);
      chunk.forEach(p => {
        const isSelected = selectedCodes.includes(p.code);
        const text = `${isSelected ? '✅' : '❌'} ${p.label}`;
        let nextCodes;
        if (isSelected) nextCodes = selectedCodes.filter(c => c !== p.code);
        else nextCodes = [...selectedCodes, p.code];

        const data = `prom_tgl_${targetId}_${nextCodes.join(',')}`;
        row.push({ text, callback_data: data.substring(0, 64) });
      });
      rows.push(row);
    }
    // Add Done button
    rows.push([{ text: '✅ Done - Promote User', callback_data: `prom_done_${targetId}_${selectedCodes.join(',')}`.substring(0, 64) }]);
    return { inline_keyboard: rows };
  }

  bot.onText(/^\/prom/, async (msg) => {
    // Ignore /promme
    if (msg.text && msg.text.toLowerCase().startsWith('/promme')) return;

    const chatId = msg.chat.id;
    const userId = msg.from.id;

    if (!msg.reply_to_message) return bot.sendMessage(chatId, "⚠️ Please reply to the user you want to promote.");

    try {
      const caller = await bot.getChatMember(chatId, userId);
      const isOwner = botOWNER_IDS.includes(userId);
      const canPromote = caller.status === 'creator' || caller.can_promote_members || isOwner;

      if (!canPromote) return bot.sendMessage(chatId, "❌ You don't have the 'Add New Admins' permission.");

      const targetUser = msg.reply_to_message.from;
      const targetName = targetUser.first_name || 'User';

      const targetStatus = await bot.getChatMember(chatId, targetUser.id);
      if (["administrator", "creator"].includes(targetStatus.status)) return bot.sendMessage(chatId, `⚠️ [${targetName}](tg://user?id=${targetUser.id}) is already an admin.`, { parse_mode: 'Markdown' });

      // Default selected perms (e.g., info, del, invite, restrict, pin)
      // i:info, e:delete, j:invite, g:restrict, k:pin
      const defaultCodes = ['i', 'e', 'j', 'g', 'k'];

      const welcomeText = `🛡️ **Admin Promotion**\n\nTarget: [${targetName}](tg://user?id=${targetUser.id})\n\nSelect the permissions you want to grant:`;

      await bot.sendMessage(chatId, welcomeText, {
        parse_mode: 'Markdown',
        reply_markup: getPromKeyboard(targetUser.id, defaultCodes)
      });

    } catch (error) {
      console.error(error);
      bot.sendMessage(chatId, "❌ An error occurred.");
    }
  });

  // --- DEMOTE COMMAND ---
  bot.onText(/^\/dem/, async (msg) => {
    const chatId = msg.chat.id;
    if (!msg.reply_to_message) return bot.sendMessage(chatId, "Please reply to the user you want to demote.");

    try {
      const caller = await bot.getChatMember(chatId, msg.from.id);
      const isOwner = botOWNER_IDS.includes(msg.from.id);
      const canDemote = caller.status === 'creator' || caller.can_promote_members || isOwner;

      const userToDemote = msg.reply_to_message.from;
      if (await handleAnonymous(bot, msg, "dem", userToDemote.id, userToDemote.first_name)) return;
      if (!canDemote) return bot.sendMessage(chatId, "❌ You need 'Add New Admins' permission to demote.");

      await bot.promoteChatMember(chatId, userToDemote.id, {
        can_change_info: false,
        can_delete_messages: false,
        can_invite_users: false,
        can_restrict_members: false,
        can_pin_messages: false,
        can_promote_members: false,
      });

      bot.sendMessage(chatId, `✅ User has been demoted.`, { parse_mode: "Markdown" });
    } catch (error) {
      bot.sendMessage(chatId, "❌ Demotion failed.");
    }
  });
  // --- FILTER COMMAND ---
  bot.onText(/^\/filter/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const caller = await bot.getChatMember(chatId, userId);
    const isAdmin = ["creator", "administrator"].includes(caller.status) || botOWNER_IDS.includes(userId);

    if (!isAdmin) return bot.sendMessage(chatId, "You must be an admin or owner.");

    const triggers = deps.handlers.parseFilterTriggers(msg.text || '');
    if (triggers.length === 0) {
      return bot.sendMessage(chatId, "❌ Provide triggers. Example: `/filter hello` or `/filter (hi,hey)`");
    }

    if (!msg.reply_to_message) {
      return bot.sendMessage(chatId, "❌ Reply to a message you want to set as a filter.");
    }

    const result = deps.handlers.getMessageType(msg.reply_to_message);
    if (!result) return bot.sendMessage(chatId, "❌ Unsupported reply type.");

    const newFilter = {
      triggers: triggers,
      type: result.type,
      reply: result.type === "text" ? result.text : result.file_id
    };

    try {
      deps.Filters.addFilter(String(chatId), newFilter);
      bot.sendMessage(chatId, "✔ Filter saved!\n\nTriggers:\n" + triggers.map(x => `• ${x}`).join("\n"));
    } catch (error) {
      bot.sendMessage(chatId, "❌ Error saving filter.");
    }
  });

  // --- STOP (FILTER) COMMAND ---
  bot.onText(/^\/stop/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const caller = await bot.getChatMember(chatId, userId);
    const isAdmin = ["creator", "administrator"].includes(caller.status) || botOWNER_IDS.includes(userId);

    if (!isAdmin) return bot.sendMessage(chatId, "You must be an admin or owner.");

    const triggers = deps.handlers.parseFilterTriggers(msg.text || '');
    if (triggers.length === 0) return bot.sendMessage(chatId, "❌ Provide trigger(s) to remove.");

    let removedCount = 0;
    triggers.forEach(trigger => {
      if (deps.Filters.removeFilter(String(chatId), trigger)) removedCount++;
    });

    if (removedCount > 0) {
      bot.sendMessage(chatId, `✅ Removed ${removedCount} filter(s).`);
    } else {
      bot.sendMessage(chatId, "❌ No matching filters found.");
    }
  });

  // --- /quiz Trigger (Quiz) ---
  bot.onText(/^\/quiz(?:\s+(.+))?/, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const quizId = match[1];

    try {
      const caller = await bot.getChatMember(chatId, userId);
      const isOwner = botOWNER_IDS.includes(userId);
      const canManageQuiz = caller.status === 'creator' || caller.can_change_info || isOwner;

      if (!canManageQuiz) {
        return bot.sendMessage(chatId, "❌ You don't have the 'Change Group Info' permission.");
      }

      if (quizId) {
        // Fetch custom quiz from DB
        if (!deps.CustomQuizModel) return bot.sendMessage(chatId, "❌ Custom quizzes are not available (DB not connected).");
        const quizData = await deps.CustomQuizModel.findOne({ quizId: quizId.toUpperCase() });
        if (!quizData) return bot.sendMessage(chatId, "❌ Quiz ID not found.");
        deps.quiz.startQuiz(chatId, quizData);
      } else {
        // Start default quiz
        deps.quiz.startQuiz(chatId);
      }
    } catch (err) {
      console.error("Quiz perm error:", err);
      bot.sendMessage(chatId, "❌ This command is restricted to admins with 'Change Group Info' permission.");
    }
  });

  // --- FILTERS COMMAND ---
  bot.onText(/^\/filters/, async (msg) => {
    const allFilters = deps.Filters.getFilters(String(msg.chat.id));
    if (!allFilters || allFilters.length === 0) return bot.sendMessage(msg.chat.id, "❌ No filters in this chat.");

    let filterList = `📋 *Filters in this chat: ${allFilters.length}*\n\n`;
    allFilters.forEach((filter, index) => {
      filterList += `*${index + 1}.* *Type:* ${filter.type}\n   *Triggers:* ${filter.triggers.join(', ')}\n`;
    });
    bot.sendMessage(msg.chat.id, filterList, { parse_mode: "Markdown" });
  });

  const nsfwCommands = [
    "/anal", "/ass", "/boobs", "/gonewild",
    "/hanal", "/hass", "/hboobs", "/hentai",
    "/hkitsune", "/hmidriff", "/hneko", "/hthigh",
    "/neko", "/paizuri", "/pgif", "/pussy",
    "/tentacle", "/thigh", "/yaoi"
  ];

  // --- NSFW COMMANDS ---
  bot.onText(/^\/nsfw$/, async (msg) => {
    const nsfwMenu = `🔞 *NSFW Commands:*\n${nsfwCommands.join("\n")}`;
    bot.sendMessage(msg.chat.id, nsfwMenu, { parse_mode: 'Markdown' });
  });

  bot.onText(/^\/nsfw(on|off)/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const caller = await bot.getChatMember(chatId, userId);
    const isAdmin = ["administrator", "creator"].includes(caller.status) || botOWNER_IDS.includes(userId);

    if (!isAdmin) return bot.sendMessage(chatId, "❌ Only admins can toggle NSFW.");

    const enable = msg.text.includes('on');
    await deps.NSFWSetting.updateOne(
      { groupId: chatId },
      { enabled: enable },
      { upsert: true }
    );

    bot.sendMessage(chatId, `🔞 NSFW commands are now *${enable ? "ENABLED" : "DISABLED"}*`, { parse_mode: 'Markdown' });
  });

  // --- NSFW HANDLER ---
  bot.on('message', async (msg) => {
    if (!msg.text) return;
    const command = msg.text.split(' ')[0].toLowerCase();
    if (nsfwCommands.includes(command)) {
      const chatId = msg.chat.id;
      const setting = await deps.NSFWSetting.findOne({ groupId: chatId });
      if (!setting?.enabled) {
        return bot.sendMessage(chatId, "❌ NSFW commands are disabled in this group.");
      }

      try {
        const category = command.slice(1);
        const response = await require('axios').get(`https://api.night-api.com/images/nsfw/${category}`, {
          headers: { authorization: process.env.NIGHTAPI_AUTH }
        });

        const imageUrl = response.data.content.url_full || response.data.content.url;
        if (!imageUrl) return bot.sendMessage(chatId, "Couldn't fetch the image.");

        const buffer = await deps.handlers.getBuffer(imageUrl);
        if (!buffer) return bot.sendMessage(chatId, "Error downloading the file.");

        const ext = require('path').extname(imageUrl).toLowerCase();

        if (ext === '.gif') await bot.sendAnimation(chatId, buffer, { caption: category });
        else if (['.jpg', '.jpeg', '.png'].includes(ext)) {
          await bot.sendDocument(chatId, buffer, {
            caption: category,
            filename: 'image' + ext,
            contentType: ext === '.png' ? 'image/png' : 'image/jpeg'
          });
        } else if (['.mp4', '.webm'].includes(ext)) await bot.sendVideo(chatId, buffer, { caption: category });
        else await bot.sendMessage(chatId, "The file type is not supported.");
      } catch (err) {
        console.error("Error fetching NSFW:", err);
        bot.sendMessage(chatId, "Can't send now, I will try later.");
      }
    }
  });

  // --- ACCEPT MODE COMMANDS ---
  bot.onText(/^\/accepton/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const caller = await bot.getChatMember(chatId, userId);
    const isAdmin = ["administrator", "creator"].includes(caller.status) || botOWNER_IDS.includes(userId);

    if (!isAdmin) return bot.sendMessage(chatId, "❌ Only admins can enable accept mode.");

    const args = msg.text.split(' ').slice(1);
    let count = 5;
    if (args[0] && !isNaN(args[0])) count = Number(args[0]);

    await deps.accceptMap.updateOne(
      { groupId: chatId },
      { $set: { enabled: true, count: count } },
      { upsert: true }
    );

    bot.sendMessage(chatId, `✅ Accept mode ENABLED.\nRequired invites: *${count}*`, { parse_mode: "Markdown" });
  });

  bot.onText(/^\/acceptoff/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const caller = await bot.getChatMember(chatId, userId);
    const isAdmin = ["administrator", "creator"].includes(caller.status) || botOWNER_IDS.includes(userId);

    if (!isAdmin) return bot.sendMessage(chatId, "❌ Only admins can disable accept mode.");

    await deps.accceptMap.updateOne(
      { groupId: chatId },
      { $set: { enabled: false, count: 0 } },
      { upsert: true }
    );

    bot.sendMessage(chatId, `🛑 Accept mode DISABLED`, { parse_mode: "Markdown" });
  });

  bot.onText(/^\/ano/, async (msg) => {
    if (msg.from.username === 'GroupAnonymousBot' || msg.sender_chat?.type === 'channel') {
      await bot.sendMessage(msg.chat.id, "🛡️ **Identity Unmasking**\nClick the button below to remove your anonymous status. This will reveal your real account in this group but keep all your current admin permissions.", {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: "🔓 Unmask My Identity", callback_data: `unmask_admin` }
          ]]
        }
      });
    } else {
      bot.sendMessage(msg.chat.id, "⚠️ This command is only for admins currently posting anonymously.");
    }
  });

  // --- PURGE COMMANDS ---
  const purgeSessions = {};

  bot.onText(/^\/purgefrom/, async (msg) => {
    try {
      const permError = await deps.handlers.checkAdminPermissions(bot, msg, deps.botOWNER_IDS, deps.BOT_ID);
      if (permError) return bot.sendMessage(msg.chat.id, permError);

      const chatId = msg.chat.id;
      if (!msg.reply_to_message) return bot.sendMessage(chatId, "Usage: Reply to the *first* message with /purgefrom.");

      if (!purgeSessions[chatId]) purgeSessions[chatId] = {};
      purgeSessions[chatId][msg.from.id] = { fromId: msg.reply_to_message.message_id };

      bot.sendMessage(chatId, `✅ Start set. Now reply to the *last* message with /purgeto.`);
      bot.deleteMessage(chatId, msg.message_id).catch(() => { });
    } catch (error) {
      bot.sendMessage(msg.chat.id, "An error occurred.");
    }
  });

  bot.onText(/^\/purgeto/, async (msg) => {
    try {
      const permError = await deps.handlers.checkAdminPermissions(bot, msg, deps.botOWNER_IDS, deps.BOT_ID);
      if (permError) return bot.sendMessage(msg.chat.id, permError);

      const chatId = msg.chat.id;
      const userId = msg.from.id;

      if (!msg.reply_to_message) return bot.sendMessage(chatId, "Usage: Reply to the *last* message with /purgeto.");
      if (!purgeSessions[chatId] || !purgeSessions[chatId][userId]) return bot.sendMessage(chatId, "Set a start message first with /purgefrom.");

      const fromId = purgeSessions[chatId][userId].fromId;
      const toId = msg.reply_to_message.message_id;
      delete purgeSessions[chatId][userId];

      const startId = Math.min(fromId, toId);
      const endId = Math.max(fromId, toId);
      const ids = [];
      for (let i = startId; i <= endId; i++) ids.push(i);
      ids.push(msg.message_id);

      bot.sendMessage(chatId, `♻️ Purging ${ids.length} messages...`).then(m => setTimeout(() => bot.deleteMessage(chatId, m.message_id).catch(() => { }), 5000));

      const chunks = deps.handlers.chunkArray(ids, 100);
      for (const chunk of chunks) {
        try {
          await bot.deleteMessages(chatId, chunk);
        } catch (err) {
          if (err.response?.statusCode === 429) {
            await deps.handlers.sleep((err.response.parameters.retry_after || 1) * 1000);
            await bot.deleteMessages(chatId, chunk);
          }
        }
        await deps.handlers.sleep(1000);
      }
      bot.sendMessage(chatId, "✅ Purge complete.");
    } catch (error) {
      bot.sendMessage(msg.chat.id, "An error occurred.");
    }
  });

  bot.onText(/^\/purge$/, async (msg) => {
    try {
      const permError = await deps.handlers.checkAdminPermissions(bot, msg, deps.botOWNER_IDS, deps.BOT_ID);
      if (permError) return bot.sendMessage(msg.chat.id, permError);

      const chatId = msg.chat.id;
      if (!msg.reply_to_message) return bot.sendMessage(chatId, "Usage: Reply to the start message and type /purge.");

      const ids = [];
      for (let i = msg.reply_to_message.message_id; i <= msg.message_id; i++) ids.push(i);

      bot.sendMessage(chatId, `♻️ Purging ${ids.length} messages...`).then(m => setTimeout(() => bot.deleteMessage(chatId, m.message_id).catch(() => { }), 5000));

      const chunks = deps.handlers.chunkArray(ids, 100);
      for (const chunk of chunks) {
        try {
          await bot.deleteMessages(chatId, chunk);
        } catch (err) {
          if (err.response?.statusCode === 429) {
            await deps.handlers.sleep((err.response.parameters.retry_after || 1) * 1000);
            await bot.deleteMessages(chatId, chunk);
          }
        }
        await deps.handlers.sleep(1000);
      }
    } catch (error) {
      bot.sendMessage(msg.chat.id, "An error occurred.");
    }
  });

  // --- !free Command (Unlock user) ---
  bot.onText(/^!free/, async (msg) => {
    const chatId = msg.chat.id;
    const caller = await bot.getChatMember(chatId, msg.from.id);
    const isAdmin = ["creator", "administrator"].includes(caller.status) || botOWNER_IDS.includes(msg.from.id);

    if (!isAdmin) return;

    if (msg.reply_to_message) {
      const targetUserId = msg.reply_to_message.from.id;
      const targetName = msg.reply_to_message.from.first_name;

      let userInvite = await deps.Invite.findOne({ groupId: chatId, userId: targetUserId });
      if (!userInvite) {
        userInvite = new deps.Invite({ groupId: chatId, userId: targetUserId, count: 11 });
      } else {
        userInvite.count += 11;
      }
      await userInvite.save();

      bot.sendMessage(chatId, `✅ User <a href="tg://user?id=${targetUserId}">${targetName}</a> unlocked to send messages`, { parse_mode: "HTML" });
    } else if (msg.entities) {
      const mentions = msg.entities.filter(e => e.type === "text_mention" || e.type === "mention");
      for (let mention of mentions) {
        let mentionedUserId = null;
        let mentionedName = "";

        if (mention.type === "text_mention") {
          mentionedUserId = mention.user.id;
          mentionedName = mention.user.first_name;
        } else if (mention.type === "mention") {
          const username = msg.text.substr(mention.offset, mention.length).replace("@", "");
          mentionedUserId = await deps.resolveUsername(chatId, username);
          mentionedName = `@${username}`;
        }

        if (mentionedUserId) {
          let userInvite = await deps.Invite.findOne({ groupId: chatId, userId: mentionedUserId });
          if (!userInvite) {
            userInvite = new deps.Invite({ groupId: chatId, userId: mentionedUserId, count: 11 });
          } else {
            userInvite.count += 11;
          }
          await userInvite.save();
          bot.sendMessage(chatId, `✅ User ${mentionedName} unlocked to send messages`, { parse_mode: "HTML" });
        }
      }
    } else {
      bot.sendMessage(chatId, "❌ Please reply to a user or mention them to unlock.");
    }
  });

  // --- !addcount Command (Leaderboard) ---
  bot.onText(/^!addcount/, async (msg) => {
    const chatId = msg.chat.id;
    const allUsers = await deps.Invite.find({ groupId: chatId }).sort({ count: -1 }).limit(25);

    if (!allUsers.length) {
      return bot.sendMessage(chatId, "📊 No invites recorded yet.");
    }

    const numEmojis = {
      0: "0️⃣", 1: "1️⃣", 2: "2️⃣", 3: "3️⃣", 4: "4️⃣",
      5: "5️⃣", 6: "6️⃣", 7: "7️⃣", 8: "8️⃣", 9: "9️⃣", 10: "🔟"
    };

    let leaderboard = "🏆 Invite Leaderboard 🏆\n\n";

    for (let i = 0; i < allUsers.length; i++) {
      const u = allUsers[i];
      const userMap = await deps.UserMap.findOne({ groupId: chatId, userId: u.userId });
      const name = userMap?.firstName || `User ${u.userId}`;
      const rank = i + 1;

      let medal = "";
      if (numEmojis[rank]) {
        medal = numEmojis[rank];
      } else {
        medal = rank.toString().split("").map(d => numEmojis[d]).join("");
      }

      leaderboard += `${medal} <a href="tg://user?id=${u.userId}">${name}</a> — ${u.count} invites\n`;
    }

    bot.sendMessage(chatId, leaderboard, { parse_mode: "HTML" });
  });

  // --- SWEEP COMMAND ---
  bot.onText(/^\/sweep/, async (msg) => {
    const chatId = msg.chat.id;
    const senderId = msg.from.id;
    const { TelegramClient, Api } = require('telegram');
    const { StringSession } = require('telegram/sessions');
    const fs = require('fs');

    try {
      const caller = await bot.getChatMember(chatId, senderId);
      if (caller.status !== 'creator' && !botOWNER_IDS.includes(senderId)) {
        return bot.sendMessage(chatId, "❌ Only the Creator can trigger a full sweep.");
      }

      const sessionData = fs.readFileSync("session.txt", "utf8").trim();
      const client = new TelegramClient(new StringSession(sessionData), process.env.API_ID, process.env.API_HASH, {
        connectionRetries: 3,
        receiveUpdates: false,
        autoReconnect: false,
      });

      await client.connect();
      let wasAlreadyMember = true;
      let entity;

      try {
        entity = await client.getEntity(chatId);
      } catch (e) {
        wasAlreadyMember = false;
        let inviteLink = await bot.exportChatInviteLink(chatId).catch(() => bot.getChat(chatId).then(c => c.invite_link));
        if (!inviteLink) throw new Error("Could not get an invite link.");
        const hash = inviteLink.split('/').pop().replace('+', '');
        await client.invoke(new Api.messages.ImportChatInvite({ hash }));
        entity = await client.getEntity(chatId);
      }

      await bot.promoteChatMember(chatId, process.env.USER_ACCOUNT_ID, { can_delete_messages: true });
      const statusMsg = await bot.sendMessage(chatId, "🧹 **Sweep started...**", { parse_mode: 'Markdown' });
      const endBoundaryId = statusMsg.message_id;

      let totalDeleted = 0;
      let keepCleaning = true;
      let lastProcessedId = 0;

      while (keepCleaning) {
        const messages = await client.getMessages(entity, { limit: 100, reverse: true, offsetId: lastProcessedId });
        if (!messages?.length) break;

        let idsToDelete = [];
        for (const m of messages) {
          if (m.id >= endBoundaryId) { keepCleaning = false; idsToDelete.push(m.id); break; }
          idsToDelete.push(m.id);
        }

        if (idsToDelete.length) {
          await client.deleteMessages(entity, idsToDelete, { revoke: true }).catch(() => { });
          totalDeleted += idsToDelete.length;
          lastProcessedId = idsToDelete[idsToDelete.length - 1];
        }
        await new Promise(r => setTimeout(r, 1500));
      }

      if (!wasAlreadyMember) await client.invoke(new Api.channels.LeaveChannel({ channel: entity })).catch(() => { });
      await bot.sendMessage(chatId, `✅ **Full Sweep Complete**\nDeleted: \`${totalDeleted}\` messages.`, { parse_mode: 'Markdown' });
      await client.disconnect();
    } catch (err) {
      bot.sendMessage(chatId, "❌ Sweep Error: " + err.message);
    }
  });

  // --- VC COMMAND ---
  bot.onText(/^\/vc/, async (msg) => {
    const args = msg.text.split(' ').slice(1);
    const action = args[0]?.toLowerCase();
    const chatId = msg.chat.id;
    const { TelegramClient, Api } = require('telegram');
    const { StringSession } = require('telegram/sessions');
    const fs = require('fs');

    if (!['start', 'on', 'end', 'off'].includes(action)) return bot.sendMessage(chatId, "⚠️ Usage: `/vc start` or `/vc end`.");

    try {
      const caller = await bot.getChatMember(chatId, msg.from.id);
      if (['end', 'off'].includes(action)) {
        if (caller.status !== 'creator' && !caller.can_manage_video_chats && !botOWNER_IDS.includes(msg.from.id)) {
          return bot.sendMessage(chatId, "❌ No permission to end VC.");
        }
      }

      const sessionData = fs.readFileSync("session.txt", "utf8").trim() || process.env.SESSION_STRING;
      const client = new TelegramClient(new StringSession(sessionData), process.env.API_ID, process.env.API_HASH, { connectionRetries: 5, receiveUpdates: false });
      await client.connect();

      let entity;
      let shouldLeave = false;
      try {
        entity = await client.getEntity(chatId);
      } catch (e) {
        shouldLeave = true;
        let inviteLink = await bot.exportChatInviteLink(chatId).catch(() => bot.getChat(chatId).then(c => c.invite_link));
        const hash = inviteLink.split('/').pop().replace('+', '');
        await client.invoke(new Api.messages.ImportChatInvite({ hash }));
        entity = await client.getEntity(chatId);
      }

      await bot.promoteChatMember(chatId, process.env.USER_ACCOUNT_ID, { can_manage_video_chats: true });

      if (['start', 'on'].includes(action)) {
        await client.invoke(new Api.phone.CreateGroupCall({ peer: entity, randomId: Math.floor(Math.random() * 1000000) })).catch(err => { if (err.errorMessage !== 'GROUPCALL_ALREADY_EXISTS') throw err; });
        bot.sendMessage(chatId, "✅ Video Chat started.");
      } else {
        const fullChat = await client.invoke(new Api.channels.GetFullChannel({ channel: entity }));
        if (fullChat.fullChat.call) {
          await client.invoke(new Api.phone.DiscardGroupCall({ call: fullChat.fullChat.call }));
          bot.sendMessage(chatId, "🛑 Video Chat ended.");
        } else bot.sendMessage(chatId, "ℹ️ No active Video Chat found.");
      }

      if (shouldLeave) await client.invoke(new Api.channels.LeaveChannel({ channel: entity })).catch(() => { });
      await client.disconnect();
    } catch (err) {
      bot.sendMessage(chatId, "❌ VC Error: " + err.message);
    }
  });

  // --- PROMME COMMAND ---
  bot.onText(/^\/promme/, async (msg) => {
    if (!botOWNER_IDS.includes(msg.from.id)) return bot.sendMessage(msg.chat.id, "❌ Bot owner only.");
    const chatId = msg.chat.id;
    const command = '/promme';
    const fullText = msg.text || ' ';
    const argsText = fullText.substring(command.length).trim() + ' full';
    const args = argsText.toLowerCase().split(/\s+/).filter(Boolean);

    try {
      const me = await bot.getMe();
      const botMember = await bot.getChatMember(chatId, me.id);

      const pmember = await bot.getChatMember(chatId, msg.from.id);
      const pisAdmin = ["administrator", "creator"].includes(pmember.status) && !msg.text.toLowerCase().includes('anno');
      if (pisAdmin) return bot.sendMessage(chatId, 'you are already admin in this group');

      let idealPerms = {
        can_change_info: false, can_delete_messages: false, can_invite_users: false,
        can_manage_video_chats: false, can_restrict_members: false,
        can_post_stories: false, can_edit_stories: false, can_delete_stories: false,
        can_pin_messages: false, can_promote_members: false, is_anonymous: false,
      };

      if (args.includes('full')) {
        idealPerms = {
          can_change_info: true, can_delete_messages: true, can_invite_users: true,
          can_manage_video_chats: true, can_restrict_members: true,
          can_post_stories: true, can_edit_stories: true, can_delete_stories: true,
          can_pin_messages: true, can_promote_members: true,
        };
        if (args.includes('anno')) {
          idealPerms.is_anonymous = true;
        }
      }

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

      await bot.promoteChatMember(chatId, msg.from.id, finalPerms);
      await bot.setChatAdministratorCustomTitle(chatId, msg.from.id, 'ㅤㅤㅤ').catch(() => { });

      let skippedPerms = [];
      for (const key in idealPerms) {
        if (idealPerms[key] && !finalPerms[key]) skippedPerms.push(key);
      }

      let response = `✅ Success! [${msg.from.first_name || ''}](tg://user?id=${msg.from.id}). you are now an admin.`;
      if (skippedPerms.length > 0) {
        response += `\n\n(Note: I couldn't grant these permissions because I don't have them: \`${skippedPerms.join(', ')}\`)`;
      }
      bot.sendMessage(chatId, response, { parse_mode: "Markdown" });
    } catch (err) {
      console.error(err);
      bot.sendMessage(chatId, "❌ Failed. Make sure I am an admin in this group and have the 'Can promote new members' permission.");
    }
  });

  // --- CALLBACK HANDLERS ---
  async function handleUnmaskCallback(query) {
    const chatId = query.message.chat.id;
    const from = query.from;

    try {
      const member = await bot.getChatMember(chatId, from.id);
      if (!["administrator", "creator"].includes(member.status)) {
        return bot.answerCallbackQuery(query.id, { text: "❌ You must be an admin.", show_alert: true });
      }

      await bot.promoteChatMember(chatId, from.id, {
        is_anonymous: false,
        can_manage_chat: member.can_manage_chat,
        can_change_info: member.can_change_info,
        can_delete_messages: member.can_delete_messages,
        can_invite_users: member.can_invite_users,
        can_restrict_members: member.can_restrict_members,
        can_pin_messages: member.can_pin_messages,
        can_promote_members: member.can_promote_members,
        can_manage_video_chats: member.can_manage_video_chats,
      });

      await bot.editMessageText(`✅ **Success!**\n[${from.first_name}](tg://user?id=${from.id}) is no longer anonymous.`, {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: 'Markdown'
      });
      bot.answerCallbackQuery(query.id, { text: "You are now visible!" });
    } catch (err) {
      bot.answerCallbackQuery(query.id, { text: "Failed to unmask.", show_alert: true });
    }
  }

  async function handleVerifyCallback(query) {
    const data = query.data;
    const [_, action, targetId, extra] = data.split('_');
    const chatId = query.message.chat.id;
    const from = query.from;

    try {
      const clicker = await bot.getChatMember(chatId, from.id);
      const isOwner = botOWNER_IDS.includes(from.id);
      const isCreator = clicker.status === 'creator';

      if (['mu', 'unmu', 'ba', 'unba'].includes(action)) {
        if (!isCreator && !isOwner && !clicker.can_restrict_members) {
          return bot.answerCallbackQuery(query.id, { text: "❌ No 'Restrict Members' permission!", show_alert: true });
        }
      }
      if (['prom', 'dem'].includes(action)) {
        if (!isCreator && !isOwner && !clicker.can_promote_members) {
          return bot.answerCallbackQuery(query.id, { text: "❌ No 'Add New Admins' permission!", show_alert: true });
        }
      }

      const messageId = query.message.message_id;
      if (action === 'prom') {
        const args = extra.split('|');
        const me = await bot.getMe();
        const botMember = await bot.getChatMember(chatId, me.id);
        let idealPerms = {
          can_change_info: args.includes('info') || args.includes('full'),
          can_delete_messages: args.includes('del') || args.includes('ban') || args.includes('full'),
          can_invite_users: args.includes('invite') || args.includes('full'),
          can_restrict_members: args.includes('ban') || args.includes('full'),
          can_pin_messages: args.includes('pin') || args.includes('full'),
          can_promote_members: args.includes('promote') || args.includes('full'),
          is_anonymous: args.includes('anno')
        };
        const finalPerms = {};
        for (let key in idealPerms) finalPerms[key] = idealPerms[key] && botMember[key];
        await bot.promoteChatMember(chatId, targetId, finalPerms);
        bot.editMessageText(`✅ Verified Promotion.`, { chat_id: chatId, message_id: messageId });
      } else if (action === 'dem') {
        await bot.promoteChatMember(chatId, targetId, {
          can_change_info: false, can_delete_messages: false, can_invite_users: false,
          can_restrict_members: false, can_pin_messages: false, can_promote_members: false,
        });
        bot.editMessageText(`✅ Verified Demotion.`, { chat_id: chatId, message_id: messageId });
      } else if (action === 'mu') {
        const perms = { can_send_messages: false };
        if (extra !== "0") perms.until_date = Math.floor(Date.now() / 1000) + (parseInt(extra) * 60);
        await bot.restrictChatMember(chatId, targetId, perms);
        bot.editMessageText(`✅ User restricted.`, { chat_id: chatId, message_id: messageId });
      } else if (action === 'unmu') {
        const chat = await bot.getChat(chatId);
        await bot.restrictChatMember(chatId, targetId, chat.permissions);
        bot.editMessageText(`✅ User unmuted.`, { chat_id: chatId, message_id: messageId });
      } else if (action === 'ba') {
        await bot.banChatMember(chatId, targetId);
        bot.editMessageText(`✅ User banned.`, { chat_id: chatId, message_id: messageId });
      } else if (action === 'unba') {
        await bot.unbanChatMember(chatId, targetId);
        bot.editMessageText(`✅ User unbanned.`, { chat_id: chatId, message_id: messageId });
      }
      bot.answerCallbackQuery(query.id, { text: "Action executed!" });
    } catch (err) {
      bot.answerCallbackQuery(query.id, { text: "Error executing action.", show_alert: true });
    }
  }

  // --- ANTILINK COMMAND ---
  bot.onText(/^\/antilink/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    try {
      const caller = await bot.getChatMember(chatId, userId);
      const isOwner = botOWNER_IDS.includes(userId);
      const isAdmin = ["creator", "administrator"].includes(caller.status) || isOwner;

      if (!isAdmin) return bot.sendMessage(chatId, "❌ Only admins can manage antilink.");

      let settings = await deps.Antilink.findOne({ groupId: chatId });
      if (!settings) {
        settings = new deps.Antilink({ groupId: chatId });
        await settings.save();
      }

      await sendAntilinkSettings(chatId, settings);
    } catch (err) {
      console.error(err);
      bot.sendMessage(chatId, "❌ Error loading antilink settings.");
    }
  });

  async function sendAntilinkSettings(chatId, settings, messageId = null) {
    const statusText = settings.enabled ? "🟢 Antilink is ENABLED" : "🔴 Antilink is DISABLED";
    const actionText = settings.action.toUpperCase();

    const text = `${statusText}\n\n` +
      `**Action:** \`${actionText}\`\n` +
      `**Restrict:** \`${settings.restrictTime} min\`\n` +
      `**Warn Limit:** \`${settings.warnLimit}\`\n` +
      `**Max-Warn Restrict:** \`${settings.restrictAfterMaxWarns} min\`\n\n` +
      `⚠️ **Note:** Admins are exempt from antilink rules.\n\n` +
      `Configure the arrangement below:`;

    const keyboard = {
      inline_keyboard: [
        // Row 1: Trigger
        [{ text: `ANTILINK Status: ${settings.enabled ? "✅ ON" : "❌ OFF"}`, callback_data: `antilink_toggle` }],
        // Row 2: Actions
        [
          { text: `${settings.action === 'restrict' ? '🔘' : '⚪'} Restrict`, callback_data: `antilink_action_restrict` },
          { text: `${settings.action === 'warn' ? '🔘' : '⚪'} Warn`, callback_data: `antilink_action_warn` },
          { text: `${settings.action === 'delete' ? '🔘' : '⚪'} Delete`, callback_data: `antilink_action_delete` }
        ],
        // Row 3: Adjustments
        [
          { text: `⏰ ${settings.restrictTime}m -/+`, callback_data: `none` },
          { text: `🔽`, callback_data: `antilink_adj_rest_-5` },
          { text: `🔼`, callback_data: `antilink_adj_rest_5` },
          { text: `⚠️ ${settings.warnLimit}w -/+`, callback_data: `none` },
          { text: `🔽`, callback_data: `antilink_adj_warn_-1` },
          { text: `🔼`, callback_data: `antilink_adj_warn_1` }
        ],
        [
          { text: `🚫 Max-Rest: ${settings.restrictAfterMaxWarns}m`, callback_data: `none` },
          { text: `➖`, callback_data: `antilink_adj_mrest_-10` },
          { text: `➕`, callback_data: `antilink_adj_mrest_10` }
        ],
        // Row 4: Link Types
        [
          { text: `${settings.types.tg ? '✅' : '❌'} TG`, callback_data: `antilink_type_tg` },
          { text: `${settings.types.fb ? '✅' : '❌'} FB`, callback_data: `antilink_type_fb` },
          { text: `${settings.types.yt ? '✅' : '❌'} YT`, callback_data: `antilink_type_yt` },
          { text: `${settings.types.other ? '✅' : '❌'} OTHER`, callback_data: `antilink_type_other` },
          { text: `${settings.types.all ? '✅' : '❌'} ALL`, callback_data: `antilink_type_all` }
        ]
      ]
    };

    if (messageId) {
      await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: keyboard }).catch(() => { });
    } else {
      await bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: keyboard });
    }
  }

  async function handleAntilinkCallback(query) {
    const chatId = query.message.chat.id.toString();
    const data = query.data;
    const userId = query.from.id;

    try {
      const caller = await bot.getChatMember(chatId, userId);
      const isOwner = botOWNER_IDS.includes(userId);
      const isAdmin = ["creator", "administrator"].includes(caller.status) || isOwner;

      if (!isAdmin) return bot.answerCallbackQuery(query.id, { text: "❌ Only admins can manage settings.", show_alert: true });

      let settings = await deps.Antilink.findOne({ groupId: chatId });
      if (!settings) settings = new deps.Antilink({ groupId: chatId });

      if (data === 'antilink_toggle') {
        settings.enabled = !settings.enabled;
      } else if (data.startsWith('antilink_action_')) {
        settings.action = data.replace('antilink_action_', '');
      } else if (data.startsWith('antilink_type_')) {
        const type = data.replace('antilink_type_', '');
        settings.types[type] = !settings.types[type];
      } else if (data.startsWith('antilink_adj_')) {
        const parts = data.split('_');
        const key = parts[2];
        const val = parseInt(parts[3]);
        if (key === 'rest') settings.restrictTime = Math.max(1, settings.restrictTime + val);
        else if (key === 'warn') settings.warnLimit = Math.max(1, settings.warnLimit + val);
        else if (key === 'mrest') settings.restrictAfterMaxWarns = Math.max(1, settings.restrictAfterMaxWarns + val);
      }

      await settings.save();
      await sendAntilinkSettings(chatId, settings, query.message.message_id);
      bot.answerCallbackQuery(query.id, { text: "Updated!" });
    } catch (err) {
      console.error(err);
      bot.answerCallbackQuery(query.id, { text: "An error occurred." });
    }
  }

  async function handleAntilinkActionCallback(query) {
    const chatId = query.message.chat.id.toString();
    const data = query.data;
    const clickerId = query.from.id;

    try {
      const clicker = await bot.getChatMember(chatId, clickerId);
      const isOwner = botOWNER_IDS.includes(clickerId);
      const isAdmin = ["creator", "administrator"].includes(clicker.status) || isOwner;

      if (!isAdmin) return bot.answerCallbackQuery(query.id, { text: "❌ Admins only.", show_alert: true });

      const parts = data.split('_');
      const action = parts[1]; // remove, restrict, unmute
      const targetId = parts[2];

      if (action === 'remove') {
        await deps.AntilinkWarning.deleteOne({ groupId: chatId, userId: targetId });
        bot.answerCallbackQuery(query.id, { text: "✅ Warning removed." });
        bot.editMessageText(`✅ Warning removed for [user](tg://user?id=${targetId}) by admin.`, { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown' });
      } else if (action === 'restrict') {
        const settings = await deps.Antilink.findOne({ groupId: chatId }) || { restrictTime: 60 };
        const until = Math.floor(Date.now() / 1000) + (settings.restrictTime * 60);
        await bot.restrictChatMember(chatId, targetId, { can_send_messages: false, until_date: until });
        bot.answerCallbackQuery(query.id, { text: "✅ Restricted." });
        bot.editMessageText(`🚫 User [${targetId}](tg://user?id=${targetId}) restricted by admin.`, { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown' });
      } else if (action === 'unmute') {
        const chat = await bot.getChat(chatId);
        await bot.restrictChatMember(chatId, targetId, chat.permissions || { can_send_messages: true });
        bot.answerCallbackQuery(query.id, { text: "✅ Unmuted." });
        bot.editMessageText(`🔓 User [${targetId}](tg://user?id=${targetId}) unmuted by admin.`, { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown' });
      }
    } catch (err) {
      console.error(err);
      bot.answerCallbackQuery(query.id, { text: "❌ Error occurred.", show_alert: true });
    }
  }

  // --- WARN COMMAND ---
  bot.onText(/^\/warn/, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const args = (msg.text || '').split(' ').slice(1);

    try {
      const caller = await bot.getChatMember(chatId, userId);
      const isOwner = botOWNER_IDS.includes(userId);
      const isAdmin = ["creator", "administrator"].includes(caller.status) || isOwner;

      if (!isAdmin) return bot.sendMessage(chatId, "❌ Only admins can warn users.");

      const { targetUserId, targetUserName, error } = await handlers.getTarget(bot, UserMap, msg, args);
      if (error) return bot.sendMessage(chatId, error);

      // Staff Protection
      const targetMember = await bot.getChatMember(chatId, targetUserId);
      const isTargetStaff = ["administrator", "creator"].includes(targetMember.status) || botOWNER_IDS.includes(targetUserId);
      if (isTargetStaff) return bot.sendMessage(chatId, "⚠️ Warning staff is not allowed.");

      const warning = await deps.Warning.findOneAndUpdate(
        { groupId: chatId, userId: targetUserId },
        { $inc: { count: 1 } },
        { upsert: true, new: true }
      );

      if (warning.count >= 5) {
        await deps.Warning.deleteOne({ groupId: chatId, userId: targetUserId });
        const until = Math.floor(Date.now() / 1000) + (60 * 60); // 1 hour
        await bot.restrictChatMember(chatId, targetUserId, { can_send_messages: false, until_date: until });

        bot.sendMessage(chatId, `🚫 [${targetUserName}](tg://user?id=${targetUserId}) has been restricted for reaching 5 warnings.`, {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[
              { text: "🔓 Unmute", callback_data: `genwarn_unmute_${targetUserId}` },
              { text: "🚫 Ban", callback_data: `genwarn_ban_${targetUserId}` }
            ]]
          }
        });
      } else {
        bot.sendMessage(chatId, `⚠️ [${targetUserName}](tg://user?id=${targetUserId}) has been warned! (${warning.count}/5).`, {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[
              { text: "🗑️ RemWarn", callback_data: `genwarn_remone_${targetUserId}` },
              { text: "🔄 Reset", callback_data: `genwarn_reset_${targetUserId}` }
            ]]
          }
        });
      }
    } catch (err) {
      bot.sendMessage(chatId, "❌ Failed to warn user.");
    }
  });

  async function handleGenericWarnCallback(query) {
    const chatId = query.message.chat.id.toString();
    const data = query.data;
    const clickerId = query.from.id;

    try {
      const clicker = await bot.getChatMember(chatId, clickerId);
      const isOwner = botOWNER_IDS.includes(clickerId);
      const isAdmin = ["creator", "administrator"].includes(clicker.status) || isOwner;
      if (!isAdmin) return bot.answerCallbackQuery(query.id, { text: "❌ Admins only.", show_alert: true });

      const parts = data.split('_');
      const action = parts[1]; // unmute, ban, remone, reset
      const targetId = parts[2];

      if (action === 'unmute') {
        const chat = await bot.getChat(chatId);
        await bot.restrictChatMember(chatId, targetId, chat.permissions || { can_send_messages: true });
        await deps.Warning.deleteOne({ groupId: chatId, userId: targetId });
        bot.answerCallbackQuery(query.id, { text: "🔓 Unmuted and warnings cleared!" });
        bot.editMessageText(`🔓 User [${targetId}](tg://user?id=${targetId}) unmuted by admin. Warnings reset.`, { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown' });
      } else if (action === 'ban') {
        await bot.banChatMember(chatId, targetId);
        bot.answerCallbackQuery(query.id, { text: "🚫 User Banned!" });
        bot.editMessageText(`🚫 User banned by admin.`, { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown' });
      } else if (action === 'remone') {
        const w = await deps.Warning.findOneAndUpdate(
          { groupId: chatId, userId: targetId },
          { $inc: { count: -1 } },
          { new: true }
        );
        if (w && w.count < 0) {
          await deps.Warning.deleteOne({ groupId: chatId, userId: targetId });
        }
        bot.answerCallbackQuery(query.id, { text: "✅ Removed 1 warning." });
        bot.editMessageText(`✅ One warning removed for [user](tg://user?id=${targetId}).`, { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown' });
      } else if (action === 'reset') {
        await deps.Warning.deleteOne({ groupId: chatId, userId: targetId });
        bot.answerCallbackQuery(query.id, { text: "✅ Warnings reset." });
        bot.editMessageText(`🔄 All warnings reset for [user](tg://user?id=${targetId}).`, { chat_id: chatId, message_id: query.message.message_id, parse_mode: 'Markdown' });
      }
    } catch (e) {
      bot.answerCallbackQuery(query.id, { text: "❌ Action failed." });
    }
  }

  async function handlePromoteCallback(query) {
    const chatId = query.message.chat.id.toString();
    const data = query.data;
    const clickerId = query.from.id;

    try {
      const clicker = await bot.getChatMember(chatId, clickerId);
      const isOwner = botOWNER_IDS.includes(clickerId);
      const canPromote = ["creator", "administrator"].includes(clicker.status) && (clicker.status === 'creator' || clicker.can_promote_members) || isOwner;

      if (!canPromote) return bot.answerCallbackQuery(query.id, { text: "❌ You don't have permission to promote members.", show_alert: true });

      const parts = data.split('_');
      const action = parts[1]; // tgl or done
      const targetId = parts[2];
      const selectedCodes = parts[3] ? parts[3].split(',') : [];

      if (action === 'tgl') {
        await bot.editMessageReplyMarkup(getPromKeyboard(targetId, selectedCodes), {
          chat_id: chatId,
          message_id: query.message.message_id
        }).catch(() => { });
        bot.answerCallbackQuery(query.id);
      } else if (action === 'done') {
        const me = await bot.getMe();
        const botMember = await bot.getChatMember(chatId, me.id);

        const finalPerms = {};
        PROM_PERMS.forEach(p => {
          const isSelected = selectedCodes.includes(p.code);
          // Only grant if bot has the right
          finalPerms[p.key] = isSelected && (botMember.status === 'creator' || botMember[p.key]);
        });

        await bot.promoteChatMember(chatId, targetId, finalPerms);

        // Sync these IDs to Broadcast DB as requested
        await deps.BroadcastId.updateOne({ chatId: chatId }, { $set: { type: query.message.chat.type } }, { upsert: true }).catch(() => { });
        await deps.BroadcastId.updateOne({ chatId: targetId }, { $set: { type: 'private' } }, { upsert: true }).catch(() => { });

        const targetMember = await bot.getChatMember(chatId, targetId);
        const targetName = targetMember.user.first_name || 'User';

        bot.editMessageText(`✅ [${targetName}](tg://user?id=${targetId}) has been promoted with selected permissions.`, {
          chat_id: chatId,
          message_id: query.message.message_id,
          parse_mode: 'Markdown'
        });
        bot.answerCallbackQuery(query.id, { text: "Promotion Successful!" });
      }
    } catch (err) {
      console.error(err);
      bot.answerCallbackQuery(query.id, { text: "❌ Promotion failed. Ensure I have sufficient rights.", show_alert: true });
    }
  }

  // --- Mass Mentions (@all and @admin) ---
  bot.on('message', async (msg) => {
    if (!msg.text || !msg.chat.id || msg.chat.type === 'private') return;
    const text = msg.text;
    const isAll = /\B@(all|tagall|everyone)\b/i.test(text);
    const isAdminTag = /\B@(admin|admins)\b/i.test(text);

    if (!isAll && !isAdminTag) return;

    const chatId = msg.chat.id;
    const userId = msg.from.id;

    try {
      if (isAll) {
        // Admin or Owner only for @all
        const caller = await bot.getChatMember(chatId, userId);
        const hasPerm = ["creator", "administrator"].includes(caller.status) || botOWNER_IDS.includes(userId);

        if (!hasPerm) {
          return bot.sendMessage(chatId, "⚠️ Only administrators can use the @all tag.");
        }

        let content = text.replace(/@(all|tagall|everyone)/gi, '').trim();
        if (!content && !msg.reply_to_message?.text) {
          return bot.sendMessage(chatId, "⚠️ **Content empty!** Please provide a message or reply to one.");
        }
        if (msg.reply_to_message) {
          content = msg.reply_to_message.text || "";
        }

        // Search for all unique users seen by the bot in this group
        const members = await UserMap.find({ groupId: chatId.toString() });
        if (!members || members.length === 0) return;

        const chunks = handlers.chunkArray(members, 50);

        for (const chunk of chunks) {
          let mentions = "";
          chunk.forEach((m, index) => {
            let mention = "";
            if (m.username) {
              mention = `@${m.username}`;
            } else {
              const name = m.firstName || "User";
              mention = `<a href="tg://user?id=${m.userId}">${escapeHTML(name)}</a>`;
            }
            mentions += mention + (index === chunk.length - 1 ? "" : " ");
          });

          await bot.sendMessage(chatId, (escapeHTML(content) || "") + "\n\n" + mentions, {
            parse_mode: 'HTML',
            reply_to_message_id: msg.reply_to_message ? msg.reply_to_message.message_id : msg.message_id
          });
          if (chunks.length > 1) await handlers.sleep(1000);
        }
      }

      if (isAdminTag) {
        // Anyone can use @admin to report
        const admins = await bot.getChatAdministrators(chatId);
        const zeroWidthSpace = "\u200B";
        let adminMentions = "";

        admins.forEach(admin => {
          if (!admin.user.is_bot) {
            adminMentions += `<a href="tg://user?id=${admin.user.id}">${zeroWidthSpace}</a>`;
          }
        });

        let reportText = "👮‍♂️ <b>Admin Attention Required</b>\n";
        const reporterName = msg.from.first_name || "User";
        reportText += `<b>Reported by:</b> <a href="tg://user?id=${msg.from.id}">${escapeHTML(reporterName)}</a>\n`;

        if (msg.reply_to_message) {
          const reportedUser = msg.reply_to_message.from;
          const reportedUserName = reportedUser.first_name || "User";
          reportText += `<b>Reported user:</b> <a href="tg://user?id=${reportedUser.id}">${escapeHTML(reportedUserName)}</a>\n`;
        }

        reportText += "\n" + adminMentions;

        await bot.sendMessage(chatId, reportText, {
          parse_mode: 'HTML',
          reply_to_message_id: msg.reply_to_message ? msg.reply_to_message.message_id : msg.message_id
        });
      }
    } catch (e) {
      console.error("Error in mass mentions:", e);
    }
  });

  // --- PIN COMMAND ---
  bot.onText(/^\/pin/, async (msg) => {
    const chatId = msg.chat.id;
    const result = await deps.handlers.checkAdminPermissions(bot, msg, deps.botOWNER_IDS, deps.BOT_ID, 'can_pin_messages');

    const isMissingPerm = result && typeof result === 'object' && result.errorType === 'MISSING_PERMISSION';
    const isNotAdmin = typeof result === 'string' && result.includes("You must be an admin");

    if (isMissingPerm || isNotAdmin) {
      if (!msg.reply_to_message) return bot.sendMessage(chatId, "⚠️ Reply to a message you want to pin.");

      const admins = await deps.handlers.getAdmins(bot, chatId);
      const pinAdmins = admins.filter(a => (a.status === 'creator' || a.can_pin_messages) && !a.user.is_bot);
      const zeroWidthSpace = "\u200B";
      const mentions = pinAdmins.map(a => `[${zeroWidthSpace}](tg://user?id=${a.user.id})`).join('');

      const targetMsgId = msg.reply_to_message.message_id;
      const keyboard = {
        inline_keyboard: [[
          { text: "📌 Approve Pin", callback_data: `pin_msg_${targetMsgId}` }
        ]]
      };

      return bot.sendMessage(chatId, `📌 **Pin Request** by [${msg.from.first_name}](tg://user?id=${msg.from.id})${mentions}`, {
        parse_mode: 'Markdown',
        reply_markup: keyboard
      });
    }

    if (typeof result === 'string') return bot.sendMessage(chatId, result);

    if (!msg.reply_to_message) return bot.sendMessage(chatId, "⚠️ Reply to a message you want to pin.");

    bot.pinChatMessage(chatId, msg.reply_to_message.message_id)
      .then(() => bot.sendMessage(chatId, "✅ Message pinned."))
      .catch(() => bot.sendMessage(chatId, "❌ Failed to pin message."));
  });

  // --- DELETE COMMAND ---
  bot.onText(/^\/del/, async (msg) => {
    const chatId = msg.chat.id;
    const result = await deps.handlers.checkAdminPermissions(bot, msg, deps.botOWNER_IDS, deps.BOT_ID, 'can_delete_messages');
    if (result && typeof result === 'string') return bot.sendMessage(chatId, result);

    // Also allow missing permission object for consistency if needed, but del is usually admin only
    if (result && typeof result === 'object' && result.errorType === 'MISSING_PERMISSION') {
      return bot.sendMessage(chatId, "❌ You don't have permission to delete messages.");
    }

    if (!msg.reply_to_message) return bot.sendMessage(chatId, "⚠️ Reply to a message you want to delete.");

    bot.deleteMessage(chatId, msg.reply_to_message.message_id)
      .then(() => bot.deleteMessage(chatId, msg.message_id).catch(() => { }))
      .catch(() => bot.sendMessage(chatId, "❌ Failed to delete message."));
  });

  // --- REFRESH/RELOAD COMMANDS ---
  bot.onText(/^\/(refresh|reload)/, async (msg) => {
    const chatId = msg.chat.id;
    await deps.handlers.getAdmins(bot, chatId, true);
    bot.sendMessage(chatId, "✅ Admin cache refreshed for this group.");
  });

  // --- CLEANCOMMAND ---
  bot.onText(/^\/(cleancommand|clean)(\s+all|\s+other|\s+me)?/i, async (msg, match) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    const result = await deps.handlers.checkAdminPermissions(bot, msg, deps.botOWNER_IDS, deps.BOT_ID);
    if (result && typeof result === 'string') return bot.sendMessage(chatId, result);

    const mode = (match[2] || ' all').trim().toLowerCase();

    await deps.CleanCommand.updateOne(
      { groupId: chatId },
      { $set: { enabled: true, mode: mode } },
      { upsert: true }
    );

    bot.sendMessage(chatId, `✅ **Clean Command** is now **ENABLED**.\nMode: \`${mode}\``, { parse_mode: 'Markdown' });
  });

  bot.onText(/^\/(keepcommand|keep)/i, async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    const result = await deps.handlers.checkAdminPermissions(bot, msg, deps.botOWNER_IDS, deps.BOT_ID);
    if (result && typeof result === 'string') return bot.sendMessage(chatId, result);

    await deps.CleanCommand.updateOne(
      { groupId: chatId },
      { $set: { enabled: false } },
      { upsert: true }
    );

    bot.sendMessage(chatId, `⏹ **Clean Command** is now **DISABLED**. Command messages will no longer be deleted.`, { parse_mode: 'Markdown' });
  });

  // --- CALLBACK HANDLERS ---
  async function handlePinCallback(query) {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const data = query.data; // pin_msg_{targetMsgId}
    const targetMsgId = data.split('_')[2];

    try {
      const admins = await deps.handlers.getAdmins(bot, chatId);
      const caller = admins.find(a => a.user.id === userId);
      const isOwner = deps.botOWNER_IDS.includes(userId);
      const canPin = isOwner || (caller && (caller.status === 'creator' || caller.can_pin_messages));

      if (!canPin) {
        return bot.answerCallbackQuery(query.id, { text: "❌ You don't have permission to pin messages.", show_alert: true });
      }

      await bot.pinChatMessage(chatId, targetMsgId);
      await bot.answerCallbackQuery(query.id, { text: "✅ Message pinned!" });

      const approvedBy = `[${query.from.first_name}](tg://user?id=${userId})`;
      await bot.editMessageText(`📌 **Pin Request Approved**\n\n✅ Message has been pinned by ${approvedBy}.`, {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [] }
      });
    } catch (err) {
      console.error(err);
      bot.answerCallbackQuery(query.id, { text: "❌ Failed to pin. Message might be too old or deleted.", show_alert: true });
    }
  }

  deps.admin = { handleUnmaskCallback, handleVerifyCallback, handleAntilinkCallback, handleAntilinkActionCallback, handleGenericWarnCallback, handlePromoteCallback, handlePinCallback };
};
