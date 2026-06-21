import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    env: {
      VITE_API_URL: "/api",
    },
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    coverage: {
      all: true,
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/routeTree.gen.ts", "src/main.tsx"],
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: "coverage",
    },
  },
});
