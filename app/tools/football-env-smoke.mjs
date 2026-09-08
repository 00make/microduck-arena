#!/usr/bin/env node
// Smoke test: boot FootballEnv, random policy for N AI steps, print summary.
//   cd app && node tools/football-env-smoke.mjs
//   node tools/football-env-smoke.mjs --steps=50

import { createFootballEnv } from './football-env.mjs';

function arg(name, def) {
  const m = process.argv.find((a) => a.startsWith(`--${name}=`));
  return m ? m.split('=')[1] : def;
}

const STEPS = Math.max(1, Number(arg('steps', '30')));

const t0 = Date.now();
process.stderr.write(`[env-smoke] creating env (MuJoCo WASM + ONNX)…\n`);
const env = await createFootballEnv({ quiet: false, maxEpisodeSteps: STEPS });
process.stderr.write(`[env-smoke] reset\n`);
let { obs, obsVec } = env.reset();
process.stderr.write(
  `[env-smoke] obsDim=${obsVec.length} actionDim=${env.actionDim} state=${obs.matchState}\n`,
);

let totalReward = 0;
let last = null;
for (let i = 0; i < STEPS; i++) {
  const action = env.sampleAction();
  last = await env.step(action);
  totalReward += last.reward;
  if ((i + 1) % 10 === 0 || last.terminated || last.truncated) {
    process.stderr.write(
      `[env-smoke] step=${i + 1}/${STEPS} R=${totalReward.toFixed(3)} ` +
      `score=${last.info.score.red}-${last.info.score.blue} state=${last.info.matchState}\n`,
    );
  }
  if (last.terminated || last.truncated) break;
}

const wall = ((Date.now() - t0) / 1000).toFixed(1);
const summary = {
  steps: last?.info?.aiSteps ?? 0,
  totalReward: Number(totalReward.toFixed(4)),
  score: last?.info?.score,
  matchState: last?.info?.matchState,
  terminated: !!last?.terminated,
  truncated: !!last?.truncated,
  wall_clock_s: Number(wall),
};
process.stdout.write(JSON.stringify(summary) + '\n');
process.stderr.write(`[env-smoke] done in ${wall}s\n`);
process.exitCode = last?.info?.exploded ? 3 : 0;
