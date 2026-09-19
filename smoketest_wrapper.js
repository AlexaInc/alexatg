/**
 * Offline smoke test for gramjs_wrapper.js — verifies the fixed conversion
 * paths without connecting to Telegram (a fake client is injected).
 */
const GramJSBot = require('./gramjs_wrapper');
const { Api } = require('telegram');
const assert = require('assert');

const USER_A = 111;
const USER_B = 222;
const CHANNEL_ID = 1234;

function fakeUserEntity(id, first) {
  return new Api.User({ id: BigInt(id), firstName: first || `U${id}`, username: `u${id}` });
}

// A minimal fake GramJS client
function makeFakeClient() {
  const calls = { invoke: [], downloadMedia: [] };
  const client = {
    _calls: calls,
    async getEntity(peer) {
      if (peer instanceof Api.PeerUser) return fakeUserEntity(peer.userId);
      if (typeof peer === 'number' || typeof peer === 'bigint') return fakeUserEntity(peer);
      if (peer instanceof Api.PeerChannel) {
        return new Api.Channel({ id: peer.channelId, accessHash: BigInt(1), title: 'TestGroup' });
      }
      throw new Error('unknown peer ' + JSON.stringify(peer));
    },
    async getMessages(entity, { ids }) {
      return ids.map(id => makeFakeGramMessage(id));
    },
    async downloadMedia(obj, outputFile, thumb) {
      calls.downloadMedia.push({ obj, thumb });
      return Buffer.from('fake-image-bytes');
    },
    async downloadFile(loc, opts) {
      throw new Error('should not be used when cache present');
    },
    async downloadProfilePhoto() { return Buffer.from('photo'); },
    async invoke(req) {
      calls.invoke.push(req);
      if (req instanceof Api.messages.SetInlineBotResults) return true;
      if (req instanceof Api.messages.SendMedia) {
        const msg = makeFakeGramMessage(500);
        return new Api.UpdateNewMessage({ message: msg, pts: 1, ptsCount: 1 });
      }
      if (req instanceof Api.channels.GetParticipant) {
        return new Api.channels.ChannelParticipant({
          participant: new Api.ChannelParticipantAdmin({
            userId: BigInt(USER_B), adminRights: new Api.ChatAdminRights({}), promotedBy: BigInt(USER_A), date: 0,
          }),
          users: [fakeUserEntity(USER_B)],
          chats: [],
        });
      }
      if (req instanceof Api.channels.EditAdmin) return true;
      return true;
    },
    async getInputEntity(e) { return e; },
    buildReplyMarkup(btns) { return new Api.ReplyInlineMarkup({ rows: [] }); },
    async sendMessage() { throw new Error('not needed'); },
    async sendFile() { throw new Error('not needed'); },
  };
  return client;
}

function makeFakeGramMessage(id, overrides = {}) {
  return new Api.Message(Object.assign({
    id,
    out: false,
    date: Math.floor(Date.now() / 1000),
    message: 'hello world',
    peerId: new Api.PeerChannel({ channelId: BigInt(CHANNEL_ID) }),
    fromId: new Api.PeerUser({ userId: BigInt(USER_A) }),
    replyTo: null,
    entities: [],
    media: null,
  }, overrides));
}

async function testReplyConversion() {
  const bot = new GramJSBot('123:abc');
  bot._client = makeFakeClient();
  // A message that REPLIES to another (this used to throw ReferenceError)
  const replyTarget = makeFakeGramMessage(42, { message: 'original text' });
  bot._client.getMessages = async () => [replyTarget];
  const msg = await bot._convertMessage(makeFakeGramMessage(7, {
    replyTo: new Api.MessageReplyHeader({ replyToMsgId: 42, replyToPeerId: null }),
  }));
  assert.ok(msg, 'message converted');
  assert.strictEqual(msg.chat.id, -Number(`100${CHANNEL_ID}`), 'channel chat id');
  assert.ok(msg.reply_to_message, 'reply_to_message set');
  assert.strictEqual(msg.reply_to_message.message_id, 42);
  assert.strictEqual(msg.reply_to_message.from.id, USER_A, 'reply sender resolved');
  console.log('✓ reply conversion (senderId bug fixed)');
}

