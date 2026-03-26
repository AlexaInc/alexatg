require('dotenv').config();
const proxyHelper = require('./utils/proxyHelper');
proxyHelper.configureAxios();
proxyHelper.configureGlobal();

const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');

const logGrpid = process.env.logGrpid;
const token = process.env.SECONDARY_BOT_TOKEN;
const mongoUri = process.env.SECONDARY_MONGO_URI;

if (!token || !mongoUri) {
  console.error("Missing SECONDARY_BOT_TOKEN or SECONDARY_MONGO_URI in .env");
  process.exit(1);
}

// Connect to MongoDB
if (typeof mongoose === 'undefined') {
  try {
    global.mongoose = require('mongoose');
  } catch (e) {
    console.error('❌ CRITICAL: Failed to require mongoose in secondary_bot.js:', e.message);
  }
}

if (typeof mongoose !== 'undefined') {
  mongoose.connect(mongoUri)
    .then(() => console.log('✅ Secondary Bot connected to MongoDB'))
    .catch(err => console.error('❌ Secondary Bot MongoDB Connection Error:', err));
} else {
  console.error('❌ CRITICAL: mongoose is still undefined after attempt to require.');
}

const bot = new TelegramBot(token, { polling: false });

const CustomQuizSchema = require('./db/models/quiz');
const CustomQuizModel = mongoose.model("Quiz", CustomQuizSchema);

// In-memory sessions
// Session shape:
// {
//   step: 'name' | 'description' | 'open_period' | 'mode' | 'collecting_polls' | 'awaiting_json',
//   title: string,
//   description: string,
//   openPeriod: number,
//   mode: 'poll' | 'json',
//   polls: []
// }
const userSessions = {};

// Helper to generate a random 6-character short ID
function generateQuizId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Safe polling start
const startPollingClean = async () => {
  await new Promise(r => setTimeout(r, 3500)); // Offset from main bot startup
  try {
    await bot.getUpdates({ timeout: 0, offset: -1 });
    console.log('Secondary bot: dropped pending updates.');
  } catch (e) { }
  bot.startPolling();
  console.log('Secondary bot polling started cleanly.');
  bot.sendMessage(logGrpid, 'Secondary bot polling started cleanly.');
};

startPollingClean();

// ─── Entry points ────────────────────────────────────────────────────────────

bot.onText(/\/start (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  if (match[1] === 'setquiz') startSetQuizFlow(chatId);
});

bot.onText(/\/start$/, (msg) => {
  bot.sendMessage(msg.chat.id, "Welcome to the Quiz Builder! Use the main bot to set up a quiz, or use /setquiz here directly.");
});

bot.onText(/\/setquiz/, (msg) => {
  startSetQuizFlow(msg.chat.id);
});

// ─── Step 1: Ask for quiz NAME ────────────────────────────────────────────────

function startSetQuizFlow(chatId) {
  userSessions[chatId] = { step: 'name' };
  bot.sendMessage(chatId,
    "🛠 *Create a New Quiz*\n\nStep 1/4 — *Quiz Name*\nWhat would you like to name this quiz?",
    { parse_mode: 'Markdown' }
  );
}

