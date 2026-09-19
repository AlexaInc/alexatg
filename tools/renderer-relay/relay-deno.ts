// Deno Deploy version of the render relay (zero config).
// 1. Go to https://dash.deno.com -> New Playground
// 2. Paste this file, Save & Deploy
// 3. On the calling service set: QUOTE_API_URL=https://<your-app>.deno.dev/api/generate

const TARGET = "https://quotlytga-quotecpp.hf.space";

const cors: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  if (req.method === "POST" && (url.pathname === "/api/generate" || url.pathname === "/quote")) {
    try {
      const body = await req.arrayBuffer();
      const upstream = await fetch(TARGET + url.pathname, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      const headers = new Headers(cors);
      headers.set("Content-Type", upstream.headers.get("Content-Type") || "image/png");
      return new Response(upstream.body, { status: upstream.status, headers });
    } catch (e) {
      return new Response("relay error: " + (e as Error).message, {
        status: 502,
        headers: { ...cors, "Content-Type": "text/plain" },
      });
    }
  }

  return new Response("render relay ready\n", {
    status: 200,
    headers: { ...cors, "Content-Type": "text/plain" },
  });
});
