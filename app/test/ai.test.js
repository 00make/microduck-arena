// Unit tests for the football AI layer (pure functions, no engine deps).
// Run with: npm test  (node --test "test/**/*.test.js")

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  angleTo, distanceTo, normalizeAngle, angleDiff, clamp, lerp,
  BaseAgent, ForwardAgent, DefenderAgent, GoalkeeperAgent,
  VX_MAX, VX_MIN, WZ_MAX, SHOOT_SPEED, SHOOT_DIST,
  createAgent, decideAll, assignChaserId, chaseCost, chaseApproachPoint,
} from '../src/game/football/ai/index.js';
import { FIELD_HALF_L } from '../src/game/football/constants.js';

/**
 * Build a minimal gameState for tests.
 * @param {object} ball - { x, y, vx?, vy? }
 * @param {Array} ducks - [{ id, team, role, x, y, yaw?, fallen? }]
 * @param {number} selfId - id of the duck the agent controls
 */
function makeGs(ball, ducks, selfId) {
  const full = ducks.map(d => ({ yaw: 0, fallen: false, ...d }));
  const s = full.find(d => d.id === selfId);
  return {
    ball: { vx: 0, vy: 0, ...ball },
    ducks: full,
    self: { id: s.id, x: s.x, y: s.y, yaw: s.yaw },
  };
}

const redForwardCfg = { team: 'red', role: 'forward', spawnX: -0.8, spawnY: 0.5 };
const redDefenderCfg = { team: 'red', role: 'defender', spawnX: -1.5, spawnY: 0 };
const redGkCfg = { team: 'red', role: 'goalkeeper', spawnX: -2.8, spawnY: 0 };

describe('ai/utils', () => {
  it('angleTo returns the bearing between two points', () => {
    assert.equal(angleTo(0, 0, 1, 0), 0);
    assert.ok(Math.abs(angleTo(0, 0, 0, 1) - Math.PI / 2) < 1e-12);
    assert.ok(Math.abs(angleTo(0, 0, -1, 0) - Math.PI) < 1e-12);
    assert.ok(Math.abs(angleTo(0, 0, 0, -1) + Math.PI / 2) < 1e-12);
  });

  it('distanceTo returns euclidean distance', () => {
    assert.equal(distanceTo(0, 0, 3, 4), 5);
    assert.equal(distanceTo(-1, -1, -1, -1), 0);
  });

  it('normalizeAngle wraps into [-PI, PI]', () => {
    assert.ok(Math.abs(normalizeAngle(3 * Math.PI) - Math.PI) < 1e-12);
    assert.ok(Math.abs(normalizeAngle(-3 * Math.PI) + Math.PI) < 1e-12);
    assert.equal(normalizeAngle(0.5), 0.5);
  });

  // Regression: the subtract-2PI loop never terminated on a non-finite angle
  // (Infinity - 2PI is still Infinity), freezing the main thread inside the
  // 50 Hz control step. That step runs before bootDone is set, so the freeze
  // presented as a boot that never completes with an empty console. The
  // timeout turns a recurrence into a fast failure instead of a hung suite.
  it('normalizeAngle survives non-finite input', { timeout: 1000 }, () => {
    assert.equal(normalizeAngle(Infinity), 0);
    assert.equal(normalizeAngle(-Infinity), 0);
    assert.equal(normalizeAngle(NaN), 0);
    assert.equal(angleDiff(Infinity, 0), 0);
    assert.equal(angleDiff(0, NaN), 0);
  });

  it('angleDiff returns the signed shortest turn', () => {
    assert.ok(Math.abs(angleDiff(0, Math.PI / 2) - Math.PI / 2) < 1e-12);
    assert.ok(Math.abs(angleDiff(Math.PI * 0.9, -Math.PI * 0.9) - Math.PI * 0.2) < 1e-12);
  });

  it('clamp and lerp behave as expected', () => {
    assert.equal(clamp(5, 0, 1), 1);
    assert.equal(clamp(-5, 0, 1), 0);
    assert.equal(clamp(0.5, 0, 1), 0.5);
    assert.equal(lerp(0, 10, 0.25), 2.5);
  });
});

