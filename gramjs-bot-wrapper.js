/**
 * gramjs-bot-wrapper.js
 *
 * Drop-in replacement for node-telegram-bot-api using Bot API for all
 * messaging/polling (reliable, works behind any proxy), and GramJS (MTProto)
 * only for the internal userbot client stored via sessionManager.
 *
 * All bot.sendMessage / bot.on / bot.onText etc. work exactly as before —
 * zero changes needed in commands/, modules/, events/.
 */

const EventEmitter = require('events');
const fetch = require('node-fetch');
const { Readable, PassThrough } = require('stream');

class GramJsBotWrapper extends EventEmitter {
  constructor(token, options = {}) {
    super();
    this.token = token;
    this.options = options;
    this._polling = false;
    this._updateOffset = 0;
    this._textHandlers = [];
    this._apiRoot = (options.baseApiUrl || process.env.API_ROOT || 'https://api.telegram.org').replace(/\/$/, '');
    this._hfToken = process.env.HFTOKEN;
    this._dbKey = options._dbKey || 'bot_session_str';
    this._label = options._label || 'Bot';

    // NOTE: GramJS session client is NOT created here.
    // It is only created on-demand via sessionManager if GramJS-level features
    // are needed (currently not needed — all bot functions use Bot API).
    // This means startPolling() never touches GramJS and cannot crash from it.
  }

  // ── No-op kept for compatibility ─────────────────────────────────────────────
  _patchRequestWithProxy() {}

  // ── Bot Token API HTTP call ───────────────────────────────────────────────────

