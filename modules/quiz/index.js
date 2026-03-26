const fetch = require('node-fetch');

module.exports = function (bot, db) {
  const QUIZ_URL = "https://raw.githubusercontent.com/hansaka02/questionjson/refs/heads/main/quiz.json";
  const quizSessions = {};

  const getCustomQuizModel = () => db.getCustomQuizModel();
  const getUserQuizScoreModel = () => db.getUserQuizScoreModel();
  const getQuizResultModel = () => db.getQuizResultModel();

  async function startQuiz(chatId, customQuizData = null) {
    if (quizSessions[chatId] && quizSessions[chatId].active) {
      bot.sendMessage(chatId, "❌ A quiz is already running in this group.");
      return;
    }

    if (!customQuizData || !customQuizData.questions || !customQuizData.questions.length) {
      bot.sendMessage(chatId, "❌ Failed to load quiz questions. (No data provided or ID invalid)");
      return;
    }

    const questions = customQuizData.questions;
    const quizTitle = customQuizData.title || "Custom Quiz";
    const quizDesc = customQuizData.description || '';
    const openPeriod = customQuizData.openPeriod || 20;

    quizSessions[chatId] = {
      questions,
      currentQ: 0,
      active: true,
      leaderboard: {},
      currentPollId: null,
      readyPlayers: new Map(), // userId => firstName
      readyMessageId: null,
      quizTitle,
      quizDesc,
      openPeriod
    };

    const descLine = quizDesc ? `\n📄 ${quizDesc}` : '';
    const text = `🎮 *Quiz:* ${quizTitle}${descLine}\n\nPlayers, get ready! Click the button below to join.`;
    const poll = await bot.sendMessage(chatId, text, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[{ text: "✅ Ready", callback_data: `ready_quiz_${chatId}` }]]
      }
    });

    quizSessions[chatId].readyMessageId = poll.message_id;

    // Wait 15 seconds for players to get ready, then start or cancel if no one ready
    setTimeout(() => startCountdown(chatId), 15000);
  }

  async function handleReadyCallback(query) {
    const chatId = query.message.chat.id.toString();
    const userId = query.from.id;
    const firstName = query.from.first_name || `User${userId}`;
    const session = quizSessions[chatId];

    if (!session || !session.active) return bot.answerCallbackQuery(query.id, { text: "❌ No active quiz session." });

    if (session.readyPlayers.has(userId)) {
      return bot.answerCallbackQuery(query.id, { text: "You are already ready!" });
    }

    session.readyPlayers.set(userId, firstName);
    bot.answerCallbackQuery(query.id, { text: "✅ You are locked in!" });

    // Update the message to show who's ready
    const names = Array.from(session.readyPlayers.values()).map(n => `• ${n}`).join('\n');
    const descLine = session.quizDesc ? `\n📄 ${session.quizDesc}` : '';
    const text = `🎮 *Quiz:* ${session.quizTitle}${descLine}\n\nPlayers, get ready! Click the button below to join.\n\n👥 *Ready (${session.readyPlayers.size}):*\n${names}`;

    bot.editMessageText(text, {
      chat_id: chatId,
      message_id: session.readyMessageId,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[{ text: "✅ Ready", callback_data: `ready_quiz_${chatId}` }]]
      }
    }).catch(() => { });
  }

  async function startCountdown(chatId) {
    const session = quizSessions[chatId];
    if (!session || !session.active) return;

    if (session.readyPlayers.size === 0) {
      bot.sendMessage(chatId, "❌ No one was ready. Quiz cancelled.");
      delete quizSessions[chatId];
      return;
    }

    bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: session.readyMessageId }).catch(() => { });

    const names = Array.from(session.readyPlayers.values()).map(n => `• ${n}`).join('\n');
    const descLine = session.quizDesc ? `\n📄 ${session.quizDesc}` : '';
    bot.editMessageText(
      `🎮 *Quiz:* ${session.quizTitle}${descLine}\n\n✅ *${session.readyPlayers.size} player(s) ready:*\n${names}\n\n_Starting now..._`,
      { chat_id: chatId, message_id: session.readyMessageId, parse_mode: 'Markdown' }
    ).catch(() => { });

    const countdownMsgs = ["3...", "2...", "1...", "🚀 GO!"];
    for (const text of countdownMsgs) {
      await bot.sendMessage(chatId, `🎯 *Starting in:* ${text}`, { parse_mode: 'Markdown' }).then(m => {
        setTimeout(() => bot.deleteMessage(chatId, m.message_id).catch(() => { }), 1000);
      });
      await new Promise(r => setTimeout(r, 1000));
    }

    sendNextQuestion(chatId);
  }

  async function sendNextQuestion(chatId) {
    const session = quizSessions[chatId];
    if (!session || !session.active) return;

    if (session.currentQ >= session.questions.length) {
      session.active = false;
      let text = "🏆 Quiz finished! Final leaderboard:\n\n";
      const sorted = Object.values(session.leaderboard).sort((a, b) => b.score - a.score);
      if (!sorted.length) {
        text += "No one answered correctly.";
      } else {
        sorted.forEach((u, i) => text += `${i + 1}. ${u.name} — ${u.score} points\n`);

        // Save scores to DB
        for (const u of sorted) {
          try {
            // Update all-time total score
            await getUserQuizScoreModel().updateOne(
              { groupId: chatId, userId: u.id },
              { $inc: { score: u.score }, firstName: u.name, username: u.username },
              { upsert: true }
            );
            // Save individual result for time-based leaderboards
            await getQuizResultModel().create({
              groupId: chatId,
              userId: u.id,
              score: u.score,
              firstName: u.name,
              username: u.username
            });
          } catch (e) {
            console.error("Error saving quiz score:", e);
          }
        }
      }
      bot.sendMessage(chatId, text);
      delete quizSessions[chatId];
      return;
    }

    if (session.currentQ > 0) {
      await bot.sendMessage(chatId, "⏳ Next question in 5 seconds...");
      await new Promise(res => setTimeout(res, 5000));
    }

    const q = session.questions[session.currentQ];
    const openPeriod = session.openPeriod || 20;
    try {
      let mediaMsg = null;
      if (q.media) {
        try {
          if (q.mediaType === 'photo') {
            mediaMsg = await bot.sendPhoto(chatId, q.media);
          } else if (q.mediaType === 'video') {
            mediaMsg = await bot.sendVideo(chatId, q.media);
          } else if (q.mediaType === 'animation') {
            mediaMsg = await bot.sendAnimation(chatId, q.media);
          }
        } catch (err) {
          console.error("Failed to send quiz media:", err.message);
        }
      }

      const poll = await bot.sendPoll(chatId, q.question, q.options, {
        type: "quiz",
        correct_option_id: q.answer,
        is_anonymous: false,
        open_period: openPeriod,
        explanation: q.explanation || "",
        reply_to_message_id: mediaMsg ? mediaMsg.message_id : null
      });
      session.currentPollId = poll.poll.id;

      setTimeout(() => {
        if (session.active) {
          session.currentQ++;
          sendNextQuestion(chatId);
        }
      }, (openPeriod + 1) * 1000); // +1s buffer after poll closes
    } catch (err) {
      console.error("Quiz Poll Execution Error:", err);
    }
  }

  bot.on("poll_answer", async (answer) => {
    const chatId = Object.keys(quizSessions).find(id => quizSessions[id].currentPollId === answer.poll_id);
    if (!chatId) return;

    const session = quizSessions[chatId];
    const q = session.questions[session.currentQ];

    if (answer.option_ids[0] === q.answer) {
      if (!session.leaderboard[answer.user.id]) {
        session.leaderboard[answer.user.id] = {
          id: answer.user.id,
          name: answer.user.first_name,
          username: answer.user.username,
          score: 0
        };
      }
      session.leaderboard[answer.user.id].score++;
    }
  });

  // Handle /qlead command
  bot.onText(/^\/qlead/, async (msg) => {
    const chatId = msg.chat.id;
    return sendLeaderboard(chatId, null, 'group', 'alltime');
  });

  async function sendLeaderboard(chatId, messageId, scope, period) {
    try {
      const now = new Date();
      let startDate = null;

      if (period === 'today') {
        startDate = new Date(now.setHours(0, 0, 0, 0));
      } else if (period === 'weekly') {
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      } else if (period === 'monthly') {
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      }

      let topUsers;
      const matchStage = {};
      if (scope === 'group') matchStage.groupId = chatId.toString();
      if (startDate) matchStage.timestamp = { $gte: startDate };

      if (period === 'alltime') {
        if (scope === 'group') {
          topUsers = await getUserQuizScoreModel().find({ groupId: chatId.toString() }).sort({ score: -1 }).limit(10);
        } else {
          topUsers = await getUserQuizScoreModel().aggregate([
            { $group: { _id: "$userId", totalScore: { $sum: "$score" }, firstName: { $first: "$firstName" } } },
            { $sort: { totalScore: -1 } },
            { $limit: 10 }
          ]);
        }
      } else {
        topUsers = await getQuizResultModel().aggregate([
          { $match: matchStage },
          {
            $group: {
              _id: "$userId",
              totalScore: { $sum: "$score" },
              firstName: { $first: "$firstName" }
            }
          },
          { $sort: { totalScore: -1 } },
          { $limit: 10 }
        ]);
      }

      const periodLabels = { today: "Today", weekly: "Weekly", monthly: "Monthly", alltime: "All-time" };
      const scopeLabels = { group: "Group", global: "Global" };

      let text = `🏆 *Quiz Leaderboard - ${scopeLabels[scope]} (${periodLabels[period]})* 🏆\n\n`;
      if (!topUsers || topUsers.length === 0) {
        text += "No scores found for this period.";
      } else {
        topUsers.forEach((u, i) => {
          const name = u.firstName || "User";
          const score = u.score !== undefined ? u.score : u.totalScore;
          const id = u.userId || u._id;
          text += `${i + 1}. [${name}](tg://user?id=${id}) — ${score} pts\n`;
        });
      }

      const getIcon = (curr, target) => curr === target ? "🔘" : "";

      const keyboard = {
        inline_keyboard: [
          [
            { text: `${getIcon(scope, 'group')} Group`, callback_data: `ql_alltime_group` }, // Defaulting to alltime when switching scope
            { text: `${getIcon(scope, 'global')} Global`, callback_data: `ql_alltime_global` }
          ],
          [
            { text: `${getIcon(period, 'today')} Today`, callback_data: `ql_today_${scope}` },
            { text: `${getIcon(period, 'weekly')} Weekly`, callback_data: `ql_weekly_${scope}` }
          ],
          [
            { text: `${getIcon(period, 'monthly')} Monthly`, callback_data: `ql_monthly_${scope}` },
            { text: `${getIcon(period, 'alltime')} All-time`, callback_data: `ql_alltime_${scope}` }
          ]
        ]
      };

      // Fix callback data for scope switch to preserve current period if possible, 
      // but let's keep it simple: switching scope resets to all-time for now, or use template:
      keyboard.inline_keyboard[0][0].callback_data = `ql_${period}_group`;
      keyboard.inline_keyboard[0][1].callback_data = `ql_${period}_global`;

      if (messageId) {
        bot.editMessageText(text, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: keyboard
        }).catch(() => { });
      } else {
        bot.sendMessage(chatId, text, {
          parse_mode: 'Markdown',
          reply_markup: keyboard
        });
      }
    } catch (e) {
      console.error("Leaderboard Error:", e);
    }
  }

  async function handleLeaderboardCallback(query) {
    const data = query.data;
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;

    let period = 'alltime';
    let scope = 'group';

    if (data.startsWith('ql_')) {
      const parts = data.split('_');
      if (parts.length >= 3) {
        period = parts[1];
        scope = parts[2];
      }
    } else if (data.includes('global')) {
      scope = 'global';
    }

    await sendLeaderboard(chatId, messageId, scope, period);
    bot.answerCallbackQuery(query.id);
  }

  async function stopQuiz(chatId) {
    const session = quizSessions[chatId];
    if (!session) return;

    session.active = false;
    if (session.currentPollId) {
      await bot.stopPoll(chatId, session.currentPollId).catch(() => { });
    }
    delete quizSessions[chatId];
    bot.sendMessage(chatId, "🛑 Quiz stopped by admin.");
  }

  return { startQuiz, stopQuiz, handleReadyCallback, handleLeaderboardCallback };
};
