// Regression guard: the 3v3 football work must NOT change sandbox behaviour.
// Everything asserted here is a value the single-duck playground depends on;
// if any of these flip, the sandbox has been contaminated by the match mode.
// Run with: cd app && npm test

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  ARENA_HALF, SPAWN_X, SPAWN_Y, BALL_RADIUS,
  NUM_JOINTS, OBS_SIZE, CMD_SIZE,
  TIMESTEP, DECIMATION, CTRL_DT,
} from '../src/game/constants.js';
import { SANDBOX_CONFIG, FOOTBALL_CONFIG } from '../src/game/football/match-config.js';
import {
  SPAWN_POSITIONS, FIELD_HALF_L, FIELD_HALF_W, GOAL_WIDTH, MATCH_DURATION_S,
  GOAL_LINES,
} from '../src/game/football/constants.js';
// goal.js is renderer-only (it pulls in `three` for createGoalMesh), so the
// plain-data GOAL_LINES table lives in constants.js instead — that keeps the
// referee engine-free. Importing goal.js here still smoke-tests that it loads
// under plain node (no DOM/WebGL) and no longer re-exports GOAL_LINES.
import * as goalModule from '../src/game/football/goal.js';

// ── Shared sim constants (the policy/ONNX contract) ─────────────────────

describe('shared sim constants are frozen', () => {
  it('keeps the square sandbox arena at +-1.5 m', () => {
    assert.equal(ARENA_HALF, 1.5);
  });

  it('keeps the sandbox spawn in the second row from the back wall', () => {
    // SPAWN_X = -ARENA_HALF + 1.5 * GRID_SECTION = -0.6, SPAWN_Y = 0.
    // Compared with a tolerance: the derived float lands on -0.6000000000000001.
    assert.ok(Math.abs(SPAWN_X - -0.6) < 1e-9, `SPAWN_X drifted to ${SPAWN_X}`);
    assert.equal(SPAWN_Y, 0);
  });

  it('keeps the model dimensions the ONNX policies were exported against', () => {
    assert.equal(NUM_JOINTS, 14);
    assert.equal(OBS_SIZE, 61);
    assert.equal(CMD_SIZE, 13);
  });

  it('keeps the 200 Hz sim / 50 Hz control split', () => {
    assert.equal(TIMESTEP, 0.005);
    assert.equal(DECIMATION, 4);
    assert.equal(CTRL_DT, 0.02);
    assert.equal(CTRL_DT, TIMESTEP * DECIMATION);
  });

  it('keeps the kickable ball radius', () => {
    assert.equal(BALL_RADIUS, 0.05);
  });
});

// ── SANDBOX_CONFIG: single duck, closed square arena, props + relief on ──

describe('SANDBOX_CONFIG preserves the original single-duck playground', () => {
  it('is in sandbox mode', () => {
    assert.equal(SANDBOX_CONFIG.mode, 'sandbox');
  });

  it('spawns exactly one duck with an empty MJCF name prefix', () => {
    assert.equal(SANDBOX_CONFIG.ducks.length, 1);
    // The empty prefix is what keeps the legacy body/actuator names valid
    // (no "d0/" renaming) — resolveAddrs must find the unprefixed names.
    assert.equal(SANDBOX_CONFIG.ducks[0].prefix, '');
  });

  it('uses the square arena for both half-extents', () => {
    assert.equal(SANDBOX_CONFIG.field.halfX, ARENA_HALF);
    assert.equal(SANDBOX_CONFIG.field.halfY, ARENA_HALF);
  });

  it('keeps fully closed walls (no goal openings)', () => {
    assert.equal(SANDBOX_CONFIG.field.walls, 'closed');
  });

  it('keeps relief terrain and the arcade props enabled', () => {
    assert.equal(SANDBOX_CONFIG.field.relief, true);
    assert.equal(SANDBOX_CONFIG.field.props, true);
  });

  it('runs with no AI and no referee', () => {
    assert.equal(SANDBOX_CONFIG.ai, null);
    assert.equal(SANDBOX_CONFIG.referee, null);
  });
});

