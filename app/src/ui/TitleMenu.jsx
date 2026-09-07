// Title / pause overlay: a full-page ink screen printed in the landing's
// comic DA - big Anton title with the ink-drop + cyan/magenta aberration
// treatment, a comic-block CTA on an acid plate, and an orange halftone
// ramp pooling in the top-left corner. Colour and locomotion live in the
// in-game HUD quickbar, so the intro's only action is Waddle in.
//
// The first "Waddle in" cues the BIOS; later Esc / the in-game Back button
// reopen the overlay as pause ("Resume"). The ?boot=1 bypass lives in
// App.jsx and never mounts this component.
import { useEffect, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { keyframes, styled } from "@mui/material/styles";
import { useGame } from "../store.js";
import { signed } from "../game/signed.js";
import { playConfirmBloop } from "../game/audio.js";
import { INK, ORANGE, MONO } from "../theme.js";
import { ComicButton, ComicTitle, HalftoneRamp, ANTON, CREAM } from "./comic.jsx";
import MenuDuck, { preloadMenuDuck, isMenuDuckReady } from "./MenuDuck.jsx";
import { PreorderButton } from "./Hud.jsx";
import { GitHubLink } from "./GitHubLink.jsx";
import { readLayoutMap, resolveKeycaps } from "./keyboard-layout.js";

const rowIn = keyframes`
  from { transform: translateY(12px); opacity: 0; }
  to { transform: none; opacity: 1; }
`;
const brandIn = keyframes`
  from { transform: translateY(10px) scale(0.94); opacity: 0; }
  to { transform: none; opacity: 1; }
`;
// Title-screen blink for the "press Enter" prompt - a soft pulse, not a
// hard arcade strobe, so it invites rather than nags.
const promptPulse = keyframes`
  from { opacity: 0.8; }
  to { opacity: 0.18; }
`;
const spin = keyframes`
  to { transform: rotate(360deg); }
`;
// One soft ease, small travel, ~80 ms between rows - staged, not showy.
const row = (delay, name = rowIn) => ({
  animation: `${name} 0.55s cubic-bezier(0.22, 1, 0.36, 1) both`,
  animationDelay: `${delay}s`,
  "@media (prefers-reduced-motion: reduce)": { animation: "none" },
});

const Kbd = styled("kbd")(({ round }) => ({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minWidth: round ? "1.9rem" : "1.65rem",
  height: "1.65rem",
  padding: "0 0.45rem",
  font: "inherit",
  fontSize: "0.68rem",
  fontWeight: 600,
  color: "#fff",
  background: "#14141c",
  border: `2px solid ${INK}`,
  borderRadius: round ? "50%" : 8,
  boxShadow: "0 0 0 2px rgba(255, 255, 255, 0.82)",
}));

// Arcade-style cheat strip pinned at the bottom of the title screen: one
// keycap group + label per move, scannable in a second. The CTA is the
// screen's centre of gravity - players enter first and learn in game.
// Controls bind physical KeyboardEvent.code positions, so letter keycaps
// carry `codes` and get their printed label resolved for the active layout
// (QWERTY fallback where the Keyboard Map API is unavailable).
const SHORTCUTS = {
  kb: [
    { caps: ["\u2191\u2190\u2193\u2192"], name: "Move" },
    { codes: ["KeyQ", "KeyE"], name: "Kick" },
    { codes: ["KeyR"], name: "Sit" },
    { codes: ["KeyG"], name: "Pick up" },
    { codes: ["KeyC"], name: "Camera" },
    { caps: ["Space"], name: "Reset" },
  ],
  pad: [
    { caps: ["LS"], name: "Move" },
    { caps: ["LB", "RB"], name: "Kick" },
    { caps: ["Y"], name: "Head" },
    { caps: ["RS"], name: "Camera" },
    { caps: ["X", "\u2193"], name: "Sit" },
  ],
  touch: [
    { caps: ["Stick"], name: "Move" },
    { caps: ["A"], round: true, name: "Kick" },
    { caps: ["B"], round: true, name: "Quack" },
  ],
};
// kb's hint is built at render time from the resolved layout (see kbHint).
const HINTS = {
  pad: "A ground pick \u00b7 RT quack \u00b7 hold LT wheee \u00b7 R3 chase",
  touch: "drag to orbit \u00b7 pinch to zoom",
};

// Per-colourway screen accent: the title fill and the halftone pool
// follow the duck on stage. Cream keeps the landing's brand orange (the
// classic duck's trim colour); lavender and sky use the press-kit swatch
// hexes (shared with the vitrine picker); graphite's swatch is too dark
// for type on ink, so it wears the palette's light warm gray instead.
const VARIANT_ACCENTS = {
  classic: ORANGE,
  charcoal: "#b9b5ae",
  purple: "#bfa9cf",
  blue: "#a9dbe8",
};

// #rrggbb -> rgba() at the halftone's alpha.
const tint = (hex, a) =>
  `rgba(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)}, ${a})`;

const KB_CODES = SHORTCUTS.kb.flatMap((t) => t.codes ?? []);

function useKeycaps(enabled) {
  const [keycaps, setKeycaps] = useState(() => resolveKeycaps(KB_CODES, null));

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let latest = 0;
    const read = async () => {
      const ticket = ++latest;
      const map = await readLayoutMap();
      // Overlapping reads can settle out of order; only the newest paints.
      if (!cancelled && ticket === latest) setKeycaps(resolveKeycaps(KB_CODES, map));
    };
    read();
    const keyboard = navigator.keyboard;
    keyboard?.addEventListener?.("layoutchange", read);
    return () => {
      cancelled = true;
      keyboard?.removeEventListener?.("layoutchange", read);
    };
  }, [enabled]);

  return keycaps;
}

