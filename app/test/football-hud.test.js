// Smoke + unit tests for the football UI/spectacle layer (Phase 4 new files).
// Pure .js modules only - node --test can't parse JSX, so the React component
// itself is covered indirectly via its extracted helpers in hud-logic.js.
// Run with: npm test  (node --test "test/**/*.test.js")

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
  formatClock, stateLabel, eventLabel, recentEvents, STATE_LABELS,
} from '../src/football/hud-logic.js';
import { MATCH_DURATION_S } from '../src/game/football/constants.js';
import { createCelebration, DURATION } from '../src/game/football/celebration.js';
import {
  VARIANTS, VARIANT_LABELS, VARIANT_NAMES, SANDBOX_VARIANT_NAMES,
  TEAM_VARIANT_NAMES, TEAM_SWATCH_HEX, VARIANT_SWATCH_HEX,
  randomVariantName, meshMaterialsFor,
} from '../src/game/variants.js';

describe('football/hud-logic: clock', () => {
  it('counts down from the match duration in MM:SS', () => {
    assert.equal(formatClock(0), '05:00');
    assert.equal(formatClock(28), '04:32'); // matches the design example
    assert.equal(formatClock(MATCH_DURATION_S), '00:00');
  });

  it('clamps at 00:00 past full time and tolerates bad input', () => {
    assert.equal(formatClock(MATCH_DURATION_S + 120), '00:00');
    assert.equal(formatClock(undefined), '05:00');
    assert.equal(formatClock(NaN), '05:00');
  });
});

describe('football/hud-logic: state + events', () => {
  it('maps known match states to printed labels', () => {
    assert.equal(stateLabel('GOAL'), 'GOAL!');
    assert.equal(stateLabel('PLAYING'), 'PLAYING');
    assert.equal(stateLabel('HALFTIME'), 'HALF TIME');
    assert.equal(stateLabel('FULLTIME'), 'FULL TIME');
    assert.equal(stateLabel(undefined), STATE_LABELS.IDLE);
  });

  it('humanises unknown states instead of dropping them', () => {
    assert.equal(stateLabel('EXTRA_TIME'), 'EXTRA TIME');
  });

  it('formats the ticker lines', () => {
    assert.equal(eventLabel({ type: 'goal', team: 'red' }), '\u26BD GOAL! Red Team scores!');
    assert.ok(eventLabel({ type: 'corner', team: 'red' }).includes('Corner kick'));
    assert.ok(eventLabel({ type: 'yellow_card', team: 'blue' }).includes('Yellow card'));
  });

  it('keeps the last n events, newest last', () => {
    const evs = [1, 2, 3, 4, 5].map((n) => ({ type: 'foul', team: 'red', time: n }));
    assert.deepEqual(recentEvents(evs, 3).map((e) => e.time), [3, 4, 5]);
    assert.deepEqual(recentEvents(null, 3), []);
  });
});

describe('game/variants: football team colourways', () => {
  const SLOTS = [
    'headDome', 'facePlate', 'trim', 'beakUpper', 'beakLower', 'tongue',
    'eyeRing', 'lens', 'bodyShell', 'sideShells', 'legShells', 'feet',
    'soles', 'hips', 'mechDark', 'mechGray',
  ];

  it('adds team_red and team_blue with every material slot', () => {
    for (const name of TEAM_VARIANT_NAMES) {
      assert.ok(VARIANTS[name], `${name} variant exists`);
      for (const slot of SLOTS) {
        assert.ok(VARIANTS[name][slot], `${name}.${slot} defined`);
        assert.ok(Array.isArray(VARIANTS[name][slot].color), `${name}.${slot}.color is rgb`);
      }
    }
  });

  it('resolves a mesh->material map for team variants', () => {
    const map = meshMaterialsFor(VARIANTS.team_red);
    assert.ok(map['top_head_shell.stl']);
    assert.ok(map['foot_left.stl']);
  });

  it('keeps the four retail variants intact', () => {
    for (const n of ['classic', 'charcoal', 'purple', 'blue']) {
      assert.ok(VARIANTS[n], `${n} still present`);
      assert.ok(VARIANT_SWATCH_HEX[n], `${n} swatch untouched`);
    }
    assert.equal(Object.keys(VARIANT_SWATCH_HEX).length, 4); // sandbox picker stays at 4
  });

  it('exposes team swatches separately and labels both', () => {
    assert.equal(TEAM_SWATCH_HEX.team_red, '#ff2244');
    assert.equal(TEAM_SWATCH_HEX.team_blue, '#2266ff');
    assert.ok(VARIANT_LABELS.team_red);
    assert.ok(VARIANT_LABELS.team_blue);
  });

  it('never hands a team colourway to the sandbox randomiser', () => {
    assert.ok(!SANDBOX_VARIANT_NAMES.includes('team_red'));
    assert.ok(!SANDBOX_VARIANT_NAMES.includes('team_blue'));
    assert.ok(VARIANT_NAMES.includes('team_red')); // full list still carries them
    for (let i = 0; i < 50; i++) {
      assert.ok(SANDBOX_VARIANT_NAMES.includes(randomVariantName()));
    }
  });
});

