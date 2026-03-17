require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');

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

bot.onText(/\/start (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const command = match[1];

  if (command === 'setquiz') {
    startSetQuizFlow(chatId);
  }
});

bot.onText(/\/start$/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, "Welcome to the Quiz Builder! Use the main bot to set up a quiz, or use /setquiz here directly.");
});

bot.onText(/\/setquiz/, (msg) => {
  startSetQuizFlow(msg.chat.id);
});

function startSetQuizFlow(chatId) {
  bot.sendMessage(chatId, "🛠 *Create a New Quiz*\n\nHow would you like to provide the questions?", {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [{ text: "📝 Upload JSON", callback_data: "mode_json" }],
        [{ text: "📊 Send Polls", callback_data: "mode_poll" }]
      ]
    }
  });
}

bot.on('callback_query', (query) => {
  const chatId = query.message.chat.id;
  const data = query.data;

  if (data === "mode_json") {
    userSessions[chatId] = { mode: 'json' };
    bot.editMessageText("📝 *JSON Mode*\n\nPlease upload a valid `.json` file containing your questions.\n\n_Format Example:_\n```json\n[\n  {\n    \"question\": \"Capital of France?\",\n    \"options\": [\"London\", \"Paris\", \"Berlin\", \"Rome\"],\n    \"answer\": 1,\n    \"explanation\": \"Paris is the capital.\"\n  }\n]\n```", {
      chat_id: chatId,
      message_id: query.message.message_id,
      parse_mode: 'Markdown'
    });
  } else if (data === "mode_poll") {
    userSessions[chatId] = { mode: 'poll', polls: [] };
    bot.editMessageText("📊 *Poll Mode*\n\nPlease send your Quiz Polls one by one here.\n\n_Make sure to use Quiz Mode and set the correct answer!_\n\nOnce you are done, send /done.", {
      chat_id: chatId,
      message_id: query.message.message_id,
      parse_mode: 'Markdown'
    });
  }

  bot.answerCallbackQuery(query.id);
});

// Handle Document Upload
bot.on('document', async (msg) => {
  const chatId = msg.chat.id;
  const session = userSessions[chatId];

  if (!session || session.mode !== 'json') return;

  const fileId = msg.document.file_id;
  const fileName = msg.document.file_name;

  if (!fileName.endsWith('.json')) {
    return bot.sendMessage(chatId, "❌ Please upload a valid `.json` file.");
  }

  try {
    const fileStream = bot.getFileStream(fileId);
    let chunks = [];
    fileStream.on('data', (chunk) => chunks.push(chunk));
    fileStream.on('end', async () => {
      try {
        const jsonContent = Buffer.concat(chunks).toString('utf-8');
        const questionsArray = JSON.parse(jsonContent);

        if (!Array.isArray(questionsArray) || questionsArray.length === 0) {
          return bot.sendMessage(chatId, "❌ Invalid format. Please provide an array of questions.");
        }

        // Basic validation
        for (let i = 0; i < questionsArray.length; i++) {
          const q = questionsArray[i];
          if (!q.question || !Array.isArray(q.options) || typeof q.answer !== 'number') {
            return bot.sendMessage(chatId, `❌ Invalid question format at index ${i}.`);
          }
        }

        // Save to DB
        const quizId = generateQuizId();
        const customQuiz = new CustomQuizModel({
          quizId,
          creatorId: msg.from.id.toString(),
          title: fileName.replace('.json', ''),
          questions: questionsArray
        });

        await customQuiz.save();

        delete userSessions[chatId];

        bot.sendMessage(chatId, `✅ *Quiz Created Successfully!*\n\nYour Quiz ID is: \`${quizId}\`\nIt contains ${questionsArray.length} questions.\n\nTo play this quiz in a group with the main bot, use:\n\`/quiz ${quizId}\``, {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[{
              text: "Share to Group",
              switch_inline_query: `quiz ${quizId}` // Can be customized based on main bot inline features
            }]]
          }
        });
      } catch (parseErr) {
        bot.sendMessage(chatId, "❌ Failed to parse JSON. Please check your syntax.");
      }
    });
  } catch (err) {
    bot.sendMessage(chatId, "❌ An error occurred while downloading the file.");
  }
});

// Handle incoming polls
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const session = userSessions[chatId];

  if (msg.poll && session && session.mode === 'poll') {
    const poll = msg.poll;
    if (poll.type !== 'quiz') {
      return bot.sendMessage(chatId, "❌ Please send a *Quiz* type poll. Normal polls cannot be validated.");
    }

    const correctOptionId = poll.correct_option_id;
    if (correctOptionId === null || correctOptionId === undefined) {
      return bot.sendMessage(chatId, "❌ This quiz poll does not have a correct answer set.");
    }

    const formattedQuestion = {
      question: poll.question,
      options: poll.options.map(o => o.text),
      answer: correctOptionId,
      explanation: poll.explanation || ""
    };

    session.polls.push(formattedQuestion);
    bot.sendMessage(chatId, `✅ Added question *${session.polls.length}*.\nSend another poll, or type /done to save the quiz.`, { parse_mode: 'Markdown' });
  }
});

// Handle /done
bot.onText(/\/done/, async (msg) => {
  const chatId = msg.chat.id;
  const session = userSessions[chatId];

  if (!session || session.mode !== 'poll') return;

  if (session.polls.length === 0) {
    return bot.sendMessage(chatId, "❌ You haven't sent any polls yet. Send a quiz poll first or type /cancel.");
  }

  const quizId = generateQuizId();
  try {
    const customQuiz = new CustomQuizModel({
      quizId,
      creatorId: msg.from.id.toString(),
      title: `Poll Quiz (${session.polls.length} Qs)`,
      questions: session.polls
    });

    await customQuiz.save();
    const qCount = session.polls.length;
    delete userSessions[chatId];

    bot.sendMessage(chatId, `✅ *Quiz Created Successfully!*\n\nYour Quiz ID is: \`${quizId}\`\nIt contains ${qCount} questions.\n\nTo play this quiz in a group with the main bot, use:\n\`/quiz ${quizId}\``, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[{
          text: "Share to Group",
          switch_inline_query: `quiz ${quizId}`
        }]]
      }
    });
  } catch (e) {
    console.error(e);
    bot.sendMessage(chatId, "❌ An error occurred saving your quiz.");
  }
});

bot.onText(/\/cancel/, (msg) => {
  delete userSessions[msg.chat.id];
  bot.sendMessage(msg.chat.id, "❌ Quiz creation cancelled.");
});

// Handle /myquiz
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
      responseText += `*${index + 1}.* ${quiz.title}\n`;
      responseText += `└ 🆔 ID: \`${quiz.quizId}\` (${quiz.questions.length} questions)\n\n`;
    });

    responseText += "To play one, use the main bot in a group and send:\n`/quiz <Quiz_ID>`";

    bot.sendMessage(chatId, responseText, { parse_mode: "Markdown" });
  } catch (err) {
    console.error("Error fetching user quizzes:", err);
    bot.sendMessage(chatId, "❌ An error occurred while fetching your quizzes.");
  }
});

console.log("Secondary bot initialized.");

// Graceful shutdown
const shutdown = async () => {
  console.log('Secondary bot shutting down...');
  try {
    await bot.stopPolling();
    console.log('Secondary bot polling stopped.');
  } catch (e) { }
  try {
    await mongoose.connection.close();
    console.log('Secondary bot MongoDB connection closed.');
  } catch (e) { }
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
