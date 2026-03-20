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



    // --- !qstop Trigger (Quiz) ---
    bot.onText(/^!qstop/, (msg) => {
        deps.quiz.stopQuiz(msg.chat.id);
    });
};