describe('game/football/celebration', () => {
  function makeCamera() {
    return { position: new THREE.Vector3(0, 2, 5) };
  }

  it('is inert until play()', () => {
    const c = createCelebration({
      camera: makeCamera(), scene: new THREE.Scene(),
      getScoringTeamRigs: () => [],
    });
    assert.equal(c.isActive(), false);
    assert.equal(c.getCameraOverride(), null);
    c.drive(0.1); // no-op, must not throw
    assert.equal(c.isActive(), false);
  });

  it('activates and frames the goal on play()', () => {
    const camera = makeCamera();
    const c = createCelebration({
      camera, scene: new THREE.Scene(), getScoringTeamRigs: () => [],
    });
    c.play('red', { x: 3, y: 0, z: 0.05 });
    assert.equal(c.isActive(), true);
    const ov = c.getCameraOverride();
    assert.ok(ov && ov.position && ov.lookAt);
    // At t=0 the override sits on the captured camera frame (pan not started).
    assert.ok(ov.position.distanceTo(camera.position) < 1e-6);
    // lookAt targets the goal, converted MJCF->three (x, z, -y).
    assert.ok(Math.abs(ov.lookAt.x - 3) < 1e-6);
    assert.ok(Math.abs(ov.lookAt.z - 0) < 1e-6);
  });

  it('deactivates after the full timeline', () => {
    const c = createCelebration({
      camera: makeCamera(), scene: new THREE.Scene(), getScoringTeamRigs: () => [],
    });
    c.play('blue', { x: -3, y: 0, z: 0.05 });
    c.drive(DURATION + 0.1);
    assert.equal(c.isActive(), false);
    assert.equal(c.getCameraOverride(), null);
  });

  it('cancel() aborts early', () => {
    const c = createCelebration({
      camera: makeCamera(), scene: new THREE.Scene(), getScoringTeamRigs: () => [],
    });
    c.play('red', { x: 3, y: 0, z: 0 });
    c.cancel();
    assert.equal(c.isActive(), false);
  });

  it('emissive fallback pulses scoring-team meshes then restores originals', () => {
    const root = new THREE.Object3D();
    const mat = new THREE.MeshStandardMaterial({ color: 0xff2244 });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.3, 0.1), mat);
    mesh.userData.meshName = 'body';
    root.add(mesh);

    const c = createCelebration({
      camera: makeCamera(), scene: new THREE.Scene(),
      getScoringTeamRigs: () => [{ root }],
    });
    c.play('red', { x: 3, y: 0, z: 0 });
    // Drive into the flash window (past FLASH_START + stagger).
    c.drive(0.7);
    assert.notEqual(mesh.material, mat, 'transient clone is live mid-flash');
    // Finish the timeline: originals restored, clones disposed.
    c.drive(DURATION);
    assert.equal(mesh.material, mat, 'original material restored');
    assert.equal(c.isActive(), false);
  });

  it('drives wireframe FX when a factory is injected', () => {
    let started = 0;
    let updated = 0;
    const fakeFx = () => ({
      init() {}, start() { started++; }, update() { updated++; },
      isDone: () => false, dispose() {},
    });
    const root = new THREE.Object3D();
    const c = createCelebration({
      camera: makeCamera(), scene: new THREE.Scene(),
      getScoringTeamRigs: () => [{ root }],
      createFx: fakeFx,
    });
    c.play('red', { x: 3, y: 0, z: 0 });
    c.drive(0.7);
    assert.equal(started, 1, 'wireframe scan cued once');
    assert.ok(updated > 0, 'wireframe scan driven');
  });
});