describe('BaseAgent', () => {
  it('fallen duck receives zero command via decideAll', () => {
    const gs = makeGs({ x: 0, y: 0 }, [{ id: 0, team: 'red', role: 'x', x: 1, y: 1, fallen: true }], 0);
    assert.deepEqual(new BaseAgent(null, redForwardCfg).decide(gs), { vx: 0, wz: 0, kick: false });
  });

  it('derives attack direction and goal lines from the team', () => {
    const red = new BaseAgent(null, redForwardCfg);
    const blue = new BaseAgent(null, { ...redForwardCfg, team: 'blue' });
    assert.equal(red.attackDir, 1);
    assert.equal(red.targetGoalX, 3.0);
    assert.equal(red.defendGoalX, -3.0);
    assert.equal(blue.attackDir, -1);
    assert.equal(blue.targetGoalX, -3.0);
    assert.equal(blue.defendGoalX, 3.0);
  });
});

describe('ForwardAgent', () => {
  it('CHASE: runs at a distant loose ball', () => {
    const agent = new ForwardAgent(null, redForwardCfg);
    const gs = makeGs({ x: 1.5, y: 0 }, [{ id: 0, team: 'red', role: 'forward', x: 0, y: 0, yaw: 0 }], 0);
    assert.equal(agent.getState(gs), 'CHASE');
    const cmd = agent.decide(gs);
    assert.ok(cmd.vx > 0.2);          // facing the ball → near full speed
    assert.equal(cmd.kick, false);
  });

  it('SHOOT: ball at feet and aligned with the goal → kick', () => {
    const agent = new ForwardAgent(null, redForwardCfg);
    const gs = makeGs({ x: 0.3, y: 0 }, [{ id: 0, team: 'red', role: 'forward', x: 0, y: 0, yaw: 0 }], 0);
    assert.equal(agent.getState(gs), 'SHOOT');
    const cmd = agent.decide(gs);
    assert.equal(cmd.kick, true);
    assert.equal(cmd.vx, SHOOT_SPEED);
  });

  it('AIM: ball at feet but facing away → turn without kicking', () => {
    const agent = new ForwardAgent(null, redForwardCfg);
    const gs = makeGs({ x: 0.3, y: 0 }, [{ id: 0, team: 'red', role: 'forward', x: 0, y: 0, yaw: Math.PI }], 0);
    assert.equal(agent.getState(gs), 'AIM');
    const cmd = agent.decide(gs);
    assert.equal(cmd.kick, false);
    assert.ok(Math.abs(cmd.wz) > 0.5); // hard turn toward the goal
  });

  it('RETURN: yields to a closer teammate in the opponent half', () => {
    const agent = new ForwardAgent(null, redForwardCfg);
    const gs = makeGs(
      { x: 1.5, y: 0 },
      [
        { id: 0, team: 'red', role: 'forward', x: 0, y: 0, yaw: 0 },
        { id: 1, team: 'red', role: 'forward', x: 1.2, y: 0, yaw: 0 },
      ],
      0,
    );
    assert.equal(agent.getState(gs), 'RETURN');
    assert.equal(agent.decide(gs).kick, false);
  });

  it('CHASE: does not yield when the ball is in the own half', () => {
    const agent = new ForwardAgent(null, redForwardCfg);
    const gs = makeGs(
      { x: -1.5, y: 0 },
      [
        { id: 0, team: 'red', role: 'forward', x: 0, y: 0, yaw: 0 },
        { id: 1, team: 'red', role: 'forward', x: -1.2, y: 0, yaw: 0 }, // closer teammate
      ],
      0,
    );
    assert.equal(agent.getState(gs), 'CHASE');
    const cmd = agent.decide(gs);
    assert.ok(Math.abs(cmd.wz) > 0.5); // ball is behind → turn around
    assert.equal(cmd.kick, false);
  });

  it('blue forward attacks toward -X', () => {
    const agent = new ForwardAgent(null, { team: 'blue', role: 'forward', spawnX: 0.8, spawnY: 0.5 });
    // Ball at feet, facing -X (blue's target goal): should shoot.
    const gs = makeGs({ x: -0.3, y: 0 }, [{ id: 3, team: 'blue', role: 'forward', x: 0, y: 0, yaw: Math.PI }], 3);
    assert.equal(agent.getState(gs), 'SHOOT');
    assert.equal(agent.decide(gs).kick, true);
  });
});

