module.exports = function (bot, deps) {
    const { startQuiz } = deps;

    // --- /hangman Trigger ---
    bot.onText(/^\/hangman/, (msg) => {
        // Current hangman module uses /newhang, let's keep it or proxy it.
        bot.sendMessage(msg.chat.id, "Please use `/newhang` to start a new Hangman game!", { parse_mode: 'Markdown' });
    });

    // --- /newchain Trigger ---
    bot.onText(/^\/newchain/, (msg) => {
        if (deps.wordchain && deps.wordchain.startChain) {
            deps.wordchain.startChain(msg.chat.id);
        }
    });

    // --- /quiz Trigger (Quiz) ---
    bot.onText(/^\/quiz(?:\s+(.+))?/, async (msg, match) => {
        const chatId = msg.chat.id;
        const quizId = match[1];

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
    });

    // --- !qstop Trigger (Quiz) ---
    bot.onText(/^!qstop/, (msg) => {
        deps.quiz.stopQuiz(msg.chat.id);
    });
};
