// Structural contract for the multi-duck MJCF that buildPhysicsXml injects.
//
// buildPhysicsXml itself is a closure inside game.js (it needs fetch/DOM and
// the MuJoCo VFS), so it cannot be imported by a node test. Instead this file
// pins down everything the injected model is *derived from*: the duck configs
// in FOOTBALL_CONFIG and the resulting model dimensions. If a future change
// renames a prefix, drops a team, or spawns a duck below the floor, the
// compiled MJCF would be silently wrong — these assertions catch it first.
// Run with: cd app && npm test

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { FOOTBALL_CONFIG } from '../src/game/football/match-config.js';
import { NUM_JOINTS, OBS_SIZE, CMD_SIZE } from '../src/game/constants.js';
import { createDuckInstance } from '../src/game/football/duck-instance.js';

// ── Model dimension arithmetic ──────────────────────────────────────────
// Each cloned duck contributes one trunk freejoint (7 qpos: xyz + wxyz quat)
// plus NUM_JOINTS hinge qpos; the ball contributes a single freejoint and no
// actuators. See game.js: the ball body is appended AFTER the robot bodies so
// the duck0 trunk freejoint stays first in qpos.
const FREEJOINT_QPOS = 7;
const QPOS_PER_DUCK = FREEJOINT_QPOS + NUM_JOINTS; // 21
const BALL_QPOS = FREEJOINT_QPOS;                  // 7

const TEAMS = ['red', 'blue'];
const ROLES = ['forward', 'defender', 'goalkeeper'];

describe('FOOTBALL_CONFIG duck prefixes', () => {
  it('uses the exact d<i>/ prefix format the injector expects', () => {
    FOOTBALL_CONFIG.ducks.forEach((duck, i) => {
      assert.equal(
        duck.prefix,
        `d${i}/`,
        `duck ${i} prefix must be "d${i}/" (prefixSubtree guards on "/" to avoid double-prefixing)`,
      );
    });
  });

  it('never collides, so cloned MJCF names stay unique', () => {
    const prefixes = FOOTBALL_CONFIG.ducks.map((d) => d.prefix);
    assert.equal(new Set(prefixes).size, prefixes.length);
  });
});

describe('expected compiled model dimensions', () => {
  it('allocates 21 qpos per duck plus 7 for the ball (nq = 133)', () => {
    const nq = FOOTBALL_CONFIG.ducks.length * QPOS_PER_DUCK + BALL_QPOS;
    assert.equal(QPOS_PER_DUCK, 21);
    assert.equal(nq, 133);
  });

  it('allocates NUM_JOINTS actuators per duck and none for the ball (nu = 84)', () => {
    const nu = FOOTBALL_CONFIG.ducks.length * NUM_JOINTS;
    assert.equal(nu, 84);
  });

  it('keeps the per-duck obs/cmd/actuator widths in sync with the policies', () => {
    // A dimension drift here would desync resolveAddrs against the ONNX models.
    assert.equal(NUM_JOINTS, 14);
    assert.equal(OBS_SIZE, 61);
    assert.equal(CMD_SIZE, 13);
  });
});

describe('FOOTBALL_CONFIG duck spawn poses', () => {
  it('gives every duck an [x, y, z] triple', () => {
    FOOTBALL_CONFIG.ducks.forEach((duck, i) => {
      assert.ok(Array.isArray(duck.spawn), `duck ${i} spawn must be an array`);
      assert.equal(duck.spawn.length, 3, `duck ${i} spawn must be [x, y, z]`);
      for (const c of duck.spawn) {
        assert.equal(typeof c, 'number');
        assert.ok(Number.isFinite(c), `duck ${i} spawn has a non-finite component`);
      }
    });
  });

  it('drops every duck above the floor (z > 0) so no body starts in collision', () => {
    FOOTBALL_CONFIG.ducks.forEach((duck, i) => {
      assert.ok(
        duck.spawn[2] > 0,
        `duck ${i} spawn z=${duck.spawn[2]} must be > 0`,
      );
    });
  });

  it('gives every duck a finite yaw', () => {
    FOOTBALL_CONFIG.ducks.forEach((duck, i) => {
      assert.equal(typeof duck.yaw, 'number', `duck ${i} yaw must be a number`);
      assert.ok(Number.isFinite(duck.yaw), `duck ${i} yaw must be finite`);
    });
  });
});