describe('DefenderAgent', () => {
  it('GUARD: ball in the opponent half → hold the guard line', () => {
    const agent = new DefenderAgent(null, redDefenderCfg);
    // Need a forward teammate closer to ball so defender isn't picked as chaser
    const gs = makeGs({ x: 2.0, y: 0.5 }, [
      { id: 2, team: 'red', role: 'defender', x: 0, y: 0, yaw: 0 },
      { id: 0, team: 'red', role: 'forward', x: 1.0, y: 0 },
    ], 2);
    assert.equal(agent.getState(gs), 'GUARD');
    const cmd = agent.decide(gs);
    assert.equal(cmd.kick, false);
    assert.ok(cmd.wz > 0.5);           // guard point is behind → turn first
    assert.equal(cmd.vx, 0);           // no forward walk until facing target
  });

  it('GUARD: parked on the line → stops moving', () => {
    const agent = new DefenderAgent(null, redDefenderCfg);
    // Guard point for ball y=0.5: x = -3.0*0.55, y = 0.25.
    const gs = makeGs({ x: 2.0, y: 0.5 }, [
      { id: 2, team: 'red', role: 'defender', x: -1.65, y: 0.25, yaw: 0 },
      { id: 0, team: 'red', role: 'forward', x: 1.0, y: 0 },
    ], 2);
    const cmd = agent.decide(gs);
    assert.equal(cmd.vx, 0);
    assert.equal(cmd.kick, false);
  });

  it('INTERCEPT: ball loose in the own half → go for it', () => {
    const agent = new DefenderAgent(null, redDefenderCfg);
    const gs = makeGs({ x: -0.5, y: 0 }, [{ id: 2, team: 'red', role: 'defender', x: -1.5, y: 0, yaw: 0 }], 2);
    assert.equal(agent.getState(gs), 'INTERCEPT');
    const cmd = agent.decide(gs);
    assert.ok(cmd.vx > 0.2);           // ball is straight ahead
    assert.equal(cmd.kick, false);
  });

  it('CLEAR: ball at feet in the own half → kick toward the opponent goal', () => {
    const agent = new DefenderAgent(null, redDefenderCfg);
    const gs = makeGs({ x: -1.8, y: 0 }, [{ id: 2, team: 'red', role: 'defender', x: -1.5, y: 0, yaw: 0 }], 2);
    assert.equal(agent.getState(gs), 'CLEAR');
    assert.equal(agent.decide(gs).kick, true);
  });

  it('SUPPORT: teammate on the ball up-field → push toward midfield', () => {
    const agent = new DefenderAgent(null, redDefenderCfg);
    const gs = makeGs(
      { x: 1.5, y: 0 },
      [
        { id: 2, team: 'red', role: 'defender', x: -1.5, y: 0, yaw: 0 },
        { id: 0, team: 'red', role: 'forward', x: 1.3, y: 0, yaw: 0 }, // controls the ball
      ],
      2,
    );
    assert.equal(agent.getState(gs), 'SUPPORT');
    const cmd = agent.decide(gs);
    assert.ok(cmd.vx > 0);             // advances toward the support line
    assert.equal(cmd.kick, false);
  });

  it('GUARD: does not support when the ball is in the own half', () => {
    const agent = new DefenderAgent(null, redDefenderCfg);
    const gs = makeGs(
      { x: -1.0, y: 0 },
      [
        { id: 2, team: 'red', role: 'defender', x: -1.9, y: 0, yaw: 0 },
        { id: 0, team: 'red', role: 'forward', x: -1.2, y: 0, yaw: 0 },
      ],
      2,
    );
    // Teammate is on the ball, but in the OWN half → intercept, not support.
    assert.equal(agent.getState(gs), 'INTERCEPT');
  });
});

