// Pure display helpers for the football HUD, kept out of the JSX so the
// node --test runner can exercise them directly (same split as
// ui/keyboard-layout.js / ui/keyboard-layout.test.js).

import { MATCH_DURATION_S } from "../game/football/constants.js";
import { t } from "./i18n.js";

// Countdown clock: matchTime is seconds ELAPSED, the board shows what is
// left of the regulation duration, clamped at 00:00.
export function formatClock(matchTime) {
  const remaining = Math.max(0, MATCH_DURATION_S - (Number(matchTime) || 0));
  const m = Math.floor(remaining / 60);
  const s = Math.floor(remaining % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

// matchState -> printed label. Unknown states fall through uppercased so a
// new referee state still reads on the board instead of vanishing.
export const STATE_LABELS = {
  IDLE: "STANDBY",
  KICKOFF: "KICKOFF",
  PLAYING: "PLAYING",
  DEAD_BALL: "DEAD BALL",
  SET_PIECE: "SET PIECE",
  GOAL: "GOAL!",
  HALFTIME: "HALF TIME",
  FULLTIME: "FULL TIME",
};

export function stateLabel(matchState, locale = "en") {
  if (!matchState) return t(locale, "state_IDLE");
  const key = `state_${matchState}`;
  const localized = t(locale, key);
  if (localized !== key) return localized;
  return STATE_LABELS[matchState] ?? String(matchState).replace(/_/g, " ").toUpperCase();
}

const EVENT_ICONS = {
  goal: "\u26BD",
  yellow_card: "\uD83D\uDFE8",
  red_card: "\uD83D\uDFE5",
  corner: "\uD83D\uDCD0",
  corner_red: "\uD83D\uDCD0",
  corner_blue: "\uD83D\uDCD0",
  foul: "\u26A0\uFE0F",
  penalty: "\uD83C\uDFAF",
  kickoff: "\uD83C\uDFC1",
  halftime: "\u23F1\uFE0F",
  fulltime: "\uD83C\uDFC6",
};

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function teamToken(ev, locale) {
  if (!ev.team) return "";
  if (locale === "zh") {
    return ev.team === "red" ? " 红队" : ev.team === "blue" ? " 蓝队" : ` ${ev.team}`;
  }
  return ` ${cap(ev.team)}`;
}

// One ticker line for a matchEvents entry {type, team, time, payload}.
export function eventLabel(ev, locale = "en") {
  const icon = EVENT_ICONS[ev.type] || "\u2022";
  const team = teamToken(ev, locale);
  switch (ev.type) {
    case "goal": return `${icon} ${t(locale, "ev_goal", { team })}`;
    case "yellow_card": return `${icon} ${t(locale, "ev_yellow", { team })}`;
    case "red_card": return `${icon} ${t(locale, "ev_red", { team })}`;
    case "corner":
    case "corner_red":
    case "corner_blue": return `${icon} ${t(locale, "ev_corner", { team })}`;
    case "foul": return `${icon} ${t(locale, "ev_foul", { team })}`;
    case "penalty": return `${icon} ${t(locale, "ev_penalty", { team })}`;
    case "kickoff": return `${icon} ${t(locale, "ev_kickoff")}`;
    case "halftime": return `${icon} ${t(locale, "ev_halftime")}`;
    case "fulltime": return `${icon} ${t(locale, "ev_fulltime")}`;
    default: return `${icon}${team} ${String(ev.type).replace(/_/g, " ")}`;
  }
}

// The ticker keeps the last n events, newest last (render order fades the
// older entries out toward the top of the stack).
export function recentEvents(matchEvents, n = 3) {
  if (!Array.isArray(matchEvents)) return [];
  return matchEvents.slice(-n);
}
