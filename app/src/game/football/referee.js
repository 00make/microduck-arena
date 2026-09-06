// Football match referee: pure state machine for rules enforcement.
// Input: gameState with ball/duck positions. Output: events via callback.
// No engine dependencies (THREE / MuJoCo / onnxruntime / DOM) — fully
// unit-testable with node:test.
//
// State machine:
//   IDLE → KICKOFF → PLAYING → DEAD_BALL → SET_PIECE → PLAYING
//                            → GOAL → KICKOFF
//                            → FULLTIME
//
// Coordinates are raw MJCF (X = field length, Y = field width, Z = up),
// matching game/constants.js and football/goal.js. Red defends -X and
// attacks +X; blue defends +X and attacks -X.

import {
  FIELD_HALF_L, FIELD_HALF_W, GOAL_HEIGHT, BALL_RADIUS,
  MATCH_DURATION_S, GOLDEN_GOAL_DURATION_S, PENALTY_DURATION_S,
  BALL_SPAWN, GOAL_LINES,
} from './constants.js';

// ── Tunables (referee-local, not part of the shared field constants) ─────
export const REFEREE = Object.freeze({
  TOUCH_DIST: 0.55,         // duck ↔ ball distance that counts as a touch (m)
  FALLEN_TIMEOUT_S: 15,     // continuous fallen time before a violation.
                            // Relaxed from 5 s so the game's own ~6 s resetDuck
                            // auto-recovery fires first; the referee only
                            // punishes ducks that are genuinely stuck.
  IDLE_TIMEOUT_S: 30,       // inactivity near the ball before a violation.
                            // Relaxed from 10 s (test phase) to stop legitimate
                            // marking/holding ducks from being whistled off.
  IDLE_NEAR_BALL_DIST: 1.5, // "ball in range" radius for the idle rule (m).
                            // Tightened from 3 m: a goalkeeper legitimately
                            // holds its line at x=±2.79, ~2.8 m from a centre
                            // ball, and a 3 m radius dragged it into the idle
                            // rule where its low shuffle command produces no
                            // net displacement -> spurious send-off (Problem 1).
                            // 1.5 m only polices ducks truly standing on the ball.
  IDLE_SPEED_EPS: 0.05,     // duck speed below this (m/s) = standing still
  WARNINGS_PER_YELLOW: 2,
  YELLOWS_PER_RED: 2,
  KICKOFF_MOVE_EPS: 0.08,   // ball travel from centre that releases kickoff
  KICKOFF_TIMEOUT_S: 3,     // fallback: auto-release kickoff after N seconds
  SET_PIECE_MOVE_EPS: 0.05, // ball travel from the spot that releases play
  SET_PIECE_TIMEOUT_S: 8,   // unplayed set piece → open ball (ball stays)
  GOAL_RESET_S: 3,          // celebration hold before the next kickoff
  DEAD_BALL_S: 1,           // whistle-to-restart hold
  GOAL_KICK_X: 2.0,         // goal-kick spot (|x|), in front of the penalty area
  SPOT_MARGIN: 0.1,         // restart spots sit this far inside the lines so
                            // the placed ball is never instantly out again
});

const TEAM_OF_GOAL = { red: 'red', blue: 'blue' }; // goal key → defending team
const OPP = { red: 'blue', blue: 'red' };

/**
 * @typedef {Object} RefereeGameState
 * @property {{pos: number[]}} ball        Ball with MJCF pos [x, y, z].
 * @property {Array<{id: string, team: 'red'|'blue', pos: number[], fallen?: boolean}>} [ducks]
 */

// ── Pure decision helpers (no referee state; exported for reuse/tests) ───

/**
 * Swept goal-line test. The segment prev → cur is intersected with each
 * goal plane at x = ±FIELD_HALF_L; a goal needs the crossing point inside
 * the mouth (|y| ≤ halfW + r for post grazes, z < GOAL_HEIGHT). The sweep
 * catches fast balls that would tunnel through the plane in a single
 * frame. Detection fires while the ball is still inside the net cage
 * (the collision geoms in goal.js stop it short of the back panel).
 *
 * @param {number[]} prev - Previous ball pos [x, y, z].
 * @param {number[]} cur  - Current ball pos [x, y, z].
 * @returns {?{team: 'red'|'blue', goal: 'red'|'blue'}} Scoring team + goal owner.
 */
