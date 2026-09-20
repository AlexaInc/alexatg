/**
 * Web front for the service — status page + anonymous AI playground.
 *
 * Served routes:
 *   GET  /             -> status + AI demo page (inline CSS/JS, no external assets)
 *   GET  /api/status   -> JSON status + runtime metrics
 *   GET  /health       -> liveness probe (JSON)
 *   GET  /api/health   -> same as /health
 *   GET  /alive        -> plain-text liveness (legacy compatibility)
 *   POST /api/chat     -> anonymous AI chat demo (rate limited, server-side key)
 *
 * The chat endpoint is safe to expose publicly:
 *   - the AI key never leaves this process (all engine calls are server-side)
 *   - per-IP hourly limit + global daily limit protect the shared quota
 *   - replies are generated STATELESSLY: no conversation row, no history,
 *     no memory, no usage log — nothing is written to any database
 *   - rate limits are in-memory only (reset on restart, never stored)
 *   - nothing sensitive is logged or rendered
 * Configure with env (all optional): WEB_CHAT_ENABLED, WEB_CHAT_HOURLY_LIMIT,
 * WEB_CHAT_DAILY_LIMIT, WEB_CHAT_MAX_LEN.
 */

const http = require('http');

const PORT = process.env.PORT || 7860;
const startedAt = Date.now();
let requestsServed = 0;

const VERSION = '1.2.0';

// ── Chat demo configuration ─────────────────────────────────────────────────
const CHAT_ENABLED = String(process.env.WEB_CHAT_ENABLED || 'true').toLowerCase() !== 'false';
const CHAT_HOURLY_LIMIT = Math.max(1, parseInt(process.env.WEB_CHAT_HOURLY_LIMIT) || 8);   // per IP
const CHAT_DAILY_LIMIT = Math.max(1, parseInt(process.env.WEB_CHAT_DAILY_LIMIT) || 300);   // global
const CHAT_MAX_LEN = Math.max(50, parseInt(process.env.WEB_CHAT_MAX_LEN) || 500);
const HOUR_MS = 60 * 60 * 1000;

// In-memory rate limiting (sufficient for a demo; resets on restart)
const chatHits = new Map(); // ip -> [timestamps]
let globalDay = { date: new Date().toISOString().slice(0, 10), count: 0 };

function uptimeSeconds() {
  return Math.floor((Date.now() - startedAt) / 1000);
}

