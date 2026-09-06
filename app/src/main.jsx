import { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import { theme } from "./theme.js";

// ?soundboard=1: standalone audio A/B experiment page instead of the game
// (lazy on both sides so the soundboard never pulls the game bundle in).
const params = new URLSearchParams(location.search);
const App = params.get("soundboard") === "1"
  ? lazy(() => import("./ui/Soundboard.jsx"))
  : params.get("mode") === "football"
    ? lazy(() => import("./football/FootballApp.jsx"))
    : lazy(() => import("./App.jsx"));

// Build tag: bump to change the bundle's content hash, e.g. to bust a stale
// edge-cached asset URL on the HF Space.
const BUILD_TAG = "2026-08-25";
console.info(`Microduck Arena build ${BUILD_TAG}`);

// No StrictMode: the game core is a heavyweight singleton (MuJoCo WASM,
// ONNX sessions, WebRTC room) and dev double-mounting would double-boot it.
createRoot(document.getElementById("root")).render(
  <ThemeProvider theme={theme}>
    <CssBaseline />
    <Suspense fallback={null}>
      <App />
    </Suspense>
  </ThemeProvider>,
);
