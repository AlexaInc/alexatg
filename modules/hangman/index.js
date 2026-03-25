const fs = require('fs');
const path = require('path');

module.exports = function (bot, db, options = {}) {
  const FILE_PATH = options.wordsFile || 'words.txt';
  const MAX_WRONG_GUESSES = 6;
  const MAX_PLAYERS = 4;
  const INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000;
  const CHECK_INTERVAL_MS = 30 * 1000;

  const getHangmanScoreModel = () => db.getHangmanScoreModel();
  const getHangmanResultModel = () => db.getHangmanResultModel();

  let wordList = [];
  const gameSessions = {};

  // --- INITIALIZATION ---
  try {
    const fileContent = fs.readFileSync(FILE_PATH, 'utf8');
    wordList = fileContent
      .split(/\r?\n/)
      .map(word => word.trim().toLowerCase())
      .filter(word => word.length > 0);
    if (wordList.length === 0) throw new Error('No words found');
  } catch (err) {
    console.error(`Error reading ${FILE_PATH}:`, err.message);
  }

  // --- HELPERS ---
  function calculatePlayerPoints(player) {
    const correctGuessCount = player.myCorrectGuesses.length;
    const wrongGuessesLeft = MAX_WRONG_GUESSES - player.wrongGuesses;
    return (correctGuessCount * 10) + (wrongGuessesLeft * 5);
  }

  function getNewWord() {
    return wordList[Math.floor(Math.random() * wordList.length)];
  }

  function getWordDisplay(word, allGuessedLetters) {
    let display = '';
    for (const char of word) {
      if (/[a-z]/.test(char)) {
        display += (allGuessedLetters.includes(char) ? char : '_') + ' ';
      } else {
        display += char + ' ';
      }
    }
    return display.trim();
  }

  function getHangmanDrawing(wrongGuesses) {
    const stages = [
      `\n  +---+\n  |   |\n      |\n      |\n      |\n      |\n=========\n`,
      `\n  +---+\n  |   |\n  O   |\n      |\n      |\n      |\n=========\n`,
      `\n  +---+\n  |   |\n  O   |\n  |   |\n      |\n      |\n=========\n`,
      `\n  +---+\n  |   |\n  O   |\n /|   |\n      |\n      |\n=========\n`,
      `\n  +---+\n  |   |\n  O   |\n /|\\  |\n      |\n      |\n=========\n`,
      `\n  +---+\n  |   |\n  O   |\n /|\\  |\n /    |\n      |\n=========\n`,
      `\n  +---+\n  |   |\n  O   |\n /|\\  |\n / \\  |\n      |\n=========\n`
    ];
    return stages[Math.min(wrongGuesses, stages.length - 1)];
  }

  function getPlayerStatus(players) {
    let statusText = "\n--- 👤 Player Lives ---\n";
    if (Object.keys(players).length === 0) {
      statusText += "No players have joined yet.\n";
    }
    for (const userId in players) {
      const player = players[userId];
      const livesLeft = MAX_WRONG_GUESSES - player.wrongGuesses;
      statusText += `**${player.username}**: ${livesLeft} lives left ${livesLeft === 0 ? ' (Defeated)' : ''}\n`;
    }
    return statusText;
  }

  function checkInactiveGames() {
    const now = Date.now();
    for (const chatId in gameSessions) {
      const game = gameSessions[chatId];
      if (game && game.state === 'playing' && game.lastActivityTime) {
        if (now - game.lastActivityTime > INACTIVITY_TIMEOUT_MS) {
          bot.sendMessage(chatId, `💀 **Game Over!** 💀\n\nEnded due to inactivity. The word was: \`${game.secretWord}\``);
          delete gameSessions[chatId];
        }
      }
    }
  }

  setInterval(checkInactiveGames, CHECK_INTERVAL_MS);

  // --- SAVE SCORES TO MONGODB ---
  async function saveGameResults(chatId, players, won) {
    try {
      for (const pId in players) {
        const p = players[pId];
        const pts = won ? calculatePlayerPoints(p) : 0;

        // Update all-time score
        await getHangmanScoreModel().updateOne(
          { groupId: chatId.toString(), userId: pId },
          {
            $inc: { points: pts, gamesPlayed: 1, wins: won ? 1 : 0 },
            $set: { firstName: p.username, username: p.tgUsername || '' }
          },
          { upsert: true }
        );

        // Save individual result for time-based leaderboards
        await getHangmanResultModel().create({
          groupId: chatId.toString(),
          userId: pId,
          points: pts,
          won: won,
          firstName: p.username,
          username: p.tgUsername || ''
        });
      }
    } catch (e) {
      console.error("Error saving hangman score:", e);
    }
  }


  // --- COMMANDS ---
  bot.onText(/^\/newhang/, (msg) => {
    const chatId = msg.chat.id;
    if (msg.chat.type === 'private') {
      return bot.sendMessage(chatId, "Groups only.");
    }
    if (gameSessions[chatId]) {
      return bot.sendMessage(chatId, "Game running. /joinhang or /endhang.");
    }
    gameSessions[chatId] = {
      secretWord: getNewWord(),
      allGuessedLetters: [],
      state: 'joining',
      creatorId: msg.from.id,
      players: {},
      lastActivityTime: null
    };
    bot.sendMessage(chatId, `🎉 **New Hangman Game!** 🎉\n/joinhang to enter. /starthang to begin.`, { parse_mode: 'Markdown' });
  });

  bot.onText(/^\/joinhang/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();
    const game = gameSessions[chatId];
    if (!game) return bot.sendMessage(chatId, "No active game.");
    if (game.state !== 'joining') return bot.sendMessage(chatId, "Already in progress.");
    if (game.players[userId]) return bot.sendMessage(chatId, "Already joined.");
    if (Object.keys(game.players).length >= MAX_PLAYERS) return bot.sendMessage(chatId, "Game full.");

    game.players[userId] = {
      username: msg.from.first_name || 'Player',
      tgUsername: msg.from.username || '',
      wrongGuesses: 0,
      myCorrectGuesses: []
    };
    bot.sendMessage(chatId, `✅ **${msg.from.first_name}** joined!`);
  });

  bot.onText(/^\/starthang/, (msg) => {
    const chatId = msg.chat.id;
    const game = gameSessions[chatId];
    if (!game || game.state === 'playing') return;
    if (Object.keys(game.players).length === 0) return bot.sendMessage(chatId, "No players.");

    game.state = 'playing';
    game.lastActivityTime = Date.now();
    bot.sendMessage(chatId, `▶️ **Started!**\nWord: \`${getWordDisplay(game.secretWord, [])}\`\n${getPlayerStatus(game.players)}`, { parse_mode: 'Markdown' });
  });

  bot.onText(/^\/endhang/, (msg) => {
    if (gameSessions[msg.chat.id]) {
      delete gameSessions[msg.chat.id];
      bot.sendMessage(msg.chat.id, "Game stopped.");
    }
  });


  // --- MESSAGE HANDLER FOR GUESSES ---
  bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const game = gameSessions[chatId];
    const text = (msg.text || '').toLowerCase();

    if (game && game.state === 'playing' && game.players[msg.from.id.toString()] && /^[a-z]$/.test(text)) {
      const userId = msg.from.id.toString();
      const player = game.players[userId];

      if (player.wrongGuesses >= MAX_WRONG_GUESSES) return;
      if (game.allGuessedLetters.includes(text)) return bot.sendMessage(chatId, `Already guessed "${text}".`);

      game.lastActivityTime = Date.now();
      game.allGuessedLetters.push(text);

      let resultText = '';
      let drawing = '';

      if (game.secretWord.includes(text)) {
        resultText = `Good guess, **${player.username}**!`;
        player.myCorrectGuesses.push(text);
      } else {
        player.wrongGuesses++;
        resultText = `Oops, **${player.username}**!`;
        drawing = getHangmanDrawing(player.wrongGuesses);
      }

      const display = getWordDisplay(game.secretWord, game.allGuessedLetters);
      const won = !display.includes('_');
      const allDefeated = Object.values(game.players).every(p => p.wrongGuesses >= MAX_WRONG_GUESSES);

      if (won) {
        let results = `🎉 **Won! Word: \`${game.secretWord}\`** 🎉\n\nFinal scores:\n`;
        for (const pId in game.players) {
          const p = game.players[pId];
          const pts = calculatePlayerPoints(p);
          results += `**${p.username}**: ${pts} pts\n`;
        }
        saveGameResults(chatId, game.players, true);
        bot.sendMessage(chatId, results, { parse_mode: 'Markdown' });
        delete gameSessions[chatId];
      } else if (allDefeated) {
        saveGameResults(chatId, game.players, false);
        bot.sendMessage(chatId, `💀 **Lost!** Word was: \`${game.secretWord}\``, { parse_mode: 'Markdown' });
        delete gameSessions[chatId];
      } else {
        bot.sendMessage(chatId, `${resultText}\n${drawing}\nWord: \`${display}\`\nGuessed: ${game.allGuessedLetters.join(', ')}\n${getPlayerStatus(game.players)}`, { parse_mode: 'Markdown' });
      }
    }
  });

  return {
    startHangman: (chatId) => {
      bot.sendMessage(chatId, "Please use `/newhang` to start a new Hangman game!");
    }
  };
};
