// Per-duck runtime state container for multi-duck modes.
// Each DuckInstance holds its own physics addresses, ONNX buffers,
// render rig reference, and state machine variables.

import { OBS_SIZE, CMD_SIZE, NUM_JOINTS } from '../constants.js';

/**
 * @param {number} id - Duck index (0-5 for 3v3)
 * @param {object} config - From matchConfig.ducks[i]
 * @param {object} addrs - From resolveAddrs(model, kin, prefix)
 * @param {object|null} rig - From buildRig/cloneRig (null until scene wiring)
 */
export function createDuckInstance(id, config, addrs, rig = null) {
  return {
    id,
    prefix: config.prefix,
    team: config.team,
    role: config.role,
    addrs,
    rig,
    // ONNX buffers (pre-allocated, reused every controlStep)
    obsBuf: new Float32Array(OBS_SIZE),
    obsTensor: null,  // lazily created (needs ort reference)
    cmd: new Float32Array(CMD_SIZE),
    // Low-pass filtered copy of `cmd` (slots 0=vx, 2=wz). The 10 Hz tactical
    // layer writes `cmd`; the 50 Hz inference reads `cmdSm`, which eases
    // toward `cmd` so a decision change never jerks the tracker (Bug B).
    cmdSm: new Float32Array(CMD_SIZE),
    lastAction: new Float32Array(NUM_JOINTS),
    // Active policy mode
    mode: 'walk',
    // AI agent (null for sandbox mode, set in Phase 2)
    agent: null,
    // Fall recovery state machine (mirrors game.js recovery logic)
    recovery: null,
    fallDebounce: 0,
    fallenSince: null,
    // One-shot action timers
    kickRun: null,
    postKickLock: 0,
    sitTimer: 0,
    standTimer: 0,
    rollRun: null,
    crouchRun: null,
    pickRun: null,
    // Football-specific: penalties and cards
    penaltyTimer: 0,
    cards: { yellow: 0, red: 0 },
    sentOff: false,
    // Last known position (cached per controlStep for AI/referee)
    pos: [0, 0, 0],
    yaw: 0,
  };
}
