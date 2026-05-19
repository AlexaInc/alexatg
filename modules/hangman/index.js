const fs = require('fs');
const path = require('path');

module.exports = function (bot, db, options = {}) {
  const FILE_PATH = options.wordsFile || path.join(__dirname, '../../assets/en.txt');
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
    if (fs.existsSync(FILE_PATH)) {
      const fileContent = fs.readFileSync(FILE_PATH, 'utf8');
      wordList = fileContent
        .split(/\s+/)
        .map(word => word.trim().toLowerCase())
        .filter(word => word.length >= 3 && /^[a-z]+$/.test(word));
      console.log(`Hangman: Loaded ${wordList.length} words from ${FILE_PATH}`);
      if (wordList.length === 0) throw new Error('No valid words found after filtering');
    } else {
      console.error(`Hangman: ${FILE_PATH} not found!`);
    }
  } catch (err) {
    console.error(`Hangman: Error reading ${FILE_PATH}:`, err.message);
  }

  // --- HELPERS ---
  function calculatePlayerPoints(player) {
    const correctGuessCount = player.myCorrectGuesses.length;
    const wrongGuessesLeft = MAX_WRONG_GUESSES - player.wrongGuesses;
    return (correctGuessCount * 10) + (wrongGuessesLeft * 5);
  }

  function getNewWord() {
    if (wordList.length === 0) {
      console.error("Hangman: wordList is empty! Using fallback word.");
      return "hangman";
    }
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
      statusText += `<b>${player.username}</b>: ${livesLeft} lives left ${livesLeft === 0 ? ' (Defeated)' : ''}\n`;
    }
    return statusText;
  }

  function checkInactiveGames() {
    const now = Date.now();
    for (const chatId in gameSessions) {
      const game = gameSessions[chatId];
      if (game && game.state === 'playing' && game.lastActivityTime) {
        if (now - game.lastActivityTime > INACTIVITY_TIMEOUT_MS) {
          bot.sendMessage(chatId, `💀 <b>Game Over!</b> 💀\n\nEnded due to inactivity. The word was: <code>${game.secretWord}</code>`, { parse_mode: 'HTML' });
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


  function initHangmanGame(chatId) {
    if (gameSessions[chatId]) {
      return bot.sendMessage(chatId, "Game running. /joinhang or /endhang.");
    }
    gameSessions[chatId] = {
      secretWord: getNewWord(),
      allGuessedLetters: [],
      state: 'joining',
      creatorId: null, // We don't have msg here, or we can pass userId if needed
      players: {},
      lastActivityTime: null
    };
    bot.sendMessage(chatId, `🎉 <b>New Hangman Game!</b> 🎉\n/joinhang to enter. /starthang to begin.`, { parse_mode: 'HTML' });
  }

  // --- COMMANDS ---
  bot.onText(/^\/joinhang(?:\s|$|@)/, (msg) => {
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
    bot.sendMessage(chatId, `✅ <b>${msg.from.first_name}</b> joined!`, { parse_mode: 'HTML' });
  });

  bot.onText(/^\/starthang(?:\s|$|@)/, (msg) => {
    const chatId = msg.chat.id;
    const game = gameSessions[chatId];
    if (!game || game.state === 'playing') return;
    if (Object.keys(game.players).length === 0) return bot.sendMessage(chatId, "No players.");

    game.state = 'playing';
    game.lastActivityTime = Date.now();
    bot.sendMessage(chatId, `▶️ <b>Started!</b>\nWord: <code>${getWordDisplay(game.secretWord, [])}</code>\n${getPlayerStatus(game.players)}`, { parse_mode: 'HTML' });
  });

  bot.onText(/^\/endhang(?:\s|$|@)/, (msg) => {
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
        let results = `🎉 <b>Won! Word: <code>${game.secretWord}</code></b> 🎉\n\nFinal scores:\n`;
        for (const pId in game.players) {
          const p = game.players[pId];
          const pts = calculatePlayerPoints(p);
          results += `<b>${p.username}</b>: ${pts} pts\n`;
        }
        saveGameResults(chatId, game.players, true);
        bot.sendMessage(chatId, results, { parse_mode: 'HTML' });
        delete gameSessions[chatId];
      } else if (allDefeated) {
        saveGameResults(chatId, game.players, false);
        bot.sendMessage(chatId, `💀 <b>Lost!</b> Word was: <code>${game.secretWord}</code>`, { parse_mode: 'HTML' });
        delete gameSessions[chatId];
      } else {
        bot.sendMessage(chatId, `${resultText.replace(/\*\*/g, '<b>').replace(/\*\*/g, '</b>')}\n${drawing}\nWord: <code>${display}</code>\nGuessed: ${game.allGuessedLetters.join(', ')}\n${getPlayerStatus(game.players)}`, { parse_mode: 'HTML' });
      }
    }
  });

  return {
    startHangman: (chatId) => {
      initHangmanGame(chatId);
    }
  };
};
