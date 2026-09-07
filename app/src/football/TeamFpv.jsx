// Dual first-person vision at the top — red left, blue right.
// Each slot owns an opaque <canvas>; gameApi blits chaser eye-cams into them.
import { useEffect, useRef } from "react";
import Box from "@mui/material/Box";
import { useGame, gameApi } from "../store.js";
import { MONO } from "../theme.js";
import { ANTON, COMIC_INK } from "../ui/comic.jsx";
import { t, teamLabel } from "./i18n.js";

const RED_ACCENT = "#ff4466";
const BLUE_ACCENT = "#4488ff";
const FPV_W = 320;
const FPV_H = 200;

function FpvSlot({ team, locale, canvasRef }) {
  const accent = team === "red" ? RED_ACCENT : BLUE_ACCENT;
  return (
    <Box
      sx={{
        width: "min(14rem, 32vw)",
        pointerEvents: "none",
        border: `2px solid ${accent}`,
        boxShadow: `inset 0 0 0 1px ${COMIC_INK}, 0 8px 24px rgba(0,0,0,0.45)`,
        background: "#0a0a10",
        overflow: "hidden",
      }}
    >
      <Box
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          px: "0.4rem",
          pt: "0.25rem",
          pb: "0.15rem",
          background: "rgba(8,8,12,0.95)",
        }}
      >
        <Box
          sx={{
            fontFamily: ANTON,
            fontSize: "0.58rem",
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: accent,
            lineHeight: 1,
          }}
        >
          {teamLabel(locale, team)}
        </Box>
        <Box
          sx={{
            fontFamily: MONO,
            fontSize: "0.42rem",
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "rgba(255,255,255,0.45)",
            lineHeight: 1,
          }}
        >
          {t(locale, "fpvLabel")}
        </Box>
      </Box>
      <Box
        component="canvas"
        ref={canvasRef}
        width={FPV_W}
        height={FPV_H}
        data-fpv={team}
        sx={{
          display: "block",
          width: "100%",
          height: "auto",
          aspectRatio: `${FPV_W} / ${FPV_H}`,
          background: "#050508",
        }}
      />
    </Box>
  );
}

/**
 * Below the scoreboard / chrome row so Back · SFX · GitHub never sit inside
 * the feed. Canvases receive real eye-cam frames from gameApi.renderTeamFpv.
 */
export default function TeamFpv() {
  const entered = useGame((s) => s.entered);
  const bootDone = useGame((s) => s.bootDone);
  const menuOpen = useGame((s) => s.menuOpen);
  const matchState = useGame((s) => s.matchState);
  const locale = useGame((s) => s.locale) || "en";
  const redRef = useRef(null);
  const blueRef = useRef(null);

  const active = entered && bootDone && !menuOpen && matchState !== "FULLTIME";

  useEffect(() => {
    if (!active) {
      gameApi.setFpvSlots?.(null);
      return undefined;
    }
    const register = () => {
      gameApi.setFpvSlots?.({
        red: redRef.current,
        blue: blueRef.current,
      });
    };
    register();
    // Boot may finish a tick after first paint — re-register once more.
    const t = window.setTimeout(register, 50);
    return () => {
      window.clearTimeout(t);
      gameApi.setFpvSlots?.(null);
    };
  }, [active]);

  if (!active) return null;

  return (
    <Box
      sx={{
        position: "fixed",
        // Clear Back / Scoreboard / GitHub row
        top: "6.85rem",
        left: 0,
        right: 0,
        zIndex: 11,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        px: "max(0.75rem, calc(50% - 24rem))",
        gap: "0.75rem",
        pointerEvents: "none",
      }}
    >
      <FpvSlot team="red" locale={locale} canvasRef={redRef} />
      <Box sx={{ flex: "1 1 10rem", maxWidth: "12rem" }} />
      <FpvSlot team="blue" locale={locale} canvasRef={blueRef} />
    </Box>
  );
}
