import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "fs";

// The two boot-critical WASM binaries (MuJoCo ~9.6MB, ORT ~13MB) are the
// largest first-load downloads and only get requested after the JS bundle
// boots. They ship as hashed assets (e.g. bundle/mujoco-Mp9KyG2b.wasm), so
// their URLs can't be hardcoded in index.html — this plugin discovers them
// from the build bundle at the final transformIndexHtml pass. It also
// preloads the non-hashed kinematics.json (whose ?v= cache-buster is read
// straight from MESH_VERSION in src/game/duck.js so the two can't drift).
// Rather than emit <link> tags directly, it injects a small guard script
// that skips the preload entirely on the ?soundboard=1 route — that route
// never loads the game bundle, so preloading 22.6MB there is pure waste.
// crossOrigin is mandatory: nginx.conf serves with COEP require-corp, and
// the WASM fetch is a CORS-mode request.
// Only .wasm engine binaries are preloaded (the endsWith filter below).
// ONNX policy files (.onnx) are deliberately not preloaded: signed()
// appends ?__sign on HF, which would make the preload URL mismatch the
// actual fetch and waste the download.
const WASM_PRELOAD_PREFIXES = ["mujoco-", "ort-wasm-simd-threaded-"];

function wasmPreloadPlugin() {
  return {
    name: "wasm-preload",
    applyToEnvironment() {
      return true;
    },
    transformIndexHtml(html, ctx) {
      // Only the final generation pass carries bundle info; earlier
      // dev/serve-time passes have none and must be no-ops.
      if (!ctx.bundle) return;

      const hrefs = [];
      for (const fileName of Object.keys(ctx.bundle)) {
        const base = fileName.split("/").pop();
        if (
          fileName.endsWith(".wasm") &&
          WASM_PRELOAD_PREFIXES.some((p) => base.startsWith(p))
        ) {
          hrefs.push(`/${fileName}`);
        }
      }

      // kinematics.json is non-hashed, so its URL is stable — but the ?v=
      // cache-buster must track MESH_VERSION in src/game/duck.js. Read it
      // from source instead of hardcoding a second literal, so a version
      // bump can't leave a stale preload that misses the real fetch.
      const meshVersion = /MESH_VERSION\s*=\s*"(\d+)"/.exec(
        readFileSync("src/game/duck.js", "utf8")
      )[1];
      hrefs.push(`/robot/mjlab/kinematics.json?v=${meshVersion}`);

      // Inject a guard script instead of raw <link> tags: the soundboard
      // route never loads the game bundle, so preloading these there would
      // waste 22.6MB. Only create the preload links off that route.
      const tags = [
        {
          tag: "script",
          children: `if(!/[?&]soundboard=1/.test(location.search)){for(const h of ${JSON.stringify(
            hrefs
          )}){const l=document.createElement("link");l.rel="preload";l.as="fetch";l.type="application/wasm";l.crossOrigin="anonymous";l.href=h;document.head.appendChild(l)}}`,
          injectTo: "head",
        },
      ];
      return { html, tags };
    },
  };
}

export default defineConfig({
  plugins: [react(), wasmPreloadPlugin()],
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