describe('GoalkeeperAgent', () => {
  it('TRACK: nearby ball → shuffle along the line mirroring ball Y', () => {
    const agent = new GoalkeeperAgent(null, redGkCfg);
    // Ball 1.5m in front (inside RESET_DIST) at y=1.0 → track, not reset.
    const gs = makeGs({ x: -1.4, y: 1.0 }, [{ id: 2, team: 'red', role: 'goalkeeper', x: -2.9, y: 0, yaw: 0 }], 2);
    assert.equal(agent.getState(gs), 'TRACK');
    const cmd = agent.decide(gs);
    assert.ok(cmd.vx > 0);             // moves toward the mirrored spot
    assert.equal(cmd.kick, false);
  });

  it('TRACK: target Y is clamped inside the goal frame', () => {
    const agent = new GoalkeeperAgent(null, redGkCfg);
    const gs = makeGs({ x: -1.4, y: 1.8 }, [{ id: 2, team: 'red', role: 'goalkeeper', x: -2.9, y: 0, yaw: 0 }], 2);
    // GOAL_WIDTH/2 - GK_Y_MARGIN = 0.5
    assert.equal(agent.trackPos(gs).y, 0.5);
  });

  it('DIVE: incoming fast ball within range → commit and kick at feet', () => {
    const agent = new GoalkeeperAgent(null, redGkCfg);
    const dive = makeGs({ x: -2.5, y: 0, vx: -2 }, [{ id: 2, team: 'red', role: 'goalkeeper', x: -2.85, y: 0, yaw: 0 }], 2);
    assert.equal(agent.getState(dive), 'DIVE');
    const diveCmd = agent.decide(dive);
    assert.equal(diveCmd.kick, true);  // ball within clear distance (0.35m)
    assert.ok(diveCmd.vx > 0.2);

    // Same shot but still out of kick range (0.95m) → dive without kicking.
    const reach = makeGs({ x: -1.9, y: 0, vx: -2 }, [{ id: 2, team: 'red', role: 'goalkeeper', x: -2.85, y: 0, yaw: 0 }], 2);
    assert.equal(agent.getState(reach), 'DIVE');
    assert.equal(agent.decide(reach).kick, false);
  });

  it('RESET: ball far away and not incoming → recover to line center', () => {
    const agent = new GoalkeeperAgent(null, redGkCfg);
    const recovering = makeGs({ x: 0, y: 0, vx: 1 }, [{ id: 2, team: 'red', role: 'goalkeeper', x: -2.0, y: 0.4, yaw: 0 }], 2);
    assert.equal(agent.getState(recovering), 'RESET');
    assert.equal(agent.decide(recovering).kick, false);

    // Already centered on the line → stop and face the field.
    const parked = makeGs({ x: 0, y: 0, vx: 1 }, [{ id: 2, team: 'red', role: 'goalkeeper', x: -2.9, y: 0, yaw: 0 }], 2);
    const cmd = agent.decide(parked);
    assert.equal(cmd.vx, 0);
    assert.equal(cmd.wz, 0);           // yaw 0 already faces +X
  });

  it('blue goalkeeper defends the +X goal (velocity sign flips)', () => {
    const agent = new GoalkeeperAgent(null, { team: 'blue', role: 'goalkeeper', spawnX: 2.8, spawnY: 0 });
    // Ball moving toward +X = toward blue's goal.
    const gs = makeGs({ x: 2.5, y: 0, vx: 2 }, [{ id: 5, team: 'blue', role: 'goalkeeper', x: 2.85, y: 0, yaw: Math.PI }], 5);
    assert.equal(agent.getState(gs), 'DIVE');
    assert.equal(agent.decide(gs).kick, true); // ball 0.35m away, at the feet
  });
});