// ─── Central text message router ─────────────────────────────────────────────

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const session = userSessions[chatId];

  // ── Collect media (photos, videos, gifs) ──
  const isCollecting = session && (session.step === 'collecting_polls' || session.step?.startsWith('qu_mod_') || session.step?.startsWith('q_mod_'));
  if (isCollecting && (msg.photo || msg.video || msg.animation)) {
    let fileId;
    let mediaType;
    if (msg.photo) {
      fileId = msg.photo[msg.photo.length - 1].file_id;
      mediaType = 'photo';
    } else if (msg.video) {
      fileId = msg.video.file_id;
      mediaType = 'video';
    } else if (msg.animation) {
      fileId = msg.animation.file_id;
      mediaType = 'animation';
    }

    try {
      const fileUrl = await bot.getFileLink(fileId);
      session.pendingMedia = fileUrl;
      session.pendingMediaType = mediaType;

      if (session.step === 'qu_mod_media') {
        const { quizId, qIdx, page } = session;
        const quiz = await CustomQuizModel.findOne({ quizId });
        quiz.questions[qIdx].media = fileUrl;
        quiz.questions[qIdx].mediaType = mediaType;
        await quiz.save();
        delete userSessions[chatId];
        bot.sendMessage(chatId, `✅ Media updated for question ${qIdx + 1}.`, {
          reply_markup: { inline_keyboard: [[{ text: "🔙 Back", callback_data: `qu_info_${quizId}_${qIdx}_${page}` }]] }
        });
        return;
      } else if (session.step === 'q_mod_media') {
        const q = session.pendingPoll;
        q.media = fileUrl;
        q.mediaType = mediaType;
        session.step = 'collecting_polls';
        bot.sendMessage(chatId, `✅ *Media attached:* ${mediaType}\n\nReview your question below.`, {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: "📝 Edit Question Text", callback_data: `q_mod_text` }],
              [{ text: "📖 Edit Explanation", callback_data: `q_mod_exp` }],
              [{ text: "✅ Change Correct Answer", callback_data: `q_mod_ans` }],
              [{ text: "🖼 Change Media", callback_data: `q_mod_media` }],
              [{ text: "🔙 Save & Back", callback_data: "confirm_last_mod" }]
            ]
          }
        });
        return;
      }

      bot.sendMessage(chatId, `✅ *Media attached:* ${mediaType}\n\nNow send the quiz poll for this question.`, { parse_mode: 'Markdown' });
    } catch (err) {
      console.error(err);
      bot.sendMessage(chatId, "❌ Failed to get media link.");
    }
    return;
  }

  // ── Collect quiz polls (step: collecting_polls) ──
  if (msg.poll && session && session.step === 'collecting_polls') {
    const poll = msg.poll;
    if (poll.type !== 'quiz') {
      return bot.sendMessage(chatId, "❌ Please send a *Quiz* type poll (not a regular poll).", { parse_mode: 'Markdown' });
    }
    const correctOptionId = poll.correct_option_id;
    if (correctOptionId === null || correctOptionId === undefined) {
      return bot.sendMessage(chatId, "❌ This poll has no correct answer set. Make sure it's a Quiz poll.");
    }

    session.pendingPoll = {
      question: poll.question,
      options: poll.options.map(o => o.text),
      answer: correctOptionId,
      explanation: poll.explanation || "",
      media: session.pendingMedia || null,
      mediaType: session.pendingMediaType || null
    };

    // Clear pending media after attaching
    delete session.pendingMedia;
    delete session.pendingMediaType;

    const qText = `❓ *Question Confirmation*\n\n*Question:* ${poll.question}\n*Options:* \n${poll.options.map((o, i) => `${i === correctOptionId ? '✅' : '❌'} ${o.text}`).join('\n')}\n${poll.explanation ? `\n📖 *Explanation:* ${poll.explanation}` : ''}${session.pendingPoll.media ? `\n🖼 *Media attached:* Yes (${session.pendingPoll.mediaType})` : ''}`;

    return bot.sendMessage(chatId, qText, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✅ Confirm & Next", callback_data: "confirm_poll" },
            { text: "✏️ Modify", callback_data: "modify_poll" },
            { text: "🗑 Discard", callback_data: "discard_poll" }
          ]
        ]
      }
    });
  }

  // Only process plain text messages for wizard steps
  if (!msg.text) return;
  const text = msg.text.trim();

  // Ignore commands in the middle of a flow (let dedicated handlers deal with them)
  if (text.startsWith('/') && text !== '/done' && text !== '/cancel') return;
  if (!session) return;

  switch (session.step) {

    // ── Step 1: receive NAME ──
    case 'name': {
      if (text.length < 2) return bot.sendMessage(chatId, "❌ Name is too short. Please enter a proper quiz name.");
      session.title = text;
      session.step = 'description';
      bot.sendMessage(chatId,
        `✅ *Name set:* ${text}\n\nStep 2/4 — *Description*\nWrite a short description for this quiz (or send /skip to leave it empty).`,
        { parse_mode: 'Markdown' }
      );
      break;
    }

    // ── Step 2: receive DESCRIPTION ──
    case 'description': {
      session.description = (text === '/skip') ? '' : text;
      session.step = 'open_period';
      bot.sendMessage(chatId,
        `✅ *Description set.*\n\nStep 3/4 — *Time per Question*\nHow many seconds should each question stay open? (enter a number between *10* and *600*)`,
        { parse_mode: 'Markdown' }
      );
      break;
    }

    // ── Step 3: receive OPEN_PERIOD ──
    case 'open_period': {
      const secs = parseInt(text, 10);
      if (isNaN(secs) || secs < 10 || secs > 600) {
        return bot.sendMessage(chatId, "❌ Please enter a valid number between *10* and *600* seconds.", { parse_mode: 'Markdown' });
      }
      session.openPeriod = secs;
      session.step = 'mode';
      bot.sendMessage(chatId,
        `✅ *${secs} seconds per question.*\n\nStep 4/4 — *Questions*\nHow would you like to provide the questions?`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: "📝 Upload JSON", callback_data: "mode_json" }],
              [{ text: "📊 Send Polls", callback_data: "mode_poll" }]
            ]
          }
        }
      );
      break;
    }

    // ── Editing NAME ──
    case 'edit_name': {
      if (text.length < 2) return bot.sendMessage(chatId, "❌ Name is too short.");
      await CustomQuizModel.updateOne({ quizId: session.quizId }, { title: text });
      delete userSessions[chatId];
      bot.sendMessage(chatId, `✅ Quiz name updated to: *${text}*`, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: "🔙 Back to Edit Menu", callback_data: `edit_${session.quizId}` }]] }
      });
      break;
    }

    // ── Editing DESCRIPTION ──
    case 'edit_desc': {
      const newDesc = (text === '/skip') ? '' : text;
      await CustomQuizModel.updateOne({ quizId: session.quizId }, { description: newDesc });
      const qId = session.quizId;
      delete userSessions[chatId];
      bot.sendMessage(chatId, `✅ Quiz description updated.`, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: "🔙 Back to Edit Menu", callback_data: `edit_${qId}` }]] }
      });
      break;
    }

    // ── Editing TIME ──
    case 'edit_time': {
      const secs = parseInt(text, 10);
      if (isNaN(secs) || secs < 10 || secs > 600) {
        return bot.sendMessage(chatId, "❌ Please enter a valid number (10-600).");
      }
      await CustomQuizModel.updateOne({ quizId: session.quizId }, { openPeriod: secs });
      const qId = session.quizId;
      delete userSessions[chatId];
      bot.sendMessage(chatId, `✅ Seconds per question updated to: *${secs}s*`, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: "🔙 Back to Edit Menu", callback_data: `edit_${qId}` }]] }
      });
      break;
    }

    // ── Question Modification ──
    case 'q_mod_text': {
      session.pendingPoll.question = text;
      session.step = 'collecting_polls';
      const q = session.pendingPoll;
      const t = `✅ *Question updated!*\n\n✏️ *Modify Current Question*\n\n*Q:* ${q.question}\n*Ans:* ${q.options[q.answer]}\n${q.explanation ? `*Exp:* ${q.explanation}` : ''}`;
      bot.sendMessage(chatId, t, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: "📝 Edit Question Text", callback_data: `q_mod_text` }],
            [{ text: "📖 Edit Explanation", callback_data: `q_mod_exp` }],
            [{ text: "✅ Change Correct Answer", callback_data: `q_mod_ans` }],
            [{ text: "🔙 Save & Back", callback_data: "confirm_last_mod" }]
          ]
        }
      });
      break;
    }

    case 'q_mod_exp': {
      session.pendingPoll.explanation = (text === '/skip') ? '' : text;
      session.step = 'collecting_polls';
      const q = session.pendingPoll;
      const t = `✅ *Explanation updated!*\n\n✏️ *Modify Current Question*\n\n*Q:* ${q.question}\n*Ans:* ${q.options[q.answer]}\n${q.explanation ? `*Exp:* ${q.explanation}` : ''}`;
      bot.sendMessage(chatId, t, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: "📝 Edit Question Text", callback_data: `q_mod_text` }],
            [{ text: "📖 Edit Explanation", callback_data: `q_mod_exp` }],
            [{ text: "✅ Change Correct Answer", callback_data: `q_mod_ans` }],
            [{ text: "🖼 Change Media", callback_data: `q_mod_media` }],
            [{ text: "🔙 Save & Back", callback_data: "confirm_last_mod" }]
          ]
        }
      });
      break;
    }

    // ── Granular Question Editing ──
    case 'qu_mod_text': {
      const { quizId, qIdx, page } = session;
      const quiz = await CustomQuizModel.findOne({ quizId });

      if (text !== '/skip') {
        quiz.questions[qIdx].question = text;
        await quiz.save();
      }

      delete userSessions[chatId];
      const q = quiz.questions[qIdx];
      const updated = (text === '/skip') ? "⚠️ Change cancelled" : "✅ Question updated!";
      const qText = `${updated}\n\n❓ *Question Details* [${qIdx + 1}]\n\n*Q:* ${q.question}\n*Ans:* ${q.options[q.answer]}\n${q.explanation ? `*Exp:* ${q.explanation}` : ''}`;
      bot.sendMessage(chatId, qText, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: "📝 Edit Text", callback_data: `qu_ed_txt_${quizId}_${qIdx}_${page}` }],
            [{ text: "📖 Edit Explanation", callback_data: `qu_ed_exp_${quizId}_${qIdx}_${page}` }],
            [{ text: "✅ Change Answer", callback_data: `qu_ed_ans_${quizId}_${qIdx}_${page}` }],
            [{ text: "🗑 Delete Question", callback_data: `qu_del_${quizId}_${qIdx}_${page}` }],
            [{ text: "🔙 Back", callback_data: `qns_page_${quizId}_${page}` }]
          ]
        }
      });
      break;
    }

    case 'qu_mod_exp': {
      const { quizId, qIdx, page } = session;
      const quiz = await CustomQuizModel.findOne({ quizId });
      quiz.questions[qIdx].explanation = (text === '/skip') ? '' : text;
      await quiz.save();

      delete userSessions[chatId];
      const q = quiz.questions[qIdx];
      const updated = (text === '/skip') ? "🧹 Explanation cleared!" : "✅ Explanation updated!";
      const qText = `${updated}\n\n❓ *Question Details* [${qIdx + 1}]\n\n*Q:* ${q.question}\n*Ans:* ${q.options[q.answer]}\n${q.explanation ? `*Exp:* ${q.explanation}` : ''}${q.media ? `\n🖼 *Media:* (${q.mediaType})` : ''}`;
      bot.sendMessage(chatId, qText, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: "📝 Edit Text", callback_data: `qu_ed_txt_${quizId}_${qIdx}_${page}` }],
            [{ text: "📖 Edit Explanation", callback_data: `qu_ed_exp_${quizId}_${qIdx}_${page}` }],
            [{ text: "✅ Change Answer", callback_data: `qu_ed_ans_${quizId}_${qIdx}_${page}` }],
            [{ text: "� Change Media", callback_data: `qu_ed_media_${quizId}_${qIdx}_${page}` }],
            [{ text: "�🗑 Delete Question", callback_data: `qu_del_${quizId}_${qIdx}_${page}` }],
            [{ text: "🔙 Back", callback_data: `qns_page_${quizId}_${page}` }]
          ]
        }
      });
      break;
    }

    case 'qu_mod_media': {
      const { quizId, qIdx, page } = session;
      const quiz = await CustomQuizModel.findOne({ quizId });
      if (text === '/skip') {
        quiz.questions[qIdx].media = null;
        quiz.questions[qIdx].mediaType = null;
        await quiz.save();
        delete userSessions[chatId];
        bot.sendMessage(chatId, "✅ Media removed.", {
          reply_markup: { inline_keyboard: [[{ text: "🔙 Back", callback_data: `qu_info_${quizId}_${qIdx}_${page}` }]] }
        });
      } else {
        bot.sendMessage(chatId, "❌ Please send a photo, video, or GIF, or send /skip to remove media.");
      }
      break;
    }

    default:
      break;
  }
});

