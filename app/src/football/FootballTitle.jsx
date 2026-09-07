// Football-mode title / boot gate. TitleMenu.jsx is deliberately untouched
// (its CTA copy and shortcut strip are sandbox-specific and store-driven),
// so the match gets its own overlay built from the same comic primitives:
// Anton title with the ink-drop + chroma ghosts, an orange ComicButton CTA
// reading "Kick Off", the duck-head corner chrome, and a spectator cheat
// strip instead of the sandbox move list (the ducks play themselves).
//
// Boot gate: the game core boots eagerly behind this overlay (MuJoCo WASM,
// six duck rigs, policy sessions), so the reveal waits for bootDone -
// matching TitleMenu's gate - and shows a "Loading teams..." step line
// while the spin-up is in flight. bootFailed releases the gate into a halt
// note so the screen never wedges behind the spinner.
//
// Visibility rides the store's `menuOpen` flag: FootballApp opens it on
// mount, and the in-match Back button (FootballHud) reopens it as pause -
// at which point the CTA reads "Resume" and no second kickoff fires.
import { useEffect, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { keyframes, styled } from "@mui/material/styles";
import { useGame } from "../store.js";
import { signed } from "../game/signed.js";
import { playConfirmBloop } from "../game/audio.js";
import { INK, ORANGE, MONO } from "../theme.js";
import { ComicButton, ComicTitle, HalftoneRamp, ANTON, CREAM } from "../ui/comic.jsx";
import { PreorderButton } from "../ui/Hud.jsx";
import { GitHubLink } from "../ui/GitHubLink.jsx";
import StrategyPanel from "./StrategyPanel.jsx";
import LangToggle from "./LangToggle.jsx";
import { t } from "./i18n.js";

const rowIn = keyframes`
  from { transform: translateY(12px); opacity: 0; }
  to { transform: none; opacity: 1; }
`;
const brandIn = keyframes`
  from { transform: translateY(10px) scale(0.94); opacity: 0; }
  to { transform: none; opacity: 1; }
`;
const promptPulse = keyframes`
  from { opacity: 0.8; }
  to { opacity: 0.18; }
`;
const spin = keyframes`
  to { transform: rotate(360deg); }
`;
// Same staged reveal grammar as TitleMenu: one soft ease, small travel,
// ~80 ms between rows.
const row = (delay, name = rowIn) => ({
  animation: `${name} 0.55s cubic-bezier(0.22, 1, 0.36, 1) both`,
  animationDelay: `${delay}s`,
  "@media (prefers-reduced-motion: reduce)": { animation: "none" },
});

const Kbd = styled("kbd")(() => ({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minWidth: "1.65rem",
  height: "1.65rem",
  padding: "0 0.45rem",
  font: "inherit",
  fontSize: "0.68rem",
  fontWeight: 600,
  color: "#fff",
  background: "#14141c",
  border: `2px solid ${INK}`,
  borderRadius: 8,
  boxShadow: "0 0 0 2px rgba(255, 255, 255, 0.82)",
}));

// Spectator cheat strip: football has no manual control (AI drives all six
// ducks), so the arcade instruction card lists camera verbs only.
// Labels come from i18n at render time.

// #rrggbb -> rgba() at the halftone's alpha.
const tint = (hex, a) =>
  `rgba(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)}, ${a})`;

export default function FootballTitle({ onKickOff }) {
  const menuOpen = useGame((s) => s.menuOpen);
  const bootDone = useGame((s) => s.bootDone);
  const bootFailed = useGame((s) => s.bootFailed);
  const padConnected = useGame((s) => s.padConnected);
  const touchMode = useGame((s) => s.touchMode);
  const entered = useGame((s) => s.entered);
  const locale = useGame((s) => s.locale) || "en";
  const [closing, setClosing] = useState(false);
  const prevOpen = useRef(menuOpen);
  // Latches once the kickoff has fired, so a pause reopen reads "Resume"
  // even before the store's entered flag is consulted.
  const kickoffFired = useRef(false);

  // The display face: Anton is the screen's voice (title, CTA, strip) and
  // loads lazily on first use, so nudge it explicitly - the gated content
  // would never request it. Timeout so a stuck font never wedges the menu.
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

  // The brand lockup images: the corner chrome is part of the gated
  // reveal, so the logo must not pop in after it. Capped so a broken
  // asset never wedges the menu.
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

  // No MenuDuck stage here: the live pitch (six ducks, already playing)
  // is the character select - it renders behind this overlay and takes
  // over the moment the gate drops.
  const ready = fontsReady && brandReady && (bootDone || bootFailed);

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

  const kickoff = () => {
    useGame.setState({ menuOpen: false, entered: true });
    // Menu-confirm bloop: the click is the audio-unlock gesture, and the
    // synth resume-retries if the shared context is still suspended.
    playConfirmBloop();
    if (!kickoffFired.current) {
      kickoffFired.current = true;
      onKickOff?.();
    }
  };

  // Enter kicks off / resumes. Esc toggles the pause overlay, but only
  // once the match is underway - before kickoff the menu is the screen.
  useEffect(() => {
    const onKey = (e) => {
      const s = useGame.getState();
      if (e.code === "Enter" && s.menuOpen) {
        if (e.target instanceof HTMLButtonElement && e.target.dataset.cta !== "1") return;
        e.preventDefault();
        if (ready) kickoff();
        return;
      }
      if (e.code !== "Escape") return;
      if (s.menuOpen) {
        if (kickoffFired.current) kickoff();
        return;
      }
      if (kickoffFired.current) useGame.setState({ menuOpen: true });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // Gamepad twin: A (button 0) kicks off / resumes, Start (9) or Select
  // (8) reopens the overlay in-match. Same one-frame-delay trick as
  // TitleMenu so the entering A press never leaks into game input.
  useEffect(() => {
    const prev = { enter: false, menu: false };
    let enterPending = false;
    let raf;
    const poll = () => {
      raf = requestAnimationFrame(poll);
      if (enterPending) {
        enterPending = false;
        if (useGame.getState().menuOpen && ready) kickoff();
      }
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
      if (menuEdge && !s.menuOpen && kickoffFired.current)
        useGame.setState({ menuOpen: true });
    };
    raf = requestAnimationFrame(poll);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  if (!menuOpen && !closing) return null;

  // After the first kickoff the overlay is a pause screen.
  const ctaLabel = kickoffFired.current ? t(locale, "resume") : t(locale, "kickOff");
  const enterHint = padConnected
    ? t(locale, "pressA")
    : touchMode
      ? null
      : t(locale, "pressEnter");

  const SPECTATOR = [
    { caps: ["Scroll"], name: t(locale, "zoom") },
    { caps: ["Drag"], name: t(locale, "orbit") },
    { caps: ["R"], name: t(locale, "resetCamera") },
  ];

  return (
    <Box
      role="dialog"
      aria-modal="true"
      aria-label="Microduck Arena"
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
      {/* Theme-orange halftone pooling in the top-left corner - the same
          screen-tone grammar as the sandbox title. */}
      <HalftoneRamp
        color={tint(ORANGE, 0.16)}
        size={20}
        corner="top-left"
        reach={60}
      />

      {/* Corner chrome: drawn duck head (top-left) + the in-game HUD's
          shop plate (top-right) with the repo link stacked under it, gated
          with the rest of the reveal. */}
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
      {ready && <PreorderButton sx={{ ...row(0.1) }} />}
      {ready && <GitHubLink sx={{ ...row(0.18) }} />}
      {ready && <LangToggle sx={{ ...row(0.22) }} />}

      {/* Boot gate: one centered spinner on bare ink with the match's
          step line until fonts, brand art and the game core are in. A
          fatal boot failure swaps the step line for the halt note. */}
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
              borderTopColor: ORANGE,
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
            {t(locale, "loadingTeams")}
          </Typography>
        </Box>
      )}

      {ready && (
      <>
      <Box
        sx={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          width: "100%",
          maxWidth: "min(48rem, 94vw)",
          flex: "1 1 auto",
          minHeight: 0,
          pt: { xs: "2.6rem", md: "1rem" },
        }}
      >
        {bootFailed ? (
          // Halt state: the boot failed, so there is no match to kick
          // off. Name the failure and keep the screen honest.
          <Typography
            sx={{
              m: "auto",
              fontFamily: MONO,
              fontSize: "0.8rem",
              fontWeight: 600,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "rgba(255, 255, 255, 0.6)",
              ...row(0.08),
            }}
          >
            {t(locale, "bootFailed")}
          </Typography>
        ) : (
        <>
        {/* The mistracked-VHS title treatment: orange fill with ink drop
            + chroma ghosts, hollow echo line below. */}
        <ComicTitle
          component="h1"
          tone="dark"
          accent={ORANGE}
          fontSize="clamp(3.2rem, 8.5vw, 5.8rem)"
          lines={[
            { text: "Microduck" },
            { text: "Football 3v3", variant: "outline", scale: 0.62 },
          ]}
          sx={{ ...row(0.08) }}
        />

        <Typography
          sx={{
            mx: "auto",
            mt: "1.1rem",
            "@media (max-height: 700px)": { mt: "0.8rem" },
            maxWidth: "38ch",
            fontSize: { xs: "0.95rem", sm: "1.05rem" },
            lineHeight: 1.5,
            letterSpacing: "-0.012em",
            color: "rgba(255, 255, 255, 0.72)",
            textWrap: "balance",
            ...row(0.24),
          }}
        >
          {t(locale, "tagline")}
        </Typography>

        <Box sx={{ width: "100%", ...row(0.28) }}>
          <StrategyPanel formationLocked={!!entered} />
        </Box>

        {/* CTA + key prompt travel as one block, centred under the title. */}
        <Box
          sx={{
            display: "inline-flex",
            flexDirection: "column",
            alignItems: "center",
            mt: "1.4rem",
            "@media (max-height: 700px)": { mt: "1rem" },
            ...row(0.32),
          }}
        >
          <ComicButton
            scheme="orange"
            size="medium"
            onDark
            data-cta="1"
            onClick={kickoff}
          >
            {/* Pad prompt: ink circle with the A face button, mirroring
                the A-to-kickoff binding of the poll loop. Decorative;
                the text label carries the meaning. */}
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
        </>
        )}
      </Box>

      {/* Bottom spectator strip: camera verbs only - the match plays
          itself. Same arcade instruction-card grammar as the sandbox
          cheat strip. */}
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
            "& kbd": {
              minWidth: "1.45rem",
              height: "1.45rem",
              p: "0 0.34rem",
              fontSize: "0.6rem",
            },
          }}
        >
          {SPECTATOR.map((s) => (
            <Box
              key={s.name}
              sx={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.45rem",
              }}
            >
              <Box sx={{ display: "inline-flex", gap: "0.22rem" }}>
                {s.caps.map((c, i) => (
                  <Kbd key={i}>{c}</Kbd>
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
          {t(locale, "coachFooter")}
        </Typography>
      </Box>
      </>
      )}
    </Box>
  );
}
