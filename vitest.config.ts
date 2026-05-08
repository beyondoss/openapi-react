import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    testTimeout: 30_000,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["src/test/setup.ts"],
  },
});
