// In-game HUD: Back (top-left), pre-order button (top-right, label flips
// to "Pre-order pack" while rollers are selected - the rollers ship in the
// accessory pack) with the GitHub link stacked under it (same SHOP / CODE
// column as the title screen), quickbar (bottom-left: colour palette +
// loco switch), telemetry stack (bottom-right) and the LOADING ROLLERS
// line while the roller stack streams in.
//
// Chrome reads as small comic PANELS: each group sits in a thick cream
// keyline frame on a dark glass plate (1px ink inset between glass and
// frame), with a caption box (cartouche) overlapping the frame's corner -
// flat cream (orange for the shop CTA) fill, ink keyline, hard 2px offset
// shadow, half in / half out like a caption on a comic panel's edge. Same
// tokens as the landing (Anton, orange, cream), zero radius everywhere.
// Title-menu CTAs stay ComicButton.
//
// Whole HUD is hidden while the title/pause overlay is up; touch mode
// strips it down to the thumbs + Back.
import { useEffect, useRef, useState } from "react";
import Box from "@mui/material/Box";
import { keyframes } from "@mui/material/styles";
import { useGame, gameApi } from "../store.js";
import { VARIANT_LABELS, VARIANT_SWATCH_HEX } from "../game/variants.js";
import { uiClick, isMuted, setMuted } from "../game/audio.js";
import { ORANGE, MONO } from "../theme.js";
import { ANTON, COMIC_INK, CREAM } from "./comic.jsx";
import { GitHubLink } from "./GitHubLink.jsx";

// Matrix-style letter scramble: on change every glyph flips through random
// charset entries, then locks to its target left-to-right over ~0.45 s.
// Monospace keeps the width stable mid-scramble.
const SCRAMBLE_GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&*<>/=+";
function useScramble(target) {
  const [text, setText] = useState(target.toUpperCase());
  const timer = useRef(null);
  const shown = useRef(target.toUpperCase());
  useEffect(() => {
    const t = target.toUpperCase();
    if (shown.current === t) return;
    shown.current = t;
    if (timer.current) clearInterval(timer.current);
    const n = t.length;
    const DUR = 450; // ms until the last letter locks
    const rnd = () => SCRAMBLE_GLYPHS[(Math.random() * SCRAMBLE_GLYPHS.length) | 0];
    const t0 = performance.now();
    timer.current = setInterval(() => {
      const k = Math.floor(((performance.now() - t0) / DUR) * n);
      if (k >= n) {
        clearInterval(timer.current);
        timer.current = null;
        setText(t);
        return;
      }
      let out = t.slice(0, k);
      for (let i = k; i < n; i++) out += rnd();
      setText(out);
    }, 40);
    return () => timer.current && clearInterval(timer.current);
  }, [target]);
  return text;
}

const recBlink = keyframes`
  0%, 58% { opacity: 1; }
  59%, 100% { opacity: 0.12; }
`;

const chipPop = keyframes`
  0% { transform: scale(0.86); }
  55% { transform: scale(1.1); }
  100% { transform: scale(1); }
`;

const HUD_H = 48;
const FRAME_W = 2; // cream keyline thickness
const PANEL_PAD = 5; // air between the frame and the printed content
// Height left for the cells inside frame + padding; colour swatches use it
// as their width too so they stay square.
const CELL_H = HUD_H - 2 * (FRAME_W + PANEL_PAD);
const CELL_GAP = 4; // gap between cells; the glass ground shows through
const FRAME = "rgba(250, 248, 242, 0.9)";
const GLASS = "rgba(8, 8, 12, 0.6)";

// The panel frame: a thick cream keyline (comic ink weight, HUD read)
// around a dark glass plate, with a 1px ink inset between frame and glass
// so it reads like a printed panel, and a few px of glass padding so the
// content has air inside the frame (the glass ground fills the padding).
// The inset is a pseudo-element so it draws over the cells (an inset
// box-shadow would be painted under them). Overflow clipping lives on the
// inner content wrapper, not the plate, so the caption box can hang over
// the frame's corner.
const plateSx = {
  position: "relative",
  display: "inline-flex",
  height: HUD_H,
  boxSizing: "border-box",
  border: `${FRAME_W}px solid ${FRAME}`,
  padding: `${PANEL_PAD}px`,
  borderRadius: 0,
  background: GLASS,
  "&::after": {
    content: '""',
    position: "absolute",
    inset: 0,
    pointerEvents: "none",
    zIndex: 2,
    boxShadow: `inset 0 0 0 1px ${COMIC_INK}`,
  },
};

