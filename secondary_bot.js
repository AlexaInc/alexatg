require('dotenv').config();
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
mongoose.connect(mongoUri)
  .then(() => console.log('✅ Secondary Bot connected to MongoDB'))
  .catch(err => console.error('❌ Secondary Bot MongoDB Connection Error:', err));

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
    session.polls.push({
      question: poll.question,
      options: poll.options.map(o => o.text),
      answer: correctOptionId,
      explanation: poll.explanation || ""
    });
    return bot.sendMessage(chatId,
      `✅ Added question *${session.polls.length}*.\nSend another poll or type /done when finished.`,
      { parse_mode: 'Markdown' }
    );
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

    default:
      break;
  }
});

// ─── Step 4: Mode selection via inline buttons ────────────────────────────────

bot.on('callback_query', (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;
  const session = userSessions[chatId];

  if (data === "mode_json" && session && session.step === 'mode') {
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

  bot.answerCallbackQuery(query.id);
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

        await saveQuiz(chatId, msg.from.id, questionsArray);
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
  const quizId = generateQuizId();

  try {
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
          inline_keyboard: [[{ text: "📤 Share to Group", switch_inline_query: `quiz ${quizId}` }]]
        }
      }
    );
  } catch (e) {
    console.error(e);
    bot.sendMessage(chatId, "❌ An error occurred while saving your quiz.");
  }
}

// ─── /myquiz — list user's quizzes ───────────────────────────────────────────

bot.onText(/\/myquiz/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id.toString();

  try {
    const userQuizzes = await CustomQuizModel.find({ creatorId: userId }).sort({ createdAt: -1 });

    if (!userQuizzes || userQuizzes.length === 0) {
      return bot.sendMessage(chatId, "⚠️ You haven't created any quizzes yet.\nCreate one using /setquiz!");
    }

    let responseText = "📚 *Your Created Quizzes*\n\n";
    userQuizzes.forEach((quiz, index) => {
      responseText += `*${index + 1}.* ${quiz.title}`;
      if (quiz.description) responseText += ` — _${quiz.description}_`;
      responseText += `\n└ 🆔 \`${quiz.quizId}\` · ${quiz.questions.length} Qs · ⏱ ${quiz.openPeriod}s/Q\n\n`;
    });
    responseText += "To play one in a group, send:\n`/quiz <Quiz_ID>`";

    bot.sendMessage(chatId, responseText, { parse_mode: "Markdown" });
  } catch (err) {
    console.error("Error fetching user quizzes:", err);
    bot.sendMessage(chatId, "❌ An error occurred while fetching your quizzes.");
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
