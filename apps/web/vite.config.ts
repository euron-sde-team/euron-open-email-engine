import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

// Public pages (/u unsubscribe, /f subscribe forms, /c confirmation, /w view in
// browser) and the tracking endpoints (/t) are server-rendered by the API. In dev
// and preview they are proxied so a link from this origin works.
const api = process.env.VITE_PROXY_TARGET || "http://localhost:5126";
const publicPaths = ["/u", "/f", "/c", "/w", "/t"];
const proxy = Object.fromEntries(publicPaths.map((p) => [p + "/", { target: api, changeOrigin: false }]));

export default defineConfig({
  plugins: [react()],
  server: { port: 3650, proxy },
  preview: { port: 3650, proxy },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
