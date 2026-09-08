// Loco limits stay orthogonal to the strategy card.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { applyLocoLimits } from '../src/game/football/loco.js';
import { getTuneOverlay, DEFAULT_STRATEGY, strategyFingerprint } from '../src/game/football/strategy.js';
import { VEL_FWD, RVEL_FWD, RVEL_ANG } from '../src/game/constants.js';

describe('applyLocoLimits', () => {
  const stratOverlay = getTuneOverlay(DEFAULT_STRATEGY);

  it('leaves strategy speeds alone on legs', () => {
    const out = applyLocoLimits(stratOverlay, 'legs');
    assert.equal(out.CHASE_SPEED, stratOverlay.CHASE_SPEED);
    assert.equal(out.VX_MAX, VEL_FWD);
  });

  it('scales chase speed to roller ceiling without inventing new tactics', () => {
    const out = applyLocoLimits(stratOverlay, 'rollers');
    const expected = Math.min(RVEL_FWD, stratOverlay.CHASE_SPEED * (RVEL_FWD / VEL_FWD));
    assert.equal(out.CHASE_SPEED, expected);
    assert.equal(out.WZ_MAX, RVEL_ANG);
    // No strategy-only knobs appear on the loco remap.
    assert.equal(out.lineHeight, undefined);
  });

  it('does not change strategy fingerprints when loco changes', () => {
    const a = strategyFingerprint(DEFAULT_STRATEGY);
    const b = strategyFingerprint(DEFAULT_STRATEGY);
    assert.equal(a, b);
    // Loco is outside the card — fingerprint ignores it by construction.
    assert.match(a, /^[0-9a-f]{8}$/);
  });
});