// ─── Step 4: Mode selection via inline buttons ────────────────────────────────

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const data = query.data;
  const session = userSessions[chatId];

  // ── Confirmation for creation/adding — confirm_poll ──
  if (data === "confirm_poll" && session && session.pendingPoll) {
    session.polls = session.polls || [];
    session.polls.push(session.pendingPoll);
    delete session.pendingPoll;

    await bot.editMessageText(
      `✅ Added question *${session.polls.length}*.\n\nSend another poll or type /done when finished.`,
      { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' }
    );
  }

  // ── Discard poll during creation ──
  else if (data === "discard_poll" && session && session.pendingPoll) {
    delete session.pendingPoll;
    await bot.editMessageText(
      "❌ Question discarded. Send another poll or type /done.",
      { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' }
    );
  }

  // ── Modify poll during creation ──
  else if (data === "modify_poll" && session && session.pendingPoll) {
    const q = session.pendingPoll;
    const text = `✏️ *Modify Current Question*\n\n*Q:* ${q.question}\n*Ans:* ${q.options[q.answer]}\n${q.explanation ? `*Exp:* ${q.explanation}` : ''}`;
    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: "📝 Edit Question Text", callback_data: `q_mod_text` }],
          [{ text: "📖 Edit Explanation", callback_data: `q_mod_exp` }],
          [{ text: "✅ Change Correct Answer", callback_data: `q_mod_ans` }],
          [{ text: "🔙 Save & Back", callback_data: "confirm_last_mod" }]
        ]
      }
    });
  }

  else if (data === "q_mod_text" && session) {
    session.step = 'q_mod_text';
    await bot.sendMessage(chatId, "Enter new question text:");
  } else if (data === "q_mod_exp" && session) {
    session.step = 'q_mod_exp';
    await bot.sendMessage(chatId, "Enter new explanation:");
  } else if (data === "q_mod_ans" && session) {
    const opts = session.pendingPoll.options;
    const btns = opts.map((opt, i) => ([{ text: `${i + 1}. ${opt}`, callback_data: `q_set_ans_${i}` }]));
    await bot.editMessageText("Select the correct answer index:", { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: btns } });
  } else if (data.startsWith("q_set_ans_")) {
    const idx = parseInt(data.split("_")[3], 10);
    session.pendingPoll.answer = idx;
    // Go back to modify menu
    const q = session.pendingPoll;
    const text = `✅ *Answer updated!*\n\n✏️ *Modify Current Question*\n\n*Q:* ${q.question}\n*Ans:* ${q.options[q.answer]}\n${q.explanation ? `*Exp:* ${q.explanation}` : ''}`;
    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: "📝 Edit Question Text", callback_data: `q_mod_text` }],
          [{ text: "📖 Edit Explanation", callback_data: `q_mod_exp` }],
          [{ text: "✅ Change Correct Answer", callback_data: `q_mod_ans` }],
          [{ text: "🔙 Save & Back", callback_data: "confirm_last_mod" }]
        ]
      }
    });
  } else if (data === "confirm_last_mod" && session && session.pendingPoll) {
    // Re-show confirmation menu
    const q = session.pendingPoll;
    const qText = `❓ *Question Confirmation (Modified)*\n\n*Question:* ${q.question}\n*Options:* \n${q.options.map((o, i) => `${i === q.answer ? '✅' : '❌'} ${o}`).join('\n')}\n${q.explanation ? `\n📖 *Explanation:* ${q.explanation}` : ''}`;
    await bot.editMessageText(qText, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✅ Confirm & Next", callback_data: "confirm_poll" },
            { text: "✏️ Modify", callback_data: "modify_poll" },
            { text: "🗑 Discard", callback_data: "discard_poll" }
          ]
        ]
      }
    });
  }

  // ── Mode selection ──
  else if (data === "mode_json" && session && session.step === 'mode') {
    session.step = 'awaiting_json';
    bot.editMessageText(
      `📝 *JSON Mode*\n\nPlease upload a valid \`.json\` file.\n\n_Format:_\n\`\`\`json\n[\n  {\n    "question": "Capital of France?",\n    "options": ["London", "Paris", "Berlin", "Rome"],\n    "answer": 1,\n    "explanation": "Paris is the capital."\n  }\n]\n\`\`\``,
      {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: 'Markdown'
      }
    );
  } else if (data === "mode_poll" && session && session.step === 'mode') {
    session.step = 'collecting_polls';
    session.polls = [];
    bot.editMessageText(
      "📊 *Poll Mode*\n\nSend your Quiz polls one by one.\n_Use Telegram's quiz poll type and mark the correct answer!_\n\nWhen you're done, type /done.",
      {
        chat_id: chatId,
        message_id: query.message.message_id,
        parse_mode: 'Markdown'
      }
    );
  }

  // ── DELETE FLOW ──
  else if (data.startsWith("confirm_del_")) {
    const qId = data.split("_")[2];
    await bot.editMessageReplyMarkup({
      inline_keyboard: [
        [{ text: "⚠️ ARE YOU SURE? ⚠️", callback_data: `no_op` }],
        [
          { text: "✅ Yes, delete!", callback_data: `del_quiz_${qId}` },
          { text: "❌ No, cancel", callback_data: `cancel_del` }
        ]
      ]
    }, { chat_id: chatId, message_id: messageId });
  }

  else if (data.startsWith("del_quiz_")) {
    const qId = data.split("_")[2];
    await CustomQuizModel.deleteOne({ quizId: qId });
    await bot.editMessageText("🗑 Quiz deleted successfully.", {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: { inline_keyboard: [[{ text: "🔙 Back to List", callback_data: "list_page_0" }]] }
    });
  }

  else if (data === "cancel_del") {
    await bot.editMessageText("Deletion cancelled.", { chat_id: chatId, message_id: messageId });
  }

  // ── EDITING FLOW ──
  else if (data.startsWith("edit_")) {
    // Note: can be "edit_qId" or "edit_field_qId"
    const parts = data.split("_");
    if (parts.length === 2) {
      // Main edit menu for quiz
      const qId = parts[1];
      const quiz = await CustomQuizModel.findOne({ quizId: qId });
      if (!quiz) return bot.sendMessage(chatId, "❌ Quiz not found.");

      const text = `🛠 *Edit Quiz: ${quiz.title}*\n\n what do you want to change?`;
      await bot.editMessageText(text, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: "📝 Change Name", callback_data: `ed_name_${qId}` }],
            [{ text: "📄 Change Description", callback_data: `ed_desc_${qId}` }],
            [{ text: "⏱ Change Time/Q", callback_data: `ed_time_${qId}` }],
            [{ text: "🗑 Edit Questions", callback_data: `ed_qns_${qId}` }],
            [{ text: "➕ Add Questions", callback_data: `add_qns_${qId}` }],
            [{ text: "🔙 Back", callback_data: `info_${qId}_0` }]
          ]
        }
      });
    } else {
      // Specific field selected
      const action = parts[1]; // name, desc, time, qns
      const qId = parts[2];

      if (action === "name") {
        userSessions[chatId] = { step: 'edit_name', quizId: qId };
        await bot.sendMessage(chatId, "Enter a new name for the quiz:");
      } else if (action === "desc") {
        userSessions[chatId] = { step: 'edit_desc', quizId: qId };
        await bot.sendMessage(chatId, "Enter a new description (or send /skip to clear it):");
      } else if (action === "time") {
        userSessions[chatId] = { step: 'edit_time', quizId: qId };
        await bot.sendMessage(chatId, "Enter seconds per question (10-600):");
      } else if (action === "qns") {
        await showQuestionsPage(chatId, messageId, qId, 0);
      }
    }
  }

  // Question Pagination
  if (data.startsWith("qns_page_")) {
    const parts = data.split("_");
    const qId = parts[2];
    const page = parseInt(parts[3], 10);
    await showQuestionsPage(chatId, messageId, qId, page);
  }

  // Question Info/Details
  if (data.startsWith("qu_info_")) {
    const parts = data.split("_");
    const qId = parts[2];
    const qIdx = parseInt(parts[3], 10);
    const page = parts[4];

    const quiz = await CustomQuizModel.findOne({ quizId: qId });
    const q = quiz.questions[qIdx];
    if (!q) return bot.answerCallbackQuery(query.id, { text: "❌ Question not found." });

    const qText = `❓ *Question Details* [${qIdx + 1}]\n\n*Q:* ${q.question}\n*Ans:* ${q.options[q.answer]}\n${q.explanation ? `*Exp:* ${q.explanation}` : ''}${q.media ? `\n🖼 *Media:* (${q.mediaType})` : ''}`;

    await bot.editMessageText(qText, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: "📝 Edit Text", callback_data: `qu_ed_txt_${qId}_${qIdx}_${page}` }],
          [{ text: "📖 Edit Explanation", callback_data: `qu_ed_exp_${qId}_${qIdx}_${page}` }],
          [{ text: "✅ Change Answer", callback_data: `qu_ed_ans_${qId}_${qIdx}_${page}` }],
          [{ text: "🖼 Change Media", callback_data: `qu_ed_media_${qId}_${qIdx}_${page}` }],
          [{ text: "🗑 Delete Question", callback_data: `qu_del_${qId}_${qIdx}_${page}` }],
          [{ text: "🔙 Back", callback_data: `qns_page_${qId}_${page}` }]
        ]
      }
    });
  }

  // Handle granular question modification callbacks
  if (data.startsWith("qu_ed_")) {
    const parts = data.split("_");
    const type = parts[2]; // txt, exp, ans, media
    const qId = parts[3];
    const qIdx = parseInt(parts[4], 10);
    const page = parts[5];

    if (type === "txt") {
      userSessions[chatId] = { step: 'qu_mod_text', quizId: qId, qIdx, page };
      await bot.sendMessage(chatId, "Enter new question text (or send /skip to cancel):");
    } else if (type === "exp") {
      userSessions[chatId] = { step: 'qu_mod_exp', quizId: qId, qIdx, page };
      await bot.sendMessage(chatId, "Enter new explanation (or send /skip to cancel):");
    } else if (type === "media") {
      userSessions[chatId] = { step: 'qu_mod_media', quizId: qId, qIdx, page };
      await bot.sendMessage(chatId, "Send a new photo, video, or GIF (or send /skip to remove current media):");
    } else if (type === "ans") {
      const quiz = await CustomQuizModel.findOne({ quizId: qId });
      const q = quiz.questions[qIdx];
      const btns = q.options.map((opt, i) => ([{ text: `${i + 1}. ${opt}`, callback_data: `qu_set_ans_${qId}_${qIdx}_${i}_${page}` }]));
      btns.push([{ text: "🔙 Back", callback_data: `qu_info_${qId}_${qIdx}_${page}` }]);
      await bot.editMessageText("Select correct answer index:", { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: btns } });
    }
  }

  if (data.startsWith("qu_set_ans_")) {
    const parts = data.split("_");
    const qId = parts[3];
    const qIdx = parseInt(parts[4], 10);
    const ansIdx = parseInt(parts[5], 10);
    const page = parts[6];

    const quiz = await CustomQuizModel.findOne({ quizId: qId });
    quiz.questions[qIdx].answer = ansIdx;
    await quiz.save();

    await bot.answerCallbackQuery(query.id, { text: "✅ Answer updated." });
    // Reload info view
    const q = quiz.questions[qIdx];
    const qText = `❓ *Question Details* [${qIdx + 1}]\n\n*Q:* ${q.question}\n*Ans:* ${q.options[q.answer]}\n${q.explanation ? `*Exp:* ${q.explanation}` : ''}${q.media ? `\n🖼 *Media:* (${q.mediaType})` : ''}`;
    await bot.editMessageText(qText, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: "📝 Edit Text", callback_data: `qu_ed_txt_${qId}_${qIdx}_${page}` }],
          [{ text: "📖 Edit Explanation", callback_data: `qu_ed_exp_${qId}_${qIdx}_${page}` }],
          [{ text: "✅ Change Answer", callback_data: `qu_ed_ans_${qId}_${qIdx}_${page}` }],
          [{ text: "🖼 Change Media", callback_data: `qu_ed_media_${qId}_${qIdx}_${page}` }],
          [{ text: "🗑 Delete Question", callback_data: `qu_del_${qId}_${qIdx}_${page}` }],
          [{ text: "🔙 Back", callback_data: `qns_page_${qId}_${page}` }]
        ]
      }
    });
  }

  if (data.startsWith("qu_del_")) {
    const parts = data.split("_");
    const qId = parts[2];
    const qIdx = parseInt(parts[3], 10);
    const page = parts[4];

    const quiz = await CustomQuizModel.findOne({ quizId: qId });
    quiz.questions.splice(qIdx, 1);
    await quiz.save();

    await bot.answerCallbackQuery(query.id, { text: "🗑 Question deleted." });
    await showQuestionsPage(chatId, messageId, qId, parseInt(page, 10));
  }

  // Extra specific handlers for editing
  if (data.startsWith("ed_")) {
    const parts = data.split("_");
    const field = parts[1];
    const qId = parts[2];

    if (field === "name") {
      userSessions[chatId] = { step: 'edit_name', quizId: qId };
      await bot.sendMessage(chatId, "Enter a new name for the quiz:");
    } else if (field === "desc") {
      userSessions[chatId] = { step: 'edit_desc', quizId: qId };
      await bot.sendMessage(chatId, "Enter a new description (or send /skip to clear it):");
    } else if (field === "time") {
      userSessions[chatId] = { step: 'edit_time', quizId: qId };
      await bot.sendMessage(chatId, "Enter seconds per question (10-600):");
    } else if (field === "qns") {
      await showQuestionsPage(chatId, messageId, qId, 0);
    }
  }

  if (data.startsWith("add_qns_")) {
    const qId = data.split("_")[2];
    const quiz = await CustomQuizModel.findOne({ quizId: qId });
    userSessions[chatId] = {
      step: 'collecting_polls',
      quizId: qId,
      mode: 'poll',
      polls: quiz.questions,
      isUpdating: true,
      title: quiz.title,
      description: quiz.description,
      openPeriod: quiz.openPeriod
    };
    await bot.sendMessage(chatId, "📊 *Adding Questions*\n\nSend new quiz polls one by one. Type /done when finished.", { parse_mode: 'Markdown' });
  }

  if (data.startsWith("q_del_")) {
    const parts = data.split("_");
    const qId = parts[2];
    const qIdx = parseInt(parts[3], 10);
    const quiz = await CustomQuizModel.findOne({ quizId: qId });

    quiz.questions.splice(qIdx, 1);
    await quiz.save();

    // Refresh the list
    let qText = `❓ *Questions of: ${quiz.title}*\n\nDeleted question ${qIdx + 1}.\nClick to delete more:`;
    const buttons = quiz.questions.map((q, i) => ([{ text: `🗑 [${i + 1}] ${q.question.substring(0, 25)}...`, callback_data: `q_del_${qId}_${i}` }]));
    buttons.push([{ text: "🔙 Back", callback_data: `edit_${qId}` }]);
    await bot.editMessageText(qText, { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } });
  }

  if (data === "close_menu") {
    await bot.deleteMessage(chatId, messageId);
  }

  // ── Pagination and List ──
  if (data.startsWith("list_page_")) {
    const page = parseInt(data.split("_")[2], 10);
    const limit = 5;
    const skip = page * limit;
    const userId = query.from.id.toString();

    const total = await CustomQuizModel.countDocuments({ creatorId: userId });
    const userQuizzes = await CustomQuizModel.find({ creatorId: userId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const keyboard = [];
    for (const quiz of userQuizzes) {
      keyboard.push([{ text: `📄 ${quiz.title}`, callback_data: `info_${quiz.quizId}_${page}` }]);
    }
    const navRow = [];
    if (page > 0) navRow.push({ text: "⬅️ Previous", callback_data: `list_page_${page - 1}` });
    if (skip + limit < total) navRow.push({ text: "Next ➡️", callback_data: `list_page_${page + 1}` });
    if (navRow.length > 0) keyboard.push(navRow);

    await bot.editMessageText(`📚 *Your Quizzes*\nPage ${page + 1}`, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: keyboard }
    });
  }

  if (data.startsWith("info_")) {
    const parts = data.split("_");
    const qId = parts[1];
    const page = parts[2];

    const quiz = await CustomQuizModel.findOne({ quizId: qId });
    if (!quiz) return bot.answerCallbackQuery(query.id, { text: "❌ Quiz not found." });

    const text = `🏷 *${quiz.title}*\n🆔 \`${quiz.quizId}\` · ${quiz.questions.length} Qs · ⏱ ${quiz.openPeriod}s/Q${quiz.description ? `\n📄 _${quiz.description}_` : ''}`;

    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: "✏️ Edit Details", callback_data: `edit_${qId}` },
            { text: "📤 Share", url: `https://t.me/share/url?url=/quiz ${qId}` }
          ],
          [{ text: "🗑 Delete Quiz", callback_data: `confirm_del_${qId}` }],
          [{ text: "🔙 Back to List", callback_data: `list_page_${page}` }]
        ]
      }
    });
  }

  if (data === "confirm_json_save" && session && session.polls) {
    await saveQuiz(chatId, query.from.id, session.polls);
  } else if (data === "discard_json" && session) {
    delete userSessions[chatId];
    bot.editMessageText("❌ JSON upload discarded.", { chat_id: chatId, message_id: messageId });
  }

  await bot.answerCallbackQuery(query.id);
});

