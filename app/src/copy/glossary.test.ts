// glossary-allow-file — the fixtures below are deliberately bad copy.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { type Finding, scanJson, scanSource } from "./glossary";

const APP_ROOT = join(__dirname, "..", "..");
const SRC = join(APP_ROOT, "src");

/** Developer-only code that never ships in the product UI. */
const EXCLUDED_DIRS = [join(SRC, "dev"), join(SRC, "testing")];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return EXCLUDED_DIRS.includes(path) ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : [];
  });
}

describe("copy rules (spec §3a glossary)", () => {
  it("catches forbidden words in copy but not in code identifiers", () => {
    const sample = `
      import { signIn } from "./account";
      type T = "TransferWithAuthorization";
      const key = "sessionToken";
      const path = "/v1/accounts/register";
      const a = <Text>Your wallet is ready</Text>;
      const b = "Sign in";
      const c = \`Paid \${x} in gas\`;
      const d = { title: "Base" };
      const e = "Designs"; // "design" must not match "sign"
      const f = "Oops, a hash"; // glossary-allow
    `;
    const words = scanSource("sample.tsx", sample).map((f) => f.word);
    expect(words).toEqual(["wallets?", "sign(s|ed|ing|er|ers)?", "gas", "Base"]);
  });

  it("finds no forbidden words anywhere in the app", () => {
    const findings: Finding[] = [];
    for (const file of sourceFiles(SRC)) {
      findings.push(...scanSource(relative(APP_ROOT, file), readFileSync(file, "utf8")));
    }
    findings.push(...scanSource("index.ts", readFileSync(join(APP_ROOT, "index.ts"), "utf8")));
    findings.push(...scanJson("app.json", JSON.parse(readFileSync(join(APP_ROOT, "app.json"), "utf8"))));
    const report = findings.map((f) => `${f.file}:${f.line} "${f.text}" (${f.word})`);
    expect(report).toEqual([]);
  });
});
