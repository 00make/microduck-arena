// Football AI — single-file pure-function architecture.
// Exports decideAll(ducks, gs) as the primary interface, plus backward-compat
// classes (BaseAgent, ForwardAgent, DefenderAgent, GoalkeeperAgent, createAgent)
// so game.js and tests keep working without changes.
//
// No THREE / MuJoCo / ONNX dependencies. Only imports data constants.

import { FIELD_HALF_L, FIELD_HALF_W, GOAL_WIDTH } from '../constants.js';

// ═══════════════════════════════════════════════════════════════════════════════
// TUNE — all adjustable parameters in one place
// ═══════════════════════════════════════════════════════════════════════════════

export const BASE_TUNE = {
  // Locomotion limits (mirrors game/constants.js VEL_FWD / VEL_BACK / VEL_ANG)
  VX_MAX: 0.25,
  VX_MIN: -0.2,
  WZ_MAX: 1.0,
  TURN_GAIN: 2.2,

  // Shooting
  SHOOT_DIST: 0.35,
  SHOOT_ANGLE: 0.26,        // ~15° alignment window
  SHOOT_SPEED: 0.25,     // raised above walk-policy dead-zone (~0.2 m/s)
  AIM_SPEED: 0.22,        // raised above walk-policy dead-zone (~0.2 m/s)

  // Deadlock breaking: after wasted at-feet kicks, stop kicking and shuffle
  // laterally for a short cooldown (breaks two-chaser mid-circle topple loops).
  APPROACH_OFFSET: 0.4,        // kept for PRESS overlays / tactics metrics
  KICK_COOLDOWN_TICKS: 15,     // ticks a stuck chaser stops kicking & repositions (1.5s @10Hz)
  KICK_HOLD_BEFORE_COOLDOWN: 2,// consecutive at-feet kick attempts before arming the cooldown

  // Chase approach (ER-Force MoveToStaticBall): stand at ball − shotDir × r,
  // not goto(ball). Slow ball → static offset; fast ball → short ball+v·t.
  BALL_SLOW_EPS: 0.12,         // |v| below this → static approach
  BALL_PREDICT_T: 0.7,         // max prediction horizon (s)
  APPROACH_ARRIVE_EPS: 0.12,   // on approach spot → step into ball

  // Chase / return — kickoff ~0.9 m to approach spot @ 0.25 m/s
  CHASE_SPEED: 0.25,
  RETURN_SPEED: 0.25,     // raised above walk-policy dead-zone (~0.2 m/s)

  // Anti-stuck
  MIN_EFFECTIVE_VX: 0.22,   // below this (but > 0) → raise to this; above dead-zone
  STALL_EPS: 0.02,          // position displacement threshold (m)
  STALL_TICKS_LIMIT: 15,    // consecutive stalled ticks → escape
  ESCAPE_TICKS: 10,         // escape maneuver duration
  AIM_MAX_TICKS: 80,        // AIM fuse: force CHASE after this many ticks

  // Formation
  FORMATION_X_ADVANCE: 0.3,
  FORMATION_X_RETREAT: -0.3,
  FORMATION_SLOT_EPS: 0.3,  // "at slot" distance

  // SSL-inspired role assignment / support (ER-Force cost, TIGERs support lane).
  // Still outputs {vx,wz,kick} — no path planner / messaging bus.
  CHASE_HYSTERESIS: 0.28,     // sticky bonus so chaser does not flicker every tick
  FACE_COST_WEIGHT: 0.35,     // metres-equivalent for facing away from the ball
  SUPPORT_AHEAD: 0.55,        // support stands this far past the ball (attack axis)
  SUPPORT_LATERAL: 0.7,       // lateral offset → open lane opposite the chaser
  SECOND_PRESS_DIST: 0,       // >0: non-chaser within range soft-contests (high press)

  // Goalkeeper
  GK_LINE_OFFSET: 0.1,
  GK_Y_MARGIN: 0.1,
  GK_DIVE_DIST: 1.5,
  GK_DIVE_VEL: 1.2,
  GK_RESET_DIST: 2.0,
  GK_CLEAR_DIST: 0.4,
  GK_DIVE_SPEED: 0.25,
  GK_TRACK_SPEED: 0.22,    // raised above walk-policy dead-zone (~0.2 m/s)
  GK_TURN_GAIN: 2.5,

  // Defender
  GUARD_X_FRAC: 0.55,
  GUARD_Y_TRACK: 0.5,
  GUARD_Y_MAX: 1.2,
  SUPPORT_X_FRAC: 0.4,
  DEF_CLEAR_DIST: 0.35,
  DEF_CHASE_SPEED: 0.25,
  DEF_TURN_GAIN: 2.2,
  TEAMMATE_BALL_DIST: 0.5,
};

