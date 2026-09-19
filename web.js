/**
 * Web front for the service — a clean, self-contained status/landing page.
 *
 * Served routes:
 *   GET /             -> status page (inline CSS/JS, no external assets)
 *   GET /health       -> liveness probe (JSON)
 *   GET /api/health   -> same as /health
 *   GET /api/status   -> JSON status + runtime metrics
 *   GET /alive        -> plain-text liveness (legacy compatibility)
 *
 * Everything is generated in-process; no files read, no external requests,
 * no secrets involved.
 */

const http = require('http');

const PORT = process.env.PORT || 7860;
const startedAt = Date.now();
let requestsServed = 0;

const VERSION = '1.0.0';

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
    box-shadow: 0 0 0 0 rgba(74, 222, 128, .5);
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
  .path {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    color: var(--text);
  }
  .ep .desc { margin-left: auto; color: var(--muted); font-size: 12.5px; text-align: right; }

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
        <span id="status-sub">Service is running and responding to requests</span>
      </div>
    </div>

    <div class="grid">
      <div class="tile"><div class="k">Status</div><div class="v" style="color: var(--accent)">Operational</div></div>
      <div class="tile"><div class="k">Uptime</div><div class="v" id="uptime">—</div></div>
      <div class="tile"><div class="k">Version</div><div class="v">v${VERSION}</div></div>
      <div class="tile"><div class="k">Requests</div><div class="v" id="reqs">—</div></div>
    </div>

    <h2>API Endpoints</h2>
    <div class="endpoints">
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
</script>
</body>
</html>`;
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  requestsServed++;
  const url = (req.url || '/').split('?')[0];

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
  console.log(`Web server running on port ${PORT}`);
});

module.exports = server;
