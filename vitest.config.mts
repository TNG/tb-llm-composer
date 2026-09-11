import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // Only the plugin's own suites; without this, standalone `*.test.mjs` scripts elsewhere in the
    // repo (e.g. .claude/hooks) get collected as suites and fail for defining no vitest tests.
    include: ["src/**/*.test.ts"],
    // Optional: for Jest compatibility
    alias: {
      "@/(.*)": "<rootDir>/src/$1",
    },
    setupFiles: ["./src/__tests__/setupVitest.ts"],
  },
});