export function checkGoal(prev, cur) {
  if (!prev || !cur) return null;
  const r = BALL_RADIUS;
  for (const owner of ['red', 'blue']) {
    const { x: planeX, halfW } = GOAL_LINES[owner];
    const side = Math.sign(planeX);
    const crossed = side < 0
      ? prev[0] > planeX && cur[0] <= planeX
      : prev[0] < planeX && cur[0] >= planeX;
    if (!crossed) continue;
    const t = (planeX - prev[0]) / (cur[0] - prev[0]);
    const y = prev[1] + t * (cur[1] - prev[1]);
    const z = prev[2] + t * (cur[2] - prev[2]);
    if (Math.abs(y) <= halfW + r && z < GOAL_HEIGHT) {
      return { team: OPP[TEAM_OF_GOAL[owner]], goal: owner };
    }
  }
  return null;
}

/**
 * Out-of-bounds test: the whole ball must be past the line (partially on
 * the line stays in play), per 01-rules.md.
 *
 * @param {number[]} pos - Ball pos [x, y, z].
 * @returns {?{kind: 'sideline'|'goalline', side: number, pos: number[]}}
 */
export function checkOutOfBounds(pos) {
  if (!pos) return null;
  const r = BALL_RADIUS;
  if (Math.abs(pos[1]) + r > FIELD_HALF_W) {
    return { kind: 'sideline', side: Math.sign(pos[1]), pos };
  }
  if (Math.abs(pos[0]) + r > FIELD_HALF_L) {
    return { kind: 'goalline', side: Math.sign(pos[0]), pos };
  }
  return null;
}


/**
 * Classify the restart after the ball leaves the field.
 *   sideline  → throw_in for the opponents of the last toucher
 *   goalline  → goal_kick if the attacking team touched last,
 *               corner for the attackers if the defenders touched last.
 * A null lastTouchTeam (nobody touched it) defaults to a goal kick for
 * the defending team — the conservative restart.
 *
 * @param {{kind: string, side: number, pos: number[]}} oob
 * @param {?('red'|'blue')} lastTouchTeam
 * @returns {{type: string, team: 'red'|'blue', pos: number[]}}
 */
export function decideSetPiece(oob, lastTouchTeam) {
  const m = REFEREE.SPOT_MARGIN;
  if (oob.kind === 'sideline') {
    const team = lastTouchTeam ? OPP[lastTouchTeam] : 'red';
    const y = oob.side * (FIELD_HALF_W - m);
    const x = Math.max(-FIELD_HALF_L + m, Math.min(FIELD_HALF_L - m, oob.pos[0]));
    return { type: 'throw_in', team, pos: [x, y, BALL_SPAWN[2]] };
  }
  // Goal line: `defender` owns the goal the ball went out over.
  const defender = oob.side < 0 ? 'red' : 'blue';
  const attacker = OPP[defender];
  const sign = oob.side;
  if (!lastTouchTeam || lastTouchTeam === attacker) {
    return {
      type: 'goal_kick',
      team: defender,
      pos: [sign * REFEREE.GOAL_KICK_X, 0, BALL_SPAWN[2]],
    };
  }
  const cornerY = Math.abs(oob.pos[1]) >= FIELD_HALF_W / 2
    ? oob.side * (FIELD_HALF_W - m)
    : Math.sign(oob.pos[1] || 1) * (FIELD_HALF_W - m);
  // Corner spots are named after the END they sit at: a corner at the blue
  // goal (+X) is 'corner_blue' and is taken by the attackers (red here).
  return { type: sign < 0 ? 'corner_red' : 'corner_blue', team: attacker, pos: [sign * (FIELD_HALF_L - m), cornerY, BALL_SPAWN[2]] };
}