// Caption box (cartouche) printed over the panel's top corner, half in /
// half out - the landing's print language: flat fill, ink keyline, hard
// offset shadow, zero radius. Decorative only: no pointer events, no
// layout footprint (absolute over the frame).
const CAPTION_FILLS = { cream: CREAM, orange: ORANGE };
const captionBaseSx = {
  position: "absolute",
  top: -9,
  zIndex: 3,
  pointerEvents: "none",
  userSelect: "none",
  whiteSpace: "nowrap",
  fontFamily: ANTON,
  fontSize: "0.58rem",
  letterSpacing: "0.09em",
  textTransform: "uppercase",
  lineHeight: 1,
  padding: "3px 6px 2px",
  color: COMIC_INK,
  border: `2px solid ${COMIC_INK}`,
  borderRadius: 0,
  boxShadow: `2px 2px 0 ${COMIC_INK}`,
};

function HudPlate({ caption, captionSide = "left", captionFill = "cream", children, sx }) {
  return (
    <Box sx={{ ...plateSx, ...sx }}>
      <Box
        sx={{
          display: "inline-flex",
          alignItems: "stretch",
          height: "100%",
          overflow: "hidden",
        }}
      >
        {children}
      </Box>
      {caption ? (
        <Box
          aria-hidden
          sx={{
            ...captionBaseSx,
            background: CAPTION_FILLS[captionFill],
            ...(captionSide === "right" ? { right: -8 } : { left: -8 }),
          }}
        >
          {caption}
        </Box>
      ) : null}
    </Box>
  );
}

// Speaker icon in the same square-stroke language as the back arrow:
// body + cone always, waves when live, a hard ink cross when muted.
function SpeakerIcon({ muted }) {
  return (
    <Box
      component="svg"
      viewBox="0 0 24 24"
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth={2.25}
      strokeLinecap="square"
      strokeLinejoin="miter"
      sx={{ width: "1.05em", height: "1.05em", display: "block", flex: "none" }}
    >
      <path d="M4 9h4l5-4v14l-5-4H4z" />
      {muted ? (
        <path d="M16 9l6 6M22 9l-6 6" />
      ) : (
        <>
          <path d="M16 9.5a3.5 3.5 0 0 1 0 5" />
          <path d="M18.5 7a7 7 0 0 1 0 10" />
        </>
      )}
    </Box>
  );
}

function BackArrowIcon() {
  return (
    <Box
      component="svg"
      viewBox="0 0 24 24"
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth={2.25}
      strokeLinecap="square"
      strokeLinejoin="miter"
      sx={{ width: "0.95em", height: "0.95em", display: "block", flex: "none" }}
    >
      <path d="M20 12H6" />
      <path d="M12 5l-7 7 7 7" />
    </Box>
  );
}

const hudHitSx = {
  appearance: "none",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "0.45em",
  height: "100%",
  px: "0.95rem",
  margin: 0,
  border: "none",
  borderRadius: 0,
  background: "transparent",
  color: CREAM,
  cursor: "pointer",
  fontFamily: ANTON,
  fontSize: "0.92rem",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  textDecoration: "none",
  lineHeight: 1,
  whiteSpace: "nowrap",
  WebkitTapHighlightColor: "transparent",
  userSelect: "none",
  transition: "background 0.15s ease, color 0.15s ease, filter 0.15s ease",
  "&:focus-visible": {
    outline: `2px dashed ${CREAM}`,
    outlineOffset: -5,
  },
};

function BackButton() {
  return (
    <HudPlate
      caption="Nav"
      sx={{ position: "fixed", top: "1.25rem", left: "1.5rem", zIndex: 10 }}
    >
      <Box
        component="button"
        type="button"
        onClick={() => { uiClick(); useGame.setState({ menuOpen: true }); }}
        sx={{
          ...hudHitSx,
          "&:hover": {
            color: ORANGE,
            background: "rgba(255, 122, 47, 0.12)",
          },
          "&:active": { filter: "brightness(0.92)" },
        }}
      >
        <BackArrowIcon /> Back
      </Box>
    </HudPlate>
  );
}

