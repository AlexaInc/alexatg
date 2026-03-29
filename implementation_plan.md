# Project Modularization Plan

The current `index.js` file is over 5000 lines long, making it difficult to maintain and edit. We will refactor the project into a modular, developer-friendly architecture without changing its existing logic or functionality.

## Proposed Code Structure

We will create the following directory structure:
```text
alexatg/
├── .env
├── index.js               // Main entry point (Bot initialization, loading handlers)
├── secondary_bot.js       // (Already modular)
├── package.json
├── db/
│   ├── index.js           // MongoDB connection logic
│   └── models/            // Mongoose Schemas (UserMap, CustomQuizModel, Invite, etc.)
├── utils/
│   ├── helpers.js         // General utilities (downloadImage, wrapTextSmart, checkAdminPermissions)
│   ├── countdown.js       // sendEditCountdown and related timing functions
│   └── idsManager.js      // (Existing)
├── modules/
│   ├── quiz/              // Logic for the quiz game
│   ├── hangman/           // Logic for the hangman game
│   └── wordchain/         // Logic for the wordchain game
├── events/
│   ├── messageHandler.js  // The main bot.on('message') router
│   └── callbackQuery.js   // The main bot.on('callback_query') router
└── commands/
    ├── admin.js           // Admin commands (ban, filter, nsfw)
    ├── general.js         // General commands
    └── games.js           // Commands to trigger games
```

## User Review Required

> [!WARNING]
> Refactoring a 5000-line file is a massive task. Since all variables (like active sessions, `gameSessions`, etc.) are currently shared in one scope, moving them to separate files means we have to properly manage module exports and memory state. 
> 
> Proceeding with this plan will fundamentally change how the codebase looks, although it will function exactly the same. Are you comfortable with moving forward with this restructuring?

## Execution Steps

### Phase 1: Separation of Database and Utilities
- Extract all MongoDB connection strings and Schemas into a `db/` folder.
- Extract generic helper functions into a `utils/` folder.

### Phase 2: Game Logic Extraction
- Move all Hangman helper functions and state variables into `modules/hangman/index.js`.
- Move all Word Chain helper functions and state variables into `modules/wordchain/index.js`.
- Move Quiz helper functions and state variables into `modules/quiz/index.js`.

### Phase 3: Route Extraction
- Split the giant `bot.on('message')` block. Route the commands to isolated files in the `commands/` directory.
- Split the `bot.on('callback_query')` block into an `events/callbackQuery.js` file, routing actions to their respective modules.

### Phase 4: Final Cleanup
- Clean up `index.js` so it only requires the modules, connects to the database, initializes the bot, and attaches the event listeners.