// Active TUNE for the current decideAll call. Strategy overlays swap this for
// one team tick, then restore BASE_TUNE so tests / compat agents stay stable.
let TUNE = BASE_TUNE;

// ═══════════════════════════════════════════════════════════════════════════════
// Utility functions (pure math, no deps)
// ═══════════════════════════════════════════════════════════════════════════════

export function angleTo(ax, ay, bx, by) {
  return Math.atan2(by - ay, bx - ax);
}

export function distanceTo(ax, ay, bx, by) {
  return Math.hypot(bx - ax, by - ay);
}

export function normalizeAngle(a) {
  if (!Number.isFinite(a)) return 0;
  const twoPi = 2 * Math.PI;
  let r = a % twoPi;
  if (r > Math.PI) r -= twoPi;
  else if (r < -Math.PI) r += twoPi;
  return r;
}

export function angleDiff(current, target) {
  return normalizeAngle(target - current);
}

export function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Decision helpers (pure functions)
// ═══════════════════════════════════════════════════════════════════════════════

function turnToward(selfYaw, targetAngle, gain = TUNE.TURN_GAIN) {
  const diff = angleDiff(selfYaw, targetAngle);
  return clamp(diff * gain, -TUNE.WZ_MAX, TUNE.WZ_MAX);
}

/** cos-scaling fix: when target is behind (cos ≤ 0), return 0 — let turn lead. */
function moveToward(selfYaw, targetAngle, maxVx = TUNE.VX_MAX) {
  const diff = Math.abs(angleDiff(selfYaw, targetAngle));
  const c = Math.cos(diff);
  return c <= 0 ? 0 : maxVx * c;
}

function limitCommand(vx, wz, kick = false) {
  return {
    vx: Number.isFinite(vx) ? clamp(vx, TUNE.VX_MIN, TUNE.VX_MAX) : 0,
    wz: Number.isFinite(wz) ? clamp(wz, -TUNE.WZ_MAX, TUNE.WZ_MAX) : 0,
    kick: Boolean(kick),
  };
}

function distToBall(duck, ball) {
  const dx = (duck.pos ? duck.pos[0] : duck.x) - ball.x;
  const dy = (duck.pos ? duck.pos[1] : duck.y) - ball.y;
  return Math.hypot(dx, dy);
}

function angleToBall(duck, ball) {
  const sx = duck.pos ? duck.pos[0] : duck.x;
  const sy = duck.pos ? duck.pos[1] : duck.y;
  return angleTo(sx, sy, ball.x, ball.y);
}

function duckXY(d) {
  return d.pos ? [d.pos[0], d.pos[1]] : [d.x, d.y];
}

function getTeammates(duck, allDucks, team) {
  return allDucks.filter(d => d.team === team && d.id !== duck.id);
}

