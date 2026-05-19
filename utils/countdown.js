async function sendEditCountdown(bot, chatId, prefix, numbers, suffix = "") {
  let msg = await bot.sendMessage(chatId, `${prefix} ${numbers[0]}${suffix}`);

  for (let i = 1; i < numbers.length; i++) {
    await new Promise(res => setTimeout(res, 750));

    await bot.editMessageText(`${prefix} ${numbers[i]}${suffix}`, {
      chat_id: chatId,
      message_id: msg.message_id
    }).catch(() => { });

    if (i === numbers.length - 1) {
      await new Promise(res => setTimeout(res, 1000));
      await bot.deleteMessage(chatId, msg.message_id).catch(() => { });
    }
  }
}

async function leaderboardCountdown(bot, chatId) {
  const numbers = Array.from({ length: 30 }, (_, i) => 30 - i)
    .map(n => n + "️⃣"); // Convert 30→1 to emoji style

  let msg = await bot.sendMessage(chatId, `📊 Leaderboard announce in ${numbers[0]}`);
  let editCount = 0;

  for (let i = 1; i < numbers.length; i++) {
    await new Promise(res => setTimeout(res, 750));

    if (editCount >= 7) {
      // 🔹 Delete and resend after 7 edits (8th change would fail)
      await bot.deleteMessage(chatId, msg.message_id).catch(() => { });
      msg = await bot.sendMessage(chatId, `📊 Leaderboard announce in ${numbers[i]}`);
      editCount = 0;
    } else {
      await bot.editMessageText(`📊 Leaderboard announce in ${numbers[i]}`, {
        chat_id: chatId,
        message_id: msg.message_id
      }).catch(async () => {
        // fallback in case edit fails
        msg = await bot.sendMessage(chatId, `📊 Leaderboard announce in ${numbers[i]}`);
        editCount = 0;
        return;
      });
      editCount++;
    }
  }
}

module.exports = {
  sendEditCountdown,
  leaderboardCountdown
};
