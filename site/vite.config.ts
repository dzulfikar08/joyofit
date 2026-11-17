import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

import { fetchJoyoPrice } from "./src/joyo-price.ts";
import { headTags, normalizePath } from "./src/seo.ts";

/**
 * Fills index.html's <!--seo-head--> for the dev server, which serves one
 * shell for every URL. The build leaves the marker for scripts/prerender.ts,
 * which writes each route's head and body.
 */
function devSeoHead(): Plugin {
  return {
    name: "joyofit-dev-seo-head",
    apply: "serve",
    transformIndexHtml(html, ctx) {
      if (!html.includes("<!--seo-head-->")) return html;
      const path = normalizePath((ctx.originalUrl ?? "/").split(/[?#]/)[0]!);
      return html.replace("<!--seo-head-->", () => headTags(path));
    },
  };
}

/**
 * /ride is its own HTML entry (ride.html) so three.js and the game never touch the landing bundle. Production
 * serves dist/ride.html at /ride (html_handling auto-trailing-slash); the dev server needs the same mapping.
 */
function rideRoute(): Plugin {
  return {
    name: "joyofit-ride-route",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        if (req.url && /^\/ride\/?(\?|$)/.test(req.url)) req.url = req.url.replace(/^\/ride\/?/, "/ride.html");
        next();
      });
    },
  };
}

export default defineConfig(async () => ({
  // Joyo Pro price for the page, read from api.joyorogo.com at build time (src/joyo-price.ts), so it follows the ladder.
  define: { __JOYO_PRICE__: JSON.stringify(await fetchJoyoPrice()) },
  plugins: [tailwindcss(), react(), devSeoHead(), rideRoute()],
  server: {
    // The game imports the phone app's protocol and physics (src/features/ride) so there is one copy of each.
    fs: { allow: [".."] },
  },
  build: {
    // The ride entry carries three.js (about 175 kB gzip); the landing entry stays far below this.
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        ride: resolve(import.meta.dirname, "ride.html"),
      },
    },
  },
}));