export const SHOP_URL = "https://store.pollen-robotics.com/collections/microduck";

// Exported: the title/pause overlay renders the same plate in the same
// spot, so the pause fade reads as the button staying put, not two
// different buttons swapping.
export function PreorderButton({ sx }) {
  const locoWant = useGame((s) => s.locoWant);
  const text = useScramble(locoWant === "rollers" ? "Pre-order pack" : "Pre-order");
  return (
    <HudPlate
      caption="Shop"
      captionSide="right"
      captionFill="orange"
      sx={{ position: "fixed", top: "1.25rem", right: "1.5rem", zIndex: 10, ...sx }}
    >
      <Box
        component="a"
        href={SHOP_URL}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => uiClick()}
        sx={{
          ...hudHitSx,
          background: ORANGE,
          color: COMIC_INK,
          "&:hover": { filter: "brightness(1.07)" },
          "&:active": { filter: "brightness(0.92)" },
        }}
      >
        {text}
      </Box>
    </HudPlate>
  );
}

function Quickbar() {
  const variant = useGame((s) => s.variant);
  const locoWant = useGame((s) => s.locoWant);
  return (
    <Box
      sx={{
        position: "fixed",
        bottom: "1.25rem",
        left: "1.5rem",
        zIndex: 10,
        display: "flex",
        flexWrap: "wrap",
        alignItems: "flex-end",
        gap: "0.85rem",
        maxWidth: "calc(100vw - 14.5rem)",
      }}
    >
      <HudPlate caption="Color">
        <Box
          role="group"
          aria-label="Duck colours"
          sx={{
            display: "inline-flex",
            alignItems: "stretch",
            height: "100%",
            gap: `${CELL_GAP}px`,
          }}
        >
          {Object.entries(VARIANT_SWATCH_HEX).map(([name, hex]) => {
            const selected = name === variant;
            const label = VARIANT_LABELS[name] ?? name;
            return (
              <Box
                key={name}
                component="button"
                type="button"
                title={label}
                aria-label={`${label} colours`}
                aria-pressed={selected}
                onClick={() => { uiClick(); gameApi.setVariant?.(name); }}
                sx={{
                  appearance: "none",
                  width: CELL_H, // square cell inside frame + padding
                  height: "100%",
                  p: 0,
                  background: hex,
                  border: "none",
                  borderRadius: 0,
                  cursor: "pointer",
                  WebkitTapHighlightColor: "transparent",
                  boxShadow: selected ? `inset 0 0 0 2px ${CREAM}` : "none",
                  opacity: selected ? 1 : 0.7,
                  animation: selected ? `${chipPop} 0.28s ease` : "none",
                  transition: "opacity 0.15s ease, box-shadow 0.15s ease",
                  "&:hover": { opacity: 1 },
                  "&:active": { animation: "none", filter: "brightness(0.92)" },
                  "&:focus-visible": {
                    outline: `2px dashed ${CREAM}`,
                    outlineOffset: -5,
                  },
                  "@media (prefers-reduced-motion: reduce)": { animation: "none" },
                }}
              />
            );
          })}
        </Box>
      </HudPlate>
      <HudPlate caption="Mode">
        <Box
          role="group"
          aria-label="Locomotion mode"
          sx={{
            display: "inline-flex",
            alignItems: "stretch",
            height: "100%",
            gap: `${CELL_GAP}px`,
          }}
        >
          {[
            { name: "legs", label: "Feet" },
            { name: "rollers", label: "Rollers" },
          ].map(({ name, label }) => {
            const selected = locoWant === name;
            return (
              <Box
                key={name}
                component="button"
                type="button"
                aria-pressed={selected}
                onClick={() => { uiClick(); gameApi.requestLoco?.(name); }}
                sx={{
                  ...hudHitSx,
                  px: "1.05rem",
                  background: selected ? ORANGE : "transparent",
                  color: selected ? COMIC_INK : "rgba(250, 248, 242, 0.72)",
                  "&:hover": {
                    color: selected ? COMIC_INK : CREAM,
                    background: selected ? ORANGE : "rgba(255, 122, 47, 0.12)",
                  },
                  "&:active": { filter: "brightness(0.92)" },
                }}
              >
                {label}
              </Box>
            );
          })}
        </Box>
      </HudPlate>
      <SoundToggle />
    </Box>
  );
}

