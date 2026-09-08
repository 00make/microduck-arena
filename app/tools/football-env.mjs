// football-env.mjs — Gym-like RL env over MuJoCo WASM 3v3.
// Centralized learner controls one team (3 ducks); opponent = decideAll.
//
// Action (10 Hz): length-9 vector
//   [vx0, wz0, kick0, vx1, wz1, kick1, vx2, wz2, kick2]
//   vx,wz continuous; kick binary ( >0.5 → kick )
//
// Usage:
//   import { createFootballEnv } from './football-env.mjs';
//   const env = await createFootballEnv({ quiet: true });
//   let obs = env.reset();
//   const { obs, reward, terminated, truncated, info } = await env.step(action);

import {
  createFootballSim,
  CTRL_DT,
  AI_DIVIDER,
  VEL_LIMITS,
} from './lib/football-sim.mjs';
import { getTuneOverlay, normalizeStrategy, DEFAULT_STRATEGY } from '../src/game/football/strategy.js';
import { MATCH_DURATION_S } from '../src/game/football/constants.js';

export { CTRL_DT, AI_DIVIDER, VEL_LIMITS };

export const ACTION_DIM = 9; // 3 ducks × (vx, wz, kick)

/**
 * Flatten tactical obs into a fixed Float32Array for neural nets.
 * Layout: ball(5) + 6 ducks × (x,y,yaw,fallen,teamSign) + score(2) + time(1) = 5+30+2+1 = 38
 */
export function encodeObs(obs, learnerTeam = 'red') {
  const out = new Float32Array(38);
  const b = obs.ball || {};
  out[0] = b.x || 0;
  out[1] = b.y || 0;
  out[2] = b.z || 0;
  out[3] = b.vx || 0;
  out[4] = b.vy || 0;
  const ducks = obs.ducks || [];
  for (let i = 0; i < 6; i++) {
    const d = ducks[i] || {};
    const o = 5 + i * 5;
    out[o] = d.x || 0;
    out[o + 1] = d.y || 0;
    out[o + 2] = d.yaw || 0;
    out[o + 3] = d.fallen ? 1 : 0;
    out[o + 4] = d.team === 'red' ? 1 : d.team === 'blue' ? -1 : 0;
  }
  out[35] = obs.score?.red || 0;
  out[36] = obs.score?.blue || 0;
  out[37] = (obs.matchTime || 0) / MATCH_DURATION_S;
  // Flip x signs if learning as blue so +X is always "attack".
  if (learnerTeam === 'blue') {
    out[0] *= -1;
    out[3] *= -1;
    for (let i = 0; i < 6; i++) {
      const o = 5 + i * 5;
      out[o] *= -1;
      out[o + 2] = Math.atan2(Math.sin(out[o + 2] + Math.PI), Math.cos(out[o + 2] + Math.PI));
      out[o + 4] *= -1;
    }
    const sr = out[35];
    out[35] = out[36];
    out[36] = sr;
  }
  return out;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function parseActions(flat, n = 3) {
  const actions = [];
  for (let i = 0; i < n; i++) {
    const o = i * 3;
    actions.push({
      vx: clamp(Number(flat[o]) || 0, VEL_LIMITS.vxMin, VEL_LIMITS.vxMax),
      wz: clamp(Number(flat[o + 1]) || 0, -VEL_LIMITS.wzMax, VEL_LIMITS.wzMax),
      kick: Number(flat[o + 2]) > 0.5,
    });
  }
  return actions;
}

/**
 * @param {object} [opts]
 * @param {'red'|'blue'} [opts.learnerTeam='red']
 * @param {object} [opts.opponentStrategy] strategy card for decideAll side
 * @param {boolean} [opts.quiet]
 * @param {number} [opts.maxEpisodeSteps] AI steps (10Hz); default ~match length
 */
export async function createFootballEnv(opts = {}) {
  const learnerTeam = opts.learnerTeam === 'blue' ? 'blue' : 'red';
  const opponentTeam = learnerTeam === 'red' ? 'blue' : 'red';
  const opponentStrategy = normalizeStrategy(opts.opponentStrategy || DEFAULT_STRATEGY);
  const tuneOverlay = getTuneOverlay(opponentStrategy);
  const maxEpisodeSteps = opts.maxEpisodeSteps
    ?? Math.round(MATCH_DURATION_S / (CTRL_DT * AI_DIVIDER));

  const sim = await createFootballSim({ quiet: opts.quiet, learnerTeam });

  let aiSteps = 0;
  let lastScore = { red: 0, blue: 0 };

  function rewardFromEvents(events) {
    let r = 0;
    for (const e of events) {
      if (e.event !== 'goal') continue;
      if (e.team === learnerTeam) r += 1;
      else if (e.team === opponentTeam) r -= 1;
    }
    return r;
  }

  function pack(obs, reward, terminated, truncated, info = {}) {
    return {
      obs,
      obsVec: encodeObs(obs, learnerTeam),
      reward,
      terminated,
      truncated,
      info: {
        ...info,
        score: obs.score,
        matchState: obs.matchState,
        aiSteps,
      },
    };
  }

  return {
    learnerTeam,
    opponentTeam,
    actionDim: ACTION_DIM,
    obsDim: 38,
    maxEpisodeSteps,

    reset() {
      aiSteps = 0;
      const obs = sim.reset();
      lastScore = { ...obs.score };
      sim.drainEvents();
      return pack(obs, 0, false, false, { reset: true });
    },

    /**
     * One tactical step (10 Hz): apply learner actions, opponent decideAll,
     * then AI_DIVIDER physics/control ticks.
     * @param {ArrayLike<number>} action length-9
     */
    async step(action) {
      const acts = parseActions(action, 3);
      sim.applyTeamActions(learnerTeam, acts, { idleCreep: false });
      sim.runOpponentDecideAll(opponentTeam, tuneOverlay);
      sim.antiStuckCheck();

      let exploded = false;
      for (let i = 0; i < AI_DIVIDER; i++) {
        const st = await sim.controlStep();
        if (st.exploded) {
          exploded = true;
          break;
        }
      }
      aiSteps += 1;

      const events = sim.drainEvents();
      const obs = sim.getObs();
      let reward = rewardFromEvents(events);

      // Tiny shaping: ball progress toward attack goal (learner frame).
      const attackSign = learnerTeam === 'red' ? 1 : -1;
      const bx = obs.ball?.x || 0;
      reward += 0.001 * attackSign * (bx - (lastScore._bx ?? 0));
      lastScore._bx = bx;

      const terminated = obs.matchState === 'FULLTIME' || exploded;
      const truncated = !terminated && aiSteps >= maxEpisodeSteps;

      return pack(obs, reward, terminated, truncated, {
        events,
        exploded,
      });
    },

    /** Random legal action for smoke tests. */
    sampleAction(rng = Math.random) {
      const a = new Float32Array(ACTION_DIM);
      for (let i = 0; i < 3; i++) {
        a[i * 3] = VEL_LIMITS.vxMin + rng() * (VEL_LIMITS.vxMax - VEL_LIMITS.vxMin);
        a[i * 3 + 1] = (rng() * 2 - 1) * VEL_LIMITS.wzMax;
        a[i * 3 + 2] = rng() < 0.05 ? 1 : 0;
      }
      return a;
    },
  };
}
