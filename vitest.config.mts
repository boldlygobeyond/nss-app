import { fileURLToPath } from "url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Mirrors tsconfig.json's "@/*" -> "./src/*" path alias, which Next.js
    // resolves natively but Vite/Vitest needs told about explicitly.
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    setupFiles: ["./vitest.setup.ts"],
    // Matches production (NEXT_PUBLIC_NSS_ENGINE=bt there too) so
    // SurveyClient.test.tsx exercises the real, currently-live code path
    // rather than the legacy win-rate engine. No other test reads this var.
    env: {
      NEXT_PUBLIC_NSS_ENGINE: "bt",
    },
  },
});