// ─── JSON file upload handler ─────────────────────────────────────────────────

bot.on('document', async (msg) => {
  const chatId = msg.chat.id;
  const session = userSessions[chatId];

  if (!session || session.step !== 'awaiting_json') return;

  const fileName = msg.document.file_name;
  if (!fileName.endsWith('.json')) {
    return bot.sendMessage(chatId, "❌ Please upload a valid `.json` file.");
  }

  try {
    const fileStream = bot.getFileStream(msg.document.file_id);
    let chunks = [];
    fileStream.on('data', chunk => chunks.push(chunk));
    fileStream.on('end', async () => {
      try {
        const questionsArray = JSON.parse(Buffer.concat(chunks).toString('utf-8'));

        if (!Array.isArray(questionsArray) || questionsArray.length === 0) {
          return bot.sendMessage(chatId, "❌ Invalid format. The file must contain a non-empty array of questions.");
        }
        for (let i = 0; i < questionsArray.length; i++) {
          const q = questionsArray[i];
          if (!q.question || !Array.isArray(q.options) || typeof q.answer !== 'number') {
            return bot.sendMessage(chatId, `❌ Invalid question at index ${i}. Each item needs: question, options[], answer (number).`);
          }
        }

        session.polls = questionsArray;
        bot.sendMessage(chatId, `✅ *Loaded ${questionsArray.length} questions.*\n\nAre you sure you want to save this quiz?`, {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: "✅ Yes, Save", callback_data: "confirm_json_save" },
                { text: "❌ Discard", callback_data: "discard_json" }
              ]
            ]
          }
        });
      } catch {
        bot.sendMessage(chatId, "❌ Failed to parse JSON. Please check your file syntax.");
      }
    });
  } catch {
    bot.sendMessage(chatId, "❌ An error occurred while downloading the file.");
  }
});

