import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // Optional: for Jest compatibility
    alias: {
      "@/(.*)": "<rootDir>/src/$1",
    },
  },
});
