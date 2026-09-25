import type { TypedDataDefinition } from "viem";

/**
 * EIP-712 payloads travel between server and app as JSON. bigints become decimal strings on the
 * way out; `hydrateTypedData` turns uint/int fields (per the declared types) back into bigints.
 */
export type TypedDataJson = {
  domain: Record<string, unknown>;
  types: Record<string, readonly { name: string; type: string }[]>;
  primaryType: string;
  message: Record<string, unknown>;
};

export function serializeTypedData(td: TypedDataDefinition | { domain?: unknown; types: unknown; primaryType: string; message: unknown }): TypedDataJson {
  return JSON.parse(JSON.stringify(td, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
}

export function hydrateTypedData(json: TypedDataJson): TypedDataDefinition {
  const fix = (typeName: string, value: Record<string, unknown>): Record<string, unknown> => {
    const fields = json.types[typeName];
    if (!fields) return value;
    const out: Record<string, unknown> = { ...value };
    for (const { name, type } of fields) {
      const v = out[name];
      if (v === undefined) continue;
      if (/^u?int\d*$/.test(type)) out[name] = BigInt(v as string | number);
      else if (json.types[type]) out[name] = fix(type, v as Record<string, unknown>);
    }
    return out;
  };
  const domain = { ...json.domain };
  if (domain.chainId !== undefined) domain.chainId = Number(domain.chainId);
  return {
    domain,
    types: json.types,
    primaryType: json.primaryType,
    message: fix(json.primaryType, json.message),
  } as TypedDataDefinition;
}
