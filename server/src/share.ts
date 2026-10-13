import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import { SERVER_ROOT } from "./config";
import { formatUsdShort } from "./util";

export type ShareView = {
  kind: "money" | "gift";
  amount: string;
  senderName: string;
  gift?: { brandName?: string };
  status: "waiting" | "opened" | "returned";
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** "Arjun sent you $20" / "Arjun sent you a $25 Starbucks gift card" */
export function shareTitle(v: ShareView): string {
  const amount = formatUsdShort(BigInt(v.amount));
  if (v.kind === "gift") return `${v.senderName} sent you a ${amount}${v.gift?.brandName ? ` ${v.gift.brandName}` : ""} gift card`;
  return `${v.senderName} sent you ${amount}`;
}

export function sharePage(args: {
  code: string;
  view: ShareView | undefined;
  baseUrl: string;
  appStoreUrl?: string;
  playStoreUrl?: string;
  /** Web build of the app; adds "Open in your browser" (claim screen) for people without the app. */
  webAppUrl?: string;
}): string {
  const { code, view, baseUrl } = args;
  const title = view ? shareTitle(view) : "BilbyPay";
  const description = !view
    ? "Send dollars to anyone with just their phone number."
    : view.status === "waiting"
      ? "Open it in BilbyPay. It only takes a minute."
      : view.status === "opened"
        ? "This has already been opened."
        : "This has expired and went back to the sender.";
  const deepLink = `bilbypay://claim/${encodeURIComponent(code)}`;
  const image = `${baseUrl}/og/${encodeURIComponent(code)}.png`;
  const store = args.appStoreUrl || args.playStoreUrl;
  const web = args.webAppUrl ? `${args.webAppUrl}/claim/${encodeURIComponent(code)}` : undefined;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="BilbyPay">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:url" content="${esc(`${baseUrl}/c/${code}`)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:image" content="${esc(image)}">
<meta name="robots" content="noindex">
<style>
  :root { --bg: #FFF7EC; --ink: #2B1D14; --muted: #7A6554; --accent: #E0772B; }
  @media (prefers-color-scheme: dark) { :root { --bg: #1B1410; --ink: #FFF3E6; --muted: #C4AE9A; } }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--bg); color: var(--ink);
    font: 17px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif; padding: 24px 16px; }
  main { max-width: 420px; width: 100%; text-align: center; }
  .brand { font-weight: 700; letter-spacing: -0.02em; color: var(--accent); margin-bottom: 32px; }
  h1 { font-size: 28px; line-height: 1.2; margin: 0 0 12px; letter-spacing: -0.02em; }
  p { color: var(--muted); margin: 0 0 32px; }
  a.button { display: block; background: var(--accent); color: #fff; text-decoration: none; font-weight: 600;
    padding: 16px; border-radius: 14px; margin-bottom: 12px; }
  a.secondary { color: var(--ink); font-size: 15px; }
</style>
</head>
<body>
<main>
  <div class="brand">BilbyPay</div>
  <h1>${esc(title)}</h1>
  <p>${esc(description)}</p>
  ${view?.status === "waiting" ? `<a class="button" href="${esc(deepLink)}">Open in BilbyPay</a>` : ""}
  ${view?.status === "waiting" && web ? `<a class="secondary" href="${esc(web)}">Open in your browser</a>` : ""}
  ${store ? `<a class="secondary" href="${esc(store)}">Don't have the app? Get BilbyPay</a>` : ""}
</main>
</body>
</html>`;
}

// ------------------------------------------------------------------ OG image

let ready: Promise<{ fonts: Uint8Array[] }> | undefined;

/** For builds without a filesystem (the Cloudflare Worker): the resvg module and fonts, bundled. */
export function provideOgAssets(assets: { wasm: WebAssembly.Module; fonts: ArrayBuffer[] }) {
  ready = (async () => {
    await initWasm(assets.wasm);
    return { fonts: assets.fonts.map((f) => new Uint8Array(f)) };
  })();
}

function init() {
  ready ??= (async () => {
    const require = createRequire(import.meta.url);
    await initWasm(readFileSync(require.resolve("@resvg/resvg-wasm/index_bg.wasm")));
    const fonts = ["Inter_400Regular.ttf", "Inter_700Bold.ttf"].map((f) => new Uint8Array(readFileSync(resolve(SERVER_ROOT, "assets/fonts", f))));
    return { fonts };
  })();
  return ready;
}

/** Fits a line to the card: shrink the font for long names instead of overflowing. */
function fitSize(text: string, max: number, widthPx: number): number {
  // Inter bold averages ~0.56em per glyph.
  return Math.max(40, Math.min(max, Math.floor(widthPx / (text.length * 0.56))));
}

export function ogSvg(view: ShareView | undefined): string {
  const amount = view ? formatUsdShort(BigInt(view.amount)) : "";
  const line1 = view ? `${view.senderName} sent you` : "Send dollars to anyone";
  const line2 = view ? (view.kind === "gift" ? `a ${amount}${view.gift?.brandName ? ` ${view.gift.brandName}` : ""} gift card` : amount) : "with just a phone number";
  const s1 = fitSize(line1, 64, 1040);
  const s2 = fitSize(line2, view?.kind === "money" ? 160 : 76, 1040);
  const footer = view?.status === "opened" ? "Already opened" : view?.status === "returned" ? "Returned to sender" : "Tap to open in BilbyPay";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#FFB36B"/>
      <stop offset="1" stop-color="#E0772B"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <circle cx="1080" cy="110" r="220" fill="#FFFFFF" fill-opacity="0.10"/>
  <circle cx="120" cy="600" r="180" fill="#FFFFFF" fill-opacity="0.08"/>
  <text x="80" y="110" font-family="Inter" font-weight="700" font-size="44" fill="#FFFFFF">BilbyPay</text>
  <text x="80" y="${view?.kind === "money" ? 280 : 300}" font-family="Inter" font-weight="400" font-size="${s1}" fill="#FFF7EC">${esc(line1)}</text>
  <text x="80" y="${view?.kind === "money" ? 440 : 400}" font-family="Inter" font-weight="700" font-size="${s2}" fill="#FFFFFF">${esc(line2)}</text>
  <rect x="80" y="500" width="${footer.length * 17 + 64}" height="72" rx="36" fill="#2B1D14" fill-opacity="0.85"/>
  <text x="112" y="547" font-family="Inter" font-weight="700" font-size="30" fill="#FFFFFF">${esc(footer)}</text>
</svg>`;
}

export async function ogPng(view: ShareView | undefined): Promise<Uint8Array> {
  const { fonts } = await init();
  const r = new Resvg(ogSvg(view), { font: { fontBuffers: fonts, defaultFontFamily: "Inter", loadSystemFonts: false }, fitTo: { mode: "width", value: 1200 } });
  return r.render().asPng();
}
