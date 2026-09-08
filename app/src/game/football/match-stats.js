// Cumulative match report — possession time + shot attempts.
// Replaces the old vanity meters (press line / compact / threat bars).

import { FIELD_HALF_L } from './constants.js';
import { DEFAULT_STRATEGY, normalizeStrategy } from './strategy.js';

const SHOT_COOLDOWN_S = 2.5;
/** Max distance duck↔ball to count as a deliberate strike (m). */
const SHOT_BALL_DIST = 0.42;
/** Max |yaw − bearing-to-goal| for a shot (~35°). */
const SHOT_FACE_GOAL = 0.61;
/** Ball must be past midfield toward the attack (attacking half). */
const SHOT_MIN_ATTACK_X = 0.05;

function angleDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

/**
 * True when this kick is a goal-directed shot, not a poke / clearance / scramble.
 * Exported for unit tests.
 *
 * @param {'red'|'blue'} team
 * @param {{ x: number, y?: number }} ball
 * @param {{ x: number, y: number, yaw: number }} kicker
 */
export function isGoalDirectedShot(team, ball, kicker) {
  if (team !== 'red' && team !== 'blue') return false;
  if (!ball || !kicker) return false;
  if (![ball.x, kicker.x, kicker.y, kicker.yaw].every(Number.isFinite)) return false;

  const dir = team === 'red' ? 1 : -1;
  // Attacking half only — midfield scrums / own-half clearances out.
  if (ball.x * dir < SHOT_MIN_ATTACK_X) return false;

  const by = Number.isFinite(ball.y) ? ball.y : 0;
  const bd = Math.hypot(kicker.x - ball.x, kicker.y - by);
  if (bd > SHOT_BALL_DIST) return false;

  const goalX = dir * FIELD_HALF_L;
  const toGoal = Math.atan2(0 - kicker.y, goalX - kicker.x);
  if (Math.abs(angleDiff(kicker.yaw, toGoal)) > SHOT_FACE_GOAL) return false;

  return true;
}

/**
 * Mutable accumulator. Call tick() every referee step while PLAYING;
 * tryNoteShot() when a field duck starts a kick (filters to goal-aimed shots).
 */
export function createMatchStats() {
  let possRed = 0;
  let possBlue = 0;
  let shotsRed = 0;
  let shotsBlue = 0;
  let coolRed = 0;
  let coolBlue = 0;

  function reset() {
    possRed = 0;
    possBlue = 0;
    shotsRed = 0;
    shotsBlue = 0;
    coolRed = 0;
    coolBlue = 0;
  }

  /**
   * @param {number} dt
   * @param {{ matchState: string, lastTouchTeam: ?string }} ctx
   */
  function tick(dt, ctx) {
    const d = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    coolRed = Math.max(0, coolRed - d);
    coolBlue = Math.max(0, coolBlue - d);
    if (ctx?.matchState !== 'PLAYING') return;
    if (ctx.lastTouchTeam === 'red') possRed += d;
    else if (ctx.lastTouchTeam === 'blue') possBlue += d;
  }

  /**
   * @param {'red'|'blue'} team
   * @param {{ x: number, y?: number }} ball
   * @param {{ x: number, y: number, yaw: number }} kicker
   * @returns {boolean}
   */
  function tryNoteShot(team, ball, kicker) {
    if (!isGoalDirectedShot(team, ball, kicker)) return false;
    if (team === 'red') {
      if (coolRed > 0) return false;
      coolRed = SHOT_COOLDOWN_S;
      shotsRed += 1;
    } else {
      if (coolBlue > 0) return false;
      coolBlue = SHOT_COOLDOWN_S;
      shotsBlue += 1;
    }
    return true;
  }

  function snapshot() {
    const total = possRed + possBlue;
    return {
      possession: {
        red: +possRed.toFixed(2),
        blue: +possBlue.toFixed(2),
        redPct: total > 1e-6 ? possRed / total : 0.5,
      },
      shots: { red: shotsRed, blue: shotsBlue },
    };
  }

  return { reset, tick, tryNoteShot, snapshot };
}

/**
 * Live / fulltime board payload.
 * @param {object} args
 * @param {{ snapshot: Function }} args.stats
 * @param {object} [args.strategyByTeam]
 * @param {{ red: number, blue: number }} [args.score]
 * @param {'legs'|'rollers'} [args.loco] — sibling rating axis to strategy
 */
export function buildMatchReport({ stats, strategyByTeam = {}, score = null, loco = 'legs' }) {
  const snap = stats?.snapshot ? stats.snapshot() : {
    possession: { red: 0, blue: 0, redPct: 0.5 },
    shots: { red: 0, blue: 0 },
  };
  return {
    possession: snap.possession,
    shots: snap.shots,
    // Orthogonal axes — never fold loco into strategy fingerprints.
    strategy: {
      red: normalizeStrategy(strategyByTeam.red || DEFAULT_STRATEGY),
      blue: normalizeStrategy(strategyByTeam.blue || DEFAULT_STRATEGY),
    },
    loco: loco === 'rollers' ? 'rollers' : 'legs',
    score: score ? { red: score.red | 0, blue: score.blue | 0 } : null,
  };
}
