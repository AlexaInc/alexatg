const TelegramBot = require('node-telegram-bot-api');

// Replace 'YOUR_TELEGRAM_BOT_TOKEN' with your actual bot token
const token = '8363655941:AAHraMJmVistRM2V3vzfwcLkYmR5hrDfWkY';
const bot = new TelegramBot(token, { polling: true });

// Listen for any 'photo' message
bot.on('photo', (msg) => {
  const chatId = msg.chat.id;

  // msg.photo is an array of photo sizes.
  // The last one (msg.photo.length - 1) is the highest resolution.
  const photo = msg.photo[msg.photo.length - 1];
  
  // Get the file_id
  const fileId = photo.file_id;

  console.log('Received Photo File ID:', fileId);
  
  // You can now send this file_id back or store it
  bot.sendPhoto(chatId, fileId, { caption: 'I received this photo and I am sending it back using its file_id!' });
});

console.log('Bot is running...');