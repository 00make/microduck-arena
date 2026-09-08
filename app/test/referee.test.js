// Unit tests for the pure football referee state machine (node:test).
// Run with: cd app && npm test

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  createReferee, decide, checkGoal, checkGoalPath, checkOutOfBounds, decideSetPiece, detectTouches, REFEREE,
} from '../src/game/football/referee.js';
import { PENALTY_DURATION_S } from '../src/game/football/constants.js';

// ── Helpers ──────────────────────────────────────────────────────────────

const DT = 0.1;

function makeGameState(ballPos = [0, 0, 0.05], ducks = []) {
  return { ball: { pos: ballPos.slice() }, ducks };
}

function duck(id, team, pos, fallen = false) {
  return { id, team, pos: pos.slice(), fallen };
}

// Drive the referee from the opening kickoff into open play: the kickoff
// is released by the ball being knocked off the centre spot (a KICKOFF is
// never released by a bare frame — game.js waits for real action too).
function toPlaying(ref) {
  ref.startMatch();
  ref.step(DT, makeGameState([0.1, 0, 0.05]));
  assert.equal(ref.getState(), 'PLAYING');
}

// Like toPlaying, but also registers a legitimate first touch so the ball is
// genuinely in open play. House rules §开球规则 forbid scoring directly from
// an untouched kickoff, so goal tests must put the ball in play with a touch
// before it crosses a line. `team` is the side that touches (and, in these
// tests, the side that goes on to score) — so the goal is never an own goal
// and lastTouchTeam lines up with the scorer.
function toOpenPlay(ref, team = 'blue') {
  toPlaying(ref);
  ref.step(DT, makeGameState([0.1, 0, 0.05], [duck('k0', team, [0.1, 0, 0])]));
  assert.equal(ref.getState(), 'PLAYING');
}

function run(ref, frames, gs) {
  for (let i = 0; i < frames; i += 1) ref.step(DT, gs);
}