/**
 * Touch detection: every duck whose 2D distance to the ball is under
 * TOUCH_DIST, sorted nearest-first so the referee's [0] attribution is
 * decided by proximity rather than input-array order. With TOUCH_DIST
 * widened to 0.55 several ducks can share a frame, so ordering matters.
 *
 * @param {number[]} ballPos
 * @param {Array<{id: string, team: string, pos: number[]}>} ducks
 * @returns {Array<{id: string, team: string}>}
 */
export function detectTouches(ballPos, ducks) {
  if (!ballPos || !ducks) return [];
  const out = [];
  for (const d of ducks) {
    if (!d || !d.pos) continue;
    const dx = d.pos[0] - ballPos[0];
    const dy = d.pos[1] - ballPos[1];
    const dist = Math.hypot(dx, dy);
    if (dist < REFEREE.TOUCH_DIST) out.push({ id: d.id, team: d.team, dist });
  }
  return out
    .sort((a, b) => a.dist - b.dist)
    .map(({ id, team }) => ({ id, team }));
}

/**
 * Pure per-frame read of the field: touches + goal + out-of-bounds.
 * Stateless by design (same input → same output), so tests can assert
 * determinism and game.js can reuse it for telemetry.
 *
 * @param {?number[]} prevBallPos
 * @param {RefereeGameState} gameState
 * @returns {{touches: Array, goal: ?Object, outOfBounds: ?Object}}
 */
export function decide(prevBallPos, gameState) {
  const ballPos = gameState && gameState.ball ? gameState.ball.pos : null;
  return {
    touches: detectTouches(ballPos, gameState ? gameState.ducks : null),
    goal: checkGoal(prevBallPos, ballPos),
    outOfBounds: checkOutOfBounds(ballPos),
  };
}

// ── The referee itself ────────────────────────────────────────────────────

/**
 * Create a referee instance. All match state lives in the closure; the
 * only side effect is the `onEvent` callback.
 *
 * Events emitted: kickoff, playing, goal, goal_disallowed, throw_in,
 * goal_kick, corner, penalty, penalty_returned, yellow_card, red_card,
 * extra_time, fulltime.
 *
 * @param {{onEvent?: (type: string, payload?: Object) => void}} options
 */
