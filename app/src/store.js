// Central bridge between the imperative game core and the React UI.
//
// Data flows one way per concern:
//   game -> store   state the UI renders (mode label, loco, telemetry, boot
//                   milestones). Written via useGame.setState from game code;
//                   high-frequency values (telemetry) are throttled at the
//                   producer so React never re-renders at frame rate.
//   UI  -> gameApi  intents (set colour, switch loco, reset, open/close
//                   menu side effects). gameApi is a plain object populated
//                   once the game boots; optional-chained calls make the UI
//                   safe to interact with before that.
import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";

export const useGame = create(
  subscribeWithSelector(() => ({
    // Boot lifecycle
    prebootDone: false, // title assets ready, grey veil dropped
    entered: false, // first "Waddle in" clicked (latches)
    menuOpen: false, // title / pause overlay up (opened by App after preboot)
    biosVisible: false, // BIOS readout playing over the scene
    bootDone: false,
    bootFailed: false,

    // Game state mirrored for the UI
    modeLabel: "Run",
    loco: "legs", // "legs" | "rollers" - what the game is actually running
    locoWant: "legs", // what the quickbar asked for (game reconciles)
    locoSwitching: false,
    rollersLoading: false, // OSD line while the roller stack streams in
    variant: "classic",
    padConnected: false,
    touchMode: false,
    ballActive: false,
    // Throttled telemetry block (4 Hz), bottom-right OSD
    telemetry: { fps: 0, ctrlHz: 0, speed: 0, odo: 0, peers: 0 },

    // Football match state (Phase 3) — mirrored from the referee at low
    // frequency; matchEvents is an append-only ring the UI drains.
    matchState: "IDLE", // referee FSM: IDLE|KICKOFF|PLAYING|DEAD_BALL|SET_PIECE|GOAL|FULLTIME
    score: { red: 0, blue: 0 },
    matchResult: null, // 'red' | 'blue' | 'draw' once FULLTIME; cleared on kick-off
    matchTime: 0, // seconds of PLAYING time
    lastTouchTeam: null, // 'red' | 'blue'
    setPieceType: null, // 'kickoff'|'throw_in'|'goal_kick'|'corner_red'|'corner_blue'
    matchEvents: [], // recent events for UI consumption [{type, team, time, payload}]
    ducksState: [], // [{id, team, role, pos2D, fallen, penalized}] — 4Hz throttled
  })),
);

// Imperative game surface, assigned by game/game.js once booted. The UI
// only ever optional-chains into it.
export const gameApi = {};

// Debug handles for the console / automated QA (same spirit as window.rl).
if (typeof window !== "undefined") {
  window.__store = useGame;
  window.__gameApi = gameApi;
}

// BIOS/POST milestone log. Plain module state on purpose: the readout
// component polls it inside its own paced replay loop (same as the old
// playBios), so no reactivity is needed and log spam never re-renders React.
// Entries: { label, status, raw, halt, progress } - status null = pending.
export const bootLog = [];

export const bootLine = (label) => {
  const entry = { label, status: null, raw: false, progress: null };
  bootLog.push(entry);
  const done = (status = "OK") => {
    entry.status = status;
  };
  done.progress = (p) => {
    entry.progress = p;
  };
  return done;
};

export const bootNote = (label) => {
  bootLog.push({ label, status: "", raw: true });
};

// Fatal boot failure: freeze the BIOS on the halt screen (the readout is
// the diagnostic surface). Drops the title overlay if still up.
export function bootHalt(detail) {
  const s = useGame.getState();
  if (s.bootFailed || s.bootDone) return;
  bootNote(`>> ${detail}`);
  bootLog.push({ label: "SYSTEM HALTED", status: "", raw: true, halt: true });
  useGame.setState({ bootFailed: true, menuOpen: false, biosVisible: true });
}