async function testServiceMessageJoin() {
  const bot = new GramJSBot('123:abc');
  bot._client = makeFakeClient();
  let gotMessage = null, gotSubtype = null;
  bot.on('message', m => { gotMessage = m; });
  bot.on('new_chat_members', m => { gotSubtype = m; });

  await bot._handleServiceMessage(new Api.MessageService({
    id: 99,
    date: Math.floor(Date.now() / 1000),
    peerId: new Api.PeerChannel({ channelId: BigInt(CHANNEL_ID) }),
    fromId: new Api.PeerUser({ userId: BigInt(USER_A) }),
    action: new Api.MessageActionChatAddUser({ users: [BigInt(USER_B)] }),
  }));

  assert.ok(gotMessage && gotMessage.new_chat_members, 'message with new_chat_members emitted');
  assert.strictEqual(gotMessage.new_chat_members[0].id, USER_B);
  assert.ok(gotSubtype, 'new_chat_members subtype emitted');
  assert.strictEqual(gotMessage.from.id, USER_A, 'adder is from');
  console.log('✓ service message join (welcome trigger restored)');
}

async function testServiceMessageLeave() {
  const bot = new GramJSBot('123:abc');
  bot._client = makeFakeClient();
  let gotSubtype = null;
  bot.on('left_chat_member', m => { gotSubtype = m; });
  await bot._handleServiceMessage(new Api.MessageService({
    id: 100,
    date: Math.floor(Date.now() / 1000),
    peerId: new Api.PeerChannel({ channelId: BigInt(CHANNEL_ID) }),
    fromId: new Api.PeerUser({ userId: BigInt(USER_A) }),
    action: new Api.MessageActionChatDeleteUser({ userId: BigInt(USER_B) }),
  }));
  assert.ok(gotSubtype && gotSubtype.left_chat_member, 'left_chat_member emitted');
  assert.strictEqual(gotSubtype.left_chat_member.id, USER_B);
  console.log('✓ service message leave (goodbye trigger restored)');
}

async function testInlineQuery() {
  const bot = new GramJSBot('123:abc');
  bot._client = makeFakeClient();
  let gotQuery = null;
  bot.on('inline_query', q => { gotQuery = q; });
  await bot._handleInlineQuery(new Api.UpdateBotInlineQuery({
    queryId: BigInt(555), userId: BigInt(USER_A), query: 'quiz abc', offset: '',
  }));
  assert.ok(gotQuery, 'inline_query emitted');
  assert.strictEqual(gotQuery.id, '555');
  assert.strictEqual(gotQuery.query, 'quiz abc');
  assert.strictEqual(gotQuery.from.id, USER_A);

  // answerInlineQuery builds valid MTProto params
  const ok = await bot.answerInlineQuery(gotQuery.id, [{
    type: 'article', id: 'abc', title: 'Share', description: 'd',
    input_message_content: { message_text: '/quiz abc' },
  }]);
  assert.strictEqual(ok, true);
  const req = bot._client._calls.invoke.find(r => r instanceof Api.messages.SetInlineBotResults);
  assert.ok(req, 'SetInlineBotResults invoked');
  assert.strictEqual(req.results[0].sendMessage.message, '/quiz abc');
  console.log('✓ inline query handling + answerInlineQuery');
}

async function testChatMemberUpdate() {
  const bot = new GramJSBot('123:abc');
  bot._client = makeFakeClient();
  let got = null;
  bot.on('chat_member', u => { got = u; });
  await bot._handleRawUpdate(new Api.UpdateChannelParticipant({
    channelId: BigInt(CHANNEL_ID), date: Math.floor(Date.now() / 1000),
    actorId: BigInt(USER_A), userId: BigInt(USER_B),
    prevParticipant: new Api.ChannelParticipantLeft({ userId: BigInt(USER_B), date: 0 }),
    newParticipant: new Api.ChannelParticipant({ userId: BigInt(USER_B), date: 0 }),
    qts: 1,
  }));
  assert.ok(got, 'chat_member emitted');
  assert.strictEqual(got.chat.id, -Number(`100${CHANNEL_ID}`));
  assert.strictEqual(got.old_chat_member.status, 'left');
  assert.strictEqual(got.new_chat_member.status, 'member');
  console.log('✓ chat_member update conversion (moderation trigger restored)');
}

