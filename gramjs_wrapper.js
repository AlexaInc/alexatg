/**
 * GramJS Bot API Wrapper
 * 
 * Replaces node-telegram-bot-api with a GramJS-based implementation.
 * All communication goes through MTProto datacenters directly,
 * NO HTTP calls to api.telegram.org at all.
 * 
 * Provides the same interface as node-telegram-bot-api so existing
 * command handlers work without modification.
 */

const { TelegramClient, Api } = require('telegram');
const { StringSession } = require('telegram/sessions');
const { NewMessage } = require('telegram/events');
const { Raw } = require('telegram/events');
const { Button } = require('telegram/tl/custom/button');
const { CustomFile } = require('telegram/client/uploads');
const bigInt = require('big-integer');
const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class GramJSBot extends EventEmitter {
  constructor(token, options = {}) {
    super();
    this.token = token;
    this.options = options;
    this._pollingActive = false;
    this._client = null;
    this._me = null;
    this._onTextHandlers = [];
    this._messageHandlers = [];
    this._callbackQueryHandlers = [];
    this._editedMessageHandlers = [];
    this._chatMemberHandlers = [];
    this._pollHandlers = [];
    this._entityCache = new Map();
    this._updateOffset = 0;
    this._processedMsgIds = new Set(); // Dedup: prevent double-processing same message
    // Unique session file per bot token so main + secondary don't collide
    const tokenHash = crypto.createHash('md5').update(token).digest('hex').substring(0, 8);
    this._sessionPath = path.join(__dirname, `.bot_session_${tokenHash}`);
    
    // API credentials - must be set in env
    this.apiId = Number(process.env.API_ID) || 24388624;
    this.apiHash = process.env.API_HASH || 'aa6e6675a9a88534f8ded7f318394d5f';
  }

  async _initClient() {
    let sessionStr = '';
    if (fs.existsSync(this._sessionPath)) {
      sessionStr = fs.readFileSync(this._sessionPath, 'utf8').trim();
    }

    this._client = new TelegramClient(
      new StringSession(sessionStr),
      this.apiId,
      this.apiHash,
      {
        connectionRetries: 10,
        requestRetries: 5,
        retryDelay: 2000,
        autoReconnect: true,
        useIPV6: false,
        timeout: 60000,
        pingTimeout: 30000,
        pingInterval: 15000,
      }
    );
    this._client.setLogLevel('warn');

    await this._client.start({
      botAuthToken: this.token,
    });

    // Save session for faster restarts
    const savedSession = this._client.session.save();
    fs.writeFileSync(this._sessionPath, savedSession);

    this._me = await this._client.getMe();
    console.log(`[GramJS Bot] Connected as @${this._me.username} (${this._me.id})`);

    return this._client;
  }

  // ─── Polling Simulation via GramJS Updates ───────────────────────

  async startPolling() {
    if (this._pollingActive) return;
    this._pollingActive = true;

    if (!this._client) {
      await this._initClient();
    }

    // Register GramJS event handlers
    this._client.addEventHandler(async (event) => {
      try {
        await this._handleNewMessage(event);
      } catch (e) {
        console.error('[GramJS Bot] Error handling message:', e.message);
      }
    }, new NewMessage({}));

    // Handle ALL raw updates (callbacks, chat_member, poll, etc.)
    this._client.addEventHandler(async (update) => {
      try {
        // Callback query
        if (update instanceof Api.UpdateBotCallbackQuery || update instanceof Api.UpdateInlineBotCallbackQuery) {
          await this._handleCallback(update);
          return;
        }
        // Poll answer
        if (update instanceof Api.UpdateMessagePollVote) {
          await this._handlePollVote(update);
          return;
        }
        // Chat participant updates
        if (update instanceof Api.UpdateChatParticipant || update instanceof Api.UpdateChannelParticipant) {
          await this._handleRawUpdate(update);
          return;
        }
      } catch (e) {
        // silently ignore unknown updates
      }
    });

    console.log('[GramJS Bot] Polling started (MTProto updates).');
  }

  async stopPolling() {
    this._pollingActive = false;
    if (this._client) {
      // Don't disconnect, just stop processing
      console.log('[GramJS Bot] Polling stopped.');
    }
  }

  isPolling() {
    return this._pollingActive;
  }

  // ─── Internal Update Handlers ───────────────────────────────────

  async _handleNewMessage(event) {
    // Dedup: skip if we already processed this message ID + chat
    // Use normalized peer string to avoid object stringification differences
    const peer = event.message.peerId;
    let peerKey = '';
    if (peer instanceof Api.PeerUser) peerKey = `u${peer.userId}`;
    else if (peer instanceof Api.PeerChat) peerKey = `c${peer.chatId}`;
    else if (peer instanceof Api.PeerChannel) peerKey = `ch${peer.channelId}`;
    else peerKey = String(peer);
    const dedupKey = `${event.message.id}_${peerKey}`;
    if (this._processedMsgIds.has(dedupKey)) return;
    this._processedMsgIds.add(dedupKey);
    // Clean old entries (keep last 500)
    if (this._processedMsgIds.size > 500) {
      const arr = [...this._processedMsgIds];
      this._processedMsgIds = new Set(arr.slice(-250));
    }

    const msg = await this._convertMessage(event.message);
    if (!msg) return;

    // Cache entity
    if (event.message.peerId) {
      this._cacheEntity(event.message);
    }

    // Attach poll data BEFORE emitting so handlers see it on first (and only) emit
    if (event.message.media && event.message.media instanceof Api.MessageMediaPoll) {
      const poll = this._convertPoll(event.message.media);
      msg.poll = poll;
    }

    // Emit generic 'message' event — only ONCE per message
    this.emit('message', msg);

    // Check registered onText handlers
    if (msg.text) {
      for (const handler of this._onTextHandlers) {
        const match = msg.text.match(handler.regexp);
        if (match) {
          try {
            handler.callback(msg, match);
          } catch (e) {
            console.error('[GramJS Bot] onText handler error:', e);
          }
        }
      }
    }

    // Photo handler
    if (msg.photo) {
      this.emit('photo', msg);
    }
    // Specific media emitters for node-telegram-bot-api compatibility
    if (msg.document) this.emit('document', msg);
    if (msg.video) this.emit('video', msg);
    if (msg.animation) this.emit('animation', msg);
    if (msg.audio) this.emit('audio', msg);
    if (msg.voice) this.emit('voice', msg);
    if (msg.sticker) this.emit('sticker', msg);
    if (msg.poll) this.emit('poll', msg);
  }

  async _handleCallback(event) {
    const query = await this._convertCallbackQuery(event);
    if (!query) return;
    // Ensure from and message are never null
    if (!query.from) query.from = { id: 0, is_bot: false, first_name: 'Unknown' };
    if (!query.message) query.message = { message_id: 0, chat: { id: 0, type: 'private' } };
    if (!query.message.chat) query.message.chat = { id: 0, type: 'private' };
    if (!query.data) query.data = '';
    this.emit('callback_query', query);
  }

  async _handleRawUpdate(update) {
    // Handle UpdateBotChatInviteRequester, UpdateChatParticipant, etc.
    if (update instanceof Api.UpdateChatParticipant ||
        update instanceof Api.UpdateChannelParticipant) {
      // Convert to bot API format for my_chat_member / chat_member
      // This is a simplified handler
      const memberUpdate = this._convertChatMemberUpdate(update);
      if (memberUpdate) {
        this.emit('chat_member', memberUpdate);
        this.emit('my_chat_member', memberUpdate);
      }
    }
  }

  async _handlePollVote(update) {
    try {
      // ── 1. Extract user ID ──
      // update.peer is PeerUser { userId: Integer { value: 1700916606n } }
      // update.userId does NOT reliably contain the user — use update.peer
      const peerUser = update.peer;
      let userId = 0;
      if (peerUser && peerUser.userId !== undefined) {
        const raw = peerUser.userId;
        if (raw && raw.value !== undefined) {
          // It's a GramJS Integer wrapper: { value: BigInt }
          userId = Number(raw.value);
        } else {
          userId = this._toNum(raw);
        }
      }

      // ── 2. Extract poll ID as exact BigInt string to avoid JS precision loss ──
      // update.pollId is Integer { value: 6080031673599132496n }
      let pollId;
      if (update.pollId && update.pollId.value !== undefined) {
        pollId = String(update.pollId.value); // exact BigInt string e.g. "6080031673599132496"
      } else {
        pollId = String(this._toNum(update.pollId));
      }

      // ── 3. Decode options ──
      // MTProto sends each option as a raw byte Buffer where the byte VALUE is the index
      // e.g. Buffer([0x00]) = option 0, Buffer([0x01]) = option 1
      const optionIds = (update.options || []).map(o => {
        if (Buffer.isBuffer(o) && o.length > 0) return o[0]; // raw byte = index
        if (typeof o === 'string') return parseInt(o) || 0;
        return this._toNum(o);
      });

      // ── 4. Build user info ──
      let userInfo = { id: userId, is_bot: false, first_name: 'User' };
      if (userId !== 0) {
        try {
          const entity = await this._client.getEntity(userId);
          userInfo = {
            id: this._toNum(entity.id),
            is_bot: entity.bot || false,
            first_name: entity.firstName || 'User',
            last_name: entity.lastName || '',
            username: entity.username || '',
          };
        } catch (e2) {
          // Keep userInfo with just the ID — sufficient for leaderboard
        }
      }

      const pollAnswer = { poll_id: pollId, user: userInfo, option_ids: optionIds };
      this.emit('poll_answer', pollAnswer);
    } catch (e) {
      console.error('[GramJS Bot] Error handling poll vote:', e.message);
    }
  }

  // ─── Message Conversion (GramJS → Bot API format) ───────────────

  async _convertMessage(gramMsg) {
    if (!gramMsg) return null;

    try {
      const msg = {};

      // Message ID
      msg.message_id = gramMsg.id;
      msg.date = gramMsg.date;

      // Chat info
      msg.chat = await this._convertPeer(gramMsg.peerId, gramMsg.chat || gramMsg._chat);

      // Use class-level safer number converter
      const toNum = (v) => this._toNum(v);

      // Sender info — extract real ID robustly
      let mainSenderId = 0;
      if (gramMsg.sender && gramMsg.sender.id) mainSenderId = toNum(gramMsg.sender.id);
      if (!mainSenderId && gramMsg.fromId) {
        if (gramMsg.fromId.userId !== undefined) mainSenderId = toNum(gramMsg.fromId.userId);
        else mainSenderId = toNum(gramMsg.fromId);
      }
      if (!mainSenderId && gramMsg._senderId) mainSenderId = toNum(gramMsg._senderId);

      if (gramMsg.sender && mainSenderId) {
        msg.from = {
          id: mainSenderId,
          is_bot: gramMsg.sender.bot || false,
          first_name: gramMsg.sender.firstName || '',
          last_name: gramMsg.sender.lastName || '',
          username: gramMsg.sender.username || '',
        };
      } else if (mainSenderId) {
        msg.from = await this._getUser(mainSenderId);
      } else if (gramMsg.peerId instanceof Api.PeerUser) {
        msg.from = await this._getUser(gramMsg.peerId);
      }

      if (!msg.from || !msg.from.id) {
        msg.from = { id: mainSenderId || 0, is_bot: false, first_name: 'Unknown' };
      }

      // Text
      if (gramMsg.message) {
        msg.text = gramMsg.message;
      }

      // Entities
      if (gramMsg.entities && gramMsg.entities.length > 0) {
        msg.entities = gramMsg.entities.map(e => this._convertEntity(e));
      }

      // Media
      if (gramMsg.media) {
        this._convertMedia(gramMsg, msg);
      }

      // Reply — must ALWAYS set reply_to_message if there's a reply
      const replyMsgId = gramMsg.replyTo?.replyToMsgId;
      if (replyMsgId) {
        try {
          const chatEntity = await this._client.getEntity(gramMsg.peerId);
          // Use client.getMessages — it auto-resolves sender when possible
          const replyMsgs = await this._client.getMessages(chatEntity, { ids: [replyMsgId] });
          const rm = replyMsgs?.[0];

          if (rm) {
            // Extract sender using EVERY possible GramJS field
            const toNum = (v) => this._toNum(v);

            // Method 1: .sender (GramJS auto-resolved User object)
            // Only accept if senderId resolves to a real nonzero number
            if (rm.sender && rm.sender.id) {
              const sid = toNum(rm.sender.id);
              if (sid && sid !== 0) {
                senderId = sid;
                replyFrom = {
                  id: senderId,
                  is_bot: rm.sender.bot || false,
                  first_name: rm.sender.firstName || '',
                  last_name: rm.sender.lastName || '',
                  username: rm.sender.username || '',
                };
              }
            }

            // Method 2: ._sender (internal cached)
            if (!senderId && rm._sender && rm._sender.id) {
              const sid = toNum(rm._sender.id);
              if (sid && sid !== 0) {
                senderId = sid;
                replyFrom = {
                  id: senderId,
                  is_bot: rm._sender.bot || false,
                  first_name: rm._sender.firstName || '',
                  last_name: rm._sender.lastName || '',
                  username: rm._sender.username || '',
                };
              }
            }

            // Method 3: .fromId (raw PeerUser)
            if (!senderId && rm.fromId) {
              const raw = rm.fromId;
              if (raw.userId !== undefined && raw.userId !== null) {
                senderId = toNum(raw.userId);
              } else if (raw.channelId !== undefined) {
                senderId = toNum(raw.channelId);
              }
            }

            // Method 4: ._senderId (internal)
            if (!senderId && rm._senderId) {
              senderId = toNum(rm._senderId);
            }

            // Method 5: senderId extracted — try getEntity to get full user info
            if (senderId && !replyFrom) {
              try {
                const userEntity = await this._client.getEntity(senderId);
                replyFrom = {
                  id: Number(userEntity.id),
                  is_bot: userEntity.bot || false,
                  first_name: userEntity.firstName || '',
                  last_name: userEntity.lastName || '',
                  username: userEntity.username || '',
                };
              } catch (e) {
                replyFrom = { id: senderId, is_bot: false, first_name: 'Unknown' };
              }
            }

            // Method 6: scan chat participants as last resort
            if (!senderId || senderId === 0) {
              try {
                // Try raw API to get the message with users
                let rawResult;
                if (chatEntity.className === 'Channel') {
                  rawResult = await this._client.invoke(new Api.channels.GetMessages({
                    channel: new Api.InputChannel({ channelId: chatEntity.id, accessHash: chatEntity.accessHash || BigInt(0) }),
                    id: [new Api.InputMessageID({ id: replyMsgId })]
                  }));
                } else {
                  rawResult = await this._client.invoke(new Api.messages.GetMessages({
                    id: [new Api.InputMessageID({ id: replyMsgId })]
                  }));
                }
                if (rawResult) {
                  const rawMsg = rawResult.messages?.[0];
                  const rawUsers = rawResult.users || [];
                  if (rawMsg?.fromId?.userId) {
                    senderId = Number(rawMsg.fromId.userId);
                    const u = rawUsers.find(u => Number(u.id) === senderId);
                    if (u) {
                      replyFrom = {
                        id: Number(u.id), is_bot: u.bot || false,
                        first_name: u.firstName || '', last_name: u.lastName || '',
                        username: u.username || '',
                      };
                    } else {
                      replyFrom = { id: senderId, is_bot: false, first_name: 'Unknown' };
                    }
                  }
                }
              } catch (e3) {
                // ignore
              }
            }

            if (!replyFrom) {
              replyFrom = { id: senderId || 0, is_bot: false, first_name: 'Unknown' };
            }

            msg.reply_to_message = {
              message_id: rm.id, date: rm.date, chat: msg.chat,
              text: rm.message || undefined, from: replyFrom,
            };
            try {
              if (rm.entities && rm.entities.length > 0) {
                msg.reply_to_message.entities = rm.entities.map(e => this._convertEntity(e));
              }
              if (rm.media && rm.message) {
                msg.reply_to_message.caption = rm.message;
                if (rm.entities) msg.reply_to_message.caption_entities = rm.entities.map(e => this._convertEntity(e));
              }
              if (rm.media) this._convertMedia(rm, msg.reply_to_message);
            } catch (mediaErr) {
              // Media/entity conversion failed — but we still have the sender, don't lose it
            }
          } else {
            msg.reply_to_message = { message_id: replyMsgId, chat: msg.chat, from: { id: 0, is_bot: false, first_name: 'Unknown' } };
          }
        } catch (e) {
          // Outer catch — only if getMessages itself fails
          // Still try to set a reply with whatever info we have
          msg.reply_to_message = { message_id: replyMsgId, chat: msg.chat, from: { id: 0, is_bot: false, first_name: 'Unknown' } };
        }
      }

      // Forward
      if (gramMsg.fwdFrom) {
        msg.forward_from = gramMsg.fwdFrom.fromId ? await this._getUser(gramMsg.fwdFrom.fromId) : null;
        msg.forward_date = gramMsg.fwdFrom.date;
      }

      // Sender chat (channels posting as themselves)
      if (gramMsg.peerId instanceof Api.PeerChannel && !gramMsg.fromId) {
        msg.sender_chat = msg.chat;
      }

      // Caption for media
      if (gramMsg.media && gramMsg.message) {
        msg.caption = gramMsg.message;
        if (gramMsg.entities) {
          msg.caption_entities = gramMsg.entities.map(e => this._convertEntity(e));
        }
      }

      return msg;
    } catch (e) {
      console.error('[GramJS Bot] Error converting message:', e.message);
      return null;
    }
  }

  _convertEntity(gramEntity) {
    const entity = {
      offset: gramEntity.offset,
      length: gramEntity.length,
    };

    if (gramEntity instanceof Api.MessageEntityBold) entity.type = 'bold';
    else if (gramEntity instanceof Api.MessageEntityItalic) entity.type = 'italic';
    else if (gramEntity instanceof Api.MessageEntityUnderline) entity.type = 'underline';
    else if (gramEntity instanceof Api.MessageEntityStrike) entity.type = 'strikethrough';
    else if (gramEntity instanceof Api.MessageEntityCode) entity.type = 'code';
    else if (gramEntity instanceof Api.MessageEntityPre) { entity.type = 'pre'; entity.language = gramEntity.language || ''; }
    else if (gramEntity instanceof Api.MessageEntityTextUrl) { entity.type = 'text_link'; entity.url = gramEntity.url; }
    else if (gramEntity instanceof Api.MessageEntityMentionName) { entity.type = 'text_mention'; entity.user = { id: gramEntity.userId.valueOf ? gramEntity.userId.valueOf() : Number(gramEntity.userId) }; }
    else if (gramEntity instanceof Api.MessageEntityCustomEmoji) { entity.type = 'custom_emoji'; entity.custom_emoji_id = String(gramEntity.documentId); }
    else if (gramEntity instanceof Api.MessageEntityMention) entity.type = 'mention';
    else if (gramEntity instanceof Api.MessageEntityUrl) entity.type = 'url';
    else if (gramEntity instanceof Api.MessageEntityBotCommand) entity.type = 'bot_command';
    else if (gramEntity instanceof Api.MessageEntityHashtag) entity.type = 'hashtag';
    else if (gramEntity instanceof Api.MessageEntityEmail) entity.type = 'email';
    else if (gramEntity instanceof Api.MessageEntityPhone) entity.type = 'phone_number';
    else if (gramEntity instanceof Api.MessageEntitySpoiler) entity.type = 'spoiler';
    else if (gramEntity instanceof Api.MessageEntityBlockquote) entity.type = 'blockquote';
    else entity.type = 'unknown';

    return entity;
  }

  _convertMedia(gramMsg, msg) {
    const media = gramMsg.media;

    if (media instanceof Api.MessageMediaPhoto) {
      if (media.photo) {
        const photo = media.photo;
        const sizes = photo.sizes || [];
        msg.photo = sizes.map((s, i) => ({
          file_id: this._buildFileId('photo', photo.id, photo.accessHash, photo.fileReference, s),
          file_unique_id: String(photo.id),
          width: s.w || 0,
          height: s.h || 0,
          file_size: s.size || 0,
          _gramPhoto: photo,
          _gramSize: s,
        }));
      }
    } else if (media instanceof Api.MessageMediaDocument) {
      if (media.document) {
        const doc = media.document;
        const attrs = doc.attributes || [];
        const isSticker = attrs.some(a => a instanceof Api.DocumentAttributeSticker);
        const isVideo = attrs.some(a => a instanceof Api.DocumentAttributeVideo);
        const isAudio = attrs.some(a => a instanceof Api.DocumentAttributeAudio);
        const isAnimated = attrs.some(a => a instanceof Api.DocumentAttributeAnimated);
        const isGif = isAnimated || (isVideo && doc.mimeType === 'video/mp4' && attrs.some(a => a instanceof Api.DocumentAttributeVideo && !a.roundMessage));

        const fileInfo = {
          file_id: this._buildFileId('document', doc.id, doc.accessHash, doc.fileReference),
          file_unique_id: String(doc.id),
          file_size: Number(doc.size) || 0,
          mime_type: doc.mimeType,
          _gramDoc: doc,
        };

        const filenameAttr = attrs.find(a => a instanceof Api.DocumentAttributeFilename);
        if (filenameAttr) fileInfo.file_name = filenameAttr.fileName;

        if (isSticker) {
          const stickerAttr = attrs.find(a => a instanceof Api.DocumentAttributeSticker);
          msg.sticker = {
            ...fileInfo,
            emoji: stickerAttr?.alt || '',
            set_name: stickerAttr?.stickerset?.shortName || '',
            is_animated: doc.mimeType === 'application/x-tgsticker',
            is_video: doc.mimeType === 'video/webm',
          };
        } else if (isAnimated || (isGif && !isSticker)) {
          msg.animation = fileInfo;
        } else if (isVideo) {
          const videoAttr = attrs.find(a => a instanceof Api.DocumentAttributeVideo);
          msg.video = {
            ...fileInfo,
            width: videoAttr?.w || 0,
            height: videoAttr?.h || 0,
            duration: videoAttr?.duration || 0,
          };
          if (videoAttr?.roundMessage) {
            msg.video_note = msg.video;
            delete msg.video;
          }
        } else if (isAudio) {
          const audioAttr = attrs.find(a => a instanceof Api.DocumentAttributeAudio);
          if (audioAttr?.voice) {
            msg.voice = { ...fileInfo, duration: audioAttr.duration || 0 };
          } else {
            msg.audio = {
              ...fileInfo,
              duration: audioAttr?.duration || 0,
              performer: audioAttr?.performer || '',
              title: audioAttr?.title || '',
            };
          }
        } else {
          msg.document = fileInfo;
        }
      }
    } else if (media instanceof Api.MessageMediaPoll) {
      msg.poll = this._convertPoll(media);
    }
  }

  _convertPoll(mediaPoll) {
    const poll = mediaPoll.poll;
    const results = mediaPoll.results;
    
      // Extract poll ID as exact BigInt string to avoid JS number precision loss
      // poll.id is GramJS Integer { value: BigInt } — same as update.pollId in _handlePollVote
      let pollIdStr;
      if (poll.id && poll.id.value !== undefined) {
        pollIdStr = String(poll.id.value); // exact BigInt string
      } else if (poll.id && poll.id.valueOf) {
        const v = poll.id.valueOf();
        pollIdStr = typeof v === 'bigint' ? String(v) : String(poll.id);
      } else {
        pollIdStr = String(poll.id);
      }

    const converted = {
      id: pollIdStr,
      question: poll.question?.text || poll.question || '',
      options: (poll.answers || []).map(a => ({
        text: a.text?.text || a.text || '',
        voter_count: 0,
      })),
      total_voter_count: results?.totalVoters || 0,
      is_closed: poll.closed || false,
      is_anonymous: !poll.publicVoters,
      type: poll.quiz ? 'quiz' : 'regular',
      allows_multiple_answers: poll.multipleChoice || false,
    };

    if (poll.quiz && results?.results) {
      const correctResult = results.results.find(r => r.correct);
      if (correctResult) {
        converted.correct_option_id = (poll.answers || []).findIndex(
          a => a.option.equals ? a.option.equals(correctResult.option) : Buffer.compare(a.option, correctResult.option) === 0
        );
      }
    }

    if (results?.solution) {
      converted.explanation = results.solution;
    }

    return converted;
  }

  _buildFileId(type, id, accessHash, fileReference, sizeInfo) {
    // Store reference in cache for downloads
    const key = `${type}_${id}_${sizeInfo ? (sizeInfo.type || 'x') : 'doc'}`;
    this._entityCache.set(key, { type, id, accessHash, fileReference, sizeInfo });
    // Return a synthetic file_id that we can decode later
    return `gramjs:${type}:${id}:${accessHash}:${sizeInfo ? (sizeInfo.type || 'x') : 'doc'}`;
  }

  async _convertPeer(peerId, chatEntity) {
    const chat = {};
    try {
      let entity = chatEntity;
      if (!entity) {
        entity = await this._client.getEntity(peerId);
      }

      if (peerId instanceof Api.PeerUser) {
        chat.id = Number(entity.id);
        chat.type = 'private';
        chat.first_name = entity.firstName || '';
        chat.last_name = entity.lastName || '';
        chat.username = entity.username || '';
      } else if (peerId instanceof Api.PeerChat) {
        chat.id = -Number(entity.id);
        chat.type = 'group';
        chat.title = entity.title || '';
      } else if (peerId instanceof Api.PeerChannel) {
        // Supergroup/channel: -100 prefix
        chat.id = -Number(`100${entity.id}`);
        chat.type = entity.broadcast ? 'channel' : 'supergroup';
        chat.title = entity.title || '';
        chat.username = entity.username || '';
      }
    } catch (e) {
      // Fallback
      if (peerId instanceof Api.PeerUser) {
        chat.id = peerId.userId.valueOf ? peerId.userId.valueOf() : Number(peerId.userId);
        chat.type = 'private';
      } else if (peerId instanceof Api.PeerChat) {
        chat.id = -(peerId.chatId.valueOf ? peerId.chatId.valueOf() : Number(peerId.chatId));
        chat.type = 'group';
      } else if (peerId instanceof Api.PeerChannel) {
        const chanId = peerId.channelId.valueOf ? peerId.channelId.valueOf() : Number(peerId.channelId);
        chat.id = -Number(`100${chanId}`);
        chat.type = 'supergroup';
      }
    }

    return chat;
  }

  // Safe number converter for ANY GramJS ID type
  _toNum(v) {
    if (v === null || v === undefined) return 0;
    if (typeof v === 'number') return v;
    if (typeof v === 'bigint') return Number(v);
    if (typeof v === 'string') {
      const p = parseInt(v);
      return isNaN(p) ? 0 : p;
    }
    if (typeof v === 'object') {
      if (v.toJSNumber) return v.toJSNumber();
      if (v.toNumber) return v.toNumber();
      if (v.valueOf) {
        const val = v.valueOf();
        if (typeof val === 'number') return val;
        if (typeof val === 'bigint') return Number(val);
        if (typeof val === 'string') return parseInt(val) || 0;
      }
    }
    const n = Number(v);
    return isNaN(n) ? 0 : n;
  }

  async _getUser(peer) {
    try {
      let userId;
      if (peer instanceof Api.PeerUser) {
        userId = this._toNum(peer.userId);
      } else if (typeof peer === 'bigint' || typeof peer === 'number' || typeof peer === 'string') {
        userId = this._toNum(peer);
      } else if (peer && peer.userId !== undefined) {
        userId = this._toNum(peer.userId);
      } else if (peer && peer.toJSNumber) {
        userId = peer.toJSNumber(); // big-integer library
      } else if (peer && peer.valueOf) {
        userId = this._toNum(peer);
      } else {
        return { id: 0, is_bot: false, first_name: 'Unknown' };
      }
      if (!userId || isNaN(userId)) {
        // userId 0 can happen if input was invalid
        return { id: 0, is_bot: false, first_name: 'Unknown' };
      }

      const entity = await this._client.getEntity(userId);
      return {
        id: this._toNum(entity.id),
        is_bot: entity.bot || false,
        first_name: entity.firstName || '',
        last_name: entity.lastName || '',
        username: entity.username || '',
        language_code: entity.langCode || '',
      };
    } catch (e) {
      let id = 0;
      if (peer instanceof Api.PeerUser) id = this._toNum(peer.userId);
      else id = this._toNum(peer);
      return { id: id || 0, is_bot: false, first_name: 'Unknown' };
    }
  }

  // Resolve user for admin actions - handles NaN, strings, unknown entities
  async _resolveUser(userId) {
    if (!this._client) return null;
    const id = this._toNum(userId);
    
    if (id !== 0) {
      try {
        return await this._client.getEntity(id);
      } catch (e) {
        // Fall through
      }
    }

    if (typeof userId === 'string') {
      try {
        return await this._client.getEntity(userId.startsWith('@') ? userId : `@${userId}`);
      } catch (e) {
        // ignore
      }
    }
    
    if (id !== 0) {
      return new Api.InputPeerUser({ userId: BigInt(id), accessHash: BigInt(0) });
    }
    return null;
  }

  async _convertCallbackQuery(update) {
    try {
      const query = {};
      // UpdateBotCallbackQuery has: queryId, userId, peer, msgId, data
      query.id = String(update.queryId);

      query.from = await this._getUser(update.userId);

      query.data = update.data ? Buffer.from(update.data).toString('utf8') : '';

      // Fetch the message that was clicked
      if (update.msgId && update.peer) {
        try {
          const chatEntity = await this._client.getEntity(update.peer);
          const msgs = await this._client.getMessages(chatEntity, { ids: [update.msgId] });
          if (msgs && msgs[0]) {
            query.message = await this._convertMessage(msgs[0]);
          }
        } catch (e) {
          // Build minimal message object from peer info
          let chatId = 0;
          if (update.peer instanceof Api.PeerUser) chatId = Number(update.peer.userId);
          else if (update.peer instanceof Api.PeerChat) chatId = -Number(update.peer.chatId);
          else if (update.peer instanceof Api.PeerChannel) chatId = -Number(`100${update.peer.channelId}`);
          query.message = { message_id: update.msgId, chat: { id: chatId, type: chatId > 0 ? 'private' : 'supergroup' } };
        }
      }

      if (!query.message) {
        query.message = { message_id: 0, chat: { id: 0 } };
      }

      return query;
    } catch (e) {
      console.error('[GramJS Bot] Error converting callback query:', e.message);
      return null;
    }
  }

  _convertChatMemberUpdate(update) {
    // Simplified conversion
    return null; // Will be handled by polling if needed
  }

  // ─── Resolve chat ID to GramJS entity ──────────────────────────

  async _resolveChat(chatId) {
    if (!this._client) {
      throw new Error('Client not initialized yet. Call startPolling() first.');
    }
    const id = Number(chatId);
    
    // Check cache first
    const cached = this._entityCache.get(`chat_${id}`);
    if (cached) return cached;

    try {
      let entity;
      if (id > 0) {
        // User
        entity = await this._client.getEntity(id);
      } else if (String(id).startsWith('-100')) {
        // Supergroup/Channel
        const channelId = String(id).replace('-100', '');
        entity = await this._client.getEntity(BigInt(`-100${channelId}`));
      } else {
        // Basic group
        entity = await this._client.getEntity(id);
      }
      
      this._entityCache.set(`chat_${id}`, entity);
      return entity;
    } catch (e) {
      // Last resort: return a synthetic InputPeer if we have the ID but getEntity failed
      // This allows SENDING messages even if we can't fetch full entity info
      if (id > 0) {
        return new Api.InputPeerUser({ userId: BigInt(id), accessHash: BigInt(0) });
      } else if (String(id).startsWith('-100')) {
        const realId = String(id).replace('-100', '');
        return new Api.InputPeerChannel({ channelId: BigInt(realId), accessHash: BigInt(0) });
      } else {
        return new Api.InputPeerChat({ chatId: BigInt(Math.abs(id)) });
      }
    }
  }

  // ─── Bot API Compatible Methods ─────────────────────────────────

  async getMe() {
    if (!this._client) await this._initClient();
    if (!this._me) this._me = await this._client.getMe();
    return {
      id: Number(this._me.id),
      is_bot: true,
      first_name: this._me.firstName || '',
      username: this._me.username || '',
    };
  }

  async getUpdates(options = {}) {
    // Not needed for MTProto - updates come via event handlers
    return [];
  }

  // ─── Send Methods ──────────────────────────────────────────────

  _getParseMode(mode) {
    if (!mode) return undefined;
    const m = mode.toLowerCase();
    if (m === 'html') return 'html';
    if (m === 'markdown' || m === 'markdownv2') return 'md';
    return undefined;
  }

  async sendMessage(chatId, text, options = {}) {
    try {
      const entity = await this._resolveChat(chatId);
      
      const params = {
        message: text,
      };

      // Parse mode
      if (options.parse_mode) {
        params.parseMode = this._getParseMode(options.parse_mode);
      }

      // Reply
      if (options.reply_to_message_id) {
        params.replyTo = options.reply_to_message_id;
      }

      // Inline keyboard
      if (options.reply_markup) {
        params.buttons = this._convertMarkup(options.reply_markup);
      }

      // Disable notification
      if (options.disable_notification) {
        params.silent = true;
      }

      const result = await this._client.sendMessage(entity, params);
      return await this._convertMessage(result);
    } catch (e) {
      // Retry without parseMode on ENTITY_BOUNDS_INVALID (markdown parse error)
      // Safely check params which might be undefined if _resolveChat failed
      if (e.errorMessage === 'ENTITY_BOUNDS_INVALID' && typeof params !== 'undefined' && params.parseMode) {
        try {
          delete params.parseMode;
          const result = await this._client.sendMessage(entity, params);
          return await this._convertMessage(result);
        } catch (e2) {
          console.error(`[GramJS Bot] sendMessage retry error for chat ${chatId}:`, e2.message);
          throw e2;
        }
      }
      console.error(`[GramJS Bot] sendMessage error for chat ${chatId}:`, e.message);
      throw e;
    }
  }

  _isBotApiFileId(str) {
    // Bot API file_ids are base64-like: letters, numbers, -, _
    // They do NOT start with http, /, gramjs:, or contain path separators
    if (!str || typeof str !== 'string') return false;
    if (str.startsWith('data:')) return false;
    if (str.startsWith('http://') || str.startsWith('https://')) return false;
    if (str.startsWith('gramjs:')) return false;
    if (str.startsWith('/') || str.startsWith('.') || str.includes('\\')) return false;
    if (str.length < 2048 && fs.existsSync(str)) return false;
    // Typical Bot API file_id pattern
    return /^[A-Za-z0-9_-]{20,}$/.test(str);
  }

  async sendPhoto(chatId, photo, options = {}, fileOptions = {}) {
    try {
      const entity = await this._resolveChat(chatId);
      
      // If it's a base64 data URI, convert to Buffer immediately
      if (typeof photo === 'string' && photo.startsWith('data:')) {
        const parts = photo.split(',');
        if (parts[1]) {
          photo = Buffer.from(parts[1], 'base64');
        }
      }

      const sendOpts = {
        caption: options.caption || '',
        parseMode: this._getParseMode(options.parse_mode),
        replyTo: options.reply_to_message_id,
        buttons: options.reply_markup ? this._convertMarkup(options.reply_markup) : undefined,
        silent: options.disable_notification || false,
        forceDocument: false,
      };
      
      if (Buffer.isBuffer(photo)) {
        // Upload as photo explicitly using CustomFile so GramJS knows it's a photo
        const file = new CustomFile('photo.jpg', photo.length, '', photo);
        const result = await this._client.sendFile(entity, {
          file: file,
          ...sendOpts,
          forceDocument: false,
        });
        return await this._convertMessage(result);
      } else if (typeof photo === 'string') {
        if (photo.startsWith('gramjs:')) {
          const parts = photo.split(':');
          const inputPhoto = new Api.InputPhoto({
            id: BigInt(parts[2]),
            accessHash: BigInt(parts[3]),
            fileReference: Buffer.alloc(0),
          });
          const result = await this._client.sendFile(entity, { file: inputPhoto, ...sendOpts });
          return await this._convertMessage(result);
        } else if (photo.startsWith('http://') || photo.startsWith('https://')) {
          // URL — Fetch it as a buffer to ensure it's sent as a photo, not a document
          try {
            const axios = require('axios');
            const res = await axios.get(photo, { responseType: 'arraybuffer' });
            const buffer = Buffer.from(res.data);
            const file = new CustomFile('photo.jpg', buffer.length, '', buffer);
            const result = await this._client.sendFile(entity, { 
                file: file, 
                ...sendOpts,
                forceDocument: false 
            });
            return await this._convertMessage(result);
          } catch (e) {
            console.error('[GramJS Bot] HTTP Photo Fetch Error, falling back to string URL:', e.message);
            const result = await this._client.sendFile(entity, { file: photo, ...sendOpts });
            return await this._convertMessage(result);
          }
        } else if (photo.length < 2048 && fs.existsSync(photo)) {
          // Local file path (check length same as MAX_PATH roughly, and avoid base64)
          const result = await this._client.sendFile(entity, { file: photo, ...sendOpts });
          return await this._convertMessage(result);
        } else if (this._isBotApiFileId(photo)) {
          // Bot API file_id — can't use directly with GramJS
          // Fallback: send caption as text message
          console.log(`[GramJS Bot] sendPhoto: Bot API file_id detected, sending caption as text fallback.`);
          return await this.sendMessage(chatId, options.caption || '📷 (photo)', options);
        } else {
          // Try anyway
          const result = await this._client.sendFile(entity, { file: photo, ...sendOpts });
          return await this._convertMessage(result);
        }
      }
    } catch (e) {
      console.error(`[GramJS Bot] sendPhoto error:`, e.message);
      // Fallback to text
      try {
        return await this.sendMessage(chatId, options.caption || '📷', options);
      } catch (e2) {
        throw e;
      }
    }
  }

  // Safe file resolver — handles Buffer, URL, local path, gramjs: ids
  // Returns null if it's a Bot API file_id that can't be used
  _resolveFile(file) {
    if (Buffer.isBuffer(file)) return file;
    if (typeof file !== 'string') return file;
    if (file.startsWith('gramjs:')) {
      const parts = file.split(':');
      return new Api.InputDocument({
        id: BigInt(parts[2]),
        accessHash: BigInt(parts[3]),
        fileReference: Buffer.alloc(0),
      });
    }
    if (file.startsWith('http://') || file.startsWith('https://')) return file;
    if (fs.existsSync(file)) return file;
    if (this._isBotApiFileId(file)) return null; // Can't use Bot API file_ids in GramJS
    return file; // Try anyway
  }

  async sendDocument(chatId, doc, options = {}, fileOptions = {}) {
    try {
      const entity = await this._resolveChat(chatId);
      const filename = fileOptions?.filename || options?.filename || 'file';
      const resolvedFile = this._resolveFile(doc);
      if (resolvedFile === null) {
        return await this.sendMessage(chatId, options.caption || '📎 (document)', options);
      }
      const result = await this._client.sendFile(entity, {
        file: resolvedFile,
        caption: options.caption || '',
        parseMode: this._getParseMode(options.parse_mode),
        replyTo: options.reply_to_message_id,
        buttons: options.reply_markup ? this._convertMarkup(options.reply_markup) : undefined,
        silent: options.disable_notification || false,
        forceDocument: true,
        attributes: [new Api.DocumentAttributeFilename({ fileName: filename })],
      });
      return await this._convertMessage(result);
    } catch (e) {
      console.error(`[GramJS Bot] sendDocument error:`, e.message);
      throw e;
    }
  }

  async sendVideo(chatId, video, options = {}) {
    try {
      const entity = await this._resolveChat(chatId);
      const resolvedFile = this._resolveFile(video);
      if (resolvedFile === null) {
        return await this.sendMessage(chatId, options.caption || '🎬 (video)', options);
      }
      const result = await this._client.sendFile(entity, {
        file: resolvedFile,
        caption: options.caption || '',
        parseMode: this._getParseMode(options.parse_mode),
        replyTo: options.reply_to_message_id,
        buttons: options.reply_markup ? this._convertMarkup(options.reply_markup) : undefined,
        silent: options.disable_notification || false,
        videoNote: false,
      });
      return await this._convertMessage(result);
    } catch (e) {
      console.error(`[GramJS Bot] sendVideo error:`, e.message);
      throw e;
    }
  }

  async sendAnimation(chatId, animation, options = {}) {
    return this.sendDocument(chatId, animation, { ...options, filename: 'animation.gif' });
  }

  async sendSticker(chatId, sticker, options = {}, fileOptions = {}) {
    try {
      const entity = await this._resolveChat(chatId);
      const filename = fileOptions?.filename || 'sticker.webp';
      const resolvedFile = this._resolveFile(sticker);
      if (resolvedFile === null) {
        return await this.sendMessage(chatId, '🎨 (sticker)', {});
      }
      const result = await this._client.sendFile(entity, {
        file: resolvedFile,
        replyTo: options.reply_to_message_id,
        buttons: options.reply_markup ? this._convertMarkup(options.reply_markup) : undefined,
        silent: options.disable_notification || false,
        attributes: [new Api.DocumentAttributeFilename({ fileName: filename })],
      });
      return await this._convertMessage(result);
    } catch (e) {
      console.error(`[GramJS Bot] sendSticker error:`, e.message);
      throw e;
    }
  }

  async sendVoice(chatId, voice, options = {}) {
    return this.sendDocument(chatId, voice, options, { filename: 'voice.ogg' });
  }

  async sendAudio(chatId, audio, options = {}) {
    return this.sendDocument(chatId, audio, options, { filename: 'audio.mp3' });
  }

  async sendVideoNote(chatId, videoNote, options = {}) {
    try {
      const entity = await this._resolveChat(chatId);
      const resolvedFile = this._resolveFile(videoNote);
      if (resolvedFile === null) return await this.sendMessage(chatId, '🎥', {});
      const result = await this._client.sendFile(entity, {
        file: resolvedFile,
        videoNote: true,
        replyTo: options.reply_to_message_id,
      });
      return await this._convertMessage(result);
    } catch (e) {
      throw e;
    }
  }

  async sendPoll(chatId, question, pollOptions, options = {}) {
    try {
      const entity = await this._resolveChat(chatId);

      const answers = pollOptions.map((opt, i) => {
        return new Api.PollAnswer({
          text: new Api.TextWithEntities({ text: opt, entities: [] }),
          option: Buffer.from([i]),
        });
      });

      const pollObj = new Api.Poll({
        id: BigInt(Math.floor(Math.random() * 1e15)),
        question: new Api.TextWithEntities({ text: question, entities: [] }),
        answers: answers,
        quiz: options.type === 'quiz',
        publicVoters: !options.is_anonymous,
        multipleChoice: options.allows_multiple_answers || false,
        closePeriod: options.open_period, // MTProto field for auto-closing
      });

      const mediaParams = {
        poll: pollObj,
      };

      if (options.correct_option_id !== undefined) {
        mediaParams.correctAnswers = [Buffer.from([options.correct_option_id])];
      }
      if (options.explanation) {
        mediaParams.solution = options.explanation;
        mediaParams.solutionEntities = [];
      }

      const mediaPoll = new Api.InputMediaPoll(mediaParams);

      const result = await this._client.invoke(new Api.messages.SendMedia({
        peer: entity,
        media: mediaPoll,
        message: '',
        randomId: BigInt(Math.floor(Math.random() * 1e15)),
        replyToMsgId: options.reply_to_message_id,
        silent: options.disable_notification || false,
      }));

      // Extract sent message from updates
      if (result.updates) {
        for (const upd of result.updates) {
          if (upd instanceof Api.UpdateNewMessage || upd instanceof Api.UpdateNewChannelMessage) {
            return await this._convertMessage(upd.message);
          }
        }
      }

      return { message_id: 0 };
    } catch (e) {
      console.error(`[GramJS Bot] sendPoll error:`, e.message);
      throw e;
    }
  }

  async stopPoll(chatId, messageId) {
    try {
      const entity = await this._resolveChat(chatId);
      const inputPeer = await this._client.getInputEntity(entity);
      
      // We need to get the message first to get the existing poll data
      const msgs = await this._client.getMessages(entity, { ids: [messageId] });
      const msg = msgs?.[0];
      if (!msg || !msg.media || !(msg.media instanceof Api.MessageMediaPoll)) {
        throw new Error('Message does not contain a poll.');
      }

      const poll = msg.media.poll;
      poll.closed = true;

      const mediaPoll = new Api.InputMediaPoll({
        poll: poll,
      });

      const result = await this._client.invoke(new Api.messages.EditMessage({
        peer: inputPeer,
        id: messageId,
        media: mediaPoll,
      }));

      return await this._convertPoll(msg.media);
    } catch (e) {
      console.error(`[GramJS Bot] stopPoll error:`, e.message);
      throw e;
    }
  }

  // ─── Edit Methods ──────────────────────────────────────────────

  async editMessageText(text, options = {}) {
    try {
      const chatId = options.chat_id;
      const messageId = options.message_id;
      const entity = await this._resolveChat(chatId);
      const pm = this._getParseMode(options.parse_mode);
      const btns = options.reply_markup ? this._convertMarkup(options.reply_markup) : undefined;

      try {
        const result = await this._client.editMessage(entity, {
          message: messageId, text: text, parseMode: pm, buttons: btns,
        });
        return await this._convertMessage(result);
      } catch (e1) {
        // Retry without parseMode on ENTITY_BOUNDS_INVALID
        if (e1.errorMessage === 'ENTITY_BOUNDS_INVALID' && pm) {
          const result = await this._client.editMessage(entity, {
            message: messageId, text: text, buttons: btns,
          });
          return await this._convertMessage(result);
        }
        throw e1;
      }
    } catch (e) {
      console.error(`[GramJS Bot] editMessageText error:`, e.message);
      throw e;
    }
  }

  async editMessageCaption(caption, options = {}) {
    // Same as editMessageText but for captions
    return this.editMessageText(caption, options);
  }

  async editMessageReplyMarkup(replyMarkup, options = {}) {
    try {
      const entity = await this._resolveChat(options.chat_id);
      const inputPeer = await this._client.getInputEntity(entity);
      const markup = replyMarkup ? this._convertMarkup(replyMarkup) : null;

      if (markup) {
        await this._client.invoke(new Api.messages.EditMessage({
          peer: inputPeer,
          id: options.message_id,
          replyMarkup: this._client.buildReplyMarkup(markup),
        }));
      } else {
        // To clear buttons, edit with no replyMarkup field at all
        // Some Telegram versions reject empty ReplyInlineMarkup, so we suppress the error
        try {
          await this._client.invoke(new Api.messages.EditMessage({
            peer: inputPeer,
            id: options.message_id,
            replyMarkup: null,
          }));
        } catch (clearErr) {
          // Silently ignore — button clearing not critical, quiz continues normally
        }
      }
    } catch (e) {
      // Silently swallow — markup edits are non-critical; don't crash quiz flow
    }
  }

  // ─── Delete Methods ─────────────────────────────────────────────

  async deleteMessage(chatId, messageId) {
    try {
      const entity = await this._resolveChat(chatId);
      await this._client.deleteMessages(entity, [messageId], { revoke: true });
      return true;
    } catch (e) {
      console.error(`[GramJS Bot] deleteMessage error:`, e.message);
      throw e;
    }
  }

  // ─── Chat Member Methods ───────────────────────────────────────

  async getChatMember(chatId, userId) {
    try {
      const numUserId = Number(typeof userId === 'bigint' ? userId : (parseInt(userId) || 0));
      if (!numUserId || numUserId === 0) {
        return { status: 'member', user: { id: 0, is_bot: false, first_name: 'Unknown' } };
      }
      const entity = await this._resolveChat(chatId);
      const userInputPeer = await this._resolveUser(userId);

      if (entity instanceof Api.Channel) {
        const result = await this._client.invoke(new Api.channels.GetParticipant({
          channel: entity,
          participant: userInputPeer,
        }));

        // Build user info from result.users if available
        let user = { id: numUserId, is_bot: false, first_name: 'Unknown' };
        if (result.users && result.users.length > 0) {
          const u = result.users.find(u => Number(u.id) === numUserId) || result.users[0];
          user = { id: Number(u.id), is_bot: u.bot || false, first_name: u.firstName || '', last_name: u.lastName || '', username: u.username || '' };
        } else {
          user = await this._getUser(numUserId);
        }

        const p = result.participant;
        if (p instanceof Api.ChannelParticipantCreator) {
          return { status: 'creator', user, ...this._extractAdminRights(p.adminRights) };
        } else if (p instanceof Api.ChannelParticipantAdmin) {
          return { status: 'administrator', user, ...this._extractAdminRights(p.adminRights) };
        } else if (p instanceof Api.ChannelParticipantBanned) {
          if (p.bannedRights?.viewMessages) return { status: 'kicked', user };
          return { status: 'restricted', user, ...this._extractBannedRights(p.bannedRights) };
        } else if (p instanceof Api.ChannelParticipantLeft) {
          return { status: 'left', user };
        } else {
          return { status: 'member', user };
        }
      } else {
        // Basic group
        const result = await this._client.invoke(new Api.messages.GetFullChat({ chatId: entity.id }));
        const participants = result.fullChat.participants?.participants || [];
        const found = participants.find(p => {
          const pId = p.userId?.valueOf ? p.userId.valueOf() : Number(p.userId);
          return pId === numUserId;
        });
        const user = await this._getUser(numUserId);
        if (!found) return { status: 'left', user };
        if (found instanceof Api.ChatParticipantCreator) return { status: 'creator', user };
        if (found instanceof Api.ChatParticipantAdmin) return { status: 'administrator', user };
        return { status: 'member', user };
      }
    } catch (e) {
      console.error(`[GramJS Bot] getChatMember error (returning default member):`, e.message);
      // DON'T throw — return default so callers (admin.js /prom etc) can continue
      const numId = Number(typeof userId === 'bigint' ? userId : (parseInt(userId) || 0));
      const user = await this._getUser(numId || userId);
      return { status: 'member', user };
    }
  }

  async getChatAdministrators(chatId) {
    try {
      const entity = await this._resolveChat(chatId);
      const admins = [];

      if (entity instanceof Api.Channel) {
        const result = await this._client.invoke(new Api.channels.GetParticipants({
          channel: entity,
          filter: new Api.ChannelParticipantsAdmins(),
          offset: 0,
          limit: 200,
          hash: bigInt(0),
        }));

        for (const p of result.participants) {
          const user = result.users.find(u => {
            const pUserId = p.userId?.valueOf ? p.userId.valueOf() : Number(p.userId);
            const uId = u.id?.valueOf ? u.id.valueOf() : Number(u.id);
            return pUserId === uId;
          });
          
          if (!user) continue;

          const adminEntry = {
            user: {
              id: Number(user.id),
              is_bot: user.bot || false,
              first_name: user.firstName || '',
              last_name: user.lastName || '',
              username: user.username || '',
            },
          };

          if (p instanceof Api.ChannelParticipantCreator) {
            adminEntry.status = 'creator';
            Object.assign(adminEntry, this._extractAdminRights(p.adminRights));
          } else if (p instanceof Api.ChannelParticipantAdmin) {
            adminEntry.status = 'administrator';
            Object.assign(adminEntry, this._extractAdminRights(p.adminRights));
          }

          admins.push(adminEntry);
        }
      } else {
        // Basic group
        const result = await this._client.invoke(new Api.messages.GetFullChat({
          chatId: entity.id,
        }));
        
        const participants = result.fullChat.participants?.participants || [];
        for (const p of participants) {
          if (p instanceof Api.ChatParticipantCreator || p instanceof Api.ChatParticipantAdmin) {
            const userId = p.userId?.valueOf ? p.userId.valueOf() : Number(p.userId);
            const user = result.users.find(u => Number(u.id) === userId);
            if (!user) continue;
            
            admins.push({
              user: {
                id: Number(user.id),
                is_bot: user.bot || false,
                first_name: user.firstName || '',
                last_name: user.lastName || '',
                username: user.username || '',
              },
              status: p instanceof Api.ChatParticipantCreator ? 'creator' : 'administrator',
            });
          }
        }
      }

      return admins;
    } catch (e) {
      console.error(`[GramJS Bot] getChatAdministrators error:`, e.message);
      throw e;
    }
  }

  _extractAdminRights(rights) {
    if (!rights) return {};
    return {
      can_change_info: rights.changeInfo || false,
      can_delete_messages: rights.deleteMessages || false,
      can_invite_users: rights.inviteUsers || false,
      can_restrict_members: rights.banUsers || false,
      can_pin_messages: rights.pinMessages || false,
      can_promote_members: rights.addAdmins || false,
      can_manage_video_chats: rights.manageCall || false,
      is_anonymous: rights.anonymous || false,
      can_manage_chat: rights.other || false,
      can_post_messages: rights.postMessages || false,
      can_edit_messages: rights.editMessages || false,
      can_manage_topics: rights.manageTopics || false,
    };
  }

  _extractBannedRights(rights) {
    if (!rights) return {};
    return {
      can_send_messages: !rights.sendMessages,
      can_send_audios: !rights.sendAudios,
      can_send_documents: !rights.sendDocs,
      can_send_photos: !rights.sendPhotos,
      can_send_videos: !rights.sendVideos,
      can_send_video_notes: !rights.sendRoundvideos,
      can_send_voice_notes: !rights.sendVoices,
      can_send_polls: !rights.sendPolls,
      can_send_other_messages: !rights.sendStickers,
      can_add_web_page_previews: !rights.embedLinks,
      can_change_info: !rights.changeInfo,
      can_invite_users: !rights.inviteUsers,
      can_pin_messages: !rights.pinMessages,
      until_date: rights.untilDate || 0,
    };
  }

  // ─── Chat Management Methods ───────────────────────────────────

  async restrictChatMember(chatId, userId, permissions = {}) {
    try {
      const numId = Number(typeof userId === 'bigint' ? userId : (parseInt(userId) || 0));
      if (!numId) { console.log('[GramJS Bot] restrictChatMember skipped: userId is 0'); return true; }
      const entity = await this._resolveChat(chatId);
      const userEntity = await this._resolveUser(userId);

      const rights = new Api.ChatBannedRights({
        untilDate: permissions.until_date || 0,
        sendMessages: permissions.can_send_messages === false,
        sendMedia: false,
        sendStickers: permissions.can_send_other_messages === false,
        sendGifs: permissions.can_send_other_messages === false,
        sendGames: false,
        sendInline: false,
        embedLinks: permissions.can_add_web_page_previews === false,
        sendPolls: permissions.can_send_polls === false,
        changeInfo: permissions.can_change_info === false,
        inviteUsers: permissions.can_invite_users === false,
        pinMessages: permissions.can_pin_messages === false,
        sendPhotos: permissions.can_send_photos === false,
        sendVideos: permissions.can_send_videos === false,
        sendRoundvideos: permissions.can_send_video_notes === false,
        sendAudios: permissions.can_send_audios === false,
        sendVoices: permissions.can_send_voice_notes === false,
        sendDocs: permissions.can_send_documents === false,
      });

      if (entity instanceof Api.Channel) {
        await this._client.invoke(new Api.channels.EditBanned({
          channel: entity,
          participant: userEntity,
          bannedRights: rights,
        }));
      }

      return true;
    } catch (e) {
      console.error(`[GramJS Bot] restrictChatMember error:`, e.message);
      throw e;
    }
  }

  async banChatMember(chatId, userId) {
    try {
      const numId = Number(typeof userId === 'bigint' ? userId : (parseInt(userId) || 0));
      if (!numId) { console.log('[GramJS Bot] banChatMember skipped: userId is 0'); return true; }
      const entity = await this._resolveChat(chatId);
      const userEntity = await this._resolveUser(userId);

      if (entity instanceof Api.Channel) {
        await this._client.invoke(new Api.channels.EditBanned({
          channel: entity,
          participant: userEntity,
          bannedRights: new Api.ChatBannedRights({
            untilDate: 0,
            viewMessages: true,
            sendMessages: true,
            sendMedia: true,
            sendStickers: true,
            sendGifs: true,
            sendGames: true,
            sendInline: true,
            embedLinks: true,
          }),
        }));
      } else {
        await this._client.invoke(new Api.messages.DeleteChatUser({
          chatId: entity.id,
          userId: userEntity,
        }));
      }

      return true;
    } catch (e) {
      console.error(`[GramJS Bot] banChatMember error:`, e.message);
      throw e;
    }
  }

  async unbanChatMember(chatId, userId) {
    try {
      const numId = Number(typeof userId === 'bigint' ? userId : (parseInt(userId) || 0));
      if (!numId) { console.log('[GramJS Bot] unbanChatMember skipped: userId is 0'); return true; }
      const entity = await this._resolveChat(chatId);
      const userEntity = await this._resolveUser(userId);

      if (entity instanceof Api.Channel) {
        await this._client.invoke(new Api.channels.EditBanned({
          channel: entity,
          participant: userEntity,
          bannedRights: new Api.ChatBannedRights({
            untilDate: 0,
          }),
        }));
      }

      return true;
    } catch (e) {
      console.error(`[GramJS Bot] unbanChatMember error:`, e.message);
      throw e;
    }
  }

  async promoteChatMember(chatId, userId, permissions = {}) {
    try {
      const numId = Number(typeof userId === 'bigint' ? userId : (parseInt(userId) || 0));
      if (!numId || numId === 0) {
        // Silently fail — this happens when old keyboard buttons have targetId=0
        console.log(`[GramJS Bot] promoteChatMember skipped: userId is 0 (stale keyboard button)`);
        return true;
      }
      const entity = await this._resolveChat(chatId);
      const userEntity = await this._resolveUser(userId);

      const rights = new Api.ChatAdminRights({
        changeInfo: permissions.can_change_info || false,
        deleteMessages: permissions.can_delete_messages || false,
        banUsers: permissions.can_restrict_members || false,
        inviteUsers: permissions.can_invite_users || false,
        pinMessages: permissions.can_pin_messages || false,
        addAdmins: permissions.can_promote_members || false,
        anonymous: permissions.is_anonymous || false,
        manageCall: permissions.can_manage_video_chats || false,
        other: permissions.can_manage_chat || false,
        postMessages: permissions.can_post_messages || false,
        editMessages: permissions.can_edit_messages || false,
        manageTopics: permissions.can_manage_topics || false,
      });

      if (entity instanceof Api.Channel) {
        await this._client.invoke(new Api.channels.EditAdmin({
          channel: entity,
          userId: userEntity,
          adminRights: rights,
          rank: permissions.custom_title || '',
        }));
      }

      return true;
    } catch (e) {
      console.error(`[GramJS Bot] promoteChatMember error:`, e.message);
      throw e;
    }
  }

  // ─── Chat Info Methods ─────────────────────────────────────────

  async getChat(chatId) {
    try {
      const entity = await this._resolveChat(chatId);
      const numChatId = Number(chatId);

      const chat = {
        id: numChatId,
      };

      if (entity instanceof Api.User) {
        chat.type = 'private';
        chat.first_name = entity.firstName || '';
        chat.last_name = entity.lastName || '';
        chat.username = entity.username || '';

        // Get full user for color, emoji status etc
        try {
          const fullUser = await this._client.invoke(new Api.users.GetFullUser({
            id: entity,
          }));
          
          if (fullUser.fullUser) {
            chat.bio = fullUser.fullUser.about || '';
          }
          
          // Color
          if (entity.color) {
            chat.accent_color_id = entity.color.color || 0;
          }

          // Emoji status
          if (entity.emojiStatus && entity.emojiStatus.documentId) {
            chat.emoji_status_custom_emoji_id = String(entity.emojiStatus.documentId);
          }
        } catch (e) {
          // ignore
        }

        // Profile photo
        if (entity.photo) {
          chat.photo = {
            small_file_id: `gramjs:userphoto:${entity.id}:small`,
            big_file_id: `gramjs:userphoto:${entity.id}:big`,
          };
        }
      } else if (entity instanceof Api.Channel || entity instanceof Api.Chat) {
        chat.type = entity instanceof Api.Channel ? (entity.broadcast ? 'channel' : 'supergroup') : 'group';
        chat.title = entity.title || '';
        chat.username = entity.username || '';

        if (entity.photo) {
          chat.photo = {
            small_file_id: `gramjs:chatphoto:${entity.id}:small`,
            big_file_id: `gramjs:chatphoto:${entity.id}:big`,
          };
        }

        // Get default permissions
        if (entity.defaultBannedRights) {
          chat.permissions = this._extractBannedRights(entity.defaultBannedRights);
          // Invert because banned rights are "denied" but permissions mean "allowed"
        }

        // Get invite link
        if (entity.username) {
          chat.invite_link = `https://t.me/${entity.username}`;
        }

        // Color for channels
        if (entity.color) {
          chat.accent_color_id = entity.color.color || 0;
        }
      }

      return chat;
    } catch (e) {
      console.error(`[GramJS Bot] getChat error:`, e.message);
      throw e;
    }
  }

  async getUserProfilePhotos(userId, options = {}) {
    try {
      const entity = await this._resolveUser(userId);
      const result = await this._client.invoke(new Api.photos.GetUserPhotos({
        userId: entity,
        offset: options.offset || 0,
        maxId: BigInt(0),
        limit: options.limit || 1,
      }));

      return {
        total_count: result.photos?.length || 0,
        photos: (result.photos || []).map(photo => {
          return (photo.sizes || []).map(s => ({
            file_id: this._buildFileId('photo', photo.id, photo.accessHash, photo.fileReference, s),
            file_unique_id: String(photo.id),
            width: s.w || 0,
            height: s.h || 0,
          }));
        }),
      };
    } catch (e) {
      return { total_count: 0, photos: [] };
    }
  }

  // ─── File Methods ──────────────────────────────────────────────

  async getFileLink(fileId) {
    // Since api.telegram.org/file is blocked, we download through GramJS
    // and return a data: URI so axios.get() can consume it directly
    if (typeof fileId === 'string' && fileId.startsWith('gramjs:userphoto:')) {
      const parts = fileId.split(':');
      const userId = Number(parts[2]);
      const size = parts[3];
      
      try {
        const entity = await this._client.getEntity(userId);
        const buffer = await this._client.downloadProfilePhoto(entity, { isBig: size === 'big' });
        if (buffer && buffer.length > 0) {
          return `data:image/jpeg;base64,${buffer.toString('base64')}`;
        }
      } catch (e) {
        console.error(`[GramJS Bot] getFileLink error for user photo:`, e.message);
      }
      return '';
    }

    if (typeof fileId === 'string' && fileId.startsWith('gramjs:chatphoto:')) {
      const parts = fileId.split(':');
      const chatId = Number(parts[2]);
      const size = parts[3];
      
      try {
        const entity = await this._client.getEntity(chatId);
        const buffer = await this._client.downloadProfilePhoto(entity, { isBig: size === 'big' });
        if (buffer && buffer.length > 0) {
          return `data:image/jpeg;base64,${buffer.toString('base64')}`;
        }
      } catch (e) {
        console.error(`[GramJS Bot] getFileLink error for chat photo:`, e.message);
      }
      return '';
    }

    if (typeof fileId === 'string' && fileId.startsWith('gramjs:')) {
      // Synthetic file_id from our wrapper
      const parts = fileId.split(':');
      const type = parts[1];
      const docId = BigInt(parts[2]);
      const accessHash = BigInt(parts[3]);
      
      // Download file via GramJS
      try {
        let inputLocation;
        if (type === 'photo') {
          inputLocation = new Api.InputPhotoFileLocation({
            id: docId,
            accessHash: accessHash,
            fileReference: Buffer.alloc(0),
            thumbSize: parts[4] || 'x',
          });
        } else {
          inputLocation = new Api.InputDocumentFileLocation({
            id: docId,
            accessHash: accessHash,
            fileReference: Buffer.alloc(0),
            thumbSize: '',
          });
        }

        const buffer = await this._client.downloadFile(inputLocation, {
          dcId: undefined,
          fileSize: undefined,
          workers: 1,
        });

        if (buffer && buffer.length > 0) {
          const mime = type === 'photo' ? 'image/jpeg' : 'application/octet-stream';
          return `data:${mime};base64,${buffer.toString('base64')}`;
        }
      } catch (e) {
        console.error(`[GramJS Bot] getFileLink download error:`, e.message);
      }
      return '';
    }

    // For non-gramjs file IDs (legacy Bot API file_ids), can't resolve
    return '';
  }

  async downloadFile(fileId) {
    const link = await this.getFileLink(fileId);
    if (!link) return null;
    // Handle data: URIs
    if (link.startsWith('data:')) {
      const base64Data = link.split(',')[1];
      if (base64Data) return Buffer.from(base64Data, 'base64');
      return null;
    }
    // Handle local file paths
    if (fs.existsSync(link)) return fs.readFileSync(link);
    return null;
  }

  getFileStream(fileId) {
    const { Readable } = require('stream');
    const stream = new Readable();
    stream._read = () => {}; // No-op

    this.downloadFile(fileId).then(buffer => {
      if (buffer) {
        stream.push(buffer);
        stream.push(null);
      } else {
        stream.emit('error', new Error('Failed to download file'));
      }
    }).catch(err => {
      stream.emit('error', err);
    });

    return stream;
  }

  // ─── Pin Methods ───────────────────────────────────────────────

  async pinChatMessage(chatId, messageId, options = {}) {
    try {
      const entity = await this._resolveChat(chatId);
      await this._client.pinMessage(entity, messageId, {
        silent: options.disable_notification || false,
      });
      return true;
    } catch (e) {
      console.error(`[GramJS Bot] pinChatMessage error:`, e.message);
      throw e;
    }
  }

  async unpinChatMessage(chatId, messageId) {
    try {
      const entity = await this._resolveChat(chatId);
      await this._client.unpinMessage(entity, messageId);
      return true;
    } catch (e) {
      throw e;
    }
  }

  // ─── Callback Query Methods ────────────────────────────────────

  async answerCallbackQuery(callbackQueryId, options = {}) {
    try {
      if (!this._client) return true;
      let qId;
      try {
        qId = BigInt(callbackQueryId);
      } catch (e) {
        // If it's not a valid BigInt, skip
        return true;
      }
      await this._client.invoke(new Api.messages.SetBotCallbackAnswer({
        queryId: qId,
        message: options.text || '',
        alert: options.show_alert || false,
        cacheTime: options.cache_time || 0,
      }));
      return true;
    } catch (e) {
      // Often fails silently - ignore
      return true;
    }
  }

  // ─── Forward Methods ───────────────────────────────────────────

  async forwardMessage(chatId, fromChatId, messageId) {
    try {
      const toEntity = await this._resolveChat(chatId);
      const fromEntity = await this._resolveChat(fromChatId);
      
      const result = await this._client.forwardMessages(toEntity, {
        messages: [messageId],
        fromPeer: fromEntity,
      });

      if (result && result[0]) {
        return await this._convertMessage(result[0]);
      }
      return { message_id: 0 };
    } catch (e) {
      console.error(`[GramJS Bot] forwardMessage error:`, e.message);
      throw e;
    }
  }

  // ─── Invite Link Methods ──────────────────────────────────────

  async exportChatInviteLink(chatId) {
    try {
      const entity = await this._resolveChat(chatId);
      const result = await this._client.invoke(new Api.messages.ExportChatInvite({
        peer: entity,
        legacyRevokePermanent: true,
      }));
      return result.link;
    } catch (e) {
      console.error(`[GramJS Bot] exportChatInviteLink error:`, e.message);
      throw e;
    }
  }

  // ─── Markup Conversion ────────────────────────────────────────

  _convertMarkup(markup) {
    if (!markup) return undefined;
    
    if (markup.inline_keyboard) {
      return markup.inline_keyboard.map(row => {
        return row.map(btn => {
          if (btn.callback_data) {
            return Button.inline(btn.text, Buffer.from(btn.callback_data));
          } else if (btn.url) {
            return Button.url(btn.text, btn.url);
          } else if (btn.switch_inline_query !== undefined) {
            return Button.switchInline(btn.text, false, btn.switch_inline_query || '');
          } else {
            return Button.inline(btn.text, Buffer.from(btn.text));
          }
        });
      });
    }

    return undefined;
  }

  // _convertMarkupToGram removed — _convertMarkup now returns Button objects directly

  // ─── Event Registration (node-telegram-bot-api compatible) ─────

  onText(regexp, callback) {
    this._onTextHandlers.push({ regexp, callback });
  }

  on(event, callback) {
    super.on(event, callback);
  }

  // ─── Proxy-compatible method stubs ────────────────────────────

  _patchRequestWithProxy() {
    // No-op: GramJS doesn't use HTTP requests to api.telegram.org
  }

  // ─── Utility ──────────────────────────────────────────────────

  _cacheEntity(msg) {
    // Cache entities for faster resolution
    if (msg.peerId) {
      const key = `peer_${JSON.stringify(msg.peerId)}`;
      // Will be cached by GramJS internally
    }
  }
}

module.exports = GramJSBot;
