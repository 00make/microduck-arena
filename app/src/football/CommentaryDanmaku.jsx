// Horizontal danmaku commentary — Bilibili-style right→left floaters.
// Consumes matchEvents + soft situational cues; lines from commentary.js.
import Box from "@mui/material/Box";
import { keyframes } from "@mui/material/styles";
import { useEffect, useRef, useState } from "react";
import { useGame } from "../store.js";
import { playDanmakuCue } from "../game/audio.js";
import { ANTON, CREAM, COMIC_INK } from "../ui/comic.jsx";
import {
  canIdle,
  canSpeak,
  DANGER_COOLDOWN_S,
  lineForDanger,
  lineForEvent,
  lineForIdle,
} from "./commentary.js";

const RED_ACCENT = "#ff4466";
const BLUE_ACCENT = "#4488ff";
const LANES = 5;
const LIFETIME_MS = 7200;
const MAX_ON_SCREEN = 4;
const TICK_MS = 500;

const drift = keyframes`
  from { transform: translateX(0); opacity: 0; }
  8%   { opacity: 1; }
  88%  { opacity: 1; }
  to   { transform: translateX(calc(-100vw - 100%)); opacity: 0.15; }
`;

let nextId = 1;

function eventSig(ev) {
  return `${ev.type}|${ev.team ?? ""}|${ev.time ?? ""}|${ev.payload?.duckId ?? ""}`;
}

export default function CommentaryDanmaku() {
  const matchEvents = useGame((s) => s.matchEvents);
  const matchState = useGame((s) => s.matchState);
  const score = useGame((s) => s.score);
  const ballState = useGame((s) => s.ballState);
  const locale = useGame((s) => s.locale) || "en";
  const danmakuEnabled = useGame((s) => s.danmakuEnabled !== false);

  const [items, setItems] = useState([]);
  const seenRef = useRef(new Set());
  const lastSpeakAt = useRef(0);
  const lastDangerAt = useRef(0);
  const laneCursor = useRef(0);
  const prevState = useRef(matchState);
  const scoreRef = useRef(score);
  const ballRef = useRef(ballState);
  const localeRef = useRef(locale);
  const stateRef = useRef(matchState);
  const enabledRef = useRef(danmakuEnabled);

  scoreRef.current = score;
  ballRef.current = ballState;
  localeRef.current = locale;
  stateRef.current = matchState;
  enabledRef.current = danmakuEnabled;

  function spawn(line) {
    if (!enabledRef.current || !line?.text) return;
    const now = performance.now();
    if (!canSpeak((now - lastSpeakAt.current) / 1000)) return;
    lastSpeakAt.current = now;
    const lane = laneCursor.current % LANES;
    laneCursor.current += 1;
    const id = nextId++;
    const entry = {
      id,
      text: line.text,
      team: line.team,
      kind: line.kind,
      lane,
      duration: LIFETIME_MS + (lane % 3) * 400,
    };
    playDanmakuCue(line.kind);
    setItems((prev) => {
      const next = [...prev, entry];
      return next.length > MAX_ON_SCREEN + 2
        ? next.slice(next.length - (MAX_ON_SCREEN + 2))
        : next;
    });
    window.setTimeout(() => {
      setItems((prev) => prev.filter((it) => it.id !== id));
    }, entry.duration + 80);
  }

  // Hard events from the referee ring.
  useEffect(() => {
    if (!Array.isArray(matchEvents)) return;
    for (const ev of matchEvents) {
      const sig = eventSig(ev);
      if (seenRef.current.has(sig)) continue;
      seenRef.current.add(sig);
      // Cap seen set so long sessions don't leak.
      if (seenRef.current.size > 80) {
        seenRef.current = new Set([...seenRef.current].slice(-40));
      }
      if (!danmakuEnabled) continue;
      const line = lineForEvent(ev, localeRef.current);
      if (line) spawn(line);
    }
  }, [matchEvents, danmakuEnabled]);

  // Kickoff never hits matchEvents (handleRefereeEvent only places the ball).
  useEffect(() => {
    const prev = prevState.current;
    prevState.current = matchState;
    if (prev === matchState) return;
    if (!danmakuEnabled) return;
    // Skip post-goal restart — goal line already covered the moment.
    if (matchState === "KICKOFF" && prev !== "GOAL") {
      spawn(lineForEvent({ type: "kickoff" }, localeRef.current));
    }
  }, [matchState, danmakuEnabled]);

  // Idle filler + danger-zone soft lines (wall clock, not physics Hz).
  useEffect(() => {
    if (!danmakuEnabled) return;
    const id = window.setInterval(() => {
      const now = performance.now();
      const since = (now - lastSpeakAt.current) / 1000;
      const st = stateRef.current;
      if (st !== "PLAYING") return;

      const ball = ballRef.current;
      if (
        ball &&
        (now - lastDangerAt.current) / 1000 >= DANGER_COOLDOWN_S &&
        canSpeak(since)
      ) {
        const danger = lineForDanger(ball, localeRef.current);
        if (danger) {
          lastDangerAt.current = now;
          spawn(danger);
          return;
        }
      }

      if (canIdle({ matchState: st, sinceLastLineS: since })) {
        spawn(lineForIdle({ score: scoreRef.current }, localeRef.current));
      }
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [danmakuEnabled]);

  // Clear on fresh kickoff after fulltime / idle reset, or when toggled off.
  useEffect(() => {
    if (matchState === "IDLE") {
      seenRef.current = new Set();
      setItems([]);
    } else if (!danmakuEnabled) {
      setItems([]);
    }
  }, [matchState, danmakuEnabled]);

  if (!danmakuEnabled || items.length === 0) return null;

  return (
    <Box
      aria-hidden
      sx={{
        position: "fixed",
        top: { xs: "5.5rem", md: "6.25rem" },
        left: 0,
        right: 0,
        height: { xs: "38%", md: "42%" },
        zIndex: 11,
        pointerEvents: "none",
        overflow: "hidden",
      }}
    >
      {items.map((it) => (
        <Box
          key={it.id}
          sx={{
            position: "absolute",
            top: `${8 + it.lane * 18}%`,
            left: "100%",
            whiteSpace: "nowrap",
            fontFamily: ANTON,
            fontSize: { xs: "0.95rem", md: "1.15rem" },
            letterSpacing: "0.04em",
            color: it.team === "red" ? RED_ACCENT : it.team === "blue" ? BLUE_ACCENT : CREAM,
            textShadow: `0 1px 0 ${COMIC_INK}, 0 0 10px rgba(0,0,0,0.65)`,
            animation: `${drift} ${it.duration}ms linear both`,
            "@media (prefers-reduced-motion: reduce)": {
              animation: "none",
              left: "50%",
              transform: "translateX(-50%)",
              opacity: 0.9,
            },
          }}
        >
          {it.text}
        </Box>
      ))}
    </Box>
  );
}