function getOpponents(duck, allDucks, team) {
  return allDucks.filter(d => d.team !== team);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Chaser selection (SSL / ER-Force style cost, not pure Euclidean)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Ball-get cost: distance + facing penalty − sticky hysteresis.
 * Lower is better. Exported for tactics-board + tests.
 */
export function chaseCost(duck, ball, prevChaserId = -1) {
  const [x, y] = duckXY(duck);
  const dist = distanceTo(x, y, ball.x, ball.y);
  const toBall = angleTo(x, y, ball.x, ball.y);
  const yaw = duck.yaw || 0;
  // 0 when facing the ball, up to 2 when facing away → weighted into metres.
  const face = 1 - Math.cos(angleDiff(yaw, toBall));
  let cost = dist + TUNE.FACE_COST_WEIGHT * face;
  if (duck.id === prevChaserId) cost -= TUNE.CHASE_HYSTERESIS;
  return cost;
}

/** Assign primary ball-getter among field players. */
export function assignChaserId(ducks, ball, prevChaserId = -1) {
  let best = null;
  let bestCost = Infinity;
  for (const d of ducks) {
    if (d.role === 'goalkeeper' || d.fallen || d.penalized || d.sentOff) continue;
    const c = chaseCost(d, ball, prevChaserId);
    if (c < bestCost) {
      bestCost = c;
      best = d;
    }
  }
  return best ? best.id : -1;
}

function prevChaserIdOf(ducks) {
  for (const d of ducks) {
    if (d._ai?.holdingChase) return d.id;
  }
  return -1;
}

function markChaserHold(ducks, chaserId) {
  for (const d of ducks) {
    if (d.id === chaserId) {
      if (!d._ai) {
        d._ai = {
          aimTicks: 0, stallTicks: 0, escapeTicks: 0,
          prevX: 0, prevY: 0, kickCooldown: 0, kickHoldTicks: 0,
        };
      }
      d._ai.holdingChase = true;
    } else if (d._ai) {
      d._ai.holdingChase = false;
    }
  }
}

/** Support lane opposite the chaser (TIGERs-style free position near the ball). */
function supportSlot(duck, ctx) {
  const { ball, attackDir, chaserId, ducks } = ctx;
  const spawnY = duck.spawnY != null ? duck.spawnY : 0;
  let latSign = spawnY >= 0 ? 1 : -1;
  const chaser = ducks.find((d) => d.id === chaserId);
  if (chaser) {
    const [, cy] = duckXY(chaser);
    latSign = (cy - ball.y) >= 0 ? -1 : 1;
  }
  return {
    x: clamp(ball.x + attackDir * TUNE.SUPPORT_AHEAD, -FIELD_HALF_L + 0.3, FIELD_HALF_L - 0.3),
    y: clamp(ball.y + latSign * TUNE.SUPPORT_LATERAL, -FIELD_HALF_W + 0.3, FIELD_HALF_W - 0.3),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Context builder
// ═══════════════════════════════════════════════════════════════════════════════

function buildCtx(ducks, gs) {
  const team = gs.team || (ducks[0] && ducks[0].team) || 'red';
  const attackDir = team === 'red' ? 1 : -1;
  const targetGoalX = attackDir * FIELD_HALF_L;
  const defendGoalX = -attackDir * FIELD_HALF_L;
  const ball = gs.ball;
  const allDucks = gs.allDucks || gs.ducks || ducks;
  const prevId = gs.prevChaserId != null ? gs.prevChaserId : prevChaserIdOf(ducks);
  const chaserId = assignChaserId(ducks, ball, prevId);
  markChaserHold(ducks, chaserId);
  return { team, attackDir, targetGoalX, defendGoalX, ball, allDucks, chaserId, ducks };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Role decision functions
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Goalkeeper: TRACK / DIVE / RESET
 * Mirrors ball Y on the goal line, dives at fast incoming shots.
 */
function gkDecide(duck, ctx) {
  const [sx, sy] = duckXY(duck);
  const yaw = duck.yaw || 0;
  const { ball, attackDir, defendGoalX } = ctx;
  const bd = distToBall(duck, ball);
  const lineX = defendGoalX + attackDir * TUNE.GK_LINE_OFFSET;

  // Is ball moving toward our goal?
  const ballToGoalX = defendGoalX - ball.x;
  const velToward = (ball.vx || 0) * Math.sign(ballToGoalX);
  const incoming = velToward > TUNE.GK_DIVE_VEL;

  // RESET: ball far away and not incoming
  if (bd > Math.max(TUNE.GK_DIVE_DIST, TUNE.GK_RESET_DIST) && !incoming) {
    const cx = lineX, cy = 0;
    const atCenter = distanceTo(sx, sy, cx, cy) < 0.2;
    if (atCenter) {
      return limitCommand(0, turnToward(yaw, attackDir > 0 ? 0 : Math.PI, TUNE.GK_TURN_GAIN));
    }
    const toC = angleTo(sx, sy, cx, cy);
    return limitCommand(
      moveToward(yaw, toC, TUNE.GK_TRACK_SPEED),
      turnToward(yaw, toC, TUNE.GK_TURN_GAIN),
    );
  }

  // DIVE: incoming shot within range
  if (incoming && bd < TUNE.GK_DIVE_DIST) {
    const toB = angleToBall(duck, ball);
    return limitCommand(
      moveToward(yaw, toB, TUNE.GK_DIVE_SPEED),
      turnToward(yaw, toB, TUNE.GK_TURN_GAIN),
      bd < TUNE.GK_CLEAR_DIST,
    );
  }

  // TRACK: shuffle along the line mirroring ball Y
  const maxY = GOAL_WIDTH / 2 - TUNE.GK_Y_MARGIN;
  const ty = clamp(ball.y, -maxY, maxY);
  const atPos = distanceTo(sx, sy, lineX, ty) < 0.15;
  if (atPos) {
    const toB = angleToBall(duck, ball);
    return limitCommand(0, turnToward(yaw, toB, TUNE.GK_TURN_GAIN));
  }
  const toPos = angleTo(sx, sy, lineX, ty);
  return limitCommand(
    moveToward(yaw, toPos, TUNE.GK_TRACK_SPEED),
    turnToward(yaw, toPos, TUNE.GK_TURN_GAIN),
  );
}

function ballSpeed(ball) {
  return Math.hypot(ball.vx || 0, ball.vy || 0);
}

/**
 * ER-Force MoveToStaticBall / short intercept.
 * Approach = predictedBall − shootDir × kickRadius (stand behind ball on the
 * shot axis). Slow/still ball → no prediction; fast ball → ball + v·t with
 * t ≈ dist/CHASE_SPEED capped by BALL_PREDICT_T.
 */
export function chaseApproachPoint(ball, targetGoalX, selfX, selfY) {
  const r = TUNE.SHOOT_DIST * 0.95;
  let bx = ball.x;
  let by = ball.y;
  const vx = ball.vx || 0;
  const vy = ball.vy || 0;
  if (ballSpeed(ball) > TUNE.BALL_SLOW_EPS) {
    const distNow = Math.hypot(bx - selfX, by - selfY);
    const t = clamp(distNow / Math.max(TUNE.CHASE_SPEED, 0.05), 0, TUNE.BALL_PREDICT_T);
    bx += vx * t;
    by += vy * t;
  }
  const gdx = targetGoalX - bx;
  const gdy = 0 - by;
  const glen = Math.hypot(gdx, gdy) || 1;
  return {
    x: bx - (gdx / glen) * r,
    y: by - (gdy / glen) * r,
  };
}

/**
 * Chaser: CHASE / AIM / SHOOT (merged forward logic).
 * Includes AIM fuse — if aiming too long, force back to CHASE.
 */
function chaserDecide(duck, ctx) {
  const [sx, sy] = duckXY(duck);
  const yaw = duck.yaw || 0;
  const { ball, targetGoalX } = ctx;
  const bd = distToBall(duck, ball);
  const toBall = angleToBall(duck, ball);
  const toGoal = angleTo(sx, sy, targetGoalX, 0);

  // Initialize per-duck AI state if absent
  if (!duck._ai) {
    duck._ai = { aimTicks: 0, stallTicks: 0, escapeTicks: 0, prevX: sx, prevY: sy, kickCooldown: 0, kickHoldTicks: 0 };
  }
  const ai = duck._ai;
  // game.js / the compat classes create _ai without the kick-cooldown fields;
  // lazily add them so the cross-frame state persists on the real duck object.
  if (ai.kickCooldown === undefined) ai.kickCooldown = 0;
  if (ai.kickHoldTicks === undefined) ai.kickHoldTicks = 0;

  // Tick the kick cooldown down once per decision.
  if (ai.kickCooldown > 0) ai.kickCooldown--;

  // Ball at feet?
  if (bd <= TUNE.SHOOT_DIST) {
    const aligned = Math.abs(angleDiff(yaw, toGoal)) <= TUNE.SHOOT_ANGLE;
    if (aligned) {
      ai.aimTicks = 0;
      // Cooldown active → stop kicking and shuffle laterally to re-approach from
      // a better angle. This is what breaks the symmetric mid-circle deadlock.
      if (ai.kickCooldown > 0) {
        ai.kickHoldTicks = 0;
        const lateralWz = (sy > ball.y) ? -TUNE.WZ_MAX * 0.5 : TUNE.WZ_MAX * 0.5;
        return limitCommand(TUNE.AIM_SPEED * 0.5, lateralWz, false);
      }
      // Count consecutive at-feet kick attempts. A single clean strike (ball
      // flies off → CHASE resets the counter) is never penalised; only a
      // sustained stuck-at-the-ball situation arms the cooldown after this kick.
      ai.kickHoldTicks++;
      if (ai.kickHoldTicks >= TUNE.KICK_HOLD_BEFORE_COOLDOWN) {
        ai.kickHoldTicks = 0;
        ai.kickCooldown = TUNE.KICK_COOLDOWN_TICKS;
      }
      return limitCommand(TUNE.SHOOT_SPEED, turnToward(yaw, toGoal), true);
    }
    // AIM — turn toward goal; after a short wind-up, poke-kick even if not
    // perfectly aligned so we don't stand on the ball forever walking.
    ai.kickHoldTicks = 0;
    ai.aimTicks++;
    if (ai.aimTicks > TUNE.AIM_MAX_TICKS) {
      // Fuse blown: re-approach via shot-axis stand point
      ai.aimTicks = 0;
      const ap = chaseApproachPoint(ball, targetGoalX, sx, sy);
      const toAp = angleTo(sx, sy, ap.x, ap.y);
      return limitCommand(
        moveToward(yaw, toAp, TUNE.CHASE_SPEED),
        turnToward(yaw, toAp),
      );
    }
    const pokeKick = ai.aimTicks >= 20;
    return limitCommand(
      moveToward(yaw, toGoal, TUNE.AIM_SPEED),
      turnToward(yaw, toGoal),
      pokeKick,
    );
  }

  // CHASE: MoveToStaticBall / intercept — go to (ball − shotDir × r), not ball centre.
  ai.aimTicks = 0;
  ai.kickHoldTicks = 0;
  const ap = chaseApproachPoint(ball, targetGoalX, sx, sy);
  const apDist = distanceTo(sx, sy, ap.x, ap.y);
  const aimAng = apDist < TUNE.APPROACH_ARRIVE_EPS ? toBall : angleTo(sx, sy, ap.x, ap.y);
  return limitCommand(
    moveToward(yaw, aimAng, TUNE.CHASE_SPEED),
    turnToward(yaw, aimAng),
  );
}

/**
 * Formation / support: non-chaser field ducks.
 * Own half → cover/retreat slot. Attack half → TIGERs-style support lane near
 * the ball. High press (SECOND_PRESS_DIST) → soft second contest.
 */
function formationDecide(duck, ctx) {
  const [sx, sy] = duckXY(duck);
  const yaw = duck.yaw || 0;
  const { ball, attackDir, defendGoalX, targetGoalX, allDucks, team } = ctx;

  const ballInOwnHalf = ball.x * attackDir < 0;
  const spawnX = duck.spawnX != null ? duck.spawnX : (attackDir > 0 ? -0.8 : 0.8);
  const spawnY = duck.spawnY != null ? duck.spawnY : 0;

  // Defender-specific: GUARD / INTERCEPT / CLEAR / SUPPORT
  if (duck.role === 'defender') {
    return defenderFormation(duck, ctx, sx, sy, yaw, ball, attackDir, defendGoalX, targetGoalX, allDucks, team);
  }

  const bd = distToBall(duck, ball);

  // High press: second player soft-contests loose ball (does not shoot — chaser owns kick).
  if (
    !ballInOwnHalf &&
    TUNE.SECOND_PRESS_DIST > 0 &&
    bd < TUNE.SECOND_PRESS_DIST &&
    bd > TUNE.SHOOT_DIST
  ) {
    const toB = angleToBall(duck, ball);
    return limitCommand(
      moveToward(yaw, toB, TUNE.CHASE_SPEED * 0.85),
      turnToward(yaw, toB),
    );
  }

  let slotX, slotY;
  if (ballInOwnHalf) {
    // Defensive cover: pull back toward own half (spawn-anchored)
    slotX = attackDir * Math.max(Math.abs(spawnX), 1.0) + TUNE.FORMATION_X_RETREAT * attackDir;
    slotY = spawnY;
  } else {
    // Attack support lane near the ball (not a deep static spawn mirror)
    const slot = supportSlot(duck, ctx);
    slotX = slot.x;
    slotY = slot.y;
    // Blend a little of formation advance so style overlays still matter
    slotX += TUNE.FORMATION_X_ADVANCE * attackDir * 0.35;
    slotX = clamp(slotX, -FIELD_HALF_L + 0.3, FIELD_HALF_L - 0.3);
  }

  const atSlot = distanceTo(sx, sy, slotX, slotY) < TUNE.FORMATION_SLOT_EPS;
  if (atSlot) {
    return limitCommand(0, turnToward(yaw, attackDir > 0 ? 0 : Math.PI));
  }
  const toSlot = angleTo(sx, sy, slotX, slotY);
  return limitCommand(
    moveToward(yaw, toSlot, TUNE.RETURN_SPEED),
    turnToward(yaw, toSlot),
  );
}

/** Defender-specific formation logic: GUARD / INTERCEPT / CLEAR / SUPPORT */
function defenderFormation(duck, ctx, sx, sy, yaw, ball, attackDir, defendGoalX, targetGoalX, allDucks, team) {
  const bd = distToBall(duck, ball);
  const ballInOwnHalf = ball.x * attackDir < 0;

  // CLEAR: ball at feet in own half → hoof it
  if (bd <= TUNE.DEF_CLEAR_DIST && ballInOwnHalf) {
    const toGoal = angleTo(sx, sy, targetGoalX, 0);
    return limitCommand(TUNE.DEF_CHASE_SPEED * 0.8, turnToward(yaw, toGoal, TUNE.DEF_TURN_GAIN), true);
  }

  // SUPPORT: teammate on ball up-field
  const teammateOnBall = ball.x * attackDir > 0 &&
    getTeammates(duck, allDucks, team).some(m => {
      if (m.fallen) return false;
      const [mx, my] = duckXY(m);
      return distanceTo(mx, my, ball.x, ball.y) <= TUNE.TEAMMATE_BALL_DIST;
    });
  if (teammateOnBall) {
    const supX = attackDir * FIELD_HALF_L * TUNE.SUPPORT_X_FRAC;
    const toSup = angleTo(sx, sy, supX, ball.y);
    return limitCommand(
      moveToward(yaw, toSup, TUNE.DEF_CHASE_SPEED),
      turnToward(yaw, toSup, TUNE.DEF_TURN_GAIN),
    );
  }

  // INTERCEPT: ball loose in own half
  if (ballInOwnHalf) {
    const toB = angleToBall(duck, ball);
    return limitCommand(
      moveToward(yaw, toB, TUNE.DEF_CHASE_SPEED),
      turnToward(yaw, toB, TUNE.DEF_TURN_GAIN),
    );
  }

  // GUARD: hold the guard line
  const guardY = clamp(ball.y * TUNE.GUARD_Y_TRACK, -TUNE.GUARD_Y_MAX, TUNE.GUARD_Y_MAX);
  const guardX = defendGoalX * TUNE.GUARD_X_FRAC;
  const atGuard = distanceTo(sx, sy, guardX, guardY) < 0.25;
  if (atGuard) {
    return limitCommand(0, turnToward(yaw, attackDir > 0 ? 0 : Math.PI, TUNE.DEF_TURN_GAIN));
  }
  const toGuard = angleTo(sx, sy, guardX, guardY);
  return limitCommand(
    moveToward(yaw, toGuard, TUNE.DEF_CHASE_SPEED),
    turnToward(yaw, toGuard, TUNE.DEF_TURN_GAIN),
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Anti-stuck
// ═══════════════════════════════════════════════════════════════════════════════

/** Raise sub-threshold vx to MIN_EFFECTIVE_VX to prevent stalling. */
function applyAntiStuck(cmd) {
  let { vx, wz, kick } = cmd;
  if (vx > 0 && vx < TUNE.MIN_EFFECTIVE_VX) vx = TUNE.MIN_EFFECTIVE_VX;
  if (vx < 0 && vx > -TUNE.MIN_EFFECTIVE_VX) vx = -TUNE.MIN_EFFECTIVE_VX;
  return { vx, wz, kick };
}

// ═══════════════════════════════════════════════════════════════════════════════
// decideAll — primary interface
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Compute locomotion commands for one team's ducks this tick.
 * @param {Array} ducks  Team ducks: [{id, pos:[x,y], yaw, role, fallen, penalized, team, spawnX?, spawnY?, _ai?}]
 * @param {Object} gs    {ball:{x,y,vx,vy}, allDucks:[...], team, time?, tuneOverlay?}
 * @returns {Array<{vx:number, wz:number, kick:boolean}>}
 */
export function decideAll(ducks, gs) {
  if (!ducks || !ducks.length) return [];
  const prevTune = TUNE;
  const overlay = gs?.tuneOverlay;
  TUNE = overlay && Object.keys(overlay).length
    ? { ...BASE_TUNE, ...overlay }
    : BASE_TUNE;
  try {
    const ctx = buildCtx(ducks, gs);
    return ducks.map(d => {
      if (d.fallen || d.penalized) return { vx: 0, wz: 0, kick: false };
      if (d.role === 'goalkeeper') return gkDecide(d, ctx);
      if (d.id === ctx.chaserId) return chaserDecide(d, ctx);
      return formationDecide(d, ctx);
    }).map(cmd => applyAntiStuck(cmd));
  } finally {
    TUNE = prevTune;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Backward-compatible constants
// ═══════════════════════════════════════════════════════════════════════════════

export const VX_MAX = TUNE.VX_MAX;
export const VX_MIN = TUNE.VX_MIN;
export const WZ_MAX = TUNE.WZ_MAX;
export const SHOOT_SPEED = TUNE.SHOOT_SPEED;
export const CHASE_SPEED = TUNE.CHASE_SPEED;
export const AIM_SPEED = TUNE.AIM_SPEED;
export const RETURN_SPEED = TUNE.RETURN_SPEED;
export const SHOOT_ANGLE_THRESH = TUNE.SHOOT_ANGLE;
export const SHOOT_DIST = TUNE.SHOOT_DIST;
export const TURN_GAIN = TUNE.TURN_GAIN;
export const GK_LINE_OFFSET = TUNE.GK_LINE_OFFSET;
export const GK_Y_MARGIN = TUNE.GK_Y_MARGIN;
export const GK_DIVE_DIST = TUNE.GK_DIVE_DIST;
export const GK_DIVE_VEL = TUNE.GK_DIVE_VEL;
export const GK_RESET_DIST = TUNE.GK_RESET_DIST;
export const GK_CLEAR_DIST = TUNE.GK_CLEAR_DIST;
export const GK_DIVE_SPEED = TUNE.GK_DIVE_SPEED;
export const GK_TRACK_SPEED = TUNE.GK_TRACK_SPEED;
export const GK_TURN_GAIN = TUNE.GK_TURN_GAIN;
export const GUARD_X_FRAC = TUNE.GUARD_X_FRAC;
export const GUARD_Y_TRACK = TUNE.GUARD_Y_TRACK;
export const GUARD_Y_MAX = TUNE.GUARD_Y_MAX;
export const SUPPORT_X_FRAC = TUNE.SUPPORT_X_FRAC;
export const DEF_CLEAR_DIST = TUNE.DEF_CLEAR_DIST;
export const DEF_CHASE_SPEED = TUNE.DEF_CHASE_SPEED;
export const DEF_TURN_GAIN = TUNE.DEF_TURN_GAIN;
export const TEAMMATE_BALL_DIST = TUNE.TEAMMATE_BALL_DIST;

// ═══════════════════════════════════════════════════════════════════════════════
// Backward-compatible classes
// ═══════════════════════════════════════════════════════════════════════════════

export class BaseAgent {
  constructor(duck, config) {
    this.duck = duck;
    this.team = config.team;
    this.role = config.role;
    this.spawnX = config.spawnX;
    this.spawnY = config.spawnY;
    this.attackDir = config.team === 'red' ? 1 : -1;
    this.targetGoalX = this.attackDir * FIELD_HALF_L;
    this.defendGoalX = -this.attackDir * FIELD_HALF_L;
    // Per-agent AI state for compat path
    this._ai = { aimTicks: 0, stallTicks: 0, escapeTicks: 0, prevX: 0, prevY: 0 };
  }

  /**
   * Compat decide: adapts old gs format {ball, ducks, self} → decideAll.
   * Passes all team ducks so pickChaser sees the full picture.
   * @param {object} gs
   * @returns {{vx:number, wz:number, kick:boolean}}
   */
  decide(gs) {
    const self = gs.self;
    // Build team duck list from gs.ducks for correct chaser selection
    const teamDucks = (gs.ducks || [])
      .filter(d => d.team === this.team)
      .map(d => ({
        id: d.id,
        pos: [d.x, d.y],
        yaw: d.yaw || 0,
        role: d.role || 'forward',
        fallen: d.fallen || false,
        penalized: false,
        team: d.team,
        spawnX: d.id === self.id ? this.spawnX : undefined,
        spawnY: d.id === self.id ? this.spawnY : undefined,
        _ai: d.id === self.id ? this._ai : undefined,
      }));
    // Ensure self is in the list even if gs.ducks is incomplete
    if (!teamDucks.some(d => d.id === self.id)) {
      teamDucks.push({
        id: self.id, pos: [self.x, self.y], yaw: self.yaw || 0,
        role: this.role, fallen: false, penalized: false,
        team: this.team, spawnX: this.spawnX, spawnY: this.spawnY, _ai: this._ai,
      });
    }
    const adapted = {
      ball: gs.ball,
      allDucks: gs.ducks || teamDucks,
      team: this.team,
    };
    const cmds = decideAll(teamDucks, adapted);
    const idx = teamDucks.findIndex(d => d.id === self.id);
    return (idx >= 0 && cmds[idx]) || { vx: 0, wz: 0, kick: false };
  }

  getState() { return 'active'; }
  getSelf(gs) { return gs.self; }
  getTeammates(gs) { return gs.ducks.filter(d => d.team === this.team && d.id !== gs.self.id); }
  getOpponents(gs) { return gs.ducks.filter(d => d.team !== this.team); }
  distToBall(gs) { return distanceTo(gs.self.x, gs.self.y, gs.ball.x, gs.ball.y); }
  angleToBall(gs) { return angleTo(gs.self.x, gs.self.y, gs.ball.x, gs.ball.y); }
  turnToward(selfYaw, targetAngle, gain) { return turnToward(selfYaw, targetAngle, gain); }
  moveToward(selfYaw, targetAngle, maxVx) { return moveToward(selfYaw, targetAngle, maxVx); }
  limitCommand(cmd) { return limitCommand(cmd.vx, cmd.wz, cmd.kick); }
}

export class ForwardAgent extends BaseAgent {
  formationSlot() {
    return {
      x: this.attackDir * Math.max(Math.abs(this.spawnX), 1.0),
      y: this.spawnY,
    };
  }

  ballInOwnHalf(gs) { return gs.ball.x * this.attackDir < 0; }

  nearestTeammateToBall(gs) {
    let best = null, bestDist = Infinity;
    for (const mate of this.getTeammates(gs)) {
      if (mate.fallen) continue;
      const d = distanceTo(mate.x, mate.y, gs.ball.x, gs.ball.y);
      if (d < bestDist) { bestDist = d; best = mate; }
    }
    return best ? { mate: best, dist: bestDist } : null;
  }

  getState(gs) {
    const self = this.getSelf(gs);
    const ballDist = this.distToBall(gs);
    if (ballDist <= TUNE.SHOOT_DIST) {
      const toGoal = angleTo(self.x, self.y, this.targetGoalX, 0);
      return Math.abs(angleDiff(self.yaw, toGoal)) <= TUNE.SHOOT_ANGLE
        ? 'SHOOT' : 'AIM';
    }
    if (!this.ballInOwnHalf(gs)) {
      const nearest = this.nearestTeammateToBall(gs);
      if (nearest && nearest.dist < ballDist) return 'RETURN';
    }
    return 'CHASE';
  }
}

export class DefenderAgent extends BaseAgent {
  guardPos(gs) {
    const y = clamp(gs.ball.y * TUNE.GUARD_Y_TRACK, -TUNE.GUARD_Y_MAX, TUNE.GUARD_Y_MAX);
    return { x: this.defendGoalX * TUNE.GUARD_X_FRAC, y };
  }

  supportPos(gs) {
    return { x: this.attackDir * FIELD_HALF_L * TUNE.SUPPORT_X_FRAC, y: gs.ball.y };
  }

  teammateOnBall(gs) {
    if (gs.ball.x * this.attackDir <= 0) return false;
    return this.getTeammates(gs).some(m =>
      !m.fallen && distanceTo(m.x, m.y, gs.ball.x, gs.ball.y) <= TUNE.TEAMMATE_BALL_DIST);
  }

  getState(gs) {
    const inOwnHalf = gs.ball.x * this.attackDir < 0;
    if (this.distToBall(gs) <= TUNE.DEF_CLEAR_DIST && inOwnHalf) return 'CLEAR';
    if (this.teammateOnBall(gs)) return 'SUPPORT';
    if (inOwnHalf) return 'INTERCEPT';
    return 'GUARD';
  }
}

export class GoalkeeperAgent extends BaseAgent {
  lineX() { return this.defendGoalX + this.attackDir * TUNE.GK_LINE_OFFSET; }

  trackPos(gs) {
    const maxY = GOAL_WIDTH / 2 - TUNE.GK_Y_MARGIN;
    return { x: this.lineX(), y: clamp(gs.ball.y, -maxY, maxY) };
  }

  ballMovingToGoal(gs) {
    const ballToGoalX = this.defendGoalX - gs.ball.x;
    return (gs.ball.vx || 0) * Math.sign(ballToGoalX) > TUNE.GK_DIVE_VEL;
  }

  getState(gs) {
    const ballDist = this.distToBall(gs);
    if (ballDist > Math.max(TUNE.GK_DIVE_DIST, TUNE.GK_RESET_DIST) && !this.ballMovingToGoal(gs)) return 'RESET';
    if (this.ballMovingToGoal(gs) && ballDist < TUNE.GK_DIVE_DIST) return 'DIVE';
    return 'TRACK';
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Factory
// ═══════════════════════════════════════════════════════════════════════════════

export function createAgent(duck, config) {
  switch (config.role) {
    case 'forward': return new ForwardAgent(duck, config);
    case 'defender': return new DefenderAgent(duck, config);
    case 'goalkeeper': return new GoalkeeperAgent(duck, config);
    default: return new ForwardAgent(duck, config);
  }
}
