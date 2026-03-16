module.exports = function (bot, deps) {
  const { botOWNER_IDS, handlers } = deps;
  const { getTarget, handleAnonymous } = handlers;

  // --- MUTE COMMAND ---
  bot.onText(/^\/mu/, async (msg) => {
    const text = msg.text || '';
    const command = text.split(' ')[0].toLowerCase();
    const args = text.split(' ').slice(1);
    const chatId = msg.chat.id;

    if (!msg.reply_to_message && !args.length) return bot.sendMessage(chatId, "⚠️ Reply to a user or provide their ID.");

    try {
      const { targetUserId, targetUserName, error } = await getTarget(msg, args);
      if (error) return bot.sendMessage(chatId, error);

      const caller = await bot.getChatMember(chatId, msg.from.id);
      const isOwner = botOWNER_IDS.includes(msg.from.id);
      const canMute = caller.status === 'creator' || caller.can_restrict_members || isOwner;

      if (await handleAnonymous(msg, "mu", targetUserId, targetUserName)) return;
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
      const { targetUserId, targetUserName, error } = await getTarget(msg, args);
      if (error) return bot.sendMessage(chatId, error);

      const caller = await bot.getChatMember(chatId, msg.from.id);
      const canUnmute = caller.status === 'creator' || caller.can_restrict_members || botOWNER_IDS.includes(msg.from.id);

      if (await handleAnonymous(msg, "unmu", targetUserId, targetUserName)) return;
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
      const { targetUserId, targetUserName, error } = await getTarget(msg, args);
      if (error) return bot.sendMessage(chatId, error);

      const caller = await bot.getChatMember(chatId, msg.from.id);
      const isOwner = botOWNER_IDS.includes(msg.from.id);
      const canBan = caller.status === 'creator' || caller.can_restrict_members || isOwner;

      if (await handleAnonymous(msg, "ba", targetUserId, targetUserName)) return;
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
      const { targetUserId, targetUserName, error } = await getTarget(msg, args);
      if (error) return bot.sendMessage(chatId, error);

      const caller = await bot.getChatMember(chatId, msg.from.id);
      const isOwner = botOWNER_IDS.includes(msg.from.id);
      const canUnban = caller.status === 'creator' || caller.can_restrict_members || isOwner;

      if (await handleAnonymous(msg, "unba", targetUserId, targetUserName)) return;
      if (!canUnban) return bot.sendMessage(chatId, "❌ No permission.");

      await bot.unbanChatMember(chatId, targetUserId);
      bot.sendMessage(chatId, `✅ Unbanned [${targetUserName}](tg://user?id=${targetUserId})`, { parse_mode: 'Markdown' });
    } catch (err) {
      bot.sendMessage(chatId, "Error unbanning.");
    }
  });

  // --- PROMOTE COMMAND ---
  bot.onText(/^\/prom/, async (msg) => {
    const text = msg.text || '';
    const command = text.split(' ')[0].toLowerCase();
    const args = text.substring(command.length).trim().toLowerCase().split(/\s+/).filter(Boolean);
    const chatId = msg.chat.id;

    if (!msg.reply_to_message) return bot.sendMessage(chatId, "Please reply to the user you want to promote.");
    if (args.length === 0) return bot.sendMessage(chatId, "Please provide permissions (e.g., 'full', 'ban', 'pin', 'del', 'info', 'invite', 'promote').");

    try {
      const caller = await bot.getChatMember(chatId, msg.from.id);
      const isOwner = botOWNER_IDS.includes(msg.from.id);
      const canPromote = caller.status === 'creator' || caller.can_promote_members || isOwner;

      const userToPromote = msg.reply_to_message.from;
      const userToPromotename = userToPromote.first_name || '';

      if (await handleAnonymous(msg, "prom", userToPromote.id, userToPromotename, args.join('|'))) return;
      if (!canPromote) return bot.sendMessage(chatId, "❌ You don't have the 'Add New Admins' permission.");

      const targetStatus = await bot.getChatMember(chatId, userToPromote.id);
      if (["administrator", "creator"].includes(targetStatus.status)) return bot.sendMessage(chatId, "User is already admin.");

      const me = await bot.getMe();
      const botMember = await bot.getChatMember(chatId, me.id);

      let idealPerms = {
        can_change_info: args.includes('info') || args.includes('full'),
        can_delete_messages: args.includes('del') || args.includes('ban') || args.includes('full'),
        can_invite_users: args.includes('invite') || args.includes('full'),
        can_restrict_members: args.includes('ban') || args.includes('full'),
        can_pin_messages: args.includes('pin') || args.includes('full'),
        can_promote_members: args.includes('promote') || args.includes('full'),
        can_manage_video_chats: args.includes('full'),
        is_anonymous: args.includes('anno')
      };

      const finalPerms = {};
      Object.keys(idealPerms).forEach(key => {
        finalPerms[key] = idealPerms[key] && botMember[key];
      });

      await bot.promoteChatMember(chatId, userToPromote.id, finalPerms);
      bot.sendMessage(chatId, `✅ [${userToPromotename}](tg://user?id=${userToPromote.id}) has been promoted.`, { parse_mode: "Markdown" });

    } catch (error) {
      console.error(error);
      bot.sendMessage(chatId, "❌ Promotion failed. Ensure I have 'Add New Admins' rights.");
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
      if (await handleAnonymous(msg, "dem", userToDemote.id, userToDemote.first_name)) return;
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

      const sessionData = fs.readFileSync("session.txt", "utf8").trim();
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

  deps.admin = { handleUnmaskCallback, handleVerifyCallback };
};
