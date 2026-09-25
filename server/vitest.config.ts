import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 60_000,
    // The integration suite may compile contracts (forge build) and boots anvil.
    hookTimeout: 600_000,
    pool: "forks",
  },
});
