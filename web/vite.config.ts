import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const hwt = fileURLToPath(new URL("../packages/hwt/src/index.ts", import.meta.url));

export default defineConfig({
  // Served at https://app.fit.joyorogo.com/studio/ (see wrangler.jsonc and worker/index.ts).
  base: "/studio/",
  plugins: [tailwindcss(), react(), cloudflare()],
  resolve: {
    alias: { "@joyofit/hwt": hwt, "@": fileURLToPath(new URL("./src", import.meta.url)) },
    // One React for the whole bundle. A web/node_modules missing a package (e.g. react-i18next) lets Vite resolve it from the
    // repo root, which brings the root's React too; two Reacts crash the page on the first hook ("reading 'useContext'").
    dedupe: ["react", "react-dom", "react-i18next", "i18next"],
  },
  server: { port: 3100, fs: { allow: [".."] } },
});
