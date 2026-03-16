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
            { text: 'Contact Us', callback_data: 'contact_us' },
            { text: 'Help & Commands', callback_data: 'help_main' }
        ],
        [
            { text: 'join official channel', url: 'https://t.me/AlexaInc_updates' },
            { text: 'use on whatsapp', url: 'wa.me/+94771058234?text=Hello%2C+I+want+to+talk+to+Alexa' }
        ],
        [
            { text: 'Add me to your group', url: 'https://t.me/alexaIncbot?startgroup=bot_setup' }
        ]
    ]
};

const helpMainKeyboard = {
    inline_keyboard: [
        [{ text: 'Bot Owner Commands', callback_data: 'help_owner' }],
        [{ text: 'Bot Premium Commands', callback_data: 'help_premium' }],
        [{ text: 'NSFW Commands', callback_data: 'help_nsfw' }],
        [{ text: 'Group Admin Commands', callback_data: 'help_admin' }],
        [{ text: 'Other Commands', callback_data: 'help_ai' }],
        [{ text: '🔙 Back', callback_data: 'start_menu' }]
    ]
};

const backToHelpKeyboard = {
    inline_keyboard: [
        [{ text: '🔙 Back', callback_data: 'help_main' }]
    ]
};

module.exports = {
    START_IMAGE_FILE_ID,
    nsfwCommands,
    getStartMessage,
    startKeyboard,
    helpMainKeyboard,
    backToHelpKeyboard
};
