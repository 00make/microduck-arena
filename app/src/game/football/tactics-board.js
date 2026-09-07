// Live match report board helpers.
// Kept as the public name `buildTacticsBoard` so game.js / store stay stable;
// content is cumulative possession + shots (see match-stats.js), not vanity meters.

export { assignChaserId as pickChaserId } from './ai/index.js';
export { createMatchStats, buildMatchReport } from './match-stats.js';

import { buildMatchReport } from './match-stats.js';

/**
 * @param {object} args
 * @param {{ snapshot: Function }} args.stats
 * @param {object} [args.strategyByTeam]
 * @param {{ red: number, blue: number }} [args.score]
 */
export function buildTacticsBoard(args) {
  return buildMatchReport(args);
}
