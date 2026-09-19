# Renderer relay

A ~60-line pass-through proxy for the quote render service. No dependencies,
no auth, nothing stored.

## Why

The render host applies very strict limits to **anonymous requests that
originate from inside its own cloud platform** — such requests receive an
HTTP 429 page before ever reaching the renderer. Calls from anywhere else
get normal limits. So when the calling service runs on the same platform as
the renderer, route the render calls through a tiny relay hosted elsewhere.

## Deploy (pick one, all free)

### Deno Deploy (easiest)

1. Go to <https://dash.deno.com> → **New Playground**
2. Paste the contents of `relay-deno.ts` → **Save & Deploy**
3. You get a URL like `https://your-name.deno.dev`

### Koyeb / Render / Railway / Fly (Node)

1. Create a service from this folder (start command: `node relay-node.js`)
2. You get a URL like `https://your-app.koyeb.app`

## Point the caller at the relay

On the calling service, set a variable/secret:

```
QUOTE_API_URL=https://your-name.deno.dev/api/generate
```

Multiple URLs may be given (comma-separated); they are tried in order before
falling back to the direct endpoint.

## Verify

```
curl -X POST https://your-name.deno.dev/api/generate \
  -H "Content-Type: application/json" \
  -d '{"transparent":true,"messages":[{"text":"relay test","entities":[],"from":{"id":1,"first_name":"Relay"}}]}' \
  -o test.png
```

`test.png` should be a PNG image.
