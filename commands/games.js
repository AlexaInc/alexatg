module.exports = function (bot, deps) {
    const { startQuiz, db } = deps;

    // --- /hangman Trigger ---
    bot.onText(/^\/hangman(?:\s|$|@)/, (msg) => {
        if (!deps.handlers.checkCommand(msg, '/hangman', deps.BOT_USERNAME)) return;
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

    // =============================================
    //  UNIFIED LEADERBOARD: /leaderboard
    // =============================================
    // Callback format: lb_<game>_<scope>_<period>
    //   game:   quiz | hang | chain
    //   scope:  chat | global
    //   period: alltime | today | week

    const gameLabels = { quiz: '🎯 Quiz', hang: '🔤 Hangman', chain: '⛓ Word Chain' };
    const scopeLabels = { chat: '💬 This Chat', global: '🌍 Global' };
    const periodLabels = { alltime: '📊 All-time', today: '📅 Today', week: '📆 This Week' };

    function buildKeyboard(game, scope, period) {
        const mark = (current, target) => current === target ? '• ' : '';

        return {
            inline_keyboard: [
                // Row 1: Game selector
                Object.keys(gameLabels).map(g => ({
                    text: `${mark(game, g)}${gameLabels[g]}`,
                    callback_data: `lb_${g}_${scope}_${period}`
                })),
                // Row 2: Scope selector
                Object.keys(scopeLabels).map(s => ({
                    text: `${mark(scope, s)}${scopeLabels[s]}`,
                    callback_data: `lb_${game}_${s}_${period}`
                })),
                // Row 3: All-time
                [{ text: `${mark(period, 'alltime')}${periodLabels.alltime}`, callback_data: `lb_${game}_${scope}_alltime` }],
                // Row 4: Today + Week
                [
                    { text: `${mark(period, 'today')}${periodLabels.today}`, callback_data: `lb_${game}_${scope}_today` },
                    { text: `${mark(period, 'week')}${periodLabels.week}`, callback_data: `lb_${game}_${scope}_week` }
                ]
            ]
        };
    }

    async function fetchLeaderboardData(game, scope, period, chatId) {
        const now = new Date();
        let startDate = null;

        if (period === 'today') {
            startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        } else if (period === 'week') {
            startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        }

        const matchStage = {};
        if (scope === 'chat') matchStage.groupId = chatId.toString();
        if (startDate) matchStage.timestamp = { $gte: startDate };

        let topUsers = [];

        if (game === 'quiz') {
            if (period === 'alltime') {
                if (scope === 'chat') {
                    topUsers = await db.getUserQuizScoreModel().find({ groupId: chatId.toString() }).sort({ score: -1 }).limit(10);
                } else {
                    topUsers = await db.getUserQuizScoreModel().aggregate([
                        { $group: { _id: "$userId", totalScore: { $sum: "$score" }, firstName: { $first: "$firstName" } } },
                        { $sort: { totalScore: -1 } },
                        { $limit: 10 }
                    ]);
                }
            } else {
                topUsers = await db.getQuizResultModel().aggregate([
                    { $match: matchStage },
                    { $group: { _id: "$userId", totalScore: { $sum: "$score" }, firstName: { $first: "$firstName" } } },
                    { $sort: { totalScore: -1 } },
                    { $limit: 10 }
                ]);
            }
            return topUsers.map(u => ({
                name: u.firstName || 'User',
                id: u.userId || u._id,
                stat: `${u.score !== undefined ? u.score : u.totalScore} pts`
            }));

        } else if (game === 'hang') {
            if (period === 'alltime') {
                if (scope === 'chat') {
                    topUsers = await db.getHangmanScoreModel().find({ groupId: chatId.toString() }).sort({ points: -1 }).limit(10);
                } else {
                    topUsers = await db.getHangmanScoreModel().aggregate([
                        { $group: { _id: "$userId", totalPoints: { $sum: "$points" }, totalWins: { $sum: "$wins" }, firstName: { $first: "$firstName" } } },
                        { $sort: { totalPoints: -1 } },
                        { $limit: 10 }
                    ]);
                }
            } else {
                topUsers = await db.getHangmanResultModel().aggregate([
                    { $match: matchStage },
                    { $group: { _id: "$userId", totalPoints: { $sum: "$points" }, totalWins: { $sum: { $cond: ["$won", 1, 0] } }, firstName: { $first: "$firstName" } } },
                    { $sort: { totalPoints: -1 } },
                    { $limit: 10 }
                ]);
            }
            return topUsers.map(u => ({
                name: u.firstName || 'User',
                id: u.userId || u._id,
                stat: `${u.points !== undefined ? u.points : u.totalPoints} pts · ${u.wins !== undefined ? u.wins : u.totalWins} wins`
            }));

        } else if (game === 'chain') {
            if (period === 'alltime') {
                if (scope === 'chat') {
                    topUsers = await db.getWordchainScoreModel().find({ groupId: chatId.toString() }).sort({ wins: -1 }).limit(10);
                } else {
                    topUsers = await db.getWordchainScoreModel().aggregate([
                        { $group: { _id: "$userId", totalWins: { $sum: "$wins" }, totalGames: { $sum: "$gamesPlayed" }, firstName: { $first: "$firstName" } } },
                        { $sort: { totalWins: -1 } },
                        { $limit: 10 }
                    ]);
                }
            } else {
                topUsers = await db.getWordchainResultModel().aggregate([
                    { $match: matchStage },
                    { $group: { _id: "$userId", totalWins: { $sum: { $cond: ["$won", 1, 0] } }, totalGames: { $sum: 1 }, firstName: { $first: "$firstName" } } },
                    { $sort: { totalWins: -1 } },
                    { $limit: 10 }
                ]);
            }
            return topUsers.map(u => ({
                name: u.firstName || 'User',
                id: u.userId || u._id,
                stat: `${u.wins !== undefined ? u.wins : u.totalWins} wins · ${u.gamesPlayed !== undefined ? u.gamesPlayed : u.totalGames} games`
            }));
        }

        return [];
    }

    function formatLeaderboardText(game, scope, period, entries) {
        const gameName = gameLabels[game].replace(/^[^\s]+ /, '');
        const scopeName = scope === 'chat' ? 'This Chat' : 'Global';
        const periodName = periodLabels[period].replace(/^[^\s]+ /, '');

        let text = `🏆 *${gameName} Leaderboard*\n📍 ${scopeName} · ${periodName}\n\n`;

        if (!entries || entries.length === 0) {
            text += "_No scores found for this selection._";
        } else {
            const medals = ['🥇', '🥈', '🥉'];
            entries.forEach((u, i) => {
                const prefix = i < 3 ? medals[i] : `${i + 1}.`;
                text += `${prefix} [${u.name}](tg://user?id=${u.id}) — ${u.stat}\n`;
            });
        }
        return text;
    }

    async function sendUnifiedLeaderboard(chatId, messageId, game, scope, period) {
        try {
            const entries = await fetchLeaderboardData(game, scope, period, chatId);
            const text = formatLeaderboardText(game, scope, period, entries);
            const keyboard = buildKeyboard(game, scope, period);

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
            console.error("Unified Leaderboard Error:", e);
        }
    }

    // --- /leaderboard Command ---
    bot.onText(/^\/leaderboard(?:\s|$|@)/, (msg) => {
        if (!deps.handlers.checkCommand(msg, '/leaderboard', deps.BOT_USERNAME)) return;
        sendUnifiedLeaderboard(msg.chat.id, null, 'quiz', 'chat', 'alltime');
    });

    // --- Callback Handler ---
    async function handleLeaderboardCallback(query) {
        const parts = query.data.split('_'); // lb_<game>_<scope>_<period>
        if (parts.length < 4) return;

        const game = parts[1];
        const scope = parts[2];
        const period = parts[3];

        const chatId = query.message.chat.id;
        const messageId = query.message.message_id;

        await sendUnifiedLeaderboard(chatId, messageId, game, scope, period);
        bot.answerCallbackQuery(query.id).catch(() => { });
    }

    // Export for callback routing
    deps.gameLeaderboard = { handleLeaderboardCallback };
};