describe('createReferee', () => {
  let events;
  let ref;

  beforeEach(() => {
    events = [];
    ref = createReferee({ onEvent: (type, payload) => events.push({ type, payload }) });
  });

  const types = () => events.map((e) => e.type);
  const last = (type) => [...events].reverse().find((e) => e.type === type);

  // ── Lifecycle ──────────────────────────────────────────────────────────

  it('starts in IDLE and ignores steps', () => {
    assert.equal(ref.getState(), 'IDLE');
    ref.step(DT, makeGameState());
    assert.equal(ref.getState(), 'IDLE');
    assert.equal(events.length, 0);
  });

  it('startMatch() transitions to KICKOFF and emits kickoff for red', () => {
    ref.startMatch();
    assert.equal(ref.getState(), 'KICKOFF');
    assert.deepEqual(last('kickoff').payload.team, 'red');
    assert.deepEqual(ref.getScore(), { red: 0, blue: 0 });
    assert.equal(ref.getMatchTime(), 0);
  });

  it('KICKOFF → PLAYING once the ball is stepped', () => {
    toPlaying(ref);
    assert.ok(types().includes('playing'));
  });

  it('matchTime only accrues while PLAYING', () => {
    ref.startMatch();
    ref.step(DT, makeGameState([0.1, 0, 0.05])); // KICKOFF → PLAYING, no time yet
    assert.equal(ref.getMatchTime(), 0);
    run(ref, 10, makeGameState());
    assert.ok(Math.abs(ref.getMatchTime() - 1.0) < 1e-6);
  });

  // ── Goals ──────────────────────────────────────────────────────────────

  it('ball crossing the red goal line scores for blue', () => {
    toOpenPlay(ref, 'blue');
    ref.step(DT, makeGameState([-2.9, 0.1, 0.05]));
    ref.step(DT, makeGameState([-3.02, 0.1, 0.05]));
    assert.deepEqual(ref.getScore(), { red: 0, blue: 1 });
    assert.equal(ref.getState(), 'GOAL');
    const g = last('goal');
    assert.equal(g.payload.team, 'blue');
    assert.equal(g.payload.ownGoal, false);
  });

  it('ball crossing the blue goal line scores for red', () => {
    toOpenPlay(ref, 'red');
    ref.step(DT, makeGameState([2.9, -0.2, 0.05]));
    ref.step(DT, makeGameState([3.02, -0.2, 0.05]));
    assert.deepEqual(ref.getScore(), { red: 1, blue: 0 });
    assert.equal(last('goal').payload.team, 'red');
  });

  it('slow roll into the mouth scores (OOB must not steal the goal)', () => {
    // Whole-ball OOB trips at |x|>~2.95; goal plane is at 3.0. A soft finish
    // that creeps 2.90 → 2.97 → 3.02 must still count as a goal.
    toOpenPlay(ref, 'red');
    ref.step(DT, makeGameState([2.90, 0.05, 0.05], [duck('r0', 'red', [2.7, 0, 0])]));
    ref.step(DT, makeGameState([2.97, 0.05, 0.05], [duck('r0', 'red', [2.7, 0, 0])]));
    assert.equal(ref.getState(), 'PLAYING', 'mouth corridor is not a set-piece yet');
    ref.step(DT, makeGameState([3.02, 0.05, 0.05], [duck('r0', 'red', [2.7, 0, 0])]));
    assert.deepEqual(ref.getScore(), { red: 1, blue: 0 });
    assert.equal(ref.getState(), 'GOAL');
  });

  it('ball already stranded past the plane inside the mouth still scores', () => {
    toOpenPlay(ref, 'red');
    // Both frames past the plane (missed sweep) — recovery path.
    ref.step(DT, makeGameState([3.05, 0.1, 0.05], [duck('r0', 'red', [2.8, 0, 0])]));
    assert.deepEqual(ref.getScore(), { red: 1, blue: 0 });
    assert.equal(last('goal').payload.team, 'red');
  });

  it('post-glance path still scores when plane y drifts wide', () => {
    // Plane intersection is wide of the mouth, but a deeper sample has
    // come back inside the posts — must not become a goal-kick.
    toOpenPlay(ref, 'blue');
    ref.step(DT, makeGameState([-2.90, 0.90, 0.05], [duck('b0', 'blue', [-2.7, 0.5, 0])]));
    ref.step(DT, makeGameState([-3.10, 0.50, 0.05], [duck('b0', 'blue', [-2.7, 0.5, 0])]));
    assert.deepEqual(ref.getScore(), { red: 0, blue: 1 });
    assert.equal(ref.getState(), 'GOAL');
  });

  it('deep tunnel past the net back panel still scores in the mouth', () => {
    toOpenPlay(ref, 'red');
    ref.step(DT, makeGameState([2.9, 0, 0.05], [duck('r0', 'red', [2.7, 0, 0])]));
    ref.step(DT, makeGameState([3.45, 0.05, 0.05], [duck('r0', 'red', [2.7, 0, 0])]));
    assert.deepEqual(ref.getScore(), { red: 1, blue: 0 });
  });

  it('GOAL → KICKOFF after the reset hold, conceding team restarts', () => {
    toOpenPlay(ref, 'blue');
    ref.step(DT, makeGameState([-2.9, 0, 0.05]));
    ref.step(DT, makeGameState([-3.02, 0, 0.05]));
    assert.equal(ref.getState(), 'GOAL');
    run(ref, Math.ceil(REFEREE.GOAL_RESET_S / DT) + 1, makeGameState([0, 0, 0.05]));
    assert.equal(ref.getState(), 'KICKOFF');
    assert.equal(last('kickoff').payload.team, 'red'); // red conceded, red restarts
    ref.step(DT, makeGameState([0.1, 0, 0.05])); // knocked off the spot
    assert.equal(ref.getState(), 'PLAYING');
  });

  it('a crossing above the crossbar is not a goal', () => {
    toPlaying(ref);
    // Crossing point interpolates to z ≈ 0.55 > GOAL_HEIGHT (0.4).
    ref.step(DT, makeGameState([-2.9, 0, 0.5]));
    ref.step(DT, makeGameState([-3.1, 0, 0.6]));
    assert.deepEqual(ref.getScore(), { red: 0, blue: 0 });
    assert.notEqual(ref.getState(), 'GOAL');
  });

  it('swept test catches a fast ball tunnelling past the goal plane', () => {
    toOpenPlay(ref, 'blue');
    // One frame from x=-1 to x=-4: naive per-frame position checks miss it.
    ref.step(DT, makeGameState([-1, 0.1, 0.05]));
    ref.step(DT, makeGameState([-4, 0.1, 0.05]));
    assert.deepEqual(ref.getScore(), { red: 0, blue: 1 });
    assert.equal(last('goal').payload.team, 'blue');
  });

  // ── Direct kickoff goals (judged by which net the ball went into) ───────

  it('a direct kickoff goal into the opponents\' net counts for the kicker', () => {
    ref.startMatch(); // red kicks off, attacks +X (the blue goal)
    // Release the kickoff by the ball rolling off the centre spot — no duck
    // ever touches it, so it is still "directly from the kickoff".
    ref.step(DT, makeGameState([0.1, 0, 0.05]));
    assert.equal(ref.getState(), 'PLAYING');
    // Ball flies straight into the blue goal (+X), untouched.
    ref.step(DT, makeGameState([2.9, 0, 0.05]));
    ref.step(DT, makeGameState([3.02, 0, 0.05]));
    assert.deepEqual(ref.getScore(), { red: 1, blue: 0 }); // valid goal for red
    const g = last('goal');
    assert.equal(g.payload.team, 'red');
    assert.equal(g.payload.ownGoal, false);
    assert.equal(ref.getState(), 'GOAL');
  });

  it('a direct kickoff goal into the kicker\'s own net → corner for the kicker', () => {
    ref.startMatch(); // red kicks off and defends -X
    ref.step(DT, makeGameState([-0.1, 0, 0.05])); // released by move, untouched
    assert.equal(ref.getState(), 'PLAYING');
    ref.step(DT, makeGameState([-2.9, 0, 0.05]));
    ref.step(DT, makeGameState([-3.02, 0, 0.05])); // into red's own goal, untouched
    assert.deepEqual(ref.getScore(), { red: 0, blue: 0 }); // no goal, no own goal
    const gd = last('goal_disallowed');
    assert.ok(gd, 'goal_disallowed emitted');
    assert.equal(gd.payload.reason, 'direct_kickoff_own_goal');
    assert.equal(ref.getState(), 'DEAD_BALL');
    // The kicking team restarts with a corner at its own end.
    run(ref, Math.ceil(REFEREE.DEAD_BALL_S / DT) + 1, makeGameState([-2.9, 1.9, 0.05]));
    const piece = ref.getSetPiece();
    assert.equal(piece.type, 'corner_red'); // corner at the red end
    assert.equal(piece.team, 'red');        // taken by the kicking team
    assert.ok(piece.pos[0] < 0);
  });

  it('a goal after the kickoff is touched is judged normally', () => {
    ref.startMatch();
    ref.step(DT, makeGameState([0.1, 0, 0.05])); // released by move, still untouched
    assert.equal(ref.getState(), 'PLAYING');
    // A blue duck touches the ball → open play begins (kickoffActive clears).
    ref.step(DT, makeGameState([0.5, 0, 0.05], [duck('b1', 'blue', [0.5, 0, 0])]));
    assert.equal(ref.getLastTouchTeam(), 'blue');
    // The ball then crosses into the red goal (-X): a normal goal for blue.
    ref.step(DT, makeGameState([-2.9, 0, 0.05]));
    ref.step(DT, makeGameState([-3.02, 0, 0.05]));
    assert.deepEqual(ref.getScore(), { red: 0, blue: 1 });
    assert.equal(last('goal').payload.team, 'blue');
    assert.equal(last('goal').payload.ownGoal, false);
  });

  // ── Out of bounds ──────────────────────────────────────────────────────

  it('ball fully over the sideline → throw_in for the opponents', () => {
    toPlaying(ref);
    const gs = (pos) => makeGameState(pos, [duck('b1', 'blue', [pos[0], 1.6, 0])]);
    ref.step(DT, gs([0.5, 1.94, 0.05])); // in play (1.94 + 0.05 < 2.0)
    ref.step(DT, gs([0.5, 1.96, 0.05])); // fully over (1.96 + 0.05 > 2.0)
    assert.equal(ref.getState(), 'DEAD_BALL');
    run(ref, Math.ceil(REFEREE.DEAD_BALL_S / DT) + 1, gs([0.5, 1.95, 0.05]));
    assert.equal(ref.getState(), 'SET_PIECE');
    const piece = ref.getSetPiece();
    assert.equal(piece.type, 'throw_in');
    assert.equal(piece.team, 'red'); // blue touched last
    assert.ok(Math.abs(piece.pos[1] - (2.0 - REFEREE.SPOT_MARGIN)) < 1e-6);
    assert.ok(types().includes('throw_in'));
  });

  it('ball over the goal line, attacker touched last → goal_kick', () => {
    toPlaying(ref);
    // Red attacks +X; red touches last and the ball exits WIDE of the blue
    // mouth (inside the mouth would be a goal, not a goal-kick).
    const gs = (pos) => makeGameState(pos, [duck('r1', 'red', [pos[0] - 0.2, pos[1], 0])]);
    ref.step(DT, gs([2.9, 1.2, 0.05]));
    ref.step(DT, gs([2.96, 1.2, 0.05]));
    run(ref, Math.ceil(REFEREE.DEAD_BALL_S / DT) + 1, gs([2.95, 1.2, 0.05]));
    const piece = ref.getSetPiece();
    assert.equal(piece.type, 'goal_kick');
    assert.equal(piece.team, 'blue'); // defending team restarts
    assert.equal(Math.sign(piece.pos[0]), 1); // in front of the blue goal
  });

  it('ball over the goal line, defender touched last → corner', () => {
    toPlaying(ref);
    // Blue defends +X; blue touches last and the ball exits wide of its mouth.
    const gs = (pos) => makeGameState(pos, [duck('b1', 'blue', [pos[0] - 0.2, pos[1] - 0.1, 0])]);
    ref.step(DT, gs([2.9, 1.2, 0.05]));
    ref.step(DT, gs([2.96, 1.2, 0.05]));
    run(ref, Math.ceil(REFEREE.DEAD_BALL_S / DT) + 1, gs([2.95, 1.2, 0.05]));
    const piece = ref.getSetPiece();
    assert.equal(piece.type, 'corner_blue'); // corner at the blue end, red takes it
    assert.equal(piece.team, 'red');
    assert.ok(piece.pos[0] > 0);
  });

  it('partially over the line stays in play', () => {
    toPlaying(ref);
    ref.step(DT, makeGameState([0, 1.9, 0.05])); // 1.9 + 0.05 = 1.95 < 2.0
    ref.step(DT, makeGameState([0, 1.94, 0.05])); // 1.99 < 2.0 → still in
    assert.equal(ref.getState(), 'PLAYING');
  });

  // ── Touch tracking ─────────────────────────────────────────────────────

  it('a duck within the touch radius updates lastTouchTeam', () => {
    toPlaying(ref);
    assert.equal(ref.getLastTouchTeam(), null);
    const gs = makeGameState([0.5, 0, 0.05], [duck('r2', 'red', [0.7, 0, 0])]);
    ref.step(DT, gs);
    assert.equal(ref.getLastTouchTeam(), 'red');
    const gs2 = makeGameState([0.5, 0, 0.05], [duck('b2', 'blue', [0.6, 0.1, 0])]);
    ref.step(DT, gs2);
    assert.equal(ref.getLastTouchTeam(), 'blue');
  });

  it('ducks beyond the touch radius do not register', () => {
    toPlaying(ref);
    const gs = makeGameState([0, 0, 0.05], [duck('r1', 'red', [0.6, 0, 0])]);
    ref.step(DT, gs); // 0.6 m > TOUCH_DIST (0.55)
    assert.equal(ref.getLastTouchTeam(), null);
  });

  // ── Fouls & discipline ─────────────────────────────────────────────────

  it(`fallen over ${REFEREE.FALLEN_TIMEOUT_S} s → ${PENALTY_DURATION_S} s sin-bin penalty`, () => {
    toPlaying(ref);
    const gs = makeGameState([0, 0, 0.05], [duck('r1', 'red', [5, 5, 0], true)]);
    run(ref, Math.floor(REFEREE.FALLEN_TIMEOUT_S / DT) + 2, gs);
    const p = last('penalty');
    assert.ok(p, 'penalty event emitted');
    assert.equal(p.payload.duckId, 'r1');
    assert.equal(p.payload.reason, 'fallen');
    assert.equal(p.payload.duration, PENALTY_DURATION_S);
    assert.ok(ref.getFoulTimers().r1 > 0);
  });

  it(`sin-bin timer counts down and the duck returns after ${PENALTY_DURATION_S} s`, () => {
    toPlaying(ref);
    const fallen = makeGameState([0, 0, 0.05], [duck('r1', 'red', [5, 5, 0], true)]);
    run(ref, Math.floor(REFEREE.FALLEN_TIMEOUT_S / DT) + 2, fallen);
    const t0 = ref.getFoulTimers().r1;
    assert.ok(t0 > 0 && t0 <= PENALTY_DURATION_S, 'sin-bin starts at the penalty duration');
    const standing = makeGameState([0, 0, 0.05], [duck('r1', 'red', [5, 5, 0], false)]);
    run(ref, 20, standing); // 2 s
    const t1 = ref.getFoulTimers().r1;
    assert.ok(Math.abs(t0 - t1 - 2) < 0.15);
    run(ref, 40, standing); // 4 s more → timer expired
    assert.equal(ref.getFoulTimers().r1, undefined);
    assert.ok(types().includes('penalty_returned'));
  });

  it(`inactivity near the ball over ${REFEREE.IDLE_TIMEOUT_S} s → penalty`, () => {
    toPlaying(ref);
    // Duck stands still 0.5 m from the ball (inside the IDLE_NEAR_BALL_DIST radius).
    const gs = makeGameState([0, 0, 0.05], [duck('b1', 'blue', [0.5, 0, 0], false)]);
    run(ref, Math.floor(REFEREE.IDLE_TIMEOUT_S / DT) + 2, gs);
    const p = last('penalty');
    assert.ok(p, 'penalty event emitted');
    assert.equal(p.payload.reason, 'inactive');
  });

  // ── Relaxed discipline (test phase) ────────────────────────────────────
  // With FALLEN_TIMEOUT_S (15 s) and IDLE_TIMEOUT_S (30 s) now both far
  // longer than PENALTY_DURATION_S (5 s), a sin-bin always lapses before the
  // duck can re-offend. The penalty_reset / warning / yellow / red escalation
  // chain is therefore intentionally dormant: a stuck duck is briefly parked
  // and returned to play, never sent off, so the match stays 3v3.

  it('relaxed rules: the short sin-bin expires before a fallen duck can re-offend (no penalty_reset)', () => {
    toPlaying(ref);
    const gs = makeGameState([0, 0, 0.05], [duck('r1', 'red', [5, 5, 0], true)]);
    // 1st fallen offence (~15 s) then 6 s more: the 5 s bin lapses, and a
    // re-offence would need another full 15 s fallen — impossible inside it.
    run(ref, Math.floor(REFEREE.FALLEN_TIMEOUT_S / DT) + 60, gs);
    assert.ok(types().includes('penalty'), 'a penalty was issued');
    assert.ok(types().includes('penalty_returned'), 'the sin-bin expired and the duck returned');
    assert.ok(!types().includes('penalty_reset'), 'no re-offence landed inside the bin');
    assert.equal(ref.getWarnings('r1'), 0);
  });

  it('relaxed rules: continuous falling never accrues warnings or a yellow card', () => {
    toPlaying(ref);
    const gs = makeGameState([0, 0, 0.05], [duck('r1', 'red', [5, 5, 0], true)]);
    run(ref, 400, gs); // 40 s of continuous falling → several fresh sin-bins
    assert.equal(ref.getWarnings('r1'), 0);
    assert.equal(ref.getCards().yellow.length, 0);
  });

  it('relaxed rules: a persistently fallen duck is never sent off and keeps returning to play', () => {
    toPlaying(ref);
    const gs = makeGameState([0, 0, 0.05], [duck('r1', 'red', [5, 5, 0], true)]);
    run(ref, 700, gs); // 70 s: sin-bins fire and lapse repeatedly
    assert.equal(ref.getCards().red.length, 0);
    assert.equal(ref.isSentOff('r1'), false);
    assert.ok(!types().includes('red_card'), 'no sending-off under the relaxed constants');
    // It was parked and returned at least once, so it stays in the match.
    assert.ok(types().includes('penalty'));
    assert.ok(types().includes('penalty_returned'));
  });

  // ── Match clock ────────────────────────────────────────────────────────

  it('level score at 300 s → golden-goal extra time, not FULLTIME', () => {
    toPlaying(ref);
    run(ref, Math.ceil(300 / DT) + 1, makeGameState());
    assert.equal(ref.getState(), 'PLAYING');
    assert.ok(ref.isExtraTime());
    assert.ok(types().includes('extra_time'));
    assert.equal(ref.getResult(), null);
  });

  it('unlevel score at 300 s → FULLTIME with the winner', () => {
    toOpenPlay(ref, 'red');
    ref.step(DT, makeGameState([2.9, 0, 0.05]));
    ref.step(DT, makeGameState([3.02, 0, 0.05])); // red scores
    run(ref, Math.ceil(REFEREE.GOAL_RESET_S / DT) + 2, makeGameState([0, 0, 0.05]));
    assert.equal(ref.getState(), 'KICKOFF');
    ref.step(DT, makeGameState([0.1, 0, 0.05])); // restart into open play
    run(ref, Math.ceil(300 / DT) + 5, makeGameState());
    assert.equal(ref.getState(), 'FULLTIME');
    assert.equal(ref.getResult(), 'red');
    assert.equal(last('fulltime').payload.result, 'red');
  });

  it('golden goal: any extra-time goal ends the match immediately', () => {
    toOpenPlay(ref, 'blue');
    run(ref, Math.ceil(300 / DT) + 1, makeGameState()); // 0-0 → extra time
    assert.ok(ref.isExtraTime());
    ref.step(DT, makeGameState([-2.9, 0, 0.05]));
    ref.step(DT, makeGameState([-3.02, 0, 0.05])); // blue scores
    assert.equal(ref.getState(), 'FULLTIME');
    assert.equal(ref.getResult(), 'blue');
    assert.deepEqual(ref.getScore(), { red: 0, blue: 1 });
  });

  it('extra time exhausted without a goal → draw', () => {
    toPlaying(ref);
    run(ref, Math.ceil((300 + 1200) / DT) + 2, makeGameState());
    assert.equal(ref.getState(), 'FULLTIME');
    assert.equal(ref.getResult(), 'draw');
  });

  it('FULLTIME is terminal: further steps change nothing', () => {
    toPlaying(ref);
    run(ref, Math.ceil(300 / DT) + 1, makeGameState()); // extra time
    run(ref, Math.ceil(1200 / DT) + 2, makeGameState()); // draw at FULLTIME
    const snapshot = { state: ref.getState(), score: ref.getScore(), time: ref.getMatchTime() };
    run(ref, 50, makeGameState([3.5, 0, 0.05]));
    assert.deepEqual(
      { state: ref.getState(), score: ref.getScore(), time: ref.getMatchTime() },
      snapshot,
    );
  });

  // ── Own goals ──────────────────────────────────────────────────────────

  it('open-play own goal counts for the opponents', () => {
    toPlaying(ref);
    // Red (defending -X) is the last toucher; ball rolls into the red goal.
    ref.step(DT, makeGameState([-2.5, 0, 0.05], [duck('r1', 'red', [-2.6, 0, 0])]));
    assert.equal(ref.getLastTouchTeam(), 'red');
    ref.step(DT, makeGameState([-2.9, 0, 0.05]));
    ref.step(DT, makeGameState([-3.02, 0, 0.05]));
    assert.deepEqual(ref.getScore(), { red: 0, blue: 1 });
    const g = last('goal');
    assert.equal(g.payload.team, 'blue');
    assert.equal(g.payload.ownGoal, true);
    assert.equal(g.payload.scorer, null);
  });

  it('set-piece own goal from a single defensive touch → disallowed, corner', () => {
    toPlaying(ref);
    // Blue touches last over the sideline → red throw_in.
    ref.step(DT, makeGameState([0, 1.94, 0.05], [duck('b1', 'blue', [0, 1.8, 0])]));
    ref.step(DT, makeGameState([0, 1.96, 0.05], [duck('b1', 'blue', [0, 1.8, 0])]));
    run(ref, Math.ceil(REFEREE.DEAD_BALL_S / DT) + 1, makeGameState([0, 1.95, 0.05]));
    assert.equal(ref.getState(), 'SET_PIECE');
    assert.equal(ref.getSetPiece().type, 'throw_in');
    // Red takes the throw-in (first touch), then puts it straight into its
    // own goal at -X.
    const throwPos = ref.getSetPiece().pos;
    ref.step(DT, makeGameState(throwPos, [duck('r1', 'red', [throwPos[0], throwPos[1] - 0.1, 0])]));
    assert.equal(ref.getState(), 'PLAYING');
    ref.step(DT, makeGameState([-2.9, 0.3, 0.05]));
    ref.step(DT, makeGameState([-3.02, 0.3, 0.05]));
    assert.deepEqual(ref.getScore(), { red: 0, blue: 0 }); // no goal awarded
    assert.ok(types().includes('goal_disallowed'));
    run(ref, Math.ceil(REFEREE.DEAD_BALL_S / DT) + 1, makeGameState([-2.9, 1.9, 0.05]));
    const piece = ref.getSetPiece();
    assert.equal(piece.type, 'corner_red'); // corner at the red end (own goal went in there), blue takes it
    assert.equal(piece.team, 'blue');
    assert.ok(piece.pos[0] < 0);
  });

  // ── Set piece mechanics ────────────────────────────────────────────────

  it('KICKOFF → PLAYING via timeout fallback when no touch or ball movement', () => {
    ref.startMatch();
    assert.equal(ref.getState(), 'KICKOFF');
    // Ball stays at centre, no ducks nearby: only the timeout can release.
    const gs = makeGameState([0, 0, 0.05]);
    run(ref, Math.ceil(REFEREE.KICKOFF_TIMEOUT_S / DT) - 1, gs);
    assert.equal(ref.getState(), 'KICKOFF'); // not yet
    ref.step(DT, gs); // one more frame crosses the threshold
    assert.equal(ref.getState(), 'PLAYING');
    assert.ok(types().includes('playing'));
  });

  it('kickoffTimer resets after a goal so the next KICKOFF gets a fresh timeout', () => {
    toOpenPlay(ref, 'blue');
    // Score a goal to trigger GOAL → KICKOFF cycle.
    ref.step(DT, makeGameState([-2.9, 0, 0.05]));
    ref.step(DT, makeGameState([-3.02, 0, 0.05]));
    assert.equal(ref.getState(), 'GOAL');
    // Run exactly enough frames for the GOAL hold to expire and enter KICKOFF.
    run(ref, Math.ceil(REFEREE.GOAL_RESET_S / DT), makeGameState([0, 0, 0.05]));
    assert.equal(ref.getState(), 'KICKOFF');
    // The timer should be freshly reset: wait just under the timeout.
    const gs = makeGameState([0, 0, 0.05]);
    run(ref, Math.ceil(REFEREE.KICKOFF_TIMEOUT_S / DT) - 1, gs);
    assert.equal(ref.getState(), 'KICKOFF'); // still holding
    ref.step(DT, gs);
    assert.equal(ref.getState(), 'PLAYING'); // now released
  });

  it('set piece times out → open ball, play resumes', () => {
    toPlaying(ref);
    const gs = (pos) => makeGameState(pos, [duck('b1', 'blue', [pos[0], 1.6, 0])]);
    ref.step(DT, gs([0.5, 1.94, 0.05]));
    ref.step(DT, gs([0.5, 1.96, 0.05])); // sideline out, blue touched
    run(ref, Math.ceil(REFEREE.DEAD_BALL_S / DT) + 1, gs([0.5, 1.95, 0.05]));
    assert.equal(ref.getState(), 'SET_PIECE');
    // Nobody plays it: after the timeout the ball is simply open.
    const far = makeGameState([0.5, 1.9, 0.05], [duck('b1', 'blue', [-2, -1.6, 0])]);
    run(ref, Math.ceil(REFEREE.SET_PIECE_TIMEOUT_S / DT) + 2, far);
    assert.equal(ref.getState(), 'PLAYING');
  });

  it('kickoff exposes the centre-ball set piece for game.js placement', () => {
    ref.startMatch();
    const piece = ref.getSetPiece();
    assert.equal(piece.type, 'kickoff');
    assert.deepEqual(piece.pos, [0, 0, 0.05]);
    assert.equal(piece.team, 'red');
  });

  it('getScore/getSetPiece return copies (no state leaks)', () => {
    toPlaying(ref);
    const s = ref.getScore();
    s.red = 99;
    assert.equal(ref.getScore().red, 0);
    const p = ref.getSetPiece();
    p.pos[0] = 99;
    assert.notEqual(ref.getSetPiece().pos[0], 99);
  });
});

