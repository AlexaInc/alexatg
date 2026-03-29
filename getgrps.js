const { TelegramClient, Api } = require("telegram");
const { StringSession } = require("telegram/sessions");

// 1. Replace these with your credentials
const apiId = 21436767; // Your API_ID from my.telegram.org
const apiHash = "eeded975801ebbec8e498ec5d9a7b31e"; 
const botToken = "8363655941:AAElGNG5Y4ERZf-wHm5eoVZRm_8dtGiidvQ";

const stringSession = new StringSession("");

(async () => {
  const client = new TelegramClient(stringSession, apiId, apiHash, {
    connectionRetries: 5,
  });

  await client.start({ botAuthToken: botToken });
  console.log("Connected! Scanning message history for groups...");

  try {
    // We request the last 100 messages the bot handled. 
    // Telegram allows bots to see their own history/peers.
    const messages = await client.getMessages(undefined, { limit: 100 });
    
    const foundGroups = new Map();

    for (const msg of messages) {
      const peer = msg.peerId;
      
      // Check if it's a Channel (Supergroup) or Chat (Basic Group)
      if (peer instanceof Api.PeerChannel || peer instanceof Api.PeerChat) {
        try {
            const entity = await client.getEntity(peer);
            
            // Filter out actual Channels (broadcasts), keep Groups/Supergroups
            if (entity.className === 'Channel' && !entity.broadcast || entity.className === 'Chat') {
              const id = entity.id.toString();
              const title = entity.title || "Unknown Name";
              
              if (!foundGroups.has(id)) {
                foundGroups.set(id, title);
              }
            }
        } catch (e) {
            // Skip entities that are no longer accessible
            continue;
        }
      }
    }

    console.log("\n--- FOUND GROUPS ---");
    if (foundGroups.size === 0) {
      console.log("No recent groups found in message history.");
    } else {
      foundGroups.forEach((title, id) => {
        // Most Bot API libraries expect Supergroup IDs to start with -100
        const formattedId = id.startsWith("-") ? id : `-100${id}`;
        console.log(`Name: ${title} | ID: ${formattedId}`);
      });
    }

  } catch (err) {
    console.error("Error fetching data:", err);
  }

  await client.disconnect();
  process.exit();
})();