export function createReferee({ onEvent } = {}) {
  let state = 'IDLE';
  let score = { red: 0, blue: 0 };
  let matchTime = 0;          // seconds of PLAYING time (incl. extra time)
  let extraTime = false;      // golden-goal period active
  let result = null;          // 'red' | 'blue' | 'draw' once FULLTIME
  let lastTouchTeam = null;
  let setPieceType = null;    // 'kickoff'|'throw_in'|'goal_kick'|'corner_red'|'corner_blue'
  let setPiecePos = null;
  let setPieceTeam = null;
  let foulTimers = {};        // duckId → remaining sin-bin seconds
  let fallTimers = {};        // duckId → continuous fallen seconds
  let idleTimers = {};        // duckId → continuous near-ball inactivity seconds
  let prevDuckPos = {};       // duckId → last frame pos (idle detection)
  let warnings = {};          // duckId → caution count
  let yellows = {};           // duckId → yellow-card count
  let cards = { yellow: [], red: [] };
  let prevBallPos = null;
  let stateTimer = 0;         // generic hold timer (DEAD_BALL / SET_PIECE / GOAL)
  let pendingPiece = null;    // queued restart while the whistle hold ticks
  let kickoffTeam = 'red';    // who takes the next kickoff
  let kickoffTimer = 0;        // seconds elapsed in KICKOFF state (timeout fallback)
  let setPieceActive = false; // restart context alive: first touch may still be judged
  let touchesSinceSetPiece = 0; // own-goal rule: single defensive touch
  let lastTouchId = null;
  let kickoffActive = false;  // true from a kickoff until the ball is touched:
                              // a goal before then is "directly from the kickoff"
                              // and is judged by direction (opponents' net counts,
                              // own net → a corner for the kicking team).

  const emit = (type, payload) => {
    if (onEvent) onEvent(type, payload);
  };

  // ── Discipline ────────────────────────────────────────────────────────

  function addWarning(duckId, reason) {
    warnings[duckId] = (warnings[duckId] || 0) + 1;
    if (warnings[duckId] % REFEREE.WARNINGS_PER_YELLOW === 0) {
      const yellowCount = warnings[duckId] / REFEREE.WARNINGS_PER_YELLOW;
      cards.yellow.push({ duckId, reason, time: matchTime });
      yellows[duckId] = yellowCount;
      emit('yellow_card', { duckId, reason, count: yellowCount, time: matchTime });
      if (yellowCount >= REFEREE.YELLOWS_PER_RED) {
        // Second caution = sending-off: permanent, sin-bin timer dropped.
        cards.red.push({ duckId, reason, time: matchTime });
        delete foulTimers[duckId];
        emit('red_card', { duckId, reason, time: matchTime });
      }
    }
  }

  /**
   * Register a rules violation for one duck. Already sin-binned → reset
   * the remaining time and append a warning (rules §"罚时期间违规返场").
   *
   * @param {string} duckId
   * @param {'fallen'|'inactive'|'set_piece'} reason
   */
  function violate(duckId, reason) {
    fallTimers[duckId] = 0;
    idleTimers[duckId] = 0;
    if (foulTimers[duckId] > 0) {
      foulTimers[duckId] = PENALTY_DURATION_S;
      addWarning(duckId, reason);
      emit('penalty_reset', { duckId, reason, time: matchTime });
      return;
    }
    foulTimers[duckId] = PENALTY_DURATION_S;
    emit('penalty', { duckId, reason, duration: PENALTY_DURATION_S, time: matchTime });
  }

  function tickFouls(dt, gameState) {
    // Sin-bin countdown (runs in every live state).
    for (const id of Object.keys(foulTimers)) {
      foulTimers[id] -= dt;
      if (foulTimers[id] <= 0) {
        delete foulTimers[id];
        emit('penalty_returned', { duckId: id, time: matchTime });
      }
    }
    // Fallen / idle foul detection only runs during open play. During
    // KICKOFF, SET_PIECE, DEAD_BALL, and GOAL the ducks are being placed
    // or waiting — penalising them for not moving or for physics settling
    // causes spurious send-offs and cascading failures.
    if (state !== 'PLAYING') {
      // Reset accumulators so stale values don't carry into the next
      // PLAYING window.
      const ducks = (gameState && gameState.ducks) || [];
      for (const d of ducks) {
        if (!d || d.id == null) continue;
        fallTimers[d.id] = 0;
        idleTimers[d.id] = 0;
        if (d.pos) prevDuckPos[d.id] = d.pos.slice();
      }
      return;
    }
    const ballPos = gameState && gameState.ball ? gameState.ball.pos : null;
    const ducks = (gameState && gameState.ducks) || [];
    for (const d of ducks) {
      if (!d || d.id == null) continue;
      if (isSentOff(d.id)) continue; // permanently off, nothing to police
      // Fallen timeout.
      if (d.fallen) {
        fallTimers[d.id] = (fallTimers[d.id] || 0) + dt;
        if (fallTimers[d.id] > REFEREE.FALLEN_TIMEOUT_S) violate(d.id, 'fallen');
      } else {
        fallTimers[d.id] = 0;
      }
      // Inactivity: ball within IDLE_NEAR_BALL_DIST but the duck does not
      // move for IDLE_TIMEOUT_S.
      // The threshold is a speed (m/s) scaled by dt into a per-step
      // displacement, so it stays frame-rate independent: 0.05 m/s sits
      // well below a duck's normal walk (VEL_FWD = 0.25 m/s) and above
      // standing-still jitter.
      const prev = prevDuckPos[d.id];
      const moved = !prev || !d.pos
        ? true
        : Math.hypot(d.pos[0] - prev[0], d.pos[1] - prev[1]) > REFEREE.IDLE_SPEED_EPS * dt;
      if (d.pos) prevDuckPos[d.id] = d.pos.slice();
      const nearBall = ballPos && d.pos
        && Math.hypot(d.pos[0] - ballPos[0], d.pos[1] - ballPos[1]) < REFEREE.IDLE_NEAR_BALL_DIST;
      if (nearBall && !moved) {
        idleTimers[d.id] = (idleTimers[d.id] || 0) + dt;
        if (idleTimers[d.id] > REFEREE.IDLE_TIMEOUT_S) violate(d.id, 'inactive');
      } else {
        idleTimers[d.id] = 0;
      }
    }
  }

  function isSentOff(duckId) {
    return cards.red.some((c) => c.duckId === duckId);
  }

  // ── Restarts ──────────────────────────────────────────────────────────

  function beginSetPiece(piece) {
    setPieceType = piece.type;
    setPiecePos = piece.pos.slice();
    setPieceTeam = piece.team;
    setPieceActive = true;
    touchesSinceSetPiece = 0;
    kickoffActive = false; // a placed restart ends the direct-kickoff window
    stateTimer = 0;
    prevBallPos = null; // no sweeping across the teleport to the spot
    state = 'SET_PIECE';
    emit(piece.type, { team: piece.team, pos: piece.pos.slice(), time: matchTime });
  }

  function beginKickoff(team) {
    setPieceType = 'kickoff';
    setPiecePos = BALL_SPAWN.slice();
    setPieceTeam = team;
    setPieceActive = true;
    touchesSinceSetPiece = 0;
    kickoffActive = true;   // open the direct-kickoff goal window
    prevBallPos = null; // no sweeping across the teleport to centre
    kickoffTimer = 0;   // reset timeout fallback
    state = 'KICKOFF';
    emit('kickoff', { team, pos: BALL_SPAWN.slice(), score: { ...score }, time: matchTime });
  }

  /**
   * Transition to open play. A set piece released by a touch keeps its
   * context alive so the own-goal-from-set-piece rule can still judge
   * that first touch; a kickoff does not (rules §乌龙球判定 lists only
   * 界外球/球门球/角球), and a ball simply rolling off the spot is open
   * play right away.
   *
   * @param {boolean} touched - True when released by a touch.
   */
  function releaseToPlay(touched) {
    if (!(touched && setPieceType !== 'kickoff')) setPieceActive = false;
    state = 'PLAYING';
    emit('playing', { time: matchTime });
  }

  function endMatch(winner) {
    result = winner; // 'red' | 'blue' | 'draw'
    state = 'FULLTIME';
    emit('fulltime', { result, score: { ...score }, extraTime, time: matchTime });
  }

  // ── Per-state handlers ────────────────────────────────────────────────

  /**
   * Record touch bookkeeping shared by KICKOFF / PLAYING / SET_PIECE: the
   * toucher becomes the last-touch reference for out-of-bounds and own-goal
   * decisions even when the touch is what releases the restart.
   */
  function recordTouches(touches) {
    if (touches.length === 0) return;
    lastTouchTeam = touches[0].team;
    lastTouchId = touches[0].id;
    touchesSinceSetPiece += 1;
    // First contact after the kickoff puts the ball into open play. Until it
    // happens a goal is "directly from the kickoff" and is judged by which
    // net the ball went into (see onGoal).
    kickoffActive = false;
  }

  function handleKickoff(dt, gameState, touches, ballPos) {
    kickoffTimer += dt;
    recordTouches(touches);
    // Released by a touch, by the ball travelling away from the spot, or
    // by the timeout fallback (defensive: AI ducks may never get close
    // enough to register a touch due to body geometry).
    const moved = ballPos && setPiecePos
      && Math.hypot(ballPos[0] - setPiecePos[0], ballPos[1] - setPiecePos[1]) > REFEREE.KICKOFF_MOVE_EPS;
    if (touches.length > 0 || moved || kickoffTimer >= REFEREE.KICKOFF_TIMEOUT_S) {
      releaseToPlay(touches.length > 0);
    }
  }

  function handlePlaying(dt, gameState, touches, ballPos) {
    matchTime += dt;
    recordTouches(touches);
    // The first touch consumes a set-piece context: it is the one the
    // own-goal-from-set-piece rule judges. From the second touch on it is
    // open play (except right after a kickoff, where the context is only
    // bookkeeping for the deferred direct-goal rule).
    if (touches.length > 0 && setPieceActive
      && (touchesSinceSetPiece >= 2 || setPieceType !== 'kickoff')) {
      setPieceActive = false;
    }
    // Goal (swept) takes priority over out-of-bounds: a ball in the mouth
    // is also "past the goal line" but must count as a goal.
    const goal = checkGoal(prevBallPos, ballPos);
    if (goal) {
      onGoal(goal);
      return;
    }
    const oob = checkOutOfBounds(ballPos);
    if (oob) {
      const piece = decideSetPiece(oob, lastTouchTeam);
      state = 'DEAD_BALL';
      stateTimer = REFEREE.DEAD_BALL_S;
      pendingPiece = piece;
      return;
    }
    // Time expired?
    if (extraTime) {
      if (matchTime >= MATCH_DURATION_S + GOLDEN_GOAL_DURATION_S) endMatch('draw');
    } else if (matchTime >= MATCH_DURATION_S) {
      if (score.red === score.blue) {
        extraTime = true;
        emit('extra_time', { score: { ...score }, time: matchTime });
      } else {
        endMatch(score.red > score.blue ? 'red' : 'blue');
      }
    }
  }

  function onGoal(goal) {
    // Direct from the kickoff (nobody touched the ball in between). Judge by
    // which net it went into, relative to the kicking team:
    //   opponents' net → a valid goal for the kicking team;
    //   own net        → no own goal from a kickoff; corner for the kicker.
    // `goal.goal` is the net owner, `goal.team` the side a normal goal pays.
    if (kickoffActive) {
      kickoffActive = false;
      if (goal.goal === kickoffTeam) {
        emit('goal_disallowed', { reason: 'direct_kickoff_own_goal', team: kickoffTeam, time: matchTime });
        const sign = kickoffTeam === 'red' ? -1 : 1;
        const m = REFEREE.SPOT_MARGIN;
        pendingPiece = {
          // Corner at the kicking team's own end (where its net is), taken by
          // the kicking team — a direct own goal from the kickoff is not an
          // own goal, so the kicker keeps possession via the corner.
          type: kickoffTeam === 'red' ? 'corner_red' : 'corner_blue',
          team: kickoffTeam,
          pos: [sign * (FIELD_HALF_L - m), FIELD_HALF_W - m, BALL_SPAWN[2]],
        };
        state = 'DEAD_BALL';
        stateTimer = REFEREE.DEAD_BALL_S;
        return;
      }
      // Opponents' net: a valid goal. Credit the kicking team as the last
      // toucher (no duck registered a touch) and fall through to normal
      // scoring; isOwnGoal stays false since the ball went into the other net.
      lastTouchTeam = kickoffTeam;
      lastTouchId = null;
    }
    const defendingTeam = OPP[goal.team]; // team whose net it is
    const isOwnGoal = lastTouchTeam === defendingTeam;
    // Own goal straight from a set piece with a single defensive touch:
    // disallowed, opponents get a corner instead (rules §乌龙球判定).
    if (isOwnGoal && setPieceActive && touchesSinceSetPiece <= 1) {
      emit('goal_disallowed', { reason: 'own_goal_set_piece', team: defendingTeam, time: matchTime });
      const sign = defendingTeam === 'red' ? -1 : 1;
      const m = REFEREE.SPOT_MARGIN;
      pendingPiece = {
        // Corner spots are named after the END they sit at (see
        // decideSetPiece): the own goal went into the defending team's
        // own net, so the corner is at that end and the attackers take it.
        type: defendingTeam === 'red' ? 'corner_red' : 'corner_blue',
        team: goal.team,
        pos: [sign * (FIELD_HALF_L - m), FIELD_HALF_W - m, BALL_SPAWN[2]],
      };
      state = 'DEAD_BALL';
      stateTimer = REFEREE.DEAD_BALL_S;
      setPieceActive = false;
      return;
    }
    score[goal.team] += 1;
    emit('goal', {
      team: goal.team,
      scorer: isOwnGoal ? null : lastTouchId,
      ownGoal: isOwnGoal,
      score: { ...score },
      time: matchTime,
    });
    if (extraTime) {
      endMatch(goal.team); // golden goal: match over immediately
      return;
    }
    state = 'GOAL';
    stateTimer = REFEREE.GOAL_RESET_S;
    kickoffTeam = OPP[goal.team]; // the conceding team restarts
  }

  function handleDeadBall(dt) {
    stateTimer -= dt;
    if (stateTimer <= 0 && pendingPiece) {
      const piece = pendingPiece;
      pendingPiece = null;
      beginSetPiece(piece);
    }
  }

  function handleSetPiece(dt, gameState, touches, ballPos) {
    // Released by a touch, by the ball leaving the spot, or by timeout
    // (open ball — nobody owns it, play just resumes where it lies).
    stateTimer += dt;
    recordTouches(touches);
    const moved = ballPos && setPiecePos
      && Math.hypot(ballPos[0] - setPiecePos[0], ballPos[1] - setPiecePos[1]) > REFEREE.SET_PIECE_MOVE_EPS;
    if (touches.length > 0 || moved || stateTimer > REFEREE.SET_PIECE_TIMEOUT_S) {
      releaseToPlay(touches.length > 0);
    }
  }

  function handleGoalState(dt) {
    stateTimer -= dt;
    if (stateTimer <= 0) beginKickoff(kickoffTeam);
  }

  /**
   * Advance the match by dt seconds.
   *
   * @param {number} dt - Frame delta in seconds (ignored when ≤ 0).
   * @param {RefereeGameState} gameState - Ball + duck snapshot this frame.
   */
  function step(dt, gameState) {
    if (!(dt > 0) || state === 'IDLE' || state === 'FULLTIME') return;
    const ballPos = gameState && gameState.ball ? gameState.ball.pos : null;
    const touches = state === 'PLAYING' || state === 'KICKOFF' || state === 'SET_PIECE'
      ? detectTouches(ballPos, gameState ? gameState.ducks : null)
      : [];
    tickFouls(dt, gameState);
    switch (state) {
      case 'KICKOFF':
        handleKickoff(dt, gameState, touches, ballPos);
        break;
      case 'PLAYING':
        handlePlaying(dt, gameState, touches, ballPos);
        break;
      case 'DEAD_BALL':
        handleDeadBall(dt);
        break;
      case 'SET_PIECE':
        handleSetPiece(dt, gameState, touches, ballPos);
        break;
      case 'GOAL':
        handleGoalState(dt);
        break;
      default:
        break;
    }
    prevBallPos = ballPos ? ballPos.slice() : null;
  }

  /** Start (or restart) the match: red kicks off from centre. */
  function startMatch() {
    score = { red: 0, blue: 0 };
    matchTime = 0;
    extraTime = false;
    result = null;
    lastTouchTeam = null;
    lastTouchId = null;
    foulTimers = {};
    fallTimers = {};
    idleTimers = {};
    prevDuckPos = {};
    warnings = {};
    yellows = {};
    cards = { yellow: [], red: [] };
    pendingPiece = null;
    setPieceActive = false;
    kickoffActive = false;
    kickoffTeam = 'red';
    beginKickoff('red');
  }

  return {
    step,
    startMatch,
    getState: () => state,
    getScore: () => ({ ...score }),
    getMatchTime: () => matchTime,
    isExtraTime: () => extraTime,
    getResult: () => result,
    getLastTouchTeam: () => lastTouchTeam,
    getSetPiece: () => (setPieceType
      ? { type: setPieceType, pos: setPiecePos.slice(), team: setPieceTeam, active: setPieceActive }
      : null),
    getCards: () => ({ yellow: cards.yellow.slice(), red: cards.red.slice() }),
    getWarnings: (duckId) => (duckId == null ? { ...warnings } : warnings[duckId] || 0),
    getFoulTimers: () => ({ ...foulTimers }),
    isSentOff,
  };
}