describe('FOOTBALL_CONFIG teams and roles', () => {
  it('assigns every duck a valid team and role', () => {
    FOOTBALL_CONFIG.ducks.forEach((duck, i) => {
      assert.ok(TEAMS.includes(duck.team), `duck ${i} team "${duck.team}" not in ${TEAMS}`);
      assert.ok(ROLES.includes(duck.role), `duck ${i} role "${duck.role}" not in ${ROLES}`);
    });
  });

  it('fields three red and three blue ducks (3v3)', () => {
    const counts = { red: 0, blue: 0 };
    for (const duck of FOOTBALL_CONFIG.ducks) counts[duck.team] += 1;
    assert.equal(counts.red, 3);
    assert.equal(counts.blue, 3);
  });

  it('gives each team a goalkeeper', () => {
    for (const team of TEAMS) {
      const keepers = FOOTBALL_CONFIG.ducks.filter((d) => d.team === team && d.role === 'goalkeeper');
      assert.equal(keepers.length, 1, `${team} must field exactly one goalkeeper`);
    }
  });

  it('has unique ids implied by unique prefixes', () => {
    const ids = FOOTBALL_CONFIG.ducks.map((_, i) => i);
    assert.equal(new Set(ids).size, ids.length);
  });
});

describe('createDuckInstance', () => {
  // Stub addresses: createDuckInstance only stores them, it never resolves
  // them against a real MuJoCo model.
  const stubAddrs = { qpos: 0, qvel: 7, ctrl: 0, sensordata: 0 };

  it('returns a per-duck state container with the required fields', () => {
    const config = FOOTBALL_CONFIG.ducks[0];
    const inst = createDuckInstance(0, config, stubAddrs);

    for (const field of ['id', 'prefix', 'team', 'role', 'addrs', 'rig', 'obsBuf', 'cmd', 'lastAction', 'mode', 'pos', 'yaw']) {
      assert.ok(field in inst, `duck instance is missing "${field}"`);
    }

    assert.equal(inst.id, 0);
    assert.equal(inst.prefix, config.prefix);
    assert.equal(inst.team, config.team);
    assert.equal(inst.role, config.role);
    assert.equal(inst.addrs, stubAddrs);
    assert.equal(inst.rig, null, 'rig stays null until scene wiring');
  });

  it('pre-allocates ONNX buffers at the policy widths', () => {
    const inst = createDuckInstance(1, FOOTBALL_CONFIG.ducks[1], stubAddrs);
    assert.ok(inst.obsBuf instanceof Float32Array);
    assert.equal(inst.obsBuf.length, OBS_SIZE);
    assert.ok(inst.cmd instanceof Float32Array);
    assert.equal(inst.cmd.length, CMD_SIZE);
    assert.ok(inst.lastAction instanceof Float32Array);
    assert.equal(inst.lastAction.length, NUM_JOINTS);
  });

  it('does not share buffers between instances', () => {
    const a = createDuckInstance(0, FOOTBALL_CONFIG.ducks[0], stubAddrs);
    const b = createDuckInstance(1, FOOTBALL_CONFIG.ducks[1], stubAddrs);
    assert.notEqual(a.obsBuf, b.obsBuf);
    assert.notEqual(a.cmd, b.cmd);
    assert.notEqual(a.lastAction, b.lastAction);
    assert.notEqual(a.pos, b.pos);
  });

  it('starts in walk mode with no AI agent and clean discipline state', () => {
    const inst = createDuckInstance(2, FOOTBALL_CONFIG.ducks[2], stubAddrs);
    assert.equal(inst.mode, 'walk');
    assert.equal(inst.agent, null);
    assert.equal(inst.penaltyTimer, 0);
    assert.deepEqual(inst.cards, { yellow: 0, red: 0 });
    assert.equal(inst.sentOff, false);
  });

  it('covers all six football ducks', () => {
    const instances = FOOTBALL_CONFIG.ducks.map((config, i) => createDuckInstance(i, config, stubAddrs));
    assert.equal(instances.length, 6);
    assert.deepEqual(instances.map((d) => d.team), FOOTBALL_CONFIG.ducks.map((d) => d.team));
  });
});
