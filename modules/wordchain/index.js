const fs = require('fs');
const path = require('path');

module.exports = function (bot, db, options = {}) {
  const CHAIN_DICTIONARY_FILE = options.dictionaryFile || 'dictionary.txt';
  const JOIN_TIME_MS = 60 * 1000;
  const CHAIN_INACTIVITY_MS = 5 * 60 * 1000;
  const MAX_PLAYERS = 4;

  const getWordchainScoreModel = () => db.getWordchainScoreModel();
  const getWordchainResultModel = () => db.getWordchainResultModel();

  let chainDictionary = [];
  let MAX_POSSIBLE_LENGTH = 0;
  const chainSessions = {};

  // --- INITIALIZATION ---
  try {
    if (fs.existsSync(CHAIN_DICTIONARY_FILE)) {
      const content = fs.readFileSync(CHAIN_DICTIONARY_FILE, 'utf8');
      chainDictionary = content.split(/\r?\n/).map(w => w.trim().toLowerCase()).filter(w => w.length > 0);
      MAX_POSSIBLE_LENGTH = chainDictionary.reduce((max, word) => Math.max(max, word.length), 0);
      console.log(`Word Chain: Loaded ${chainDictionary.length} words.`);
    } else {
      console.warn(`Word Chain: ${CHAIN_DICTIONARY_FILE} not found.`);
    }
  } catch (err) {
    console.error(`Word Chain: Error reading dictionary:`, err);
  }

  // --- HELPERS ---
  function adjustChainDifficulty(game) {
    if (game.currentTurnTimeLimit > 5) {
      if (game.currentTurnTimeLimit > 30) game.currentTurnTimeLimit -= 5;
    }
    if (game.roundCount > 2) {
      const newLength = 3 + Math.floor((game.roundCount - 1) / 2);
      game.currentMinWordLength = Math.min(newLength, MAX_POSSIBLE_LENGTH);
    }
  }

  async function saveGameResults(chatId, winnerId, allPlayerIds, playerNames) {
    try {
      for (const userId of allPlayerIds) {
        const isWinner = userId === winnerId;
        const name = playerNames[userId] || 'Player';

        // Update all-time score
        await getWordchainScoreModel().updateOne(
          { groupId: chatId.toString(), userId },
          {
            $inc: { gamesPlayed: 1, wins: isWinner ? 1 : 0 },
            $set: { firstName: name }
          },
          { upsert: true }
        );

        // Save individual result for time-based leaderboards
        await getWordchainResultModel().create({
          groupId: chatId.toString(),
          userId,
          won: isWinner,
          firstName: name
        });
      }
    } catch (e) {
      console.error("Error saving wordchain score:", e);
    }
  }

  function handleChainWin(chatId) {
    const game = chainSessions[chatId];
    if (!game) return;
    clearTimeout(game.turnTimer);
    if (game.players.length === 1) {
      const winnerId = game.players[0];
      const winnerName = game.playerNames[winnerId];
      bot.sendMessage(chatId, `🏆 **VICTORY!** 🏆\n\n**${winnerName}** is the Word Chain Champion!`, { parse_mode: 'Markdown' });
      saveGameResults(chatId, winnerId, game.allOriginalPlayers, game.playerNames);
    } else {
      bot.sendMessage(chatId, "Game ended. Not enough players.");
    }
    delete chainSessions[chatId];
  }

  function eliminatePlayer(chatId, userId) {
    const game = chainSessions[chatId];
    if (!game) return;
    const username = game.playerNames[userId];
    bot.sendMessage(chatId, `💀 **Time's up!** ${username} eliminated!`);
    game.players = game.players.filter(id => id !== userId);
    if (game.players.length === 1) {
      handleChainWin(chatId);
    } else {
      startChainTurn(chatId);
    }
  }

  function startChainTurn(chatId) {
    const game = chainSessions[chatId];
    if (!game || game.players.length < 2) {
      handleChainWin(chatId);
      return;
    }
    if (game.turnIndex >= game.players.length) {
      game.turnIndex = 0;
      game.roundCount++;
      adjustChainDifficulty(game);
    }
    const userId = game.players[game.turnIndex];
    const username = game.playerNames[userId];
    bot.sendMessage(chatId,
      `⏳ **Round ${game.roundCount}**\n` +
      `Current Letter: 🔤 **${game.lastLetter.toUpperCase()}** 🔤\n` +
      `👉 **${username}**, it's your turn!\n` +
      `⏱️ Time: ${game.currentTurnTimeLimit}s\n` +
      `📏 Min Length: ${game.currentMinWordLength} letters`,
      { parse_mode: 'Markdown' }
    );
    clearTimeout(game.turnTimer);
    game.turnTimer = setTimeout(() => {
      eliminatePlayer(chatId, userId);
    }, game.currentTurnTimeLimit * 1000);
  }


  function initChainGame(chatId) {
    if (chainSessions[chatId]) return bot.sendMessage(chatId, "Game in progress.");
    chainSessions[chatId] = {
      state: 'joining',
      players: [],
      allOriginalPlayers: [],
      playerNames: {},
      usedWords: [],
      lastLetter: '',
      turnIndex: 0,
      roundCount: 1,
      currentTurnTimeLimit: 60,
      currentMinWordLength: 3,
      lastActivityTime: Date.now()
    };
    bot.sendMessage(chatId, `🎮 **Word Chain Battle Royale!**\n/joinchain to enter. Creator /startchain to begin.`, { parse_mode: 'Markdown' });
  }

  // --- COMMANDS ---
  bot.onText(/^\/joinchain/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();
    const game = chainSessions[chatId];
    if (!game) return bot.sendMessage(chatId, "No active game.");
    if (game.state !== 'joining') return bot.sendMessage(chatId, "Already started.");
    if (game.players.includes(userId)) return bot.sendMessage(chatId, "Already in.");
    if (game.players.length >= MAX_PLAYERS) return bot.sendMessage(chatId, "Full.");

    game.players.push(userId);
    game.allOriginalPlayers.push(userId);
    game.playerNames[userId] = msg.from.first_name || 'Player';
    bot.sendMessage(chatId, `✅ **${msg.from.first_name}** joined! (${game.players.length}/${MAX_PLAYERS})`, { parse_mode: 'Markdown' });
  });

  bot.onText(/^\/startchain/, (msg) => {
    const chatId = msg.chat.id;
    const game = chainSessions[chatId];
    if (!game || game.state !== 'joining') return;
    if (game.players.length < 2) return bot.sendMessage(chatId, "Need at least 2 players.");

    game.state = 'playing';
    game.lastLetter = "abcdefghijklmnopqrstuvwxyz"[Math.floor(Math.random() * 26)];
    startChainTurn(chatId);
  });

  bot.onText(/^\/endchain/, (msg) => {
    if (chainSessions[msg.chat.id]) {
      clearTimeout(chainSessions[msg.chat.id].turnTimer);
      delete chainSessions[msg.chat.id];
      bot.sendMessage(msg.chat.id, "Game ended.");
    }
  });


  // --- MESSAGE HANDLER ---
  bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const game = chainSessions[chatId];
    if (game && game.state === 'playing') {
      const currentPlayer = game.players[game.turnIndex];
      const userId = msg.from.id.toString();
      const text = (msg.text || '').toLowerCase().trim();

      if (userId !== currentPlayer) return;

      if (text.length < game.currentMinWordLength) return bot.sendMessage(chatId, `⚠️ Too short! Need ${game.currentMinWordLength}+ letters.`);
      if (text.charAt(0) !== game.lastLetter) return bot.sendMessage(chatId, `❌ Must start with **${game.lastLetter.toUpperCase()}**`, { parse_mode: 'Markdown' });
      if (!chainDictionary.includes(text)) return bot.sendMessage(chatId, `📖 Not in dictionary!`);
      if (game.usedWords.includes(text)) return bot.sendMessage(chatId, `♻️ Already used!`);

      clearTimeout(game.turnTimer);
      game.usedWords.push(text);
      game.lastLetter = text.slice(-1);
      game.turnIndex++;
      game.lastActivityTime = Date.now();
      startChainTurn(chatId);
    }
  });

  return {
    startChain: (chatId) => {
      initChainGame(chatId);
    }
  };
};
