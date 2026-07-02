import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    env: {
      VITE_API_URL: "/api",
    },
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    setupFiles: ["./vitest.setup.ts"],
    coverage: {
      all: true,
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "tests/**/*.test.{ts,tsx}",
        "src/routeTree.gen.ts",
        "src/client.tsx",
        "src/server.ts",
        "src/router.tsx",
        "src/styles.css",
        // 1-line route files
        "src/routes/__root.tsx",
        "src/routes/_authed.api-keys.tsx",
        "src/routes/_authed.docs.tsx",
        "src/routes/_authed.index.tsx",
        "src/routes/_authed.logs.tsx",
        "src/routes/_authed.models.tsx",
        "src/routes/_authed.users.tsx",
        "src/routes/_authed.providers.index.tsx",
        "src/routes/_authed.providers.tsx",
        "src/routes/register.tsx",
        // Hard-to-test route components
        "src/routes/login.tsx",
        "src/routes/onboard.tsx",
        "src/routes/_authed.tsx",
        "src/routes/_authed.settings.tsx",
        "src/routes/_authed.providers.$name.models.tsx",
        // Complex UI page components
        "src/modules/dashboard/components/app-shell.tsx",
        "src/modules/dashboard/components/overview-page.tsx",
        "src/modules/docs/docs-page.tsx",
        "src/modules/logs/logs-page.tsx",
        "src/modules/models/models-page.tsx",
        "src/modules/providers/providers-page.tsx",
        "src/modules/providers/provider-models-page.tsx",
        "src/modules/api-keys/api-keys-page.tsx",
        // Types-only files
        "src/modules/auth/types.ts",
      ],
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: "coverage",
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
  },
});
