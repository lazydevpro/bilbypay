// glossary-allow-file — this file defines the forbidden words.
import ts from "typescript";

/**
 * Spec §3a: words the UI never uses. Case-insensitive whole words unless marked case-sensitive
 * (so "base units" in a comment or "Mon" as a weekday don't trip it, but "Base" or "MON" do).
 */
export const FORBIDDEN: Array<{ word: string; re: RegExp }> = [
  ...[
    "chains?", "gas", "tokens?", "transactions?", "tx", "hash(es)?", "swap(s|ped|ping)?", "bridg(e|es|ed|ing)",
    "wallets?", "address(es)?", "stak(e|es|ed|ing)", "apy", "yields?", "sign(s|ed|ing|er|ers)?", "signatures?",
    "seed( phrase)?s?", "crypto(currency)?", "blockchains?", "monad", "fixed deposits?", "interest", "savings",
    "guaranteed?", "stablecoins?", "escrow", "aave", "vaults?", "slippage", "approve",
  ].map((w) => ({ word: w, re: new RegExp(`\\b${w}\\b`, "i") })),
  ...["Base", "AUSD", "USDC", "MON", "FD"].map((w) => ({ word: w, re: new RegExp(`\\b${w}\\b`) })),
];

export type Finding = { file: string; line: number; text: string; word: string };

export function forbiddenIn(text: string): string | null {
  for (const { word, re } of FORBIDDEN) if (re.test(text)) return word;
  return null;
}

/**
 * Code identifiers (object keys, route paths, storage keys, EIP-712 type names…) are not copy.
 * A single capitalised word ("Base", "Wallet") or anything with a space is treated as copy.
 */
export function looksLikeIdentifier(s: string): boolean {
  if (/\s/.test(s)) return false;
  if (!/[A-Za-z]/.test(s)) return true;
  if (/^(https?:|\/|\.\.?\/|@|#|[a-z]+:\/\/)/.test(s)) return true;
  if (/^[a-z][a-z0-9_]*$/.test(s)) return true; // lowercase id or key
  if (/^[a-z]+[A-Z][A-Za-z0-9]*$/.test(s)) return true; // camelCase
  if (/^[A-Z][a-z0-9]+[A-Z][A-Za-z0-9]*$/.test(s)) return true; // PascalCase with 2+ humps
  if (/^[A-Z0-9]+_[A-Z0-9_]+$/.test(s)) return true; // ERROR_CODE
  if (/[._:/=]/.test(s) && !/[!?,]$/.test(s)) return true; // dotted keys, urls, mime types
  return false;
}

/** Scans one TS/TSX source for UI-visible strings (literals, template text, JSX text) using forbidden words. */
export function scanSource(file: string, source: string): Finding[] {
  if (/glossary-allow-file/.test(source)) return [];
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const lines = source.split("\n");
  const findings: Finding[] = [];

  const allowed = (line: number) => /glossary-allow\b/.test(lines[line] ?? "") || /glossary-allow\b/.test(lines[line - 1] ?? "");

  const check = (node: ts.Node, text: string, identifierCheck: boolean) => {
    const t = text.trim();
    if (!t) return;
    if (identifierCheck && looksLikeIdentifier(t)) return;
    const word = forbiddenIn(t);
    if (!word) return;
    const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line;
    if (allowed(line)) return;
    findings.push({ file, line: line + 1, text: t, word });
  };

  const visit = (node: ts.Node) => {
    // Module specifiers, type-level literals and property names are code, not copy.
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isLiteralTypeNode(node)) return;
    if (ts.isPropertyAssignment(node)) {
      visit(node.initializer); // the key is code; the value may be copy
      return;
    }
    if (ts.isElementAccessExpression(node)) {
      visit(node.expression);
      return;
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) check(node, node.text, true);
    else if (ts.isTemplateExpression(node)) {
      check(node, [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join(" … "), false);
    } else if (ts.isJsxText(node)) check(node, node.text, false);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return findings;
}

/** Scans a JSON config (app.json) for user-visible string values. */
export function scanJson(file: string, json: unknown): Finding[] {
  const findings: Finding[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string") {
      if (!looksLikeIdentifier(v)) {
        const word = forbiddenIn(v);
        if (word) findings.push({ file, line: 0, text: v, word });
      }
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(json);
  return findings;
}