// Mute / unmute panel: same cartouche language as the other groups. The
// toggle ramps audio.js's master gain (~50 ms) and persists; unmuting
// plays the HUD click as confirmation (muting stays silent, obviously).
function SoundToggle() {
  const [muted, setMutedState] = useState(isMuted);
  const toggle = () => {
    const next = !muted;
    setMuted(next);
    setMutedState(next);
    if (!next) uiClick();
  };
  return (
    <HudPlate caption="Sound">
      <Box
        component="button"
        type="button"
        aria-label={muted ? "Unmute sound" : "Mute sound"}
        aria-pressed={muted}
        onClick={toggle}
        sx={{
          ...hudHitSx,
          px: "0.75rem",
          color: muted ? "rgba(250, 248, 242, 0.5)" : CREAM,
          "&:hover": {
            color: muted ? CREAM : ORANGE,
            background: "rgba(255, 122, 47, 0.12)",
          },
          "&:active": { filter: "brightness(0.92)" },
        }}
      >
        <SpeakerIcon muted={muted} />
      </Box>
    </HudPlate>
  );
}

function Telemetry() {
  const t = useGame((s) => s.telemetry);
  const odo = t.odo < 1000 ? `${t.odo.toFixed(1)}M` : `${(t.odo / 1000).toFixed(2)}KM`;
  const lines = [];
  if (t.peers) lines.push(`${t.peers + 1} ONLINE`);
  lines.push(`${t.speed.toFixed(2)}M/S \u00b7 ODO ${odo}`);
  lines.push(`FPS ${t.fps} \u00b7 CTRL ${t.ctrlHz}HZ`);
  return (
    <Box
      sx={{
        position: "fixed",
        bottom: "1.25rem",
        right: "1.5rem",
        zIndex: 10,
        pointerEvents: "none",
        fontFamily: MONO,
        fontSize: "0.62rem",
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        color: "rgba(255, 255, 255, 0.35)",
        fontVariantNumeric: "tabular-nums",
        textShadow: "0 0 6px rgba(255, 255, 255, 0.15)",
        whiteSpace: "pre-line",
        textAlign: "right",
        lineHeight: 1.8,
      }}
    >
      {lines.join("\n")}
    </Box>
  );
}

function OsdLoad() {
  const rollersLoading = useGame((s) => s.rollersLoading);
  if (!rollersLoading) return null;
  return (
    <Box
      sx={{
        position: "fixed",
        top: "5.2rem",
        right: "1.5rem",
        zIndex: 10,
        fontFamily: MONO,
        fontSize: "0.68rem",
        letterSpacing: "0.14em",
        color: ORANGE,
        textShadow: "0 0 8px rgba(255, 122, 47, 0.4)",
      }}
    >
      LOADING ROLLERS
      <Box
        component="span"
        sx={{ display: "inline-block", ml: "0.15em", animation: `${recBlink} 0.8s steps(1) infinite` }}
      >
        {"\u2588"}
      </Box>
    </Box>
  );
}

export default function Hud() {
  const entered = useGame((s) => s.entered);
  const menuOpen = useGame((s) => s.menuOpen);
  const touchMode = useGame((s) => s.touchMode);
  if (!entered || menuOpen) return null;
  return (
    <>
      <BackButton />
      <PreorderButton />
      {/* The HUD renders as a bare fragment (no positioned wrapper), so the
          link's default absolute SPOT would anchor to the viewport - flip
          it to fixed to stack under the shop plate, SHOP / CODE column. */}
      <GitHubLink sx={{ position: "fixed", zIndex: 10 }} />
      {!touchMode && (
        <>
          <Quickbar />
          <Telemetry />
          <OsdLoad />
        </>
      )}
    </>
  );
}
