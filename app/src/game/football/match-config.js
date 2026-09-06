// Match configuration objects passed to bootGame().
// SANDBOX_CONFIG is the default (single duck, square arena) — preserves
// existing behavior exactly. FOOTBALL_CONFIG enables 3v3.

import { ARENA_HALF, SPAWN_X, SPAWN_Y } from '../constants.js';
import {
  FIELD_HALF_L, FIELD_HALF_W, SPAWN_POSITIONS, BALL_SPAWN,
  AI_HZ, AI_DIVIDER, MATCH_DURATION_S,
} from './constants.js';

export const SANDBOX_CONFIG = {
  mode: 'sandbox',
  ducks: [{ prefix: '', spawn: [SPAWN_X, SPAWN_Y, 0.12], yaw: 0, team: null, role: null }],
  field: {
    halfX: ARENA_HALF,
    halfY: ARENA_HALF,
    walls: 'closed',
    relief: true,
    props: true,
  },
  ball: { parkPos: '50 0 0.05' },
  ai: null,
  referee: null,
};

export const FOOTBALL_CONFIG = {
  mode: 'football',
  ducks: SPAWN_POSITIONS.map((s, i) => ({
    prefix: `d${i}/`,
    spawn: [s.x, s.y, 0.12],
    yaw: s.yaw,
    team: s.team,
    role: s.role,
  })),
  field: {
    halfX: FIELD_HALF_L,
    halfY: FIELD_HALF_W,
    walls: 'goal-openings',
    relief: false,
    props: false,
  },
  ball: { parkPos: `${BALL_SPAWN[0]} ${BALL_SPAWN[1]} ${BALL_SPAWN[2]}` },
  ai: { hz: AI_HZ, divider: AI_DIVIDER },
  referee: { matchDuration: MATCH_DURATION_S },
};
