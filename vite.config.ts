import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

const apiPort = process.env.VITE_API_PORT || "3001";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // server.ts serves static files from ./dist-vite (and the SPA fallback in
  // routes/index.ts sends dist-vite/index.html) — Vite's default `dist`
  // output never matched that, so the built frontend was never actually
  // reachable through the server until this was set explicitly.
  build: {
    outDir: "dist-vite",
  },
  server: {
    port: parseInt(process.env.VITE_PORT || "3000"),
    proxy: {
      "/api": {
        target: `http://localhost:${apiPort}`,
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 4173,
    proxy: {
      "/api": {
        target: `http://localhost:${apiPort}`,
        changeOrigin: true,
      },
    },
  },
});
