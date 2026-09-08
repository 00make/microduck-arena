// Strategy card (v2) — continuous 0..1 knobs, presets, overlays, hints.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_STRATEGY,
  DEFAULT_KNOBS,
  STYLE_PRESET_KNOBS,
  KNOB_IDS,
  normalizeStrategy,
  mergeStrategy,
  getTuneOverlay,
  knobsToOverlay,
  buildSpawnTable,
  strategiesForUser,
  buildStrategyByTeam,
  strategyFingerprint,
  strategyFromStylePreset,
  parseStrategyHints,
  knobsDiff,
  matchStylePreset,
  describeStrategy,
  coerceKnobValue,
} from '../src/game/football/strategy.js';
import { decideAll, BASE_TUNE } from '../src/game/football/ai/index.js';

describe('strategy continuous knobs', () => {
  it('normalizeStrategy falls back to 0.5 defaults', () => {
    const s = normalizeStrategy({});
    assert.equal(s.formation, DEFAULT_STRATEGY.formation);
    assert.equal(s.style, 'balanced');
    for (const id of KNOB_IDS) assert.equal(s.knobs[id], 0.5);
  });

  it('migrates legacy discrete levels to 0..1', () => {
    assert.equal(coerceKnobValue('push'), 1);
    assert.equal(coerceKnobValue('sit'), 0);
    assert.equal(coerceKnobValue('high'), 1);
    const s = normalizeStrategy({
      knobs: { lineHeight: 'push', press: 'low', shootGreed: 'greedy' },
    });
    assert.equal(s.knobs.lineHeight, 1);
    assert.equal(s.knobs.press, 0);
    assert.equal(s.knobs.shootGreed, 1);
  });

  it('legacy style+press fills knobs then overrides press', () => {
    const s = normalizeStrategy({ style: 'defend', press: 'high' });
    assert.ok(s.knobs.lineHeight < 0.25);
    assert.equal(s.knobs.press, 1);
    assert.equal(s.press, 'high');
  });

  it('attack overlay is visibly more advanced than defend', () => {
    const atk = getTuneOverlay({ style: 'attack' });
    const def = getTuneOverlay({ style: 'defend' });
    assert.ok(atk.FORMATION_X_ADVANCE > def.FORMATION_X_ADVANCE + 0.5);
    assert.ok(def.FORMATION_X_RETREAT < atk.FORMATION_X_RETREAT - 0.5);
    assert.equal(def.LINE_HOLD_MID, 1);
    assert.equal(atk.LINE_PUSH_MID, 1);
    assert.ok(atk.SECOND_PRESS_DIST > 1.5);
    assert.ok(def.SECOND_PRESS_DIST < 0.4);
    assert.ok(atk.SHOOT_ANGLE > def.SHOOT_ANGLE + 0.1);
  });

  it('knobsToOverlay interpolates continuously', () => {
    const lo = knobsToOverlay({ ...DEFAULT_KNOBS, press: 0 });
    const hi = knobsToOverlay({ ...DEFAULT_KNOBS, press: 1 });
    const mid = knobsToOverlay({ ...DEFAULT_KNOBS, press: 0.5 });
    assert.equal(lo.SECOND_PRESS_DIST, 0);
    assert.ok(hi.SECOND_PRESS_DIST > 2);
    assert.ok(mid.SECOND_PRESS_DIST > lo.SECOND_PRESS_DIST);
    assert.ok(mid.SECOND_PRESS_DIST < hi.SECOND_PRESS_DIST);
  });

  it('single knob patch marks custom', () => {
    const next = mergeStrategy(strategyFromStylePreset('balanced'), {
      knobs: { shootGreed: 0.9 },
    });
    assert.equal(next.knobs.shootGreed, 0.9);
    assert.equal(next.style, 'custom');
    assert.ok(getTuneOverlay(next).SHOOT_ANGLE > BASE_TUNE.SHOOT_ANGLE);
  });

  it('style preset with knobs payload keeps style', () => {
    const next = mergeStrategy(DEFAULT_STRATEGY, {
      style: 'attack',
      knobs: { ...STYLE_PRESET_KNOBS.attack },
    });
    assert.equal(next.style, 'attack');
  });

  it('buildSpawnTable pushes attack line forward vs defend', () => {
    const atk = buildSpawnTable({
      red: { style: 'attack' },
      blue: { ...DEFAULT_STRATEGY },
    });
    const def = buildSpawnTable({
      red: { style: 'defend' },
      blue: { ...DEFAULT_STRATEGY },
    });
    // Red forward (id 0) should sit further upfield under attack preset.
    assert.ok(atk[0].x > def[0].x + 0.3);
  });

  it('strategiesForUser accepts opponent card', () => {
    const map = strategiesForUser('red', { style: 'attack' }, { style: 'defend' });
    assert.equal(map.red.style, 'attack');
    assert.equal(map.blue.style, 'defend');
  });

  it('buildStrategyByTeam normalizes both sides', () => {
    const map = buildStrategyByTeam({
      red: { style: 'attack' },
      blue: { knobs: { press: 0.95 } },
    });
    assert.ok(map.red.knobs.shootGreed > 0.7);
    assert.equal(map.blue.knobs.press, 0.95);
    assert.equal(map.blue.style, 'custom');
  });

  it('fingerprint stable; JSON round-trip', () => {
    const card = mergeStrategy(strategyFromStylePreset('attack'), {
      knobs: { spacing: 0.8, gkRush: 0.2 },
    });
    const again = normalizeStrategy(JSON.parse(JSON.stringify(card)));
    assert.equal(strategyFingerprint(card), strategyFingerprint(again));
    assert.deepEqual(getTuneOverlay(again), getTuneOverlay(card));
  });

  it('decideAll accepts continuous overlay', () => {
    const ducks = [
      { id: 0, pos: [0, 0], yaw: 0, role: 'forward', team: 'red', spawnX: -0.8, spawnY: 0.5 },
      { id: 1, pos: [-1, 0.5], yaw: 0, role: 'forward', team: 'red', spawnX: -0.8, spawnY: -0.5 },
      { id: 2, pos: [-2.8, 0], yaw: 0, role: 'goalkeeper', team: 'red', spawnX: -2.8, spawnY: 0 },
    ];
    const cmds = decideAll(ducks, {
      ball: { x: 0.2, y: 0, vx: 0, vy: 0 },
      allDucks: ducks,
      team: 'red',
      tuneOverlay: getTuneOverlay({ style: 'attack' }),
    });
    assert.equal(cmds.length, 3);
    assert.equal(typeof cmds[0].kick, 'boolean');
  });
});

describe('parseStrategyHints continuous', () => {
  it('parses Chinese high-press into high floats', () => {
    const { knobs } = parseStrategyHints('高位逼抢，稳一点别乱射，门将别瞎出门');
    assert.ok(knobs.press >= 0.8);
    assert.ok(knobs.lineHeight >= 0.8);
    assert.ok(knobs.shootGreed <= 0.25);
    assert.ok(knobs.gkRush <= 0.2);
  });

  it('knobsDiff lists changed keys', () => {
    const diff = knobsDiff(DEFAULT_KNOBS, { press: 0.9, shootGreed: 0.5 });
    assert.equal(diff.length, 1);
    assert.equal(diff[0].id, 'press');
  });

  it('describeStrategy highlights poles away from mid', () => {
    const d = describeStrategy({ style: 'attack' }, 'en');
    assert.ok(d.highlights.length >= 1);
    assert.equal(d.fingerprint.length, 8);
  });

  it('matchStylePreset detects attack', () => {
    assert.equal(matchStylePreset(STYLE_PRESET_KNOBS.attack), 'attack');
    assert.equal(matchStylePreset({ ...DEFAULT_KNOBS, press: 0.9 }), null);
  });
});