// ── Pure helpers ─────────────────────────────────────────────────────────

describe('pure decision helpers', () => {
  it('decide() is deterministic and does not mutate its input', () => {
    const gs = makeGameState([-3.02, 0.1, 0.05], [duck('r1', 'red', [-3.1, 0.1, 0])]);
    const frozen = JSON.parse(JSON.stringify(gs));
    const a = decide([-2.9, 0.1, 0.05], gs);
    const b = decide([-2.9, 0.1, 0.05], gs);
    assert.deepEqual(a, b);
    assert.deepEqual(gs, frozen);
    assert.equal(a.goal.team, 'blue');
    assert.deepEqual(a.touches, [{ id: 'r1', team: 'red' }]);
    // Mouth/cage is reserved for the goal path — not a goalline set-piece.
    assert.equal(a.outOfBounds, null);
  });

  it('checkGoal: mouth crossing yes, wide/over the bar no', () => {
    assert.deepEqual(checkGoal([2.9, 0, 0.05], [3.02, 0, 0.05]), { team: 'red', goal: 'blue' });
    assert.equal(checkGoal([2.9, 1.5, 0.05], [3.2, 1.5, 0.05]), null); // wide of the post
    assert.equal(checkGoal([2.9, 0, 0.5], [3.2, 0, 0.6]), null); // over the bar
    assert.equal(checkGoal(null, [3.2, 0, 0.05]), null);
  });

  it('checkGoalPath recovers inward drift after a wide plane graze', () => {
    assert.equal(checkGoal([2.9, 0.9, 0.05], [3.1, 0.5, 0.05]), null);
    assert.deepEqual(
      checkGoalPath([2.9, 0.9, 0.05], [3.1, 0.5, 0.05]),
      { team: 'red', goal: 'blue' },
    );
  });

  it('checkOutOfBounds: whole-ball rule on both axes', () => {
    assert.equal(checkOutOfBounds([0, 1.94, 0.05]), null); // 1.99 < 2.0
    assert.equal(checkOutOfBounds([0, 1.96, 0.05]).kind, 'sideline');
    // Wide of the posts past the goal line → goalline OOB.
    assert.equal(checkOutOfBounds([2.96, 1.5, 0.05]).kind, 'goalline');
    // Inside the mouth corridor (|y| small) is reserved for goal detection.
    assert.equal(checkOutOfBounds([2.96, 0, 0.05]), null);
    assert.equal(checkOutOfBounds([0, 0, 0.05]), null);
  });

  it('decideSetPiece maps out types to the right restart and team', () => {
    const side = { kind: 'sideline', side: 1, pos: [0.5, 2.01, 0.05] };
    assert.deepEqual(decideSetPiece(side, 'blue').type, 'throw_in');
    assert.equal(decideSetPiece(side, 'blue').team, 'red');
    const line = { kind: 'goalline', side: 1, pos: [3.01, 0.5, 0.05] };
    assert.equal(decideSetPiece(line, 'red').type, 'goal_kick'); // attacker last
    assert.equal(decideSetPiece(line, 'red').team, 'blue');
    assert.equal(decideSetPiece(line, 'blue').type, 'corner_blue'); // at the blue end
    assert.equal(decideSetPiece(line, 'blue').team, 'red');
    const redLine = { kind: 'goalline', side: -1, pos: [-3.01, -0.5, 0.05] };
    assert.equal(decideSetPiece(redLine, 'red').type, 'corner_red'); // at the red end
    assert.equal(decideSetPiece(redLine, 'red').team, 'blue');
    assert.equal(decideSetPiece(redLine, 'blue').type, 'goal_kick');
    assert.equal(decideSetPiece(redLine, 'blue').team, 'red');
  });

  it('detectTouches only reports ducks inside the touch radius', () => {
    const ducks = [
      duck('r1', 'red', [0.54, 0, 0]),
      duck('b1', 'blue', [0.56, 0, 0]),
      duck('b2', 'blue', [2, 0, 0]),
    ];
    const touches = detectTouches([0, 0, 0.05], ducks);
    assert.deepEqual(touches, [{ id: 'r1', team: 'red' }]);
    assert.deepEqual(detectTouches(null, ducks), []);
    assert.deepEqual(detectTouches([0, 0, 0.05], null), []);
  });
});
