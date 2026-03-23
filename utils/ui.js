const START_IMAGE_FILE_ID = 'AgACAgUAAxkDAAIDe2kKsn9Ijyv6SWG4-qVKhBVjV6djAAJUDGsbBrMxVLtQ3xtIwyecAQADAgADdwADNgQ';

const nsfwCommands = [
    "/anal", "/ass", "/boobs", "/gonewild",
    "/hanal", "/hass", "/hboobs", "/hentai",
    "/hkitsune", "/hmidriff", "/hneko", "/hthigh",
    "/neko", "/paizuri", "/pgif", "/pussy",
    "/tentacle", "/thigh", "/yaoi"
];

const getStartMessage = (senderName) => {
    return `ʜᴇʏ <b>${senderName}</b> , 🥀
๏ ɪ'ᴍ alexa ʜᴇʀᴇ ᴛᴏ ʜᴇʟᴘ ʏᴏᴜ ᴍᴀɴᴀɢᴇ ʏᴏᴜʀ ɢʀᴏᴜᴘs!

ʜɪᴛ ʜᴇʟᴘ ᴛᴏ ғɪɴᴅ ᴏᴜᴛ ᴍᴏʀᴇ ᴀʙᴏᴜᴛ ʜᴏᴡ ᴛᴏ ᴜsᴇ ᴍᴇ ɪɴ ᴍʏ ғᴜʟʟ ᴘᴏᴛᴇɴᴛɪᴀʟ!

➻ ᴛʜᴇ ᴍᴏsᴛ ᴩᴏᴡᴇʀғᴜʟ ᴛᴇʟᴇɢʀᴀᴍ ɢʀᴏᴜᴩ ᴍᴀɴᴀɢᴇᴍᴇɴᴛ ʙᴏᴛ ᴀɴᴅ ɪ ʜᴀᴠᴇ sᴏᴍᴇ ᴀᴡᴇsᴏᴍᴇ , fun ᴀɴᴅ ᴜsᴇғᴜʟ ғᴇᴀᴛᴜʀᴇs.`;
};

const startKeyboard = {
    inline_keyboard: [
        [
            { text: '🆘 Help & Commands', callback_data: 'help_main' }
        ],
        [
            { text: '👤 Contact Us', callback_data: 'contact_us' },
            { text: '📊 Stats', callback_data: 'bot_stats' }
        ],
        [
            { text: '📢 Official Channel', url: 'https://t.me/AlexaInc_updates' },
            { text: '💬 WhatsApp', url: 'wa.me/+94771058234?text=Hello%2C+I+want+to+talk+to+Alexa' }
        ],
        [
            { text: '➕ Add me to your group', url: 'https://t.me/alexaIncbot?startgroup=bot_setup' }
        ]
    ]
};

const helpMainKeyboard = {
    inline_keyboard: [
        [
            { text: '👮 Admin', callback_data: 'help_admin' },
            { text: '🛠 Utils', callback_data: 'help_utils' }
        ],
        [
            { text: '👋 Welcome', callback_data: 'help_welcome' },
            { text: '🎮 Games', callback_data: 'help_games' }
        ],
        [
            { text: '🔞 NSFW', callback_data: 'help_nsfw' },
            { text: '❤️ Extra', callback_data: 'help_extra' }
        ],
        [
            { text: '💎 Premium', callback_data: 'help_premium' },
            { text: '👑 Owner', callback_data: 'help_owner' }
        ],
        [
            { text: '🔙 Back', callback_data: 'start_menu' }
        ]
    ]
};

const backToHelpKeyboard = {
    inline_keyboard: [
        [{ text: '🔙 Back to Help', callback_data: 'help_main' }]
    ]
};

const helpTexts = {
    admin: `🛡️ <b>Admin Commands:</b>
• /ba - Ban a user | /unba - Unban
• /mu - Mute a user | /unmu - Unmute
• /warn - Warn a user | /unwarn - Remove
• /prom - Promote user | /dem - Demote
• /pin - Pin a message | /del - Delete
• /purge - Purge range of msgs
• /filters - Manage chat filters
• /cleancommand [mode] - Auto-delete commands
• /keepcommand - Disable command auto-delete
• /accepton [n] - Limit speech to invitees
• /antilink - Configure link protection
• /refresh - Reload admin list cache
• /ano - Identity unmasking for anon admins
• !free - Manually unlock a participant`,

    welcome: `👋 <b>Welcome & Goodbye:</b>
• /welcome [on/off] - Toggle welcome
• /goodbye [on/off] - Toggle goodbye
• /setwelcome - Reply to msg to set it
• /setgoodbye - Reply to msg to set it
• /resetwelcome - Default welcome
• /resetgoodbye - Default goodbye
• /cleanwelcome - Toggle old msg deletion`,

    utils: `🛠️ <b>Utility Commands:</b>
• /ai - Ask Alexa AI
• /aic - Check AI usage limit
• /id - Get IDs of chat/user
• /send - Create quote sticker
• /setquiz - Create custom quizzes
• /myquiz - List your quizzes
• /id - Get unique IDs`,

    games: `🎮 <b>Entertainment & Games:</b>
• /quiz - Start a general quiz
• /quiz [ID] - Start custom quiz
• !qstop - Stop current quiz
• /newhang - Play Hangman
• /newchain - Play Word Chain
• !addcount - View invite leaderboard`,

    extra: `✨ <b>Extra Features:</b>
<b>❤️ Dating (Private Only):</b>
• /dating - Start profile creation
• /find - Discover matches
• /settings - Update dating prefs

<b>📢 Broadcast & More:</b>
• /bc - Special user broadcast`,

    premium: `💎 <b>Premium Features:</b>
• /fq - Generate fake stickers
• 🚀 Unlimited AI Usage
• 📂 Exclusive access to new tools`,

    owner: `👑 <b>Owner Commands:</b>
• /bc - Broadcast message
• /stats - Detailed bot stats
• /update - Git pull & restart
• /restart - Reboot bot instance
• /sweep - Clean entire chat
• /vc [on/off] - Manage VC
• /addspecial - Grant premium
• /remspecial - Remove premium
• /promme - Full owner admin`,

    nsfw: `🔞 <b>NSFW Commands:</b>
NSFW must be enabled via /nsfwon.
Available: /anal, /ass, /boobs, /hentai, /pussy, /yaoi, and more...`
};

module.exports = {
    START_IMAGE_FILE_ID,
    nsfwCommands,
    getStartMessage,
    startKeyboard,
    helpMainKeyboard,
    backToHelpKeyboard,
    helpTexts
};
