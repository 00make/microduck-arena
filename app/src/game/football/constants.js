// Football match constants — field dimensions, team config, spawn positions.
// Isolated from game/constants.js to avoid breaking the single-duck sandbox.

// Re-exported so the referee can stay engine-free (it must not import the
// whole shared constants module, only the ball geometry it needs).
export { BALL_RADIUS } from '../constants.js';

export const FIELD_LENGTH = 6.0;      // X axis (long side), meters
export const FIELD_WIDTH = 4.0;       // Y axis (short side), meters
export const FIELD_HALF_L = FIELD_LENGTH / 2;  // 3.0
export const FIELD_HALF_W = FIELD_WIDTH / 2;   // 2.0

export const GOAL_WIDTH = 1.2;        // inner width between posts
export const GOAL_DEPTH = 0.3;        // net depth behind the line
export const GOAL_HEIGHT = 0.4;       // crossbar height
export const GOAL_POST_RADIUS = 0.02; // post/beam cylinder radius

// Single source of truth for goal-line coordinates (consumed by the referee).
// x is the MJCF goal-line position, halfW the half mouth. Lives here (not in
// goal.js) so pure-logic modules never pull in three.js transitively.
export const GOAL_LINES = {
  red:  { x: -FIELD_HALF_L, halfW: GOAL_WIDTH / 2 },
  blue: { x:  FIELD_HALF_L, halfW: GOAL_WIDTH / 2 },
};

export const CENTER_CIRCLE_RADIUS = 0.6;
export const PENALTY_AREA_L = 1.2;    // extends from goal line into field
export const PENALTY_AREA_W = 0.8;    // half-width from center
export const CORNER_ARC_RADIUS = 0.3;

export const WALL_HEIGHT = 0.25;
export const WALL_THICKNESS = 0.05;

export const DUCKS_PER_TEAM = 3;
export const TEAMS = { red: 'red', blue: 'blue' };
export const ROLES = { forward: 'forward', defender: 'defender', goalkeeper: 'goalkeeper' };

// Spawn positions in MJCF coordinates (X = field length, Y = field width).
// Red team defends -X, attacks +X. Blue team defends +X, attacks -X.
export const SPAWN_POSITIONS = [
  // Red team
  { team: 'red', role: 'forward',    x: -0.8, y:  0.5, yaw: 0 },
  { team: 'red', role: 'forward',    x: -0.8, y: -0.5, yaw: 0 },
  { team: 'red', role: 'goalkeeper', x: -2.8, y:  0.0, yaw: 0 },
  // Blue team
  { team: 'blue', role: 'forward',   x:  0.8, y:  0.5, yaw: Math.PI },
  { team: 'blue', role: 'forward',   x:  0.8, y: -0.5, yaw: Math.PI },
  { team: 'blue', role: 'goalkeeper',x:  2.8, y:  0.0, yaw: Math.PI },
];

// Ball starts at center
export const BALL_SPAWN = [0, 0, 0.05];

export const AI_HZ = 10;              // tactical decision frequency
export const AI_DIVIDER = 50 / AI_HZ; // = 5 (run AI every 5 controlSteps)
export const MATCH_DURATION_S = 300;  // 5 minutes
export const GOLDEN_GOAL_DURATION_S = 1200; // 20 minutes max extra time
export const PENALTY_DURATION_S = 5;  // 5-second sin-bin (test phase: keep ducks on the pitch)
