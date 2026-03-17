const fetch = require('node-fetch');

module.exports = function (bot, db) {
  const QUIZ_URL = "https://raw.githubusercontent.com/hansaka02/questionjson/refs/heads/main/quiz.json";
  const quizSessions = {};

  const getCustomQuizModel = () => db.getCustomQuizModel();
  const getUserQuizScoreModel = () => db.getUserQuizScoreModel();

  async function startQuiz(chatId, customQuizData = null) {
    if (quizSessions[chatId] && quizSessions[chatId].active) {
      bot.sendMessage(chatId, "❌ A quiz is already running in this group.");
      return;
    }

    let questions;
    if (customQuizData) {
      questions = customQuizData.questions;
    } else {
      try {
        const res = await fetch(QUIZ_URL);
        questions = await res.json();
      } catch (err) {
        bot.sendMessage(chatId, "❌ Failed to load quiz questions.");
        return;
      }
    }

    const quizTitle = customQuizData ? customQuizData.title : "General Knowledge";
    const quizDesc = customQuizData ? (customQuizData.description || '') : '';
    const openPeriod = customQuizData ? (customQuizData.openPeriod || 20) : 20;

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
            await getUserQuizScoreModel().updateOne(
              { groupId: chatId, userId: u.id },
              { $inc: { score: u.score }, firstName: u.name, username: u.username },
              { upsert: true }
            );
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
      const poll = await bot.sendPoll(chatId, q.question, q.options, {
        type: "quiz",
        correct_option_id: q.answer,
        is_anonymous: false,
        open_period: openPeriod,
        explanation: q.explanation || ""
      });
      session.currentPollId = poll.poll.id;

      setTimeout(() => {
        if (session.active) {
          session.currentQ++;
          sendNextQuestion(chatId);
        }
      }, (openPeriod + 1) * 1000); // +1s buffer after poll closes
    } catch (err) { }
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

  // Handle /qlead command (should be called from main message handler ideally, but for now we can register it)
  bot.onText(/^\/qlead/, async (msg) => {
    const chatId = msg.chat.id;
    try {
      const topUsers = await getUserQuizScoreModel().find({ groupId: chatId }).sort({ score: -1 }).limit(10);
      let text = "🏆 **Quiz Leaderboard - Group** 🏆\n\n";
      if (!topUsers.length) text += "No scores yet.";
      else topUsers.forEach((u, i) => text += `${i + 1}. [${u.firstName}](tg://user?id=${u.userId}) — ${u.score} pts\n`);

      bot.sendMessage(chatId, text, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: "👥 Group", callback_data: "qlead_group" },
            { text: "🌍 Global", callback_data: "qlead_global" }
          ]]
        }
      });
    } catch (e) {
      console.error(e);
    }
  });

  async function handleLeaderboardCallback(query) {
    const data = query.data;
    const chatId = query.message.chat.id.toString();

    try {
      let topUsers;
      let title;
      if (data.includes('group')) {
        topUsers = await getUserQuizScoreModel().find({ groupId: chatId }).sort({ score: -1 }).limit(10);
        title = "Group";
      } else {
        topUsers = await getUserQuizScoreModel().aggregate([
          { $group: { _id: "$userId", totalScore: { $sum: "$score" }, firstName: { $first: "$firstName" } } },
          { $sort: { totalScore: -1 } },
          { $limit: 10 }
        ]);
        title = "Global";
      }

      let text = `🏆 *Quiz Leaderboard - ${title}* 🏆\n\n`;
      if (!topUsers.length) text += "No scores yet.";
      else topUsers.forEach((u, i) => {
        const name = u.firstName || "User";
        const score = u.score || u.totalScore;
        const id = u.userId || u._id;
        text += `${i + 1}. [${name}](tg://user?id=${id}) — ${score} pts\n`;
      });

      bot.editMessageText(text, {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: "👥 Group", callback_data: `qlead_group_${chatId}` },
            { text: "🌍 Global", callback_data: `qlead_global_${chatId}` }
          ]]
        }
      });
      bot.answerCallbackQuery(query.id);
    } catch (e) {
      console.error(e);
      bot.answerCallbackQuery(query.id, { text: "Error fetching leaderboard." });
    }
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
