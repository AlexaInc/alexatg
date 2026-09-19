// Zero-dependency pass-through relay for the render service.
// Deploy on any free host OUTSIDE the renderer's own platform
// (Deno Deploy / Koyeb / Render / Railway / Fly / a VPS) and point the
// calling service's QUOTE_API_URL secret at it.
//
// Why: the render host applies very strict limits to ANONYMOUS requests that
// originate from inside its own cloud platform. Calls from anywhere else
// (like this relay) pass through with normal limits. No auth needed.
//
// Koyeb / Render / Railway / Fly:
//   1. Create a service from this file (start command: node relay-node.js)
//   2. Note the public URL, e.g. https://my-relay.koyeb.app
//   3. On the calling service set: QUOTE_API_URL=https://my-relay.koyeb.app/api/generate

const http = require('http');
const https = require('https');

const PORT = process.env.PORT || 8080;
const TARGET_HOST = process.env.RELAY_TARGET_HOST || 'quotlytga-quotecpp.hf.space';
const PATHS = new Set(['/api/generate', '/quote']);

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  if (req.method === 'POST' && PATHS.has(req.url)) {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const up = https.request(
        {
          hostname: TARGET_HOST,
          path: req.url,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': body.length,
          },
        },
        (ur) => {
          res.writeHead(ur.statusCode || 502, {
            'Content-Type': ur.headers['content-type'] || 'image/png',
            'Access-Control-Allow-Origin': '*',
          });
          ur.pipe(res);
        }
      );
      up.on('error', (e) => {
        res.writeHead(502, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
        res.end('relay error: ' + e.message);
      });
      up.end(body);
    });
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
  res.end('render relay ready\n');
});

server.listen(PORT, () => console.log(`render relay listening on :${PORT} -> ${TARGET_HOST}`));
