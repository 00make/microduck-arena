// Strategy preset → spawn / TUNE overlay tests (no engine deps).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_STRATEGY,
  normalizeStrategy,
  getTuneOverlay,
  buildSpawnTable,
  strategiesForUser,
} from '../src/game/football/strategy.js';
import { decideAll, BASE_TUNE } from '../src/game/football/ai/index.js';

describe('strategy presets', () => {
  it('normalizeStrategy falls back to defaults', () => {
    assert.deepEqual(normalizeStrategy({}), DEFAULT_STRATEGY);
    assert.equal(normalizeStrategy({ formation: 'nope' }).formation, '2f1gk');
    assert.equal(normalizeStrategy({ style: 'attack' }).style, 'attack');
  });

  it('attack overlay pushes formation advance higher than defend', () => {
    const atk = getTuneOverlay({ style: 'attack', press: 'medium' });
    const def = getTuneOverlay({ style: 'defend', press: 'medium' });
    assert.ok(atk.FORMATION_X_ADVANCE > (def.FORMATION_X_ADVANCE ?? BASE_TUNE.FORMATION_X_ADVANCE));
    assert.ok(def.FORMATION_X_RETREAT < (atk.FORMATION_X_RETREAT ?? BASE_TUNE.FORMATION_X_RETREAT));
  });

  it('buildSpawnTable enables defender roles for 1f1d1gk', () => {
    const table = buildSpawnTable({
      red: { formation: '1f1d1gk', style: 'balanced', press: 'medium' },
      blue: { ...DEFAULT_STRATEGY },
    });
    assert.equal(table[0].role, 'forward');
    assert.equal(table[1].role, 'defender');
    assert.equal(table[2].role, 'goalkeeper');
    assert.equal(table[3].role, 'forward');
    assert.equal(table[4].role, 'forward'); // blue still 2F
    assert.equal(table[5].role, 'goalkeeper');
  });

  it('strategiesForUser only overrides the user team', () => {
    const map = strategiesForUser('blue', { formation: '1f1d1gk', style: 'attack', press: 'high' });
    assert.equal(map.blue.formation, '1f1d1gk');
    assert.equal(map.red.formation, '2f1gk');
    assert.equal(map.red.style, 'balanced');
  });

  it('decideAll accepts tuneOverlay without breaking chase', () => {
    const ducks = [
      { id: 0, pos: [0, 0], yaw: 0, role: 'forward', team: 'red', spawnX: -0.8, spawnY: 0.5 },
      { id: 1, pos: [-1, 0.5], yaw: 0, role: 'forward', team: 'red', spawnX: -0.8, spawnY: -0.5 },
      { id: 2, pos: [-2.8, 0], yaw: 0, role: 'goalkeeper', team: 'red', spawnX: -2.8, spawnY: 0 },
    ];
    const gs = {
      ball: { x: 0.2, y: 0, vx: 0, vy: 0 },
      allDucks: ducks,
      team: 'red',
      tuneOverlay: getTuneOverlay({ style: 'attack', press: 'high' }),
    };
    const cmds = decideAll(ducks, gs);
    assert.equal(cmds.length, 3);
    assert.ok(Number.isFinite(cmds[0].vx));
    assert.equal(typeof cmds[0].kick, 'boolean');
  });
});