function uptimeString() {
  const s = uptimeSeconds();
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s % 60}s`;
}

// ── Chat helpers ────────────────────────────────────────────────────────────
function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) return xff.split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

function chatAllowance(ip) {
  const today = new Date().toISOString().slice(0, 10);
  if (globalDay.date !== today) globalDay = { date: today, count: 0 };
  if (globalDay.count >= CHAT_DAILY_LIMIT) {
    return { ok: false, reason: 'The demo has reached its daily limit. Please come back tomorrow.' };
  }

  const now = Date.now();
  const hits = (chatHits.get(ip) || []).filter((t) => now - t < HOUR_MS);
  if (hits.length >= CHAT_HOURLY_LIMIT) {
    const oldest = hits[0];
    const retryMin = Math.max(1, Math.ceil((HOUR_MS - (now - oldest)) / 60000));
    return { ok: false, reason: `Hourly demo limit reached (${CHAT_HOURLY_LIMIT}/h). Try again in ~${retryMin} min.` };
  }

  hits.push(now);
  chatHits.set(ip, hits);
  globalDay.count++;
  return { ok: true, remaining: CHAT_HOURLY_LIMIT - hits.length };
}

function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > maxBytes) {
        reject(new Error('payload too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function handleChat(req, res) {
  const fail = (code, msg) => sendJson(res, code, { error: msg });

  if (!CHAT_ENABLED) return fail(503, 'The AI demo is currently disabled.');

  let body;
  try {
    body = JSON.parse(await readBody(req, 10 * 1024));
  } catch (e) {
    return fail(400, 'Invalid request body.');
  }

  const message = typeof body.message === 'string' ? body.message.trim() : '';

  if (!message) return fail(400, 'Message is required.');
  if (message.length > CHAT_MAX_LEN) return fail(400, `Message too long (max ${CHAT_MAX_LEN} characters).`);
  // Note: a sessionId may be sent by browser clients for UX purposes, but the
  // demo is fully stateless — there is no per-session history to key it to.

  // Engine configured? (aii lazily creates the engine; null means no keys)
  let aii;
  try {
    aii = require('./aii');
  } catch (e) {
    return fail(503, 'The AI demo is not available right now.');
  }
  if (!aii.getEngine()) {
    return fail(503, 'The AI demo is not configured on this deployment.');
  }

  const allowance = chatAllowance(clientIp(req));
  if (!allowance.ok) return fail(429, allowance.reason);

  try {
    // Stateless single-turn call: the reply is generated in one shot and
    // NOTHING is written to any database — no history, no identity, no logs.
    const out = await aii.aiChatEphemeral({ message });
    if (out.error === 'not_configured') {
      return fail(503, 'The AI demo is not configured on this deployment.');
    }
    if (out.error === 'quota') {
      return fail(429, 'The AI demo has reached its usage limit for now — please try again later.');
    }
    if (out.error || !out.reply) {
      return fail(500, 'The assistant could not answer right now — please try again.');
    }
    return sendJson(res, 200, { reply: out.reply, remaining: allowance.remaining });
  } catch (e) {
    console.error('[web] chat error:', e.message || e);
    return fail(500, 'The assistant could not answer right now — please try again.');
  }
}

// ── Page ────────────────────────────────────────────────────────────────────
function renderPage() {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SysSync Core V1</title>
<style>
  :root {
    --bg: #0b1220;
    --card: #121a2b;
    --card2: #0e1626;
    --line: #1e2a41;
    --text: #e6edf7;
    --muted: #8b9bb4;
    --accent: #4ade80;
    --accent2: #38bdf8;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: var(--bg);
    color: var(--text);
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 48px 20px;
  }
  .wrap { width: 100%; max-width: 720px; }
  header { margin-bottom: 28px; }
  .brand {
    display: flex; align-items: center; gap: 12px;
    font-size: 20px; font-weight: 700; letter-spacing: .3px;
  }
  .brand .dot-logo {
    width: 14px; height: 14px; border-radius: 4px;
    background: linear-gradient(135deg, var(--accent2), var(--accent));
    display: inline-block;
  }
  .brand small { color: var(--muted); font-weight: 400; font-size: 13px; margin-left: 4px; }
  .tagline { color: var(--muted); font-size: 14px; margin-top: 8px; }

  .banner {
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 18px 20px;
    display: flex; align-items: center; gap: 14px;
    margin-bottom: 20px;
  }
  .pulse {
    width: 10px; height: 10px; border-radius: 50%;
    background: var(--accent);
    animation: pulse 2s infinite;
    flex: none;
  }
  @keyframes pulse {
    0% { box-shadow: 0 0 0 0 rgba(74, 222, 128, .45); }
    70% { box-shadow: 0 0 0 9px rgba(74, 222, 128, 0); }
    100% { box-shadow: 0 0 0 0 rgba(74, 222, 128, 0); }
  }
  .banner b { font-size: 15px; }
  .banner span { display: block; color: var(--muted); font-size: 13px; margin-top: 2px; }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 14px;
    margin-bottom: 22px;
  }
  .tile {
    background: var(--card2);
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 14px 16px;
  }
  .tile .k { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .8px; }
  .tile .v { font-size: 17px; font-weight: 600; margin-top: 6px; font-variant-numeric: tabular-nums; }

  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .8px; color: var(--muted); margin: 26px 0 10px; }
  .endpoints { border: 1px solid var(--line); border-radius: 10px; overflow: hidden; }
  .ep {
    display: flex; align-items: center; gap: 12px;
    padding: 12px 16px; background: var(--card2);
    border-bottom: 1px solid var(--line);
    font-size: 14px;
  }
  .ep:last-child { border-bottom: none; }
  .method {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11px; font-weight: 700; color: var(--accent2);
    background: rgba(56, 189, 248, .1);
    border: 1px solid rgba(56, 189, 248, .25);
    border-radius: 5px; padding: 2px 7px; flex: none;
  }
  .method.post { color: #fbbf24; background: rgba(251, 191, 36, .1); border-color: rgba(251, 191, 36, .25); }
  .path {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    color: var(--text);
  }
  .ep .desc { margin-left: auto; color: var(--muted); font-size: 12.5px; text-align: right; }

  .chat-card {
    background: var(--card2);
    border: 1px solid var(--line);
    border-radius: 10px;
    overflow: hidden;
  }
  .chat-log {
    height: 300px;
    overflow-y: auto;
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .msg {
    max-width: 82%;
    padding: 9px 13px;
    border-radius: 12px;
    font-size: 14px;
    line-height: 1.5;
    white-space: pre-wrap;
    word-wrap: break-word;
    overflow-wrap: anywhere;
  }
  .msg.user {
    align-self: flex-end;
    background: rgba(56, 189, 248, .12);
    border: 1px solid rgba(56, 189, 248, .3);
    border-bottom-right-radius: 4px;
  }
  .msg.ai {
    align-self: flex-start;
    background: var(--card);
    border: 1px solid var(--line);
    border-bottom-left-radius: 4px;
  }
  .msg.ai.err { border-color: rgba(248, 113, 113, .4); color: #fca5a5; }
  .msg.ai code, .msg.user code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 12.5px;
    background: rgba(11, 18, 32, .7);
    border-radius: 4px;
    padding: 1px 5px;
  }
  .msg.ai b { color: #fff; }
  .typing { display: inline-flex; gap: 4px; padding: 4px 2px; }
  .typing i {
    width: 6px; height: 6px; border-radius: 50%;
    background: var(--muted);
    animation: blink 1.2s infinite;
  }
  .typing i:nth-child(2) { animation-delay: .2s; }
  .typing i:nth-child(3) { animation-delay: .4s; }
  @keyframes blink { 0%, 80%, 100% { opacity: .25; } 40% { opacity: 1; } }
  .chat-row {
    display: flex;
    gap: 10px;
    padding: 12px;
    border-top: 1px solid var(--line);
    background: var(--card);
  }
  .chat-row input {
    flex: 1;
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: 8px;
    color: var(--text);
    font-size: 14px;
    padding: 10px 14px;
    outline: none;
  }
  .chat-row input:focus { border-color: var(--accent2); }
  .chat-row button {
    background: linear-gradient(135deg, var(--accent2), var(--accent));
    border: none;
    border-radius: 8px;
    color: #06121f;
    font-size: 14px;
    font-weight: 700;
    padding: 10px 20px;
    cursor: pointer;
  }
  .chat-row button:disabled { opacity: .5; cursor: default; }
  .chat-note {
    color: var(--muted);
    font-size: 12px;
    padding: 8px 14px 12px;
    background: var(--card);
    border-top: 1px solid var(--line);
  }

  footer { margin-top: 34px; color: var(--muted); font-size: 12.5px; text-align: center; }
  footer code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    background: var(--card2); border: 1px solid var(--line);
    border-radius: 5px; padding: 1px 6px;
  }
</style>
</head>
<body>
  <div class="wrap">
    <header>
      <div class="brand"><span class="dot-logo"></span>SysSync Core <small>v${VERSION}</small></div>
      <div class="tagline">System Synchronization API Service</div>
    </header>

    <div class="banner">
      <span class="pulse"></span>
      <div>
        <b>All Systems Operational</b>
        <span>Service is running and responding to requests</span>
      </div>
    </div>

    <div class="grid">
      <div class="tile"><div class="k">Status</div><div class="v" style="color: var(--accent)">Operational</div></div>
      <div class="tile"><div class="k">Uptime</div><div class="v" id="uptime">—</div></div>
      <div class="tile"><div class="k">Version</div><div class="v">v${VERSION}</div></div>
      <div class="tile"><div class="k">Requests</div><div class="v" id="reqs">—</div></div>
    </div>

    <h2>AI Playground</h2>
    <div class="chat-card">
      <div class="chat-log" id="chatlog">
        <div class="msg ai">Hi! I'm the demo assistant. Ask me anything — anonymous, no account needed.</div>
      </div>
      <div class="chat-row">
        <input id="chatin" maxlength="${CHAT_MAX_LEN}" placeholder="Ask anything…" autocomplete="off">
        <button id="sendbtn">Send</button>
      </div>
      <div class="chat-note">Anonymous demo · nothing is stored · limited to ${CHAT_HOURLY_LIMIT} messages/hour · responses are generated and may be inaccurate</div>
    </div>

    <h2>API Endpoints</h2>
    <div class="endpoints">
      <div class="ep"><span class="method post">POST</span><span class="path">/api/chat</span><span class="desc">AI chat (demo)</span></div>
      <div class="ep"><span class="method">GET</span><span class="path">/api/status</span><span class="desc">Runtime status and metrics</span></div>
      <div class="ep"><span class="method">GET</span><span class="path">/api/health</span><span class="desc">Liveness probe</span></div>
      <div class="ep"><span class="method">GET</span><span class="path">/health</span><span class="desc">Liveness (alias)</span></div>
    </div>

    <footer>SysSync Core V1 &middot; uptime <code id="foot-uptime">—</code></footer>
  </div>

<script>
  function fmt(s) {
    var d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    if (d > 0) return d + 'd ' + h + 'h ' + m + 'm';
    if (h > 0) return h + 'h ' + m + 'm';
    return m + 'm ' + (s % 60) + 's';
  }
  function tick() {
    fetch('/api/status').then(function (r) { return r.json(); }).then(function (j) {
      var u = document.getElementById('uptime'), f = document.getElementById('foot-uptime'), q = document.getElementById('reqs');
      if (u) u.textContent = fmt(j.uptimeSeconds);
      if (f) f.textContent = fmt(j.uptimeSeconds);
      if (q) q.textContent = j.requestsServed.toLocaleString();
    }).catch(function () {});
  }
  tick();
  setInterval(tick, 30000);

  // ── Anonymous AI playground ──────────────────────────────────────────────
  var sessionId;
  try {
    sessionId = sessionStorage.getItem('syssync_demo_session');
    if (!sessionId) {
      sessionId = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()) + String(Date.now()))
        .replace(/[^a-zA-Z0-9]/g, '').slice(0, 24);
      sessionStorage.setItem('syssync_demo_session', sessionId);
    }
  } catch (e) {
    sessionId = 'fallback' + String(Date.now()).slice(-14);
  }

  var log = document.getElementById('chatlog');
  var input = document.getElementById('chatin');
  var sendBtn = document.getElementById('sendbtn');
  var busy = false;

  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  // Light formatting: **bold** / *bold*, _italic_, \`code\`
  function fmtMsg(s) {
    var e = esc(s);
    e = e.replace(/\`\`\`([\\s\\S]*?)\`\`\`/g, '<code>$1</code>');
    e = e.replace(/\`([^\\n]+?)\`/g, '<code>$1</code>');
    e = e.replace(/\\*\\*([^\\n]+?)\\*\\*/g, '<b>$1</b>');
    e = e.replace(/(^|\\s)\\*([^\\n]+?)\\*(?=\\s|$)/g, '$1<b>$2</b>');
    e = e.replace(/(^|\\s)_([^\\n]+?)_(?=\\s|$)/g, '$1<i>$2</i>');
    return e;
  }
  function addMsg(cls, html) {
    var d = document.createElement('div');
    d.className = 'msg ' + cls;
    d.innerHTML = html;
    log.appendChild(d);
    log.scrollTop = log.scrollHeight;
    return d;
  }
  function send() {
    var text = input.value.trim();
    if (!text || busy) return;
    busy = true;
    sendBtn.disabled = true;
    input.value = '';
    addMsg('user', esc(text));
    var t = addMsg('ai typing-html', '<span class="typing"><i></i><i></i><i></i></span>');
    t.className = 'msg ai';
    fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, sessionId: sessionId })
    }).then(function (r) {
      return r.json().then(function (j) { return { ok: r.ok, j: j }; });
    }).then(function (r) {
      t.innerHTML = r.ok ? fmtMsg(r.j.reply || '…') : esc(r.j.error || 'Something went wrong.');
      if (!r.ok) t.classList.add('err');
    }).catch(function () {
      t.innerHTML = 'Network error — please try again.';
      t.classList.add('err');
    }).finally(function () {
      busy = false;
      sendBtn.disabled = false;
      input.focus();
      log.scrollTop = log.scrollHeight;
    });
  }
  sendBtn.addEventListener('click', send);
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); send(); }
  });
</script>
</body>
</html>`;
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    // Allow the public website's status badge to read these endpoints
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  requestsServed++;
  const url = (req.url || '/').split('?')[0];

  // CORS preflight for browser clients: the public website's chat demo sends
  // a JSON POST, which makes the browser ask for permission (OPTIONS) before
  // the real request. Answer it once, cacheably, for any origin.
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    });
    return res.end();
  }

  if (url === '/api/chat') {
    if (req.method !== 'POST') return sendJson(res, 405, { status: 'error', error: 'method not allowed' });
    return handleChat(req, res).catch((e) => {
      console.error('[web] chat handler crash:', e.message || e);
      try { sendJson(res, 500, { error: 'Internal error.' }); } catch (e2) { /* headers sent */ }
    });
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return sendJson(res, 405, { status: 'error', error: 'method not allowed' });
  }

  if (url === '/' || url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(req.method === 'HEAD' ? undefined : renderPage());
  }

  if (url === '/api/status') {
    return sendJson(res, 200, {
      status: 'ok',
      service: 'syssync-core',
      version: VERSION,
      uptimeSeconds: uptimeSeconds(),
      uptime: uptimeString(),
      requestsServed,
      timestamp: new Date().toISOString(),
    });
  }

  if (url === '/health' || url === '/api/health') {
    return sendJson(res, 200, { status: 'ok', uptime: uptimeString() });
  }

  if (url === '/alive') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    return res.end('alive');
  }

  return sendJson(res, 404, { status: 'error', error: 'not found' });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Web server running on port ${PORT} (chat demo ${CHAT_ENABLED ? 'enabled' : 'disabled'})`);
});

module.exports = server;