function closeMenu() {
  useGame.setState({ menuOpen: false });
  if (!useGame.getState().entered) useGame.setState({ entered: true });
  // Menu-confirm bloop. On the first entry the `entered` latch above has
  // just created the shared AudioContext inside this very gesture, so the
  // bloop rides the unlock (the synth resume-retries if still suspended).
  playConfirmBloop();
}

export default function TitleMenu() {
  const menuOpen = useGame((s) => s.menuOpen);
  const entered = useGame((s) => s.entered);
  const padConnected = useGame((s) => s.padConnected);
  const touchMode = useGame((s) => s.touchMode);
  const variant = useGame((s) => s.variant);
  const bootDone = useGame((s) => s.bootDone);
  const bootFailed = useGame((s) => s.bootFailed);
  const [closing, setClosing] = useState(false);
  const prevOpen = useRef(menuOpen);
  // A plugged-in gamepad wins over the touch tutorial.
  const tutorialVariant = padConnected ? "pad" : touchMode ? "touch" : "kb";
  const { labels, moveHint } = useKeycaps(tutorialVariant === "kb");

  // Touch devices and narrow (mobile-sized) screens skip the 3D stage
  // entirely: no duck column, and the GLB is never even downloaded. The
  // width check matches the layout's md breakpoint, so the stage never
  // renders where the column would stack under the text anyway. Everyone
  // else holds a spinner until the stage's assets are in, so the content
  // reveal and the duck's entrance scan cue together. The stage is a
  // module singleton, so pause reopens resolve instantly (no second
  // spinner).
  const [wide, setWide] = useState(
    () => window.matchMedia("(min-width: 900px)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 900px)");
    const onChange = () => setWide(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  const showDuck = !touchMode && wide;
  const [duckReady, setDuckReady] = useState(isMenuDuckReady);
  useEffect(() => {
    if (!showDuck || duckReady) return;
    let on = true;
    const done = () => { if (on) setDuckReady(true); };
    preloadMenuDuck().catch(() => {}).then(done);
    // Capped like the font and brand gates below: the stage build creates a
    // second WebGL context and pulls the shared GLB, so a context that never
    // comes up (or a fetch that never settles) would otherwise hold the whole
    // title screen behind the spinner forever - with the game fully booted
    // behind it and nothing in the console.
    const t = setTimeout(done, 6000);
    return () => { on = false; clearTimeout(t); };
  }, [showDuck, duckReady]);

  // The display face too: Anton is the screen's voice (title, CTA,
  // strip) and would otherwise FOUT in after the reveal. It loads
  // lazily on first use, so nudge it explicitly - the content is gated
  // and would never request it. Timeout so a stuck font never wedges
  // the menu behind the spinner.
  const [fontsReady, setFontsReady] = useState(
    () => !!document.fonts?.check?.("1rem Anton"),
  );
  useEffect(() => {
    if (fontsReady) return;
    let on = true;
    const done = () => { if (on) setFontsReady(true); };
    const anton = document.fonts?.load
      ? document.fonts.load("1rem Anton")
      : Promise.resolve();
    const allFonts = document.fonts?.ready ?? Promise.resolve();
    Promise.all([anton, allFonts]).then(done, done);
    const t = setTimeout(done, 4000);
    return () => { on = false; clearTimeout(t); };
  }, [fontsReady]);

  // The brand lockup images too (formerly the preboot veil's job): the
  // corner chrome is part of the gated reveal, so the logo must not pop
  // in after it. Capped so a broken asset never wedges the menu.
  const [brandReady, setBrandReady] = useState(false);
  useEffect(() => {
    if (brandReady) return;
    let on = true;
    const done = () => { if (on) setBrandReady(true); };
    const load = (src) =>
      new Promise((res) => {
        const img = new Image();
        img.src = signed(src);
        if (img.complete && img.naturalWidth) res();
        else {
          img.addEventListener("load", res, { once: true });
          img.addEventListener("error", res, { once: true });
        }
      });
    Promise.all([
      load("./assets/duck-head-mark.webp"),
      load("./assets/duck-head-mark-open.webp"),
    ]).then(done, done);
    const t = setTimeout(done, 2500);
    return () => { on = false; clearTimeout(t); };
  }, [brandReady]);

  // The game core too: it boots eagerly behind the title screen (MuJoCo
  // WASM, scene geometry, policy sessions), saturating the main thread
  // in ~10-40 ms chunks for a couple of seconds. Revealing the menu
  // mid-boot made the duck's entrance scan stutter (profiled: the scan
  // window sat inside the boot's busy region), so the spinner holds
  // until the boot settles - the reveal then animates on a free thread
  // and Waddle-in is instant. bootFailed releases the gate: the halt
  // screen owns the viewport at that point.
  const ready =
    (duckReady || !showDuck) &&
    fontsReady &&
    brandReady &&
    (bootDone || bootFailed);

  // Keep the overlay mounted through the 0.35 s closing fade.
  useEffect(() => {
    const was = prevOpen.current;
    prevOpen.current = menuOpen;
    if (was && !menuOpen) {
      setClosing(true);
      const t = setTimeout(() => setClosing(false), 380);
      return () => clearTimeout(t);
    }
  }, [menuOpen]);

  // Enter enters / resumes; Esc toggles the pause menu (never over the
  // BIOS readout).
  useEffect(() => {
    const onKey = (e) => {
      const s = useGame.getState();
      if (e.code === "Enter" && s.menuOpen) {
        if (e.target instanceof HTMLButtonElement && e.target.dataset.cta !== "1") return;
        e.preventDefault();
        closeMenu();
        return;
      }
      if (e.code !== "Escape") return;
      if (s.biosVisible) return;
      if (s.menuOpen) {
        if (s.entered) closeMenu();
        return;
      }
      if (s.entered) useGame.setState({ menuOpen: true });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Gamepad twin of the handler above: A (button 0) enters / resumes
  // through the same closeMenu() as the CTA click; Start (9) or Select (8)
  // reopens the overlay in-game, like Escape. Polled with a light rAF loop
  // because the game's own gamepad source only exists once the core has
  // booted (and its actions are game-facing). Edge state persists across
  // the open/close transition, so one press fires exactly one action.
  useEffect(() => {
    const prev = { enter: false, menu: false };
    // The A press that closes the menu is applied one frame LATE on
    // purpose: closing unlocks the game inputs synchronously, and the
    // in-game gamepad source polls in the same rAF round - if it sees the
    // press only after the unlock, its own A edge fires (groundPick). The
    // one-frame delay guarantees it polls the press at least once while
    // the pause lock still gates it, so by the unlock frame its edge
    // state already knows the button is down and the entering press is
    // swallowed.
    let enterPending = false;
    let raf;
    const poll = () => {
      raf = requestAnimationFrame(poll);
      if (enterPending) {
        enterPending = false;
        if (useGame.getState().menuOpen) closeMenu();
      }
      // Same pad preference as controls/gamepad.js: standard mapping first.
      const pads = [...(navigator.getGamepads?.() ?? [])].filter((p) => p && p.connected);
      const gp = pads.find((p) => p.mapping === "standard") ?? pads[0];
      if (!gp) {
        prev.enter = false;
        prev.menu = false;
        return;
      }
      const enter = !!gp.buttons[0]?.pressed;
      const menu = !!(gp.buttons[9]?.pressed || gp.buttons[8]?.pressed);
      const enterEdge = enter && !prev.enter;
      const menuEdge = menu && !prev.menu;
      prev.enter = enter;
      prev.menu = menu;
      const s = useGame.getState();
      if (enterEdge && s.menuOpen) {
        enterPending = true;
        return;
      }
      if (menuEdge && !s.menuOpen && s.entered && !s.biosVisible)
        useGame.setState({ menuOpen: true });
    };
    raf = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(raf);
  }, []);

  if (!menuOpen && !closing) return null;

  // Letter keycaps resolved for the active layout (QWERTY fallback).
  const shortcuts =
    tutorialVariant === "kb"
      ? SHORTCUTS.kb.map((t) =>
          t.codes ? { ...t, caps: t.codes.map((code) => labels[code]) } : t,
        )
      : SHORTCUTS[tutorialVariant];
  // The strip's footnote names the letter movement cluster for the active
  // layout too ("ZQSD works too" reads wrong on QWERTY and Dvorak).
  const kbHint = `${moveHint.replace(/^arrows or /, "")} works too \u00b7 drag to orbit \u00b7 scroll to zoom`;
  const ctaLabel = entered ? "Resume" : "Waddle in";
  // Blinking key prompt under the CTA; touch has no key to press.
  const enterHint = padConnected ? "press A" : touchMode ? null : "press Enter";
  const accent = VARIANT_ACCENTS[variant] ?? ORANGE;

  return (
    <Box
      role="dialog"
      aria-modal="true"
      aria-label="Microduck"
      sx={{
        position: "fixed",
        inset: 0,
        zIndex: 30,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        p: "2.4rem 1.4rem 1.8rem",
        background: INK,
        opacity: menuOpen ? 1 : 0,
        pointerEvents: menuOpen ? "auto" : "none",
        overflowY: "auto",
        transition: "opacity 0.35s ease, background 0.4s ease",
      }}
    >
      {/* Theme-orange halftone pooling in the top-left corner, dots
          growing toward it - the landing's screen-tone on ink ground. */}
      <HalftoneRamp
        color={tint(accent, 0.16)}
        size={20}
        corner="top-left"
        reach={60}
      />

      {/* Corner chrome, shared grammar with the vitrine header (drawn
          duck head, top-left) and the in-game HUD (pre-order, top-right):
          the title screen wears the same screen furniture as the game.
          Gated with the rest of the reveal so the loading state is a
          single centered spinner on bare ink. */}
      {ready && (
      <Box
        aria-hidden
        sx={{
          position: "absolute",
          top: "1.25rem",
          left: "1.5rem",
          zIndex: 1,
          display: "flex",
          alignItems: "center",
          gap: "0.65rem",
          userSelect: "none",
          ...row(0, brandIn),
          "&:hover .duck-closed": { opacity: 0 },
          "&:hover .duck-open": { opacity: 1 },
        }}
      >
        <Box
          component="span"
          sx={{
            position: "relative",
            display: "block",
            height: "2.1rem",
            filter: "drop-shadow(2px 2px 0 rgba(0, 0, 0, 0.5))",
          }}
        >
          <Box
            component="img"
            className="duck-closed"
            alt=""
            src={signed("./assets/duck-head-mark.webp")}
            sx={{ display: "block", height: "100%", width: "auto" }}
          />
          {/* The open frame's canvas (460x333) is a hair wider/taller
              than the closed one (454x269); offsets pin the head while
              the jaw hangs below. */}
          <Box
            component="img"
            className="duck-open"
            alt=""
            src={signed("./assets/duck-head-mark-open.webp")}
            sx={{
              position: "absolute",
              top: "-0.75%",
              left: "-1.1%",
              width: "101.3%",
              maxWidth: "none",
              height: "auto",
              opacity: 0,
            }}
          />
        </Box>
        <Box
          component="span"
          sx={{
            fontFamily: ANTON,
            fontSize: "1rem",
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            color: "#fff",
            display: { xs: "none", sm: "block" },
          }}
        >
          Microduck
        </Box>
      </Box>
      )}

      {/* The in-game HUD's shop plate, verbatim: same component, same
          fixed spot, so pausing never swaps it for a lookalike. The repo
          link stacks under it - the corner reads SHOP / CODE as one
          column, gated with the rest of the reveal. */}
      {ready && <PreorderButton sx={{ ...row(0.1) }} />}
      {ready && <GitHubLink sx={{ ...row(0.18) }} />}

      {/* Loading gate: one centered spinner on bare ink until logo,
          fonts, the duck stage's assets and the game boot are all in -
          then the whole composition (corner chrome included) reveals at
          once (row stagger + entrance scan). */}
      {!ready && (
        <Box
          role="status"
          aria-label="Loading"
          sx={{
            m: "auto",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "1.1rem",
          }}
        >
          <Box
            aria-hidden
            sx={{
              width: "2.4rem",
              height: "2.4rem",
              borderRadius: "50%",
              border: "3px solid rgba(255, 255, 255, 0.14)",
              borderTopColor: accent,
              animation: `${spin} 0.8s linear infinite`,
            }}
          />
          <Typography
            sx={{
              fontFamily: MONO,
              fontSize: "0.64rem",
              fontWeight: 600,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: "rgba(255, 255, 255, 0.5)",
            }}
          >
            Loading
          </Typography>
        </Box>
      )}

      {/* Split title screen: brand + CTA column on the left, the live
          duck stage on the right (stacked on narrow screens). The row
          stretches to fill the space between the corner chrome and the
          bottom strip, so the duck stands ON the strip's rule - the
          screen has a floor instead of elements floating mid-air. */}
      {ready && (
      <>
      <Box
        sx={{
          position: "relative",
          display: "flex",
          flexDirection: { xs: "column", md: "row" },
          alignItems: "stretch",
          justifyContent: "center",
          gap: { xs: "0.4rem", md: "1.5rem" },
          width: "100%",
          maxWidth: "min(66rem, 94vw)",
          flex: "1 1 auto",
          minHeight: 0,
          pt: { xs: "2.6rem", md: 0 },
        }}
      >
      <Box
        sx={{
          position: "relative",
          flex: { md: "0 1 33rem" },
          width: "100%",
          maxWidth: { xs: "min(48rem, 92vw)", md: "none" },
          mx: { xs: "auto", md: 0 },
          // Game-menu grammar: the text block rides the column's vertical
          // centre on desktop; left-anchored there, centered when stacked
          // or when the duck column is absent (touch mode).
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: { xs: "center", md: showDuck ? "flex-start" : "center" },
          textAlign: { xs: "center", md: showDuck ? "left" : "center" },
        }}
      >
        {/* The landing hero's mistracked-VHS treatment: orange fill with
            ink drop + chroma ghosts, hollow echo line below. */}
        <ComicTitle
          component="h1"
          tone="dark"
          accent={accent}
          fontSize="clamp(3.4rem, 9vw, 6.2rem)"
          lines={[
            { text: "Microduck" },
            { text: "Arena", variant: "outline", scale: 0.78 },
          ]}
          sx={{ ...row(0.08) }}
        />

        <Typography
          sx={{
            mx: { xs: "auto", md: 0 },
            mt: "1.1rem",
            "@media (max-height: 700px)": { mt: "0.8rem" },
            maxWidth: "34ch",
            fontSize: { xs: "0.95rem", sm: "1.05rem" },
            lineHeight: 1.5,
            letterSpacing: "-0.012em",
            color: "rgba(255, 255, 255, 0.72)",
            textWrap: "balance",
            ...row(0.24),
          }}
        >
          The exact same trained policies that drive the real robot,
          live in your browser.
        </Typography>

        {/* CTA + key prompt travel as one block so the prompt stays
            centred under the button whatever the column's alignment. */}
        <Box
          sx={{
            display: "inline-flex",
            flexDirection: "column",
            alignItems: "center",
            mt: "2rem",
            "@media (max-height: 700px)": { mt: "1.3rem" },
            ...row(0.32),
          }}
        >
          <ComicButton
            scheme="orange"
            size="medium"
            onDark
            data-cta="1"
            onClick={closeMenu}
          >
            {/* Pad prompt: ink circle with the A face button, shown while a
                gamepad is connected - it mirrors the A-to-enter binding of
                the poll loop above. Decorative; the text label carries the
                meaning. */}
            {padConnected && (
              <Box
                component="span"
                aria-hidden
                sx={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: "1.5em",
                  height: "1.5em",
                  borderRadius: "50%",
                  background: INK,
                  color: CREAM,
                  fontSize: "0.72em",
                  lineHeight: 1,
                }}
              >
                A
              </Box>
            )}
            {ctaLabel}
          </ComicButton>

          {enterHint && (
            <Typography
              aria-hidden
              sx={{
                mt: "0.85rem",
                fontFamily: MONO,
                fontSize: "0.66rem",
                fontWeight: 600,
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: "rgba(255, 255, 255, 0.6)",
                ...row(0.4),
              }}
            >
              <Box
                component="span"
                sx={{
                  display: "inline-block",
                  animation: `${promptPulse} 0.95s ease-in-out infinite alternate`,
                  "@media (prefers-reduced-motion: reduce)": {
                    animation: "none",
                    opacity: 0.6,
                  },
                }}
              >
                {enterHint}
              </Box>
            </Typography>
          )}
        </Box>
      </Box>

      {/* Right column: the duck's simulated twin, live - head follows the
          pointer, click quacks. Its colourway tracks the in-game duck. No
          backdrop, no fake shadow: the render alone, standing on the
          bottom strip's rule like a character select. Touch devices skip
          the stage entirely (no column, no GLB download). */}
      {showDuck && (
        <Box
          sx={{
            position: "relative",
            flex: { xs: "1 1 auto", md: "1 1 22rem" },
            width: "100%",
            minHeight: { xs: "min(30vh, 16rem)", md: 0 },
            ...row(0.16, brandIn),
          }}
        >
          <MenuDuck sx={{ position: "absolute", inset: 0 }} />
        </Box>
      )}
      </Box>

      {/* Bottom cheat strip: every move on one wrapping line, arcade
          instruction-card style. Reference material, not the main event -
          it sits at the screen's bottom edge, out of the CTA's way. */}
      <Box
        sx={{
          position: "relative",
          width: "100%",
          textAlign: "center",
          mt: "1.2rem",
          pt: "1.15rem",
          borderTop: "1px solid rgba(255, 255, 255, 0.08)",
          ...row(0.5),
        }}
      >
        <Box
          sx={{
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "center",
            alignItems: "center",
            gap: "0.55rem 1.25rem",
            // Strip keycaps are a notch smaller than the CTA scale.
            "& kbd": {
              minWidth: "1.45rem",
              height: "1.45rem",
              p: "0 0.34rem",
              fontSize: "0.6rem",
            },
          }}
        >
          {shortcuts.map((s) => (
            <Box
              key={s.name}
              sx={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.45rem",
              }}
            >
              <Box sx={{ display: "inline-flex", gap: "0.22rem" }}>
                {/* Index keys: exotic layouts can print the same glyph twice. */}
                {s.caps.map((c, i) => (
                  <Kbd key={i} round={s.round ? 1 : 0}>{c}</Kbd>
                ))}
              </Box>
              <Box
                component="span"
                sx={{
                  fontFamily: ANTON,
                  fontSize: "0.74rem",
                  letterSpacing: "0.07em",
                  textTransform: "uppercase",
                  color: "rgba(255, 255, 255, 0.88)",
                }}
              >
                {s.name}
              </Box>
            </Box>
          ))}
        </Box>

        <Typography
          sx={{
            mt: "0.7rem",
            fontFamily: MONO,
            fontSize: "0.62rem",
            fontWeight: 600,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "rgba(255, 255, 255, 0.34)",
          }}
        >
          {tutorialVariant === "kb" ? kbHint : HINTS[tutorialVariant]}
        </Typography>
      </Box>
      </>
      )}
    </Box>
  );
}