  async _botApiCall(method, params = {}) {
    const url = `${this._apiRoot}/bot${this.token}/${method}`;
    const headers = { 'Content-Type': 'application/json' };
    if (this._hfToken && (this._apiRoot.includes('hf.space') || this._apiRoot.includes('proxy'))) {
      headers['Authorization'] = `Bearer ${this._hfToken}`;
      headers['Referer'] = 'https://huggingface.co';
    }

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(params),
    });
    const data = await res.json();
    if (!data.ok) {
      const err = new Error(data.description || 'Telegram API error');
      err.code = data.error_code;
      err.response = { body: data };
      throw err;
    }
    return data.result;
  }

  // ── Polling (pure Bot API long-poll) ─────────────────────────────────────────

  async startPolling() {
    if (this._polling) return;
    this._polling = true;
    console.log(`[${this._label}] Bot API polling started.`);
    this._pollLoop();
  }

  _pollLoop() {
    if (!this._polling) return;

    const poll = async () => {
      if (!this._polling) return;
      try {
        const updates = await this._botApiCall('getUpdates', {
          timeout: 30,
          offset: this._updateOffset,
          allowed_updates: JSON.stringify([
            'message', 'edited_message', 'callback_query',
            'my_chat_member', 'chat_member', 'inline_query',
            'poll', 'poll_answer',
          ]),
        });

        for (const update of updates) {
          if (update.update_id >= this._updateOffset) {
            this._updateOffset = update.update_id + 1;
          }
          this._processUpdate(update);
        }
      } catch (err) {
        if (this._polling) {
          this.emit('polling_error', err);
          await new Promise(r => setTimeout(r, 3000));
        }
      }
      if (this._polling) setImmediate(() => poll());
    };

    poll();
  }

  async stopPolling() {
    this._polling = false;
    console.log(`[${this._label}] Polling stopped.`);
  }

  isPolling() {
    return this._polling;
  }

  async getUpdates({ timeout = 0, offset = -1 } = {}) {
    try {
      const updates = await this._botApiCall('getUpdates', { timeout, offset });
      if (updates.length > 0) {
        this._updateOffset = updates[updates.length - 1].update_id + 1;
      }
      return updates;
    } catch (_) {
      return [];
    }
  }

  // ── Update routing ────────────────────────────────────────────────────────────

  _processUpdate(update) {
    try {
      if (update.message) {
        const msg = update.message;
        this.emit('message', msg);
        if (msg.poll) this.emit('poll', msg.poll);
        // onText handlers
        if (msg.text) {
          for (const { regex, handler } of this._textHandlers) {
            const match = msg.text.match(regex);
            if (match) {
              try { handler(msg, match); } catch (e) { console.error(`[${this._label}] onText handler error:`, e.message); }
            }
          }
        }
      }
      if (update.edited_message) this.emit('edited_message', update.edited_message);
      if (update.callback_query) this.emit('callback_query', update.callback_query);
      if (update.inline_query) this.emit('inline_query', update.inline_query);
      if (update.my_chat_member) this.emit('my_chat_member', update.my_chat_member);
      if (update.chat_member) this.emit('chat_member', update.chat_member);
      if (update.poll) this.emit('poll', update.poll);
      if (update.poll_answer) this.emit('poll_answer', update.poll_answer);
    } catch (err) {
      console.error(`[${this._label}] Error processing update:`, err.message);
    }
  }

  // ── onText (regex listener, same as node-telegram-bot-api) ───────────────────

  onText(regex, handler) {
    this._textHandlers.push({ regex, handler });
  }

  // ── Bot API methods ───────────────────────────────────────────────────────────

  async getMe() {
    return this._botApiCall('getMe');
  }

  async sendMessage(chatId, text, opts = {}) {
    const params = { chat_id: chatId, text };
    if (opts.parse_mode) params.parse_mode = opts.parse_mode;
    if (opts.reply_to_message_id) params.reply_to_message_id = opts.reply_to_message_id;
    if (opts.reply_markup) params.reply_markup = opts.reply_markup;
    if (opts.disable_web_page_preview != null) params.disable_web_page_preview = opts.disable_web_page_preview;
    if (opts.disable_notification != null) params.disable_notification = opts.disable_notification;
    if (opts.protect_content != null) params.protect_content = opts.protect_content;
    if (opts.entities) params.entities = opts.entities;
    return this._botApiCall('sendMessage', params);
  }

  async editMessageText(text, opts = {}) {
    const params = { text };
    if (opts.chat_id) params.chat_id = opts.chat_id;
    if (opts.message_id) params.message_id = opts.message_id;
    if (opts.inline_message_id) params.inline_message_id = opts.inline_message_id;
    if (opts.parse_mode) params.parse_mode = opts.parse_mode;
    if (opts.reply_markup) params.reply_markup = opts.reply_markup;
    if (opts.disable_web_page_preview != null) params.disable_web_page_preview = opts.disable_web_page_preview;
    return this._botApiCall('editMessageText', params);
  }

  async editMessageReplyMarkup(reply_markup, opts = {}) {
    const params = { reply_markup };
    if (opts.chat_id) params.chat_id = opts.chat_id;
    if (opts.message_id) params.message_id = opts.message_id;
    if (opts.inline_message_id) params.inline_message_id = opts.inline_message_id;
    return this._botApiCall('editMessageReplyMarkup', params);
  }

  async editMessageCaption(caption, opts = {}) {
    const params = { caption };
    if (opts.chat_id) params.chat_id = opts.chat_id;
    if (opts.message_id) params.message_id = opts.message_id;
    if (opts.parse_mode) params.parse_mode = opts.parse_mode;
    if (opts.reply_markup) params.reply_markup = opts.reply_markup;
    return this._botApiCall('editMessageCaption', params);
  }

  async deleteMessage(chatId, messageId) {
    return this._botApiCall('deleteMessage', { chat_id: chatId, message_id: messageId });
  }

  async forwardMessage(toChatId, fromChatId, messageId, opts = {}) {
    const params = { chat_id: toChatId, from_chat_id: fromChatId, message_id: messageId };
    if (opts.disable_notification != null) params.disable_notification = opts.disable_notification;
    if (opts.protect_content != null) params.protect_content = opts.protect_content;
    return this._botApiCall('forwardMessage', params);
  }

  async sendPhoto(chatId, photo, opts = {}) {
    if (typeof photo === 'string') {
      const params = { chat_id: chatId, photo };
      this._applyMediaOpts(params, opts);
      return this._botApiCall('sendPhoto', params);
    }
    return this._sendFileMultipart('sendPhoto', chatId, 'photo', photo, opts);
  }

  async sendVideo(chatId, video, opts = {}) {
    if (typeof video === 'string') {
      const params = { chat_id: chatId, video };
      this._applyMediaOpts(params, opts);
      return this._botApiCall('sendVideo', params);
    }
    return this._sendFileMultipart('sendVideo', chatId, 'video', video, opts);
  }

  async sendAnimation(chatId, animation, opts = {}) {
    if (typeof animation === 'string') {
      const params = { chat_id: chatId, animation };
      this._applyMediaOpts(params, opts);
      return this._botApiCall('sendAnimation', params);
    }
    return this._sendFileMultipart('sendAnimation', chatId, 'animation', animation, opts);
  }

  async sendAudio(chatId, audio, opts = {}) {
    if (typeof audio === 'string') {
      const params = { chat_id: chatId, audio };
      this._applyMediaOpts(params, opts);
      return this._botApiCall('sendAudio', params);
    }
    return this._sendFileMultipart('sendAudio', chatId, 'audio', audio, opts);
  }

  async sendVoice(chatId, voice, opts = {}) {
    if (typeof voice === 'string') {
      const params = { chat_id: chatId, voice };
      this._applyMediaOpts(params, opts);
      return this._botApiCall('sendVoice', params);
    }
    return this._sendFileMultipart('sendVoice', chatId, 'voice', voice, opts);
  }

  async sendVideoNote(chatId, videoNote, opts = {}) {
    if (typeof videoNote === 'string') {
      const params = { chat_id: chatId, video_note: videoNote };
      if (opts.reply_to_message_id) params.reply_to_message_id = opts.reply_to_message_id;
      if (opts.reply_markup) params.reply_markup = opts.reply_markup;
      return this._botApiCall('sendVideoNote', params);
    }
    return this._sendFileMultipart('sendVideoNote', chatId, 'video_note', videoNote, opts);
  }

  async sendDocument(chatId, document, opts = {}, fileOptions = {}) {
    if (typeof document === 'string') {
      const params = { chat_id: chatId, document };
      this._applyMediaOpts(params, opts);
      return this._botApiCall('sendDocument', params);
    }
    return this._sendFileMultipart('sendDocument', chatId, 'document', document, opts, fileOptions);
  }

  async sendSticker(chatId, sticker, opts = {}, fileOptions = {}) {
    if (typeof sticker === 'string') {
      const params = { chat_id: chatId, sticker };
      if (opts.reply_to_message_id) params.reply_to_message_id = opts.reply_to_message_id;
      if (opts.reply_markup) params.reply_markup = opts.reply_markup;
      return this._botApiCall('sendSticker', params);
    }
    return this._sendFileMultipart('sendSticker', chatId, 'sticker', sticker, opts, fileOptions);
  }

  async sendPoll(chatId, question, options, opts = {}) {
    const params = { chat_id: chatId, question, options };
    if (opts.is_anonymous != null) params.is_anonymous = opts.is_anonymous;
    if (opts.type) params.type = opts.type;
    if (opts.allows_multiple_answers != null) params.allows_multiple_answers = opts.allows_multiple_answers;
    if (opts.correct_option_id != null) params.correct_option_id = opts.correct_option_id;
    if (opts.explanation) params.explanation = opts.explanation;
    if (opts.open_period != null) params.open_period = opts.open_period;
    if (opts.reply_to_message_id) params.reply_to_message_id = opts.reply_to_message_id;
    if (opts.reply_markup) params.reply_markup = opts.reply_markup;
    return this._botApiCall('sendPoll', params);
  }

  async stopPoll(chatId, messageId, opts = {}) {
    const params = { chat_id: chatId, message_id: messageId };
    if (opts.reply_markup) params.reply_markup = opts.reply_markup;
    return this._botApiCall('stopPoll', params);
  }

  async pinChatMessage(chatId, messageId, opts = {}) {
    const params = { chat_id: chatId, message_id: messageId };
    if (opts.disable_notification != null) params.disable_notification = opts.disable_notification;
    return this._botApiCall('pinChatMessage', params);
  }

  async getChat(chatId) {
    return this._botApiCall('getChat', { chat_id: chatId });
  }

  async getChatMember(chatId, userId) {
    return this._botApiCall('getChatMember', { chat_id: chatId, user_id: userId });
  }

  async getChatAdministrators(chatId) {
    return this._botApiCall('getChatAdministrators', { chat_id: chatId });
  }

  async banChatMember(chatId, userId, opts = {}) {
    const params = { chat_id: chatId, user_id: userId };
    if (opts.until_date) params.until_date = opts.until_date;
    if (opts.revoke_messages != null) params.revoke_messages = opts.revoke_messages;
    return this._botApiCall('banChatMember', params);
  }

  async unbanChatMember(chatId, userId, opts = {}) {
    const params = { chat_id: chatId, user_id: userId };
    if (opts.only_if_banned != null) params.only_if_banned = opts.only_if_banned;
    return this._botApiCall('unbanChatMember', params);
  }

  async restrictChatMember(chatId, userId, permissions, opts = {}) {
    const params = { chat_id: chatId, user_id: userId, permissions };
    if (opts.until_date) params.until_date = opts.until_date;
    return this._botApiCall('restrictChatMember', params);
  }

  async promoteChatMember(chatId, userId, opts = {}) {
    return this._botApiCall('promoteChatMember', { chat_id: chatId, user_id: userId, ...opts });
  }

  async setChatAdministratorCustomTitle(chatId, userId, customTitle) {
    return this._botApiCall('setChatAdministratorCustomTitle', {
      chat_id: chatId, user_id: userId, custom_title: customTitle,
    });
  }

  async exportChatInviteLink(chatId) {
    return this._botApiCall('exportChatInviteLink', { chat_id: chatId });
  }

  async answerCallbackQuery(queryId, opts = {}) {
    const params = { callback_query_id: queryId };
    if (opts.text) params.text = opts.text;
    if (opts.show_alert != null) params.show_alert = opts.show_alert;
    if (opts.url) params.url = opts.url;
    if (opts.cache_time != null) params.cache_time = opts.cache_time;
    return this._botApiCall('answerCallbackQuery', params);
  }

  async answerInlineQuery(queryId, results, opts = {}) {
    const params = { inline_query_id: queryId, results };
    if (opts.cache_time != null) params.cache_time = opts.cache_time;
    if (opts.is_personal != null) params.is_personal = opts.is_personal;
    if (opts.next_offset) params.next_offset = opts.next_offset;
    return this._botApiCall('answerInlineQuery', params);
  }

  async getUserProfilePhotos(userId, opts = {}) {
    return this._botApiCall('getUserProfilePhotos', { user_id: userId, ...opts });
  }

  async getFileLink(fileId) {
    const file = await this._botApiCall('getFile', { file_id: fileId });
    return `${this._apiRoot}/file/bot${this.token}/${file.file_path}`;
  }

  getFileStream(fileId) {
    const pt = new PassThrough();
    (async () => {
      try {
        const url = await this.getFileLink(fileId);
        const headers = {};
        if (this._hfToken && (this._apiRoot.includes('hf.space') || this._apiRoot.includes('proxy'))) {
          headers['Authorization'] = `Bearer ${this._hfToken}`;
          headers['Referer'] = 'https://huggingface.co';
        }
        const res = await fetch(url, { headers });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        res.body.pipe(pt);
      } catch (err) {
        pt.destroy(err);
      }
    })();
    return pt;
  }

  // ── Internal helpers ─────────────────────────────────────────────────────────

  _applyMediaOpts(params, opts) {
    if (opts.caption) params.caption = opts.caption;
    if (opts.parse_mode) params.parse_mode = opts.parse_mode;
    if (opts.reply_to_message_id) params.reply_to_message_id = opts.reply_to_message_id;
    if (opts.reply_markup) params.reply_markup = opts.reply_markup;
    if (opts.disable_notification != null) params.disable_notification = opts.disable_notification;
    if (opts.protect_content != null) params.protect_content = opts.protect_content;
    if (opts.duration != null) params.duration = opts.duration;
    if (opts.width != null) params.width = opts.width;
    if (opts.height != null) params.height = opts.height;
    if (opts.thumb) params.thumb = opts.thumb;
    if (opts.supports_streaming != null) params.supports_streaming = opts.supports_streaming;
  }

  async _sendFileMultipart(method, chatId, fieldName, fileData, opts = {}, fileOptions = {}) {
    const FormData = require('form-data');
    const form = new FormData();
    form.append('chat_id', String(chatId));

    const filename = fileOptions.filename || `${fieldName}.bin`;
    const contentType = fileOptions.contentType || 'application/octet-stream';

    if (Buffer.isBuffer(fileData) || (fileData && typeof fileData.pipe === 'function')) {
      form.append(fieldName, fileData, { filename, contentType });
    } else {
      form.append(fieldName, String(fileData));
    }

    if (opts.caption) form.append('caption', opts.caption);
    if (opts.parse_mode) form.append('parse_mode', opts.parse_mode);
    if (opts.reply_to_message_id) form.append('reply_to_message_id', String(opts.reply_to_message_id));
    if (opts.reply_markup) form.append('reply_markup', JSON.stringify(opts.reply_markup));
    if (opts.disable_notification != null) form.append('disable_notification', String(opts.disable_notification));

    const url = `${this._apiRoot}/bot${this.token}/${method}`;
    const headers = { ...form.getHeaders() };
    if (this._hfToken && (this._apiRoot.includes('hf.space') || this._apiRoot.includes('proxy'))) {
      headers['Authorization'] = `Bearer ${this._hfToken}`;
      headers['Referer'] = 'https://huggingface.co';
    }

    const res = await fetch(url, { method: 'POST', headers, body: form });
    const data = await res.json();
    if (!data.ok) {
      const err = new Error(data.description || 'Telegram API error');
      err.code = data.error_code;
      err.response = { body: data };
      throw err;
    }
    return data.result;
  }
}

module.exports = GramJsBotWrapper;