// ─── /done — finish poll collection ──────────────────────────────────────────

bot.onText(/\/done/, async (msg) => {
  const chatId = msg.chat.id;
  const session = userSessions[chatId];

  if (!session || session.step !== 'collecting_polls') return;

  if (session.polls.length === 0) {
    return bot.sendMessage(chatId, "❌ You haven't sent any polls yet. Send a quiz poll or type /cancel.");
  }

  await saveQuiz(chatId, msg.from.id, session.polls);
});

// ─── /cancel ─────────────────────────────────────────────────────────────────

bot.onText(/\/cancel/, (msg) => {
  delete userSessions[msg.chat.id];
  bot.sendMessage(msg.chat.id, "❌ Quiz creation cancelled.");
});

// ─── /skip (inside wizard steps) — handled in the message router above ────────

// ─── Common quiz save helper ──────────────────────────────────────────────────

async function saveQuiz(chatId, fromId, questions) {
  const session = userSessions[chatId];
  const quizId = session.quizId || generateQuizId();

  try {
    if (session.isUpdating) {
      // Update existing quiz (only questions are typically changed here)
      await CustomQuizModel.updateOne({ quizId: session.quizId }, { questions });
      delete userSessions[chatId];
      return bot.sendMessage(chatId, `✅ *Quiz Updated!* Questions saved.\n\nID: \`${quizId}\``, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[{ text: "🔙 Back to Edit Menu", callback_data: `edit_${quizId}` }]]
        }
      });
    }

    // Creating new quiz
    const customQuiz = new CustomQuizModel({
      quizId,
      creatorId: fromId.toString(),
      title: session.title,
      description: session.description || '',
      openPeriod: session.openPeriod,
      questions
    });

    await customQuiz.save();

    const qCount = questions.length;
    delete userSessions[chatId];

    const descLine = session.description ? `\n📄 *Desc:* ${session.description}` : '';
    bot.sendMessage(chatId,
      `✅ *Quiz Created!*\n\n🏷 *Name:* ${session.title}${descLine}\n⏱ *Time/Q:* ${session.openPeriod}s\n📋 *Questions:* ${qCount}\n🆔 *ID:* \`${quizId}\`\n\nUse this in your group:\n\`/quiz ${quizId}\``,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[{ text: "📤 Share", url: `https://t.me/share/url?url=/quiz ${quizId}` }]]
        }
      }
    );
  } catch (e) {
    console.error(e);
    bot.sendMessage(chatId, "❌ An error occurred while saving your quiz.");
  }
}

