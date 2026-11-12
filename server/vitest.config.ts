import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations("./migrations");
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          // JOYOROGO_AUTH_URL is pinned: a local `.dev.vars` (for `wrangler dev` against a local JoyoRogo) must not change what the tests assert.
          bindings: { TEST_MIGRATIONS: migrations, JOYOROGO_AUTH_URL: "https://api.joyorogo.com", STRAVA_CLIENT_SECRET: "test-client-secret", STRAVA_WEBHOOK_VERIFY_TOKEN: "test-verify-token", ATUR_ORIGIN: "https://atur.test", ATUR_BOARD_TOKEN: "pk_fb_test", ATUR_IDENTIFY_SECRET: "test-atur-identify-secret" },
        },
      }),
    ],
    test: { setupFiles: ["./test/apply-migrations.ts"] },
  };
});
