// Hermes has no crypto.getRandomValues; mera and viem both need it. Import this first.
import { getRandomValues } from "expo-crypto";

const g = globalThis as { crypto?: Partial<Crypto> };
if (!g.crypto) g.crypto = {};
if (!g.crypto.getRandomValues) {
  g.crypto.getRandomValues = getRandomValues as Crypto["getRandomValues"];
}