// ─── Question List Helper (Paginated) ──────────────────────────────────────────

async function showQuestionsPage(chatId, messageId, qId, page = 0) {
  const limit = 5;
  const skip = page * limit;

  try {
    const quiz = await CustomQuizModel.findOne({ quizId: qId });
    if (!quiz) return bot.sendMessage(chatId, "❌ Quiz not found.");

    const total = quiz.questions.length;
    const questions = quiz.questions.slice(skip, skip + limit);

    if (questions.length === 0 && page > 0) return showQuestionsPage(chatId, messageId, qId, page - 1);

    let text = `❓ *Questions of: ${quiz.title}*\nTotal: ${total} | Page ${page + 1}`;
    const keyboard = [];

    questions.forEach((q, i) => {
      const idx = skip + i;
      keyboard.push([{ text: `📄 [${idx + 1}] ${q.question.substring(0, 30)}...`, callback_data: `qu_info_${qId}_${idx}_${page}` }]);
    });

    const navRow = [];
    if (page > 0) navRow.push({ text: "⬅️ Previous", callback_data: `qns_page_${qId}_${page - 1}` });
    if (skip + limit < total) navRow.push({ text: "Next ➡️", callback_data: `qns_page_${qId}_${page + 1}` });
    if (navRow.length > 0) keyboard.push(navRow);

    keyboard.push([{ text: "🔙 Back to Quiz", callback_data: `edit_${qId}` }]);

    const options = {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: keyboard }
    };

    if (messageId) {
      bot.editMessageText(text, options);
    } else {
      bot.sendMessage(chatId, text, options);
    }
  } catch (err) {
    console.error("Error fetching questions:", err);
    bot.sendMessage(chatId, "❌ An error occurred while fetching questions.");
  }
}

