import { defineConfig } from "vitest/config";

// Unit tests cover pure logic only (API client, demo API, the check before authorizing, money input,
// copy rules, barcodes). Nothing here imports react-native.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
