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

  // Chase approach (Booster approach_target): stand at ball − shotDir × offset.
  // Slow ball → static offset; fast ball → short ball+v·t.
  BALL_SLOW_EPS: 0.12,         // |v| below this → static approach
  BALL_PREDICT_T: 0.7,         // max prediction horizon (s)
  APPROACH_ARRIVE_EPS: 0.18,   // slightly loose so we commit into the ball
  APPROACH_OFFSET: 0.32,       // tighter stand-behind (less orbit distance)
  KICK_COOLDOWN_TICKS: 15,     // ticks a stuck chaser stops kicking & repositions (1.5s @10Hz)
  KICK_HOLD_BEFORE_COOLDOWN: 2,// consecutive at-feet kick attempts before arming the cooldown
  AIM_CREEP: 0.22,             // while AIM: keep walking into the ball (no freeze-stare)
  AIM_SOFT_TICKS: 8,           // after this many AIM ticks, widen align window
  ORBIT_COMMIT_TICKS: 14,      // stop pure orbit; cut toward approach even if path skims
  ORBIT_RADIUS: 0.40,          // tighter lateral ring (was 0.55 → endless circles)

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
  // Booster ball_claim_score role bias (Booster CENTER −0.20 / SIDE −0.10)
  CLAIM_FORWARD_BONUS: 0.20,  // prefer forwards (Booster CENTER −0.20)
  CLAIM_DEFENDER_BONUS: 0.10, // slight preference vs pure distance
  CLAIM_ATTACK_HALF_BONUS: 0.15, // already upfield when ball is attacking
  CLAIM_TIE_MARGIN: 0.12,     // costs within this → lowest duck id (Booster)
  CLAIM_WRONG_SIDE_PENALTY: 0.75, // metres: standing on the attack side of the ball
  CLAIM_STUCK_ORBIT: 16,      // orbitTicks above this → drop sticky claim
  CLAIM_STUCK_AT_FEET: 12,    // atFeetTicks without behind → drop sticky claim
  SUPPORT_AHEAD: 0.55,        // support stands this far past the ball (attack axis)
  SUPPORT_LATERAL: 0.7,       // lateral offset → open lane opposite the chaser
  SECOND_PRESS_DIST: 0,       // >0: non-chaser within range soft-contests (high press)
  // Strategy regimes (set by coach card overlay; 0/1 flags)
  LINE_HOLD_MID: 0,           // 1 → non-chasers stay in own half
  LINE_PUSH_MID: 0,           // 1 → attack support stays past midfield

  // Soft walk-target repulsion (Booster navigation / support spacing lite).
  // Pushes waypoints away from nearby ducks so paths don't stack on one spot.
  AVOID_RADIUS: 0.55,         // start repelling when a blocker is within this of the target
  AVOID_STRENGTH: 0.40,       // max push (m) when coincident with a blocker
  // Non-chasers must stay outside this ring so only one duck owns the ball.
  BALL_KEEP_OUT: 0.85,

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

/**
 * AIM creep: always walk longitudinally toward a bearing (forward or reverse).
 * Unlike moveToward, never freezes at vx=0 when the target is beside/behind.
 */