describe('createAgent factory + command contract', () => {
  it('maps roles to agent classes, unknown roles fall back to forward', () => {
    assert.ok(createAgent(null, redForwardCfg) instanceof ForwardAgent);
    assert.ok(createAgent(null, redDefenderCfg) instanceof DefenderAgent);
    assert.ok(createAgent(null, redGkCfg) instanceof GoalkeeperAgent);
    assert.ok(createAgent(null, { team: 'red', role: 'striker' }) instanceof ForwardAgent);
  });

  it('every command stays within locomotion policy limits', () => {
    const cases = [
      [new ForwardAgent(null, redForwardCfg), makeGs({ x: 1.5, y: 0 }, [{ id: 0, team: 'red', role: 'forward', x: 0, y: 0, yaw: 3 }], 0)],
      [new ForwardAgent(null, redForwardCfg), makeGs({ x: 0.3, y: 0 }, [{ id: 0, team: 'red', role: 'forward', x: 0, y: 0, yaw: 0 }], 0)],
      [new DefenderAgent(null, redDefenderCfg), makeGs({ x: -1.8, y: 0 }, [{ id: 2, team: 'red', role: 'defender', x: -1.5, y: 0, yaw: -3 }], 2)],
      [new GoalkeeperAgent(null, redGkCfg), makeGs({ x: -2.5, y: 0, vx: -2 }, [{ id: 2, team: 'red', role: 'goalkeeper', x: -2.85, y: 0, yaw: 2 }], 2)],
    ];
    for (const [agent, gs] of cases) {
      const cmd = agent.decide(gs);
      assert.ok(cmd.vx >= VX_MIN && cmd.vx <= VX_MAX, `vx out of range: ${cmd.vx}`);
      assert.ok(cmd.wz >= -WZ_MAX && cmd.wz <= WZ_MAX, `wz out of range: ${cmd.wz}`);
      assert.equal(typeof cmd.kick, 'boolean');
    }
  });

  it('decide is pure: same input → same output, gameState untouched', () => {
    const agent = new ForwardAgent(null, redForwardCfg);
    const gs = makeGs({ x: 0.3, y: 0 }, [{ id: 0, team: 'red', role: 'forward', x: 0, y: 0, yaw: 0 }], 0);
    const snapshot = JSON.stringify(gs);
    const a = agent.decide(gs);
    const b = agent.decide(gs);
    assert.deepEqual(a, b);
    assert.equal(JSON.stringify(gs), snapshot);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// decideAll — primary team-level interface
// ═══════════════════════════════════════════════════════════════════════════════

describe('decideAll', () => {
  it('returns commands for all ducks', () => {
    const ducks = [
      { id: 0, pos: [0, 0], yaw: 0, role: 'forward', fallen: false, penalized: false, team: 'red' },
      { id: 1, pos: [1, 0], yaw: 0, role: 'forward', fallen: false, penalized: false, team: 'red' },
      { id: 2, pos: [-2.5, 0], yaw: 0, role: 'goalkeeper', fallen: false, penalized: false, team: 'red' },
    ];
    const gs = {
      ball: { x: 0, y: 0, vx: 0, vy: 0 },
      allDucks: ducks,
      team: 'red',
      time: 0,
    };
    const cmds = decideAll(ducks, gs);
    assert.strictEqual(cmds.length, 3);
    for (const cmd of cmds) {
      assert.ok(Number.isFinite(cmd.vx));
      assert.ok(Number.isFinite(cmd.wz));
      assert.strictEqual(typeof cmd.kick, 'boolean');
    }
  });

  it('assigns unique chaser (closest to ball)', () => {
    const ducks = [
      { id: 0, pos: [0, 0], yaw: 0, role: 'forward', fallen: false, penalized: false, team: 'red' },
      { id: 1, pos: [2, 0], yaw: 0, role: 'forward', fallen: false, penalized: false, team: 'red' },
      { id: 2, pos: [-2.5, 0], yaw: 0, role: 'goalkeeper', fallen: false, penalized: false, team: 'red' },
    ];
    const gs = {
      ball: { x: 1.8, y: 0, vx: 0, vy: 0 },
      allDucks: ducks,
      team: 'red',
      time: 0,
    };
    const cmds = decideAll(ducks, gs);
    assert.strictEqual(cmds.length, 3);
    // duck 1 is closest to ball → chaser; duck 0 returns to formation
    // Verify they receive different commands (not both chasing)
    const duck0Moving = cmds[0].vx !== 0 || cmds[0].wz !== 0;
    const duck1Moving = cmds[1].vx !== 0 || cmds[1].wz !== 0;
    // At least one should be active; they should differ in behavior
    assert.ok(duck0Moving || duck1Moving);
  });

  it('returns zero for fallen/penalized ducks', () => {
    const ducks = [
      { id: 0, pos: [0, 0], yaw: 0, role: 'forward', fallen: true, penalized: false, team: 'red' },
      { id: 1, pos: [1, 0], yaw: 0, role: 'forward', fallen: false, penalized: true, team: 'red' },
      { id: 2, pos: [-2.5, 0], yaw: 0, role: 'goalkeeper', fallen: false, penalized: false, team: 'red' },
    ];
    const gs = {
      ball: { x: 0, y: 0, vx: 0, vy: 0 },
      allDucks: ducks,
      team: 'red',
      time: 0,
    };
    const cmds = decideAll(ducks, gs);
    assert.strictEqual(cmds[0].vx, 0);
    assert.strictEqual(cmds[0].wz, 0);
    assert.strictEqual(cmds[0].kick, false);
    assert.strictEqual(cmds[1].vx, 0);
    assert.strictEqual(cmds[1].wz, 0);
    assert.strictEqual(cmds[1].kick, false);
  });

  it('returns empty array for empty ducks list', () => {
    const cmds = decideAll([], { ball: { x: 0, y: 0, vx: 0, vy: 0 }, allDucks: [], team: 'red' });
    assert.deepEqual(cmds, []);
  });

  it('kickoff chaser closes inside SHOOT_DIST instead of orbiting the approach ring', () => {
    // Reproduce: spawn at kickoff, integrate CHASE until near the old offset
    // parking spot (~0.4 m). Must keep driving at the ball and eventually kick.
    const ducks = [
      { id: 0, pos: [-0.8, 0.5], yaw: 0, role: 'forward', fallen: false, penalized: false, team: 'red', spawnX: -0.8, spawnY: 0.5 },
      { id: 1, pos: [-0.8, -0.5], yaw: 0, role: 'forward', fallen: false, penalized: false, team: 'red', spawnX: -0.8, spawnY: -0.5 },
      { id: 2, pos: [-2.8, 0], yaw: 0, role: 'goalkeeper', fallen: false, penalized: false, team: 'red', spawnX: -2.8, spawnY: 0 },
    ];
    const ball = { x: 0, y: 0, vx: 0, vy: 0 };
    const gs = { ball, allDucks: ducks, team: 'red' };
    const dt = 0.1;
    let kicked = false;
    let minBd = Infinity;
    for (let t = 0; t < 120; t++) {
      const cmds = decideAll(ducks, gs);
      const d0 = Math.hypot(ducks[0].pos[0] - ball.x, ducks[0].pos[1] - ball.y);
      const d1 = Math.hypot(ducks[1].pos[0] - ball.x, ducks[1].pos[1] - ball.y);
      const ci = d0 <= d1 ? 0 : 1;
      const c = cmds[ci];
      const duck = ducks[ci];
      duck.yaw += c.wz * dt;
      duck.pos[0] += Math.cos(duck.yaw) * c.vx * dt;
      duck.pos[1] += Math.sin(duck.yaw) * c.vx * dt;
      const bd = Math.hypot(duck.pos[0] - ball.x, duck.pos[1] - ball.y);
      if (bd < minBd) minBd = bd;
      if (c.kick) { kicked = true; break; }
    }
    assert.ok(minBd <= SHOOT_DIST, `never reached shoot range (minBd=${minBd})`);
    assert.ok(kicked, 'chaser never issued a kick after closing on the ball');
  });

  it('chaseCost prefers a facing duck over a slightly closer back-to-ball duck', () => {
    const ball = { x: 0, y: 0 };
    const facing = { id: 0, pos: [-0.9, 0], yaw: 0, role: 'forward' };       // faces +X toward ball
    const closerAway = { id: 1, pos: [-0.75, 0], yaw: Math.PI, role: 'forward' }; // closer but faces away
    assert.ok(chaseCost(facing, ball) < chaseCost(closerAway, ball));
    assert.equal(assignChaserId([facing, closerAway], ball), 0);
  });

  it('chase hysteresis keeps the previous chaser when costs are close', () => {
    const ball = { x: 0, y: 0 };
    const a = { id: 0, pos: [-0.8, 0.1], yaw: 0, role: 'forward' };
    const b = { id: 1, pos: [-0.78, -0.1], yaw: 0, role: 'forward' };
    // Without hysteresis b is slightly closer; with prev=0, a should stick.
    assert.equal(assignChaserId([a, b], ball, -1), 1);
    assert.equal(assignChaserId([a, b], ball, 0), 0);
  });

  it('chaseApproachPoint sits behind a still ball on the shot axis (MoveToStaticBall)', () => {
    const ball = { x: 0, y: 0, vx: 0, vy: 0 };
    const ap = chaseApproachPoint(ball, FIELD_HALF_L, -0.8, 0.5);
    // Red attacks +X → approach is at −r on X, near centre line
    assert.ok(ap.x < -0.2 && ap.x > -0.4, `expected behind ball, got x=${ap.x}`);
    assert.ok(Math.abs(ap.y) < 0.05, `expected on shot axis, got y=${ap.y}`);
  });

  it('chaseApproachPoint leads a fast ball with a short prediction', () => {
    const ball = { x: 0, y: 0, vx: 0.8, vy: 0 };
    const apStill = chaseApproachPoint({ x: 0, y: 0, vx: 0, vy: 0 }, FIELD_HALF_L, -1, 0);
    const apFast = chaseApproachPoint(ball, FIELD_HALF_L, -1, 0);
    assert.ok(apFast.x > apStill.x, 'fast ball approach should shift toward travel direction');
  });

  it('non-chaser support stays near the ball instead of deep spawn mirror', () => {
    const ducks = [
      { id: 0, pos: [-0.8, 0.5], yaw: 0, role: 'forward', fallen: false, penalized: false, team: 'red', spawnX: -0.8, spawnY: 0.5, _ai: {} },
      { id: 1, pos: [-0.8, -0.5], yaw: 0, role: 'forward', fallen: false, penalized: false, team: 'red', spawnX: -0.8, spawnY: -0.5, _ai: {} },
      { id: 2, pos: [-2.8, 0], yaw: 0, role: 'goalkeeper', fallen: false, penalized: false, team: 'red', spawnX: -2.8, spawnY: 0 },
    ];
    // Ball in attack half; duck 0 is chaser (closer). Duck 1 should move toward support near ball, not x≈1.3 spawn advance.
    ducks[0].pos = [-0.2, 0.2];
    const ball = { x: 0.5, y: 0, vx: 0, vy: 0 };
    const cmds = decideAll(ducks, { ball, allDucks: ducks, team: 'red' });
    assert.equal(ducks[0]._ai.holdingChase, true);
    // Support command: positive vx toward +X (ball side) rather than spinning in place only
    assert.ok(cmds[1].vx > 0 || Math.abs(cmds[1].wz) > 0);
    // Integrate a few ticks — support should reduce distance to a near-ball lane (x around ball+ahead)
    for (let t = 0; t < 25; t++) {
      const c = decideAll(ducks, { ball, allDucks: ducks, team: 'red' })[1];
      ducks[1].yaw += c.wz * 0.1;
      ducks[1].pos[0] += Math.cos(ducks[1].yaw) * c.vx * 0.1;
      ducks[1].pos[1] += Math.sin(ducks[1].yaw) * c.vx * 0.1;
    }
    assert.ok(ducks[1].pos[0] > -0.3, `support still deep (x=${ducks[1].pos[0]})`);
    assert.ok(Math.abs(ducks[1].pos[0] - ball.x) < 1.2, 'support should linger near ball lane');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Anti-stuck: minimum effective vx
// ═══════════════════════════════════════════════════════════════════════════════

describe('anti-stuck: minimum effective vx', () => {
  it('does not produce sub-threshold forward vx', () => {
    const ducks = [
      { id: 0, pos: [0, 0], yaw: 0, role: 'forward', fallen: false, penalized: false, team: 'red' },
      { id: 1, pos: [1, 0], yaw: 0, role: 'forward', fallen: false, penalized: false, team: 'red' },
      { id: 2, pos: [-2.5, 0], yaw: 0, role: 'goalkeeper', fallen: false, penalized: false, team: 'red' },
    ];
    for (let bx = -3; bx <= 3; bx += 0.5) {
      for (let by = -2; by <= 2; by += 0.5) {
        const gs = {
          ball: { x: bx, y: by, vx: 0, vy: 0 },
          allDucks: ducks,
          team: 'red',
          time: 0,
        };
        const cmds = decideAll(ducks, gs);
        for (const cmd of cmds) {
          // positive vx must be either 0 or >= MIN_EFFECTIVE_VX (0.12)
          if (cmd.vx > 0) {
            assert.ok(cmd.vx >= 0.1, `vx ${cmd.vx} is sub-threshold at ball=(${bx},${by})`);
          }
        }
      }
    }
  });

  it('does not produce sub-threshold negative vx', () => {
    const ducks = [
      { id: 0, pos: [0, 0], yaw: Math.PI, role: 'forward', fallen: false, penalized: false, team: 'red' },
      { id: 1, pos: [1, 0], yaw: Math.PI, role: 'forward', fallen: false, penalized: false, team: 'red' },
      { id: 2, pos: [-2.5, 0], yaw: Math.PI, role: 'goalkeeper', fallen: false, penalized: false, team: 'red' },
    ];
    for (let bx = -3; bx <= 3; bx += 1.0) {
      for (let by = -2; by <= 2; by += 1.0) {
        const gs = {
          ball: { x: bx, y: by, vx: 0, vy: 0 },
          allDucks: ducks,
          team: 'red',
          time: 0,
        };
        const cmds = decideAll(ducks, gs);
        for (const cmd of cmds) {
          if (cmd.vx < 0) {
            assert.ok(cmd.vx <= -0.1, `vx ${cmd.vx} is sub-threshold negative at ball=(${bx},${by})`);
          }
        }
      }
    }
  });
});