async function testFileCacheDownload() {
  const bot = new GramJSBot('123:abc');
  bot._client = makeFakeClient();
  const photo = new Api.Photo({
    id: BigInt(777), accessHash: BigInt(888), fileReference: Buffer.from('ref'),
    date: 0, sizes: [new Api.PhotoSize({ type: 'x', w: 100, h: 100, size: 500 })], dcId: 2,
  });
  const fileId = bot._buildFileId('photo', photo.id, photo.accessHash, photo.fileReference, photo.sizes[0], photo);
  const link = await bot.getFileLink(fileId);
  assert.ok(link.startsWith('data:image'), 'data URI returned');
  const dl = bot._client._calls.downloadMedia[0];
  assert.strictEqual(dl.obj, photo, 'downloadMedia used the cached Api.Photo');
  const buf = await bot.downloadFile(fileId);
  assert.ok(Buffer.isBuffer(buf) && buf.length > 0);
  console.log('✓ getFileLink/downloadFile via cached media object');
}

async function testSendPollReplyParam() {
  const bot = new GramJSBot('123:abc');
  bot._client = makeFakeClient();
  bot._resolveChat = async () => new Api.Channel({ id: BigInt(CHANNEL_ID), accessHash: BigInt(1), title: 'G' });
  await bot.sendPoll(-1001234, 'Q?', ['a', 'b'], { reply_to_message_id: 42 });
  const req = bot._client._calls.invoke.find(r => r instanceof Api.messages.SendMedia);
  assert.ok(req, 'SendMedia invoked');
  assert.ok(req.replyTo instanceof Api.InputReplyToMessage, 'replyTo is InputReplyToMessage');
  assert.strictEqual(req.replyTo.replyToMsgId, 42);
  assert.ok(req.media instanceof Api.InputMediaPoll);
  console.log('✓ sendPoll reply param valid');
}

async function testMarkupAndCustomTitle() {
  const bot = new GramJSBot('123:abc');
  bot._client = makeFakeClient();
  bot._resolveChat = async () => new Api.Channel({ id: BigInt(CHANNEL_ID), accessHash: BigInt(1), title: 'G' });
  const btns = bot._convertMarkup({ inline_keyboard: [[
    { text: 'A', callback_data: 'cb1' }, { text: 'B', url: 'https://t.me' },
    { text: 'C', switch_inline_query_current_chat: 'quiz ' },
  ]] });
  assert.ok(Array.isArray(btns));
  await bot.setChatAdministratorCustomTitle(-1001234, USER_B, 'Owner');
  const edit = bot._client._calls.invoke.find(r => r instanceof Api.channels.EditAdmin);
  assert.ok(edit, 'EditAdmin invoked');
  assert.strictEqual(edit.rank, 'Owner');
  console.log('✓ markup conversion + setChatAdministratorCustomTitle');
}

async function testOutgoingSkipped() {
  const bot = new GramJSBot('123:abc');
  bot._client = makeFakeClient();
  let emitted = false;
  bot.on('message', () => { emitted = true; });
  await bot._handleNewMessage({ message: makeFakeGramMessage(1, { out: true }) });
  assert.strictEqual(emitted, false, 'own outgoing message skipped');
  await bot._handleNewMessage({ message: makeFakeGramMessage(2, { out: false }) });
  assert.strictEqual(emitted, true, 'incoming message delivered');
  console.log('✓ own outgoing messages skipped (Bot API parity)');
}

(async () => {
  await testReplyConversion();
  await testServiceMessageJoin();
  await testServiceMessageLeave();
  await testInlineQuery();
  await testChatMemberUpdate();
  await testFileCacheDownload();
  await testSendPollReplyParam();
  await testMarkupAndCustomTitle();
  await testOutgoingSkipped();
  console.log('\nALL WRAPPER SMOKE TESTS PASSED ✅');
})().catch(e => { console.error('❌ TEST FAILED:', e); process.exit(1); });
