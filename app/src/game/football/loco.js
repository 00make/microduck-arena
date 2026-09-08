// Locomotion layer (legs | rollers) — orthogonal to the coach Strategy Card.
//
// Hierarchy for rating / A-B tests:
//   1. Strategy card  → who chases, where to stand, when to shoot (intent)
//   2. Locomotion     → walk vs rollers ONNX + speed/turn ceilings (execution)
//
// Same strategy + different loco ⇒ same decideAll intents; only command
// magnitudes are remapped to the active loco capability. Never fold loco
// into strategyFingerprint / knobs / formation.

import {
  VEL_FWD, VEL_BACK, VEL_ANG,
  RVEL_FWD, RVEL_BACK, RVEL_ANG,
} from '../constants.js';

export const LOCO_IDS = Object.freeze(['legs', 'rollers']);

/** Positive speed keys in the TUNE overlay (m/s). */
const POS_SPEED_KEYS = [
  'CHASE_SPEED',
  'DEF_CHASE_SPEED',
  'SHOOT_SPEED',
  'AIM_SPEED',
  'AIM_CREEP',
  'RETURN_SPEED',
  'GK_TRACK_SPEED',
  'GK_DIVE_SPEED',
  'MIN_EFFECTIVE_VX',
];

/**
 * Remap a strategy-compiled TUNE overlay onto the active loco's velocity
 * envelope. Strategy knobs are untouched; this only scales execution speeds.
 *
 * @param {object} tuneOverlay from getTuneOverlay(strategy)
 * @param {'legs'|'rollers'} loco
 * @returns {object}
 */
export function applyLocoLimits(tuneOverlay, loco) {
  const base = tuneOverlay && typeof tuneOverlay === 'object' ? tuneOverlay : {};
  if (loco !== 'rollers') {
    return {
      ...base,
      VX_MAX: base.VX_MAX ?? VEL_FWD,
      VX_MIN: base.VX_MIN ?? VEL_BACK,
      WZ_MAX: base.WZ_MAX ?? VEL_ANG,
    };
  }

  const fwdScale = RVEL_FWD / VEL_FWD;
  const out = {
    ...base,
    VX_MAX: RVEL_FWD,
    VX_MIN: RVEL_BACK,
    WZ_MAX: RVEL_ANG, // rollers turn slower — capability, not tactics
    BLOCK_BACK_SPEED: RVEL_BACK,
  };

  for (const key of POS_SPEED_KEYS) {
    const v = base[key];
    if (!Number.isFinite(v)) continue;
    // Keep sign; clamp to roller forward ceiling after scale.
    out[key] = Math.min(RVEL_FWD, Math.max(0, v * fwdScale));
  }
  return out;
}