// ── FOOTBALL_CONFIG: 6 ducks, goal-openings field, flat and empty ───────

describe('FOOTBALL_CONFIG describes a 3v3 match', () => {
  it('is in football mode with six ducks', () => {
    assert.equal(FOOTBALL_CONFIG.mode, 'football');
    assert.equal(FOOTBALL_CONFIG.ducks.length, 6);
  });

  it('gives every duck a unique d<i>/ MJCF prefix', () => {
    const prefixes = FOOTBALL_CONFIG.ducks.map((d) => d.prefix);
    assert.deepEqual(prefixes, ['d0/', 'd1/', 'd2/', 'd3/', 'd4/', 'd5/']);
    assert.equal(new Set(prefixes).size, 6, 'prefixes must be unique');
  });

  it('leaves goal openings in the walls', () => {
    assert.equal(FOOTBALL_CONFIG.field.walls, 'goal-openings');
  });

  it('plays on a flat, prop-free field', () => {
    assert.equal(FOOTBALL_CONFIG.field.relief, false);
    assert.equal(FOOTBALL_CONFIG.field.props, false);
  });

  it('sizes the field from the football constants', () => {
    assert.equal(FOOTBALL_CONFIG.field.halfX, FIELD_HALF_L);
    assert.equal(FOOTBALL_CONFIG.field.halfY, FIELD_HALF_W);
  });
});

// ── Goal lines: red defends -X, blue defends +X ─────────────────────────

describe('GOAL_LINES', () => {
  it('lives in constants.js, not in the renderer-only goal.js', () => {
    assert.equal(goalModule.GOAL_LINES, undefined);
    assert.equal(typeof goalModule.createGoalMesh, 'function');
  });

  it('exposes exactly a red and a blue goal line', () => {
    assert.deepEqual(Object.keys(GOAL_LINES).sort(), ['blue', 'red']);
  });

  it('puts red on -X and blue on +X', () => {
    assert.ok(GOAL_LINES.red.x < 0, `red.x should be negative, got ${GOAL_LINES.red.x}`);
    assert.ok(GOAL_LINES.blue.x > 0, `blue.x should be positive, got ${GOAL_LINES.blue.x}`);
  });

  it('sits on the field ends with a GOAL_WIDTH mouth', () => {
    assert.equal(GOAL_LINES.red.x, -FIELD_HALF_L);
    assert.equal(GOAL_LINES.blue.x, FIELD_HALF_L);
    assert.equal(GOAL_LINES.red.halfW, GOAL_WIDTH / 2);
    assert.equal(GOAL_LINES.blue.halfW, GOAL_WIDTH / 2);
  });
});

// ── Football field + spawn layout ───────────────────────────────────────

describe('football field constants', () => {
  it('is a 6 x 4 m field with a 1.2 m goal mouth', () => {
    assert.equal(FIELD_HALF_L, 3.0);
    assert.equal(FIELD_HALF_W, 2.0);
    assert.equal(GOAL_WIDTH, 1.2);
  });

  it('runs a 300 s (5 minute) match', () => {
    assert.equal(MATCH_DURATION_S, 300);
  });

  it('lists six spawn positions', () => {
    assert.equal(SPAWN_POSITIONS.length, 6);
  });

  it('keeps every spawn strictly inside the field boundaries', () => {
    for (const s of SPAWN_POSITIONS) {
      assert.ok(
        Math.abs(s.x) < FIELD_HALF_L,
        `spawn ${s.team}/${s.role} x=${s.x} escapes |x| < ${FIELD_HALF_L}`,
      );
      assert.ok(
        Math.abs(s.y) < FIELD_HALF_W,
        `spawn ${s.team}/${s.role} y=${s.y} escapes |y| < ${FIELD_HALF_W}`,
      );
    }
  });
});
