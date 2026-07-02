import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  envDir: "../..",
  build: {
    rollupOptions: {
      onwarn(warning, warn) {
        if (
          warning.code === "INVALID_ANNOTATION" &&
          warning.id?.includes("@hugeicons/core-free-icons")
        ) {
          return;
        }

        warn(warning);
      },
    },
  },
  plugins: [tanstackRouter(), react(), tailwindcss()],
});
