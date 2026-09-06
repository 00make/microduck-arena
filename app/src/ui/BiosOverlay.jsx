// BIOS/POST boot readout. The real load runs silently behind the title
// overlay and only RECORDS milestones into bootLog (store.js); the readout
// itself plays after the first "Waddle in": a rapid-fire replay when
// everything already finished, or an honest live tracker (cursor blinking
// on the pending line) when the user enters mid-load. Never slows the
// actual boot. The line pacing is imperative DOM on purpose - it is a
// character-level animation, not UI state.
import { useEffect, useRef, useState } from "react";
import Box from "@mui/material/Box";
import { keyframes } from "@mui/material/styles";
import { useGame, gameApi, bootLog } from "../store.js";
import { playBiosBeep, playBiosTick } from "../game/audio.js";
import { INK, MONO } from "../theme.js";

const postBlink = keyframes`
  0%, 55% { opacity: 1; }
  56%, 100% { opacity: 0; }
`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const lineText = (e) => {
  if (e.raw) return e.label;
  // Pending line: bare label, plus a live counter when the stage reports
  // progress (e.g. "LOADING POLICIES [3/5]").
  if (e.status === null) return e.progress ? `${e.label} [${e.progress}]` : e.label;
  return `${e.label} `.padEnd(26, ".") + ` ${e.status}`;
};

export default function BiosOverlay() {
  const entered = useGame((s) => s.entered);
  const bootFailed = useGame((s) => s.bootFailed);
  const postRef = useRef(null);
  const startedRef = useRef(false);
  const [visible, setVisible] = useState(false);
  const [off, setOff] = useState(false);

  useEffect(() => {
    // Only the initial entry triggers the replay (startedRef latches);
    // a fatal boot failure forces it up regardless (the halt screen IS
    // the diagnostic surface).
    if ((!entered && !bootFailed) || startedRef.current) return;
    startedRef.current = true;
    playBios();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entered, bootFailed]);

  async function playBios() {
    const store = useGame.getState;
    setVisible(true);
    useGame.setState({ biosVisible: true });
    // POST beep: the replay only starts after the enter click (the audio
    // unlock gesture), and the synth no-ops if the context is still locked
    // (gamepad-only entry).
    playBiosBeep();
    const postEl = postRef.current;
    // Seeded LCG: the replay rhythm is random-feeling but identical on
    // every load - real POST screens burst through most checks and stall
    // on a few.
    let seed = 11;
    const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const els = new Map(); // entry -> element
    let i = 0;
    for (;;) {
      const { bootDone, bootFailed: failed } = store();
      if (i < bootLog.length) {
        const entry = bootLog[i++];
        const el = document.createElement("div");
        if (entry.halt) el.className = "halt";
        postEl.appendChild(el);
        els.set(entry, el);
        playBiosTick(); // whisper-level teletype tick per printed line
        if (entry.status === null && !bootDone && !failed) {
          // Honest mode: show the stage label and hold while it's really
          // in flight, cursor blinking via CSS.
          el.textContent = lineText(entry);
          while (entry.status === null && !store().bootDone && !store().bootFailed) {
            await sleep(60);
            el.textContent = lineText(entry); // live [n/m] counter
          }
          await sleep(90);
          el.textContent = lineText(entry);
        } else if (entry.raw || entry.status === null) {
          // Header / note lines: quick, no dotted leader to animate.
          el.textContent = lineText(entry);
          await sleep(20 + 60 * rand());
        } else {
          // Finished check: bursty POST pacing. Most lines snap in nearly
          // instantly; the occasional one stalls on a "slow check" - and
          // on a stall the dotted leader types out one dot at a time
          // before the status lands.
          const r = rand();
          const stall = r < 0.75 ? 20 * rand() : 150 + 250 * rand();
          if (stall < 45) {
            el.textContent = lineText(entry);
            await sleep(stall);
          } else {
            const prefix = `${entry.label} `;
            const nDots = Math.max(26 - prefix.length, 3);
            el.textContent = prefix;
            const per = stall / nDots;
            for (let d = 0; d < nDots; d++) {
              await sleep(per);
              el.textContent += ".";
            }
            await sleep(40);
            el.textContent = lineText(entry);
          }
        }
      } else if (bootDone) {
        break;
      } else {
        // Waiting for the next real stage. On a failed boot this parks the
        // console forever: everything queued (FAIL line, error detail,
        // SYSTEM HALTED) has been printed and nothing more will come.
        await sleep(failed ? 500 : 60);
      }
    }
    const ready = document.createElement("div");
    ready.textContent = "READY.";
    postEl.appendChild(ready);
    playBiosTick();
    await sleep(500);
    setOff(true);
    // Wait out the 0.45 s opacity transition BEFORE cueing the draw-in:
    // starting it under the fading overlay hides the first (and busiest)
    // part of the animation and only the tail end shows.
    await sleep(500);
    setVisible(false);
    useGame.setState({ biosVisible: false });
    // Cue the world draw-in + duck scan-up on a fully black screen.
    gameApi.startEntrance?.();
  }

  return (
    <Box
      sx={{
        position: "fixed",
        inset: 0,
        display: visible ? "flex" : "none",
        // POST readout sits bottom-left like a real BIOS, not centered
        alignItems: "flex-end",
        justifyContent: "flex-start",
        p: "2.2rem 2.4rem",
        background: INK,
        zIndex: 20,
        pointerEvents: "none",
        opacity: off ? 0 : 1,
        transition: "opacity 0.45s ease",
      }}
    >
      <Box
        ref={postRef}
        sx={{
          minWidth: "min(380px, 84vw)",
          // Grow upward from the bottom-left anchor; when the log outgrows
          // the viewport, clip the OLDEST lines at the top so the newest
          // line + cursor stay visible.
          maxHeight: "calc(100vh - 4.4rem)",
          display: "flex",
          flexDirection: "column",
          justifyContent: "flex-end",
          overflow: "hidden",
          // Raw 90s POST look: small, tight, unsmoothed monospace.
          fontFamily: MONO,
          fontSize: "12px",
          fontWeight: 400,
          lineHeight: 1.55,
          letterSpacing: 0,
          textTransform: "uppercase",
          textAlign: "left",
          // Robot orange (classic duck's BRIGHT_ORANGE, #ff7a2f in sRGB)
          color: "rgba(255, 122, 47, 0.92)",
          whiteSpace: "pre-wrap",
          overflowWrap: "break-word",
          "& > div:first-of-type": {
            color: "rgba(255, 255, 255, 0.85)",
            marginBottom: "0.55em",
          },
          // Blinking block cursor at the end of the newest line
          "& > div:last-of-type::after": {
            content: '"\\2588"',
            marginLeft: "0.15em",
            animation: `${postBlink} 1s steps(1) infinite`,
          },
          // Fatal boot failure: SYSTEM HALTED blinks like an old POST fault
          "& > div.halt": {
            color: "rgba(255, 82, 47, 0.95)",
            animation: `${postBlink} 1s steps(1) infinite`,
          },
        }}
      />
    </Box>
  );
}