// ─── /myquiz — list user's quizzes ───────────────────────────────────────────

bot.onText(/\/myquiz/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id.toString();
  await showQuizzesPage(chatId, userId, 0);
});

async function showQuizzesPage(chatId, userId, page = 0) {
  const limit = 5;
  const skip = page * limit;

  try {
    const total = await CustomQuizModel.countDocuments({ creatorId: userId });
    const userQuizzes = await CustomQuizModel.find({ creatorId: userId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    if (!userQuizzes || userQuizzes.length === 0) {
      if (page === 0) {
        return bot.sendMessage(chatId, "⚠️ You haven't created any quizzes yet.\nCreate one using /setquiz!");
      } else {
        return; // Page doesn't exist
      }
    }

    let text = `📚 *Your Quizzes (Total: ${total})*\nPage ${page + 1}`;
    const keyboard = [];

    for (const quiz of userQuizzes) {
      keyboard.push([{ text: `📄 ${quiz.title}`, callback_data: `info_${quiz.quizId}_${page}` }]);
    }

    const navRow = [];
    if (page > 0) navRow.push({ text: "⬅️ Previous", callback_data: `list_page_${page - 1}` });
    if (skip + limit < total) navRow.push({ text: "Next ➡️", callback_data: `list_page_${page + 1}` });
    if (navRow.length > 0) keyboard.push(navRow);

    const options = {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: keyboard }
    };

    bot.sendMessage(chatId, text, options);
  } catch (err) {
    console.error("Error fetching user quizzes:", err);
    bot.sendMessage(chatId, "❌ An error occurred while fetching your quizzes.");
  }
}

// ─── Inline Query Handler for Sharing ──────────────────────────────────────────
// This allows users to search for a quiz and send "/quiz ID" as a plain message.

bot.on('inline_query', async (query) => {
  const qStr = query.query.trim();
  if (qStr.startsWith('quiz ')) {
    const quizId = qStr.split(' ')[1];
    try {
      const quiz = await CustomQuizModel.findOne({ quizId: quizId });
      if (quiz) {
        const results = [
          {
            type: 'article',
            id: quizId,
            title: `🚀 Share: ${quiz.title}`,
            description: `Click to send: /quiz ${quizId}`,
            input_message_content: {
              message_text: `/quiz ${quizId}`
            }
          }
        ];
        bot.answerInlineQuery(query.id, results);
      }
    } catch (e) {
      console.error("Inline query error:", e);
    }
  }
});

console.log("Secondary bot initialized.");

// ─── Graceful shutdown ────────────────────────────────────────────────────────

const shutdown = async () => {
  console.log('Secondary bot shutting down...');
  try { await bot.stopPolling(); } catch (e) { }
  try { await mongoose.connection.close(); } catch (e) { }
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
