import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // MuJoCo WASM and onnxruntime-web are self-hosted via Vite ?url imports
  // (see game.js — "closing the jsDelivr supply-chain surface")
  server: {
    port: 5173,
  },
  build: {
    // Keep the JS/CSS bundle out of dist/assets/: the game's static assets
    // (public/assets/) land there and must keep their historical URLs.
    assetsDir: "bundle",
    chunkSizeWarningLimit: 1500,
  },
});
