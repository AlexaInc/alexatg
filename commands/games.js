module.exports = function (bot, deps) {
    const { startQuiz } = deps;

    // --- /hangman Trigger ---
    bot.onText(/^\/hangman(?:\s|$|@)/, (msg) => {
        if (!deps.handlers.checkCommand(msg, '/hangman', deps.BOT_USERNAME)) return;
        // Current hangman module uses /newhang, let's keep it or proxy it.
        bot.sendMessage(msg.chat.id, "Please use `/newhang` to start a new Hangman game!", { parse_mode: 'Markdown' });
    });

    // --- /newchain Trigger ---
    bot.onText(/^\/newchain(?:\s|$|@)/, (msg) => {
        if (!deps.handlers.checkCommand(msg, '/newchain', deps.BOT_USERNAME)) return;
        if (deps.wordchain && deps.wordchain.startChain) {
            deps.wordchain.startChain(msg.chat.id);
        }
    });



    // --- !qstop Trigger (Quiz) ---
    bot.onText(/^!qstop(?:\s|$|@)/, (msg) => {
        if (!deps.handlers.checkCommand(msg, '!qstop', deps.BOT_USERNAME)) return;
        deps.quiz.stopQuiz(msg.chat.id);
    });
};