function creepToward(selfYaw, targetAngle, speed = TUNE.AIM_CREEP) {
  const c = Math.cos(angleDiff(selfYaw, targetAngle));
  if (c >= 0.15) return speed;
  if (c <= -0.15) return clamp(-speed, TUNE.VX_MIN, TUNE.VX_MAX);
  // Nearly sideways — still ease in so gait doesn't stall while turning.
  return speed * 0.7;
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
 * Booster-style ball claim cost (lower is better).
 * distance + facing − role/half bonuses − sticky hysteresis.
 * Exported for tactics-board + tests.
 *
 * @param {object} duck
 * @param {{x:number,y:number}} ball
 * @param {number} [prevChaserId=-1]
 * @param {number} [attackDir=1]  +1 red / −1 blue
 */
export function chaseCost(duck, ball, prevChaserId = -1, attackDir = 1) {
  const [x, y] = duckXY(duck);
  const dist = distanceTo(x, y, ball.x, ball.y);
  const toBall = angleTo(x, y, ball.x, ball.y);
  const yaw = duck.yaw || 0;
  // 0 when facing the ball, up to 2 when facing away → weighted into metres.
  const face = 1 - Math.cos(angleDiff(yaw, toBall));
  let cost = dist + TUNE.FACE_COST_WEIGHT * face;

  // ball_claim_score role bias (Booster CENTER −0.20 / SIDE −0.10)
  const role = duck.role || 'forward';
  if (role === 'forward') cost -= TUNE.CLAIM_FORWARD_BONUS;
  else if (role === 'defender') cost -= TUNE.CLAIM_DEFENDER_BONUS;

  // Already upfield while ball is in attack half → slight preference
  if (ball.x * attackDir > 0 && x * attackDir > -0.3) {
    cost -= TUNE.CLAIM_ATTACK_HALF_BONUS;
  }

  // Wrong side of the shot axis (between ball and opponent goal) → expensive.
  // Stops a scrumming attack-side duck from forever owning the claim.
  const targetGoalX = attackDir * FIELD_HALF_L;
  if (!isBehindBall(x, y, ball, targetGoalX)) {
    cost += TUNE.CLAIM_WRONG_SIDE_PENALTY;
  }

  if (duck.id === prevChaserId) cost -= TUNE.CHASE_HYSTERESIS;
  return cost;
}

/**
 * Sticky claim expires when the holder is circling / staring without getting behind.
 * Free teammate can then become the finder instead of idling outside BALL_KEEP_OUT.
 */
function chaserClaimExpired(duck, ball, attackDir) {
  if (!duck?._ai) return false;
  const ai = duck._ai;
  const [x, y] = duckXY(duck);
  const targetGoalX = attackDir * FIELD_HALF_L;
  const behind = isBehindBall(x, y, ball, targetGoalX);
  if ((ai.orbitTicks | 0) >= TUNE.CLAIM_STUCK_ORBIT && !behind) return true;
  if ((ai.atFeetTicks | 0) >= TUNE.CLAIM_STUCK_AT_FEET && !behind) return true;
  return false;
}

/**
 * Assign primary ball-getter among field players.
 * Ties within CLAIM_TIE_MARGIN → lowest duck id (Booster select_chaser).
 */
export function assignChaserId(ducks, ball, prevChaserId = -1, attackDir = 1) {
  const scored = [];
  for (const d of ducks) {
    if (d.role === 'goalkeeper' || d.fallen || d.penalized || d.sentOff) continue;
    scored.push({
      id: d.id,
      cost: chaseCost(d, ball, prevChaserId, attackDir),
    });
  }
  if (!scored.length) return -1;
  scored.sort((a, b) => (a.cost - b.cost) || (a.id - b.id));
  const best = scored[0].cost;
  const margin = TUNE.CLAIM_TIE_MARGIN;
  let pick = scored[0].id;
  for (const s of scored) {
    if (s.cost > best + margin) break;
    if (s.id < pick) pick = s.id;
  }
  return pick;
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
  let x = ball.x + attackDir * TUNE.SUPPORT_AHEAD;
  let y = ball.y + latSign * TUNE.SUPPORT_LATERAL;
  // Corner: don't join the pack — sit more central so one chaser owns the ball.
  const nearCorner = Math.abs(ball.x) > FIELD_HALF_L - 0.95
    && Math.abs(ball.y) > FIELD_HALF_W - 0.95;
  if (nearCorner) {
    x = ball.x * 0.5 + attackDir * 0.35;
    y = ball.y * 0.3;
  }
  return {
    x: clamp(x, -FIELD_HALF_L + 0.3, FIELD_HALF_L - 0.3),
    y: clamp(y, -FIELD_HALF_W + 0.3, FIELD_HALF_W - 0.3),
  };
}

/**
 * Soft-repel a walk waypoint away from nearby ducks (Booster spacing lite).
 * Does not plan a path — only nudges the target so slots / approaches don't
 * land on top of another body. Field-clamped.
 *
 * @param {number} tx
 * @param {number} ty
 * @param {{id:number}} self
 * @param {Array} blockers  all ducks on the pitch (team + opponents)
 * @returns {{x:number,y:number}}
 */
export function repelWalkTarget(tx, ty, self, blockers) {
  let x = tx;
  let y = ty;
  const sid = self && self.id;
  const radius = TUNE.AVOID_RADIUS;
  const strength = TUNE.AVOID_STRENGTH;
  if (!(radius > 0) || !(strength > 0) || !blockers || !blockers.length) {
    return {
      x: clamp(x, -FIELD_HALF_L + 0.3, FIELD_HALF_L - 0.3),
      y: clamp(y, -FIELD_HALF_W + 0.3, FIELD_HALF_W - 0.3),
    };
  }
  for (const o of blockers) {
    if (!o || o.id === sid || o.fallen || o.penalized || o.sentOff) continue;
    const [ox, oy] = duckXY(o);
    if (!Number.isFinite(ox) || !Number.isFinite(oy)) continue;
    let dx = x - ox;
    let dy = y - oy;
    let d = Math.hypot(dx, dy);
    if (d >= radius) continue;
    if (d < 1e-4) {
      // Coincident: push along +Y so the nudge is deterministic.
      x += 0;
      y += strength;
      continue;
    }
    const push = ((radius - d) / radius) * strength;
    x += (dx / d) * push;
    y += (dy / d) * push;
  }
  return {
    x: clamp(x, -FIELD_HALF_L + 0.3, FIELD_HALF_L - 0.3),
    y: clamp(y, -FIELD_HALF_W + 0.3, FIELD_HALF_W - 0.3),
  };
}

/** Apply repelWalkTarget unless near the ball (chaser must not lose the approach). */
function avoidWalkPoint(tx, ty, duck, ctx) {
  const bd = distToBall(duck, ctx.ball);
  // Within ~1.2 m the approach geometry matters more than teammate spacing.
  if (bd <= 1.2) return { x: tx, y: ty };
  const blockers = ctx.allDucks || ctx.ducks || [];
  return repelWalkTarget(tx, ty, duck, blockers);
}

/**
 * Side-step waypoint around the ball toward the approach spot.
 * Never aims through the ball (that shoves it into our own net).
 * @param {number} [blend=0] 0..1 pull the orbit point toward the approach (spiral in)
 */
export function lateralOrbitPoint(sx, sy, ball, apx, apy, blend = 0) {
  const bx = ball.x;
  const by = ball.y || 0;
  let ax = apx - bx;
  let ay = apy - by;
  const al = Math.hypot(ax, ay) || 1;
  ax /= al;
  ay /= al;
  // Perpendicular; pick the side already closer to the duck.
  let px = -ay;
  let py = ax;
  if ((sx - bx) * px + (sy - by) * py < 0) {
    px = -px;
    py = -py;
  }
  const bd = Math.hypot(sx - bx, sy - by);
  const radius = Math.min(TUNE.ORBIT_RADIUS, Math.max(0.28, bd * 0.85));
  let x = bx + px * radius;
  let y = by + py * radius;
  const t = clamp(blend, 0, 1);
  if (t > 0) {
    x = x + (apx - x) * t;
    y = y + (apy - y) * t;
  }
  return {
    x: clamp(x, -FIELD_HALF_L + 0.25, FIELD_HALF_L - 0.25),
    y: clamp(y, -FIELD_HALF_W + 0.25, FIELD_HALF_W - 0.25),
  };
}

/** True when walking straight to the target would skim through the ball. */
function pathSkimsBall(sx, sy, tx, ty, ball, rad = TUNE.SHOOT_DIST * 0.85) {
  const bx = ball.x;
  const by = ball.y || 0;
  const abx = tx - sx;
  const aby = ty - sy;
  const len = Math.hypot(abx, aby);
  if (len < 1e-4) return false;
  const t = clamp(((bx - sx) * abx + (by - sy) * aby) / (len * len), 0, 1);
  const cx = sx + abx * t;
  const cy = sy + aby * t;
  return Math.hypot(bx - cx, by - cy) < rad;
}

/**
 * Cover slot between the ball and our own goal (defensive screen).
 * Kept outside BALL_KEEP_OUT so non-chasers do not join the pile.
 */
function defensiveCoverSlot(duck, ctx) {
  const { ball, defendGoalX, attackDir } = ctx;
  const spawnY = duck.spawnY != null ? duck.spawnY : 0;
  let x = ball.x + (defendGoalX - ball.x) * 0.4;
  let y = clamp(ball.y * 0.45 + spawnY * 0.4, -FIELD_HALF_W + 0.3, FIELD_HALF_W - 0.3);
  // Keep outside the ball ring toward our goal.
  const dx = x - ball.x;
  const dy = y - (ball.y || 0);
  const d = Math.hypot(dx, dy);
  if (d < TUNE.BALL_KEEP_OUT) {
    const awayX = defendGoalX - ball.x;
    const awayY = 0 - (ball.y || 0);
    const al = Math.hypot(awayX, awayY) || 1;
    x = ball.x + (awayX / al) * TUNE.BALL_KEEP_OUT;
    y = (ball.y || 0) + (awayY / al) * TUNE.BALL_KEEP_OUT * 0.25 + spawnY * 0.2;
  }
  // Prefer slightly toward attackDir of midfield so we face upfield after cover.
  x += attackDir * 0.05;
  return {
    x: clamp(x, -FIELD_HALF_L + 0.3, FIELD_HALF_L - 0.3),
    y: clamp(y, -FIELD_HALF_W + 0.3, FIELD_HALF_W - 0.3),
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
  let prevId = gs.prevChaserId != null ? gs.prevChaserId : prevChaserIdOf(ducks);
  // Stuck holder (wrong-side orbit / stare) loses sticky claim so a free
  // teammate can become the ball-finder instead of parking outside keep-out.
  if (prevId >= 0) {
    const holder = ducks.find((d) => d.id === prevId);
    if (holder && chaserClaimExpired(holder, ball, attackDir)) prevId = -1;
  }
  const chaserId = assignChaserId(ducks, ball, prevId, attackDir);
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
 * Booster approach_target + ER-Force short intercept.
 * Stand behind the ball on the shot axis when the pitch allows it.
 * Near corners the ideal spot is out of bounds — pick the best in-bounds
 * arc point that stays kick-safe (anti-goal side of the ball) with real
 * separation, swinging toward pitch center instead of collapsing onto the ball.
 */
export function chaseApproachPoint(ball, targetGoalX, selfX, selfY) {
  const r = TUNE.APPROACH_OFFSET;
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
  const ux = gdx / glen;
  const uy = gdy / glen;
  const margin = 0.28;
  const xmin = -FIELD_HALF_L + margin;
  const xmax = FIELD_HALF_L - margin;
  const ymin = -FIELD_HALF_W + margin;
  const ymax = FIELD_HALF_W - margin;

  // Open pitch: classic stand-behind on the shot axis.
  const idealX = bx - ux * r;
  const idealY = by - uy * r;
  if (idealX >= xmin && idealX <= xmax && idealY >= ymin && idealY <= ymax) {
    return { x: idealX, y: idealY };
  }

  const backAng = Math.atan2(-uy, -ux); // opposite shotDir
  const toCenterAng = Math.atan2(-by, -bx);
  const sweep = angleDiff(backAng, toCenterAng);

  const cands = [];
  // Corner / edge: arc toward pitch center at several radii so we keep
  // (ap-ball)·shotDir < 0 after field clamp (plain clamp collapsed onto ball).
  for (const rr of [r * 0.7, r, r * 1.25, r * 1.55]) {
    for (let i = 0; i <= 12; i++) {
      const ang = normalizeAngle(backAng + sweep * (i / 12));
      cands.push({ x: bx + Math.cos(ang) * rr, y: by + Math.sin(ang) * rr });
    }
  }
  const inwardX = -Math.sign(bx || targetGoalX) || -1;
  cands.push({ x: bx + inwardX * r * 1.4, y: by * 0.7 });
  cands.push({ x: bx + inwardX * r * 1.1, y: by - Math.sign(by || 1) * r * 0.5 });

  let best = null;
  let bestScore = -Infinity;
  for (const c of cands) {
    const cx = clamp(c.x, xmin, xmax);
    const cy = clamp(c.y, ymin, ymax);
    const dx = cx - bx;
    const dy = cy - by;
    const sep = Math.hypot(dx, dy);
    if (sep < r * 0.4) continue;
    const proj = dx * ux + dy * uy;
    if (proj >= 0) continue;
    const score = -proj * 2
      + Math.min(sep, r * 1.2)
      - 0.04 * (Math.abs(cx) + Math.abs(cy));
    if (score > bestScore) {
      bestScore = score;
      best = { x: cx, y: cy };
    }
  }
  if (!best) {
    const cl = Math.hypot(bx, by) || 1;
    best = {
      x: clamp(bx - (bx / cl) * r * 1.3, xmin, xmax),
      y: clamp(by - (by / cl) * r * 1.3, ymin, ymax),
    };
  }
  return best;
}

/**
 * True when the duck is on the far side of the ball from the attack goal
 * (i.e. standing behind the ball on the shot axis — Booster approach side).
 * Near the touchline a tiny soft margin is allowed so corner approaches that
 * are field-ward but not perfectly anti-goal still count as kick-safe.
 */
export function isBehindBall(sx, sy, ball, targetGoalX) {
  const gdx = targetGoalX - ball.x;
  const gdy = 0 - (ball.y || 0);
  const glen = Math.hypot(gdx, gdy) || 1;
  const ddx = sx - ball.x;
  const ddy = sy - (ball.y || 0);
  const proj = (ddx * gdx + ddy * gdy) / glen;
  const nearEdge = Math.abs(ball.x) > FIELD_HALF_L - 0.7
    || Math.abs(ball.y || 0) > FIELD_HALF_W - 0.7;
  return nearEdge ? proj < 0.1 : proj < 0;
}

/**
 * Chaser: CHASE → ARRIVE (behind ball) → AIM / SHOOT.
 *
 * Geometry that matters (not "look at the ball"):
 *   own goal ── duck(behind) ── ball ──► opponent goal
 * Kick only when behind on the shot axis AND roughly facing ball→goal.
 * Orbit is a short spiral toward the approach — not an endless ring.
 */
function chaserDecide(duck, ctx) {
  const [sx, sy] = duckXY(duck);
  const yaw = duck.yaw || 0;
  const { ball, targetGoalX } = ctx;
  const bd = distToBall(duck, ball);
  const toBall = angleToBall(duck, ball);
  const shotDir = angleTo(ball.x, ball.y, targetGoalX, 0);
  const ap = chaseApproachPoint(ball, targetGoalX, sx, sy);
  const apDist = distanceTo(sx, sy, ap.x, ap.y);
  const arrived = apDist <= TUNE.APPROACH_ARRIVE_EPS;
  const behind = isBehindBall(sx, sy, ball, targetGoalX);
  const ballAhead = Math.cos(angleDiff(yaw, toBall)) > 0.12;
  const alignErr = Math.abs(angleDiff(yaw, shotDir));

  if (!duck._ai) {
    duck._ai = {
      aimTicks: 0, stallTicks: 0, escapeTicks: 0, prevX: sx, prevY: sy,
      kickCooldown: 0, kickHoldTicks: 0, atFeetTicks: 0, pokeArmed: false,
      orbitTicks: 0,
    };
  }
  const ai = duck._ai;
  if (ai.kickCooldown === undefined) ai.kickCooldown = 0;
  if (ai.kickHoldTicks === undefined) ai.kickHoldTicks = 0;
  if (ai.atFeetTicks === undefined) ai.atFeetTicks = 0;
  if (ai.pokeArmed === undefined) ai.pokeArmed = false;
  if (ai.orbitTicks === undefined) ai.orbitTicks = 0;

  if (ai.kickCooldown > 0) ai.kickCooldown--;

  if (bd <= TUNE.SHOOT_DIST) ai.atFeetTicks++;
  else {
    ai.atFeetTicks = 0;
    ai.pokeArmed = false;
  }
  const stuckAtFeet = ai.atFeetTicks >= 10;

  // Wrong side → short lateral spiral toward approach (not a permanent orbit).
  // At feet: stay pure-lateral until off the shot axis so we never shove the ball in.
  if (!behind && bd <= Math.max(TUNE.SHOOT_DIST * 2.4, 0.85)) {
    ai.aimTicks = 0;
    ai.kickHoldTicks = 0;
    ai.orbitTicks++;
    const apSafe = avoidWalkPoint(ap.x, ap.y, duck, ctx);
    const by = ball.y || 0;
    const atFeet = bd <= TUNE.SHOOT_DIST;
    const offAxis = Math.abs(sy - by) >= 0.22;
    const skim = pathSkimsBall(sx, sy, apSafe.x, apSafe.y, ball) || atFeet;
    // Once clear of the shot axis, commit to the approach (don't park on the ring).
    const commit = offAxis || (!atFeet && ai.orbitTicks >= TUNE.ORBIT_COMMIT_TICKS);
    let wp;
    if (atFeet && !offAxis) {
      wp = lateralOrbitPoint(sx, sy, ball, apSafe.x, apSafe.y, 0);
    } else if (commit) {
      // Prefer approach; mild blend only if still very close and path skims hard.
      wp = (atFeet && skim)
        ? lateralOrbitPoint(sx, sy, ball, apSafe.x, apSafe.y, 0.75)
        : apSafe;
    } else if (skim) {
      const blend = clamp(ai.orbitTicks / TUNE.ORBIT_COMMIT_TICKS, 0, 0.45);
      wp = lateralOrbitPoint(sx, sy, ball, apSafe.x, apSafe.y, blend);
    } else {
      wp = apSafe;
    }
    const toWp = angleTo(sx, sy, wp.x, wp.y);
    // Forward-only near the ball — reverse creep shoves through to the attack side.
    const vx = (atFeet || bd < 0.55)
      ? moveToward(yaw, toWp, TUNE.CHASE_SPEED)
      : (commit || offAxis)
        ? creepToward(yaw, toWp, TUNE.CHASE_SPEED)
        : moveToward(yaw, toWp, TUNE.CHASE_SPEED);
    return limitCommand(vx, turnToward(yaw, toWp));
  }
  ai.orbitTicks = 0;

  // ENGAGE only when behind the ball.
  const canEngage = bd <= TUNE.SHOOT_DIST && behind;
  if (canEngage) {
    const by = ball.y || 0;
    const onAxis = Math.abs(sy - by) <= 0.20;
    // Behind but wide of the shot axis → slide onto approach first (don't AIM-walk past).
    if (!onAxis) {
      ai.aimTicks = 0;
      ai.kickHoldTicks = 0;
      // Hold the behind-X while bleeding off |y|; forward-only so we don't reverse through the ball.
      const slide = {
        x: ball.x - Math.cos(shotDir) * TUNE.APPROACH_OFFSET,
        y: sy * 0.55,
      };
      const toSlide = angleTo(sx, sy, slide.x, slide.y);
      return limitCommand(
        moveToward(yaw, toSlide, TUNE.CHASE_SPEED),
        turnToward(yaw, toSlide),
      );
    }
    const soft = stuckAtFeet || ai.aimTicks >= TUNE.AIM_SOFT_TICKS;
    const alignLim = soft ? TUNE.SHOOT_ANGLE * 1.85 : TUNE.SHOOT_ANGLE;
    const aligned = alignErr <= alignLim;
    if (aligned && ballAhead) {
      ai.aimTicks = 0;
      if (ai.kickCooldown > 0) {
        ai.kickHoldTicks = 0;
        const lateralWz = (sy > ball.y) ? -TUNE.WZ_MAX * 0.5 : TUNE.WZ_MAX * 0.5;
        return limitCommand(TUNE.AIM_CREEP * 0.6, lateralWz, false);
      }
      ai.kickHoldTicks++;
      if (ai.kickHoldTicks >= TUNE.KICK_HOLD_BEFORE_COOLDOWN) {
        ai.kickHoldTicks = 0;
        ai.kickCooldown = TUNE.KICK_COOLDOWN_TICKS;
      }
      return limitCommand(TUNE.SHOOT_SPEED, turnToward(yaw, shotDir), true);
    }
    // AIM — creep along shotDir while turning; scale down when badly misaligned.
    ai.kickHoldTicks = 0;
    ai.aimTicks++;
    if (ai.aimTicks > TUNE.AIM_MAX_TICKS) {
      ai.aimTicks = 0;
      ai.atFeetTicks = 0;
      const toAp = angleTo(sx, sy, ap.x, ap.y);
      return limitCommand(
        moveToward(yaw, toAp, TUNE.CHASE_SPEED),
        turnToward(yaw, shotDir),
      );
    }
    const alignFactor = clamp(1 - alignErr / (Math.PI * 0.55), 0.35, 1);
    return limitCommand(
      creepToward(yaw, shotDir, TUNE.AIM_CREEP * alignFactor),
      turnToward(yaw, shotDir),
      false,
    );
  }

  // CHASE: walk to approach; spiral if the straight line skims the ball.
  ai.aimTicks = 0;
  ai.kickHoldTicks = 0;
  const apSafe = avoidWalkPoint(ap.x, ap.y, duck, ctx);
  let dest = apSafe;
  if (pathSkimsBall(sx, sy, apSafe.x, apSafe.y, ball)) {
    ai.orbitTicks++;
    const blend = ai.orbitTicks >= TUNE.ORBIT_COMMIT_TICKS
      ? 0.7
      : clamp(ai.orbitTicks / TUNE.ORBIT_COMMIT_TICKS, 0, 0.5);
    dest = lateralOrbitPoint(sx, sy, ball, apSafe.x, apSafe.y, blend);
  } else {
    ai.orbitTicks = 0;
  }
  const toDest = angleTo(sx, sy, dest.x, dest.y);
  const arrivedSafe = distanceTo(sx, sy, apSafe.x, apSafe.y) <= TUNE.APPROACH_ARRIVE_EPS;
  if (arrived || arrivedSafe) {
    return limitCommand(
      moveToward(yaw, toBall, TUNE.CHASE_SPEED),
      turnToward(yaw, shotDir),
    );
  }
  // Face a blend of walk heading and shot axis so we arrive already half-aimed.
  const faceAng = normalizeAngle(toDest + 0.35 * angleDiff(toDest, shotDir));
  return limitCommand(
    moveToward(yaw, toDest, TUNE.CHASE_SPEED),
    turnToward(yaw, faceAng),
  );
}

/**
 * Formation / support: non-chaser field ducks.
 * Own half → screen between ball and own goal (do NOT pile onto the ball).
 * Attack half → support lane; high press soft-contests outside BALL_KEEP_OUT.
 */
function formationDecide(duck, ctx) {
  const [sx, sy] = duckXY(duck);
  const yaw = duck.yaw || 0;
  const { ball, attackDir, defendGoalX, targetGoalX, allDucks, team } = ctx;

  const ballInOwnHalf = ball.x * attackDir < 0;
  const bd = distToBall(duck, ball);
  const faceUpfield = attackDir > 0 ? 0 : Math.PI;

  // Defender-specific: GUARD / CLEAR / SUPPORT (no all-hands INTERCEPT pile)
  if (duck.role === 'defender') {
    return defenderFormation(duck, ctx, sx, sy, yaw, ball, attackDir, defendGoalX, targetGoalX, allDucks, team);
  }

  // Hard keep-out: non-chasers must back off so the chaser can get behind the ball.
  if (bd < TUNE.BALL_KEEP_OUT) {
    const away = angleTo(ball.x, ball.y, sx, sy);
    return limitCommand(
      moveToward(yaw, away, TUNE.RETURN_SPEED),
      turnToward(yaw, faceUpfield),
    );
  }

  const ballPinnedCorner = Math.abs(ball.x) > FIELD_HALF_L - 1.0
    && Math.abs(ball.y) > FIELD_HALF_W - 1.0;

  // High press: soft second contest — stay outside keep-out, never at feet.
  if (
    !ballInOwnHalf &&
    !ballPinnedCorner &&
    TUNE.SECOND_PRESS_DIST > 0 &&
    bd < TUNE.SECOND_PRESS_DIST &&
    bd > TUNE.BALL_KEEP_OUT
  ) {
    const toB = angleToBall(duck, ball);
    return limitCommand(
      moveToward(yaw, toB, TUNE.CHASE_SPEED * 0.7),
      turnToward(yaw, toB),
    );
  }

  let slotX, slotY;
  if (ballInOwnHalf) {
    const cover = defensiveCoverSlot(duck, ctx);
    slotX = cover.x;
    slotY = cover.y;
  } else {
    const slot = supportSlot(duck, ctx);
    slotX = slot.x;
    slotY = slot.y;
    slotX += TUNE.FORMATION_X_ADVANCE * attackDir * 0.35;
    slotX = clamp(slotX, -FIELD_HALF_L + 0.3, FIELD_HALF_L - 0.3);
  }

  // Coach line regimes — hard geometry, not just soft advance numbers.
  if (TUNE.LINE_HOLD_MID) {
    // Own half only (just shy of mid so the shape reads as "parked").
    if (slotX * attackDir > -0.2) slotX = -0.25 * attackDir;
  } else if (TUNE.LINE_PUSH_MID && !ballInOwnHalf) {
    if (slotX * attackDir < 0.55) slotX = 0.55 * attackDir;
  }
  slotX = clamp(slotX, -FIELD_HALF_L + 0.3, FIELD_HALF_L - 0.3);

  const slotSafe = avoidWalkPoint(slotX, slotY, duck, ctx);
  slotX = slotSafe.x;
  slotY = slotSafe.y;

  const atSlot = distanceTo(sx, sy, slotX, slotY) < TUNE.FORMATION_SLOT_EPS;
  if (atSlot) {
    return limitCommand(0, turnToward(yaw, faceUpfield));
  }
  const toSlot = angleTo(sx, sy, slotX, slotY);
  return limitCommand(
    moveToward(yaw, toSlot, TUNE.RETURN_SPEED),
    turnToward(yaw, toSlot),
  );
}

/** Defender-specific formation logic: GUARD / CLEAR / SUPPORT */
function defenderFormation(duck, ctx, sx, sy, yaw, ball, attackDir, defendGoalX, targetGoalX, allDucks, team) {
  const bd = distToBall(duck, ball);
  const ballInOwnHalf = ball.x * attackDir < 0;
  const faceUpfield = attackDir > 0 ? 0 : Math.PI;

  // Keep-out: non-chaser defenders never stand on the ball.
  if (bd < TUNE.BALL_KEEP_OUT) {
    const away = angleTo(ball.x, ball.y, sx, sy);
    return limitCommand(
      moveToward(yaw, away, TUNE.DEF_CHASE_SPEED),
      turnToward(yaw, faceUpfield, TUNE.DEF_TURN_GAIN),
    );
  }

  // CLEAR only if somehow at feet (should be rare for non-chaser) — still require behind.
  if (bd <= TUNE.DEF_CLEAR_DIST && ballInOwnHalf) {
    const shotDir = angleTo(ball.x, ball.y, targetGoalX, 0);
    if (isBehindBall(sx, sy, ball, targetGoalX)
      && Math.abs(angleDiff(yaw, shotDir)) <= TUNE.SHOOT_ANGLE * 1.4) {
      return limitCommand(TUNE.DEF_CHASE_SPEED * 0.8, turnToward(yaw, shotDir, TUNE.DEF_TURN_GAIN), true);
    }
    const ap = chaseApproachPoint(ball, targetGoalX, sx, sy);
    const wp = pathSkimsBall(sx, sy, ap.x, ap.y, ball)
      ? lateralOrbitPoint(sx, sy, ball, ap.x, ap.y)
      : ap;
    const toWp = angleTo(sx, sy, wp.x, wp.y);
    return limitCommand(
      moveToward(yaw, toWp, TUNE.DEF_CHASE_SPEED),
      turnToward(yaw, toWp, TUNE.DEF_TURN_GAIN),
      false,
    );
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
    const safe = avoidWalkPoint(supX, ball.y, duck, ctx);
    const toSup = angleTo(sx, sy, safe.x, safe.y);
    return limitCommand(
      moveToward(yaw, toSup, TUNE.DEF_CHASE_SPEED),
      turnToward(yaw, toSup, TUNE.DEF_TURN_GAIN),
    );
  }

  // Own half: screen between ball and goal — do NOT rush the ball (chaser owns it).
  if (ballInOwnHalf) {
    const cover = defensiveCoverSlot(duck, ctx);
    const safe = avoidWalkPoint(cover.x, cover.y, duck, ctx);
    const atCover = distanceTo(sx, sy, safe.x, safe.y) < 0.25;
    if (atCover) {
      return limitCommand(0, turnToward(yaw, faceUpfield, TUNE.DEF_TURN_GAIN));
    }
    const toCover = angleTo(sx, sy, safe.x, safe.y);
    return limitCommand(
      moveToward(yaw, toCover, TUNE.DEF_CHASE_SPEED),
      turnToward(yaw, toCover, TUNE.DEF_TURN_GAIN),
    );
  }

  // GUARD: hold the guard line
  const guardY = clamp(ball.y * TUNE.GUARD_Y_TRACK, -TUNE.GUARD_Y_MAX, TUNE.GUARD_Y_MAX);
  const guardX = defendGoalX * TUNE.GUARD_X_FRAC;
  const guardSafe = avoidWalkPoint(guardX, guardY, duck, ctx);
  const atGuard = distanceTo(sx, sy, guardSafe.x, guardSafe.y) < 0.25;
  if (atGuard) {
    return limitCommand(0, turnToward(yaw, faceUpfield, TUNE.DEF_TURN_GAIN));
  }
  const toGuard = angleTo(sx, sy, guardSafe.x, guardSafe.y);
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
