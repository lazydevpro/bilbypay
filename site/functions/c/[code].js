import { proxyToApi } from "../_proxy.js";

const escape = (s) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

// Claim link. With the app installed, iOS/Android open the app before this runs (universal/app links).
// Otherwise show the API's share page, or a minimal "open in BilbyPay" page if the API isn't reachable.
export async function onRequestGet(context) {
  const proxied = await proxyToApi(context);
  if (proxied) return proxied;

  const code = escape(String(context.params.code ?? ""));
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>You've got money on BilbyPay</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#fbf6ee;color:#2b2118;
font:17px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}main{max-width:420px;padding:32px 24px;text-align:center}
a{display:inline-block;margin-top:16px;padding:14px 24px;border-radius:999px;background:#2b2118;color:#fff;text-decoration:none}</style>
</head><body><main><img src="/bilby.webp" alt="" width="120" height="120" />
<h1>Someone sent you money</h1><p>Open BilbyPay to claim it.</p>
<a href="bilbypay://c/${code}">Open BilbyPay</a></main></body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
