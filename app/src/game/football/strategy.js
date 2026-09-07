// Coach-facing strategy presets for 3v3 football.
// Maps UI choices (formation / style / press) onto spawn roles and TUNE overlays.
// Opponent teams without a user strategy keep DEFAULT_STRATEGY.

import { SPAWN_POSITIONS } from './constants.js';

export const FORMATION_IDS = ['2f1gk', '1f1d1gk'];
export const STYLE_IDS = ['attack', 'balanced', 'defend'];
export const PRESS_IDS = ['low', 'medium', 'high'];

export const DEFAULT_STRATEGY = Object.freeze({
  formation: '2f1gk',
  style: 'balanced',
  press: 'medium',
});

/** 1F+1D+1GK spawn table (same duck id layout as SPAWN_POSITIONS). */
const SPAWN_1F1D1GK = [
  { team: 'red', role: 'forward', x: -0.8, y: 0.5, yaw: 0 },
  { team: 'red', role: 'defender', x: -1.6, y: -0.3, yaw: 0 },
  { team: 'red', role: 'goalkeeper', x: -2.8, y: 0.0, yaw: 0 },
  { team: 'blue', role: 'forward', x: 0.8, y: 0.5, yaw: Math.PI },
  { team: 'blue', role: 'defender', x: 1.6, y: -0.3, yaw: Math.PI },
  { team: 'blue', role: 'goalkeeper', x: 2.8, y: 0.0, yaw: Math.PI },
];

export const FORMATION_SPAWNS = Object.freeze({
  '2f1gk': SPAWN_POSITIONS,
  '1f1d1gk': SPAWN_1F1D1GK,
});

const STYLE_OVERLAYS = {
  attack: {
    FORMATION_X_ADVANCE: 0.55,
    FORMATION_X_RETREAT: -0.1,
    SHOOT_ANGLE: 0.34,
    SHOOT_DIST: 0.4,
    SUPPORT_X_FRAC: 0.55,
    GUARD_X_FRAC: 0.45,
    SUPPORT_AHEAD: 0.7,
    SUPPORT_LATERAL: 0.6,
  },
  balanced: {},
  defend: {
    FORMATION_X_ADVANCE: 0.1,
    FORMATION_X_RETREAT: -0.55,
    SHOOT_ANGLE: 0.2,
    SHOOT_DIST: 0.3,
    SUPPORT_X_FRAC: 0.28,
    GUARD_X_FRAC: 0.68,
    GK_DIVE_DIST: 1.7,
    SUPPORT_AHEAD: 0.35,
    SUPPORT_LATERAL: 0.85,
  },
};

const PRESS_OVERLAYS = {
  low: {
    APPROACH_OFFSET: 0.55,
    FORMATION_X_ADVANCE: 0.15,
    CHASE_SPEED: 0.22,
    DEF_CHASE_SPEED: 0.22,
    SUPPORT_AHEAD: 0.35,
    SUPPORT_LATERAL: 0.9,
    SECOND_PRESS_DIST: 0,
    CHASE_HYSTERESIS: 0.35,
  },
  medium: {
    // Kickoff / open play: second forward also walks toward a loose ball so
    // the opening does not look like one duck hunting while the other parks.
    SECOND_PRESS_DIST: 1.15,
  },
  high: {
    APPROACH_OFFSET: 0.22,
    FORMATION_X_ADVANCE: 0.5,
    CHASE_SPEED: 0.25,
    DEF_CHASE_SPEED: 0.25,
    DEF_CLEAR_DIST: 0.45,
    TEAMMATE_BALL_DIST: 0.65,
    SUPPORT_AHEAD: 0.45,
    SUPPORT_LATERAL: 0.55,
    SECOND_PRESS_DIST: 1.35,
    FACE_COST_WEIGHT: 0.25,
    CHASE_HYSTERESIS: 0.2,
  },
};

export function normalizeStrategy(partial = {}) {
  const formation = FORMATION_IDS.includes(partial.formation)
    ? partial.formation
    : DEFAULT_STRATEGY.formation;
  const style = STYLE_IDS.includes(partial.style)
    ? partial.style
    : DEFAULT_STRATEGY.style;
  const press = PRESS_IDS.includes(partial.press)
    ? partial.press
    : DEFAULT_STRATEGY.press;
  return { formation, style, press };
}

/** Merge style + press overlays into a flat TUNE patch (later keys win). */
export function getTuneOverlay(strategy) {
  const s = normalizeStrategy(strategy);
  return {
    ...STYLE_OVERLAYS[s.style],
    ...PRESS_OVERLAYS[s.press],
  };
}

/**
 * Build the six-slot spawn table from per-team strategies.
 * Each team's three slots come from that team's formation; positions/roles
 * stay aligned to fixed duck ids 0..5.
 */
export function buildSpawnTable(strategyByTeam = {}) {
  return SPAWN_POSITIONS.map((base, id) => {
    const strat = normalizeStrategy(strategyByTeam[base.team]);
    const table = FORMATION_SPAWNS[strat.formation] || FORMATION_SPAWNS['2f1gk'];
    const slot = table[id] || base;
    return {
      team: slot.team,
      role: slot.role,
      x: slot.x,
      y: slot.y,
      yaw: slot.yaw,
    };
  });
}

export function strategiesForUser(userTeam, userStrategy) {
  const mine = normalizeStrategy(userStrategy);
  return {
    red: userTeam === 'red' ? mine : { ...DEFAULT_STRATEGY },
    blue: userTeam === 'blue' ? mine : { ...DEFAULT_STRATEGY },
  };
}
