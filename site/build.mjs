// Builds site/dist for Cloudflare Pages: static files + the two passkey / app-link association files.
// The association files come from server/public/.well-known (single source of truth); their placeholders are
// filled from site/signing.json (public values: they end up in the served files anyway), overridable by env:
//   APPLE_TEAM_ID         10-char Apple team ID (developer.apple.com → Membership)
//   ANDROID_CERT_SHA256   comma-separated SHA-256 signing-cert fingerprints (AA:BB:...), e.g. from `eas credentials`
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, "dist");
const templates = resolve(here, "../server/public/.well-known");
const signing = JSON.parse(readFileSync(resolve(here, "signing.json"), "utf8"));

const teamId = (process.env.APPLE_TEAM_ID ?? signing.appleTeamId ?? "").trim();
const fingerprints = (process.env.ANDROID_CERT_SHA256?.split(",") ?? signing.androidCertSha256 ?? [])
  .map((s) => s.trim().toUpperCase())
  .filter(Boolean);

if (teamId && !/^[A-Z0-9]{10}$/.test(teamId)) throw new Error(`APPLE_TEAM_ID looks wrong: ${teamId}`);
for (const f of fingerprints) {
  if (!/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(f)) throw new Error(`ANDROID_CERT_SHA256 entry looks wrong: ${f}`);
}

rmSync(dist, { recursive: true, force: true });
mkdirSync(resolve(dist, ".well-known"), { recursive: true });
cpSync(resolve(here, "static"), dist, { recursive: true });

const aasa = readFileSync(resolve(templates, "apple-app-site-association"), "utf8").replaceAll(
  "REPLACE_WITH_APPLE_TEAM_ID",
  teamId || "REPLACE_WITH_APPLE_TEAM_ID",
);
writeFileSync(resolve(dist, ".well-known/apple-app-site-association"), aasa);

const links = JSON.parse(readFileSync(resolve(templates, "assetlinks.json"), "utf8"));
for (const entry of links) entry.target.sha256_cert_fingerprints = fingerprints;
writeFileSync(resolve(dist, ".well-known/assetlinks.json"), `${JSON.stringify(links, null, 2)}\n`);

if (!teamId) console.warn("warn: APPLE_TEAM_ID not set — iOS passkeys/universal links will not work on this deploy");
if (!fingerprints.length) console.warn("warn: ANDROID_CERT_SHA256 not set — Android passkeys/app links will not work on this deploy");
console.log(`built ${dist}`);
