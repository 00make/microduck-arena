// Unit tests for cumulative match stats / report board.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  createMatchStats,
  buildMatchReport,
  buildTacticsBoard,
  pickChaserId,
} from '../src/game/football/tactics-board.js';
import { isGoalDirectedShot } from '../src/game/football/match-stats.js';

describe('isGoalDirectedShot', () => {
  it('accepts a red strike at feet facing +X goal in the attack half', () => {
    assert.equal(
      isGoalDirectedShot('red', { x: 1.2, y: 0 }, { x: 0.9, y: 0, yaw: 0 }),
      true,
    );
  });

  it('rejects midfield / own-half pokes', () => {
    assert.equal(
      isGoalDirectedShot('red', { x: -0.5, y: 0 }, { x: -0.6, y: 0, yaw: 0 }),
      false,
    );
  });

  it('rejects kicks while facing away from goal', () => {
    assert.equal(
      isGoalDirectedShot('red', { x: 1.0, y: 0 }, { x: 0.7, y: 0, yaw: Math.PI }),
      false,
    );
  });

  it('rejects kicks when the ball is not at the feet', () => {
    assert.equal(
      isGoalDirectedShot('red', { x: 1.5, y: 0 }, { x: 0.5, y: 0, yaw: 0 }),
      false,
    );
  });
});

describe('match-stats', () => {
  it('accumulates possession only while PLAYING', () => {
    const stats = createMatchStats();
    stats.tick(1.0, { matchState: 'KICKOFF', lastTouchTeam: 'red' });
    stats.tick(2.0, { matchState: 'PLAYING', lastTouchTeam: 'red' });
    stats.tick(1.0, { matchState: 'PLAYING', lastTouchTeam: 'blue' });
    const snap = stats.snapshot();
    assert.equal(snap.possession.red, 2);
    assert.equal(snap.possession.blue, 1);
    assert.ok(Math.abs(snap.possession.redPct - 2 / 3) < 1e-9);
  });

  it('only counts goal-directed shots, with cooldown', () => {
    const stats = createMatchStats();
    const aim = { x: 0.9, y: 0, yaw: 0 };
    assert.equal(stats.tryNoteShot('red', { x: 1.2, y: 0 }, aim), true);
    assert.equal(stats.tryNoteShot('red', { x: 1.3, y: 0 }, aim), false); // cooldown
    // Scramble kick facing wrong way — not a shot
    assert.equal(
      stats.tryNoteShot('blue', { x: -1.0, y: 0 }, { x: -0.7, y: 0, yaw: 0 }),
      false,
    );
    // Blue facing their goal (−X)
    assert.equal(
      stats.tryNoteShot('blue', { x: -1.2, y: 0 }, { x: -0.9, y: 0, yaw: Math.PI }),
      true,
    );
    const snap = stats.snapshot();
    assert.equal(snap.shots.red, 1);
    assert.equal(snap.shots.blue, 1);
  });

  it('reset clears counters', () => {
    const stats = createMatchStats();
    stats.tick(3, { matchState: 'PLAYING', lastTouchTeam: 'red' });
    stats.tryNoteShot('red', { x: 1.2, y: 0 }, { x: 0.9, y: 0, yaw: 0 });
    stats.reset();
    const snap = stats.snapshot();
    assert.equal(snap.possession.red, 0);
    assert.equal(snap.shots.red, 0);
    assert.equal(snap.possession.redPct, 0.5);
  });
});

describe('buildMatchReport', () => {
  it('attaches normalized strategies and score', () => {
    const stats = createMatchStats();
    stats.tick(4, { matchState: 'PLAYING', lastTouchTeam: 'red' });
    stats.tick(1, { matchState: 'PLAYING', lastTouchTeam: 'blue' });
    stats.tryNoteShot('red', { x: 1.2, y: 0 }, { x: 0.9, y: 0, yaw: 0 });
    const report = buildMatchReport({
      stats,
      strategyByTeam: {
        red: { formation: '1f1d1gk', style: 'attack', press: 'high' },
        blue: { style: 'defend' },
      },
      score: { red: 2, blue: 1 },
    });
    assert.equal(report.strategy.red.style, 'attack');
    assert.equal(report.strategy.red.press, 'high');
    assert.equal(report.strategy.blue.style, 'defend');
    assert.equal(report.strategy.blue.press, 'medium');
    assert.equal(report.shots.red, 1);
    assert.equal(report.score.red, 2);
    assert.ok(report.possession.redPct > 0.7);
  });

  it('buildTacticsBoard is an alias of buildMatchReport', () => {
    const stats = createMatchStats();
    const a = buildTacticsBoard({ stats, strategyByTeam: {} });
    const b = buildMatchReport({ stats, strategyByTeam: {} });
    assert.deepEqual(a.shots, b.shots);
    assert.deepEqual(a.strategy, b.strategy);
  });
});

describe('pickChaserId', () => {
  it('still picks nearest non-GK field duck', () => {
    const ball = { x: 0.1, y: 0 };
    const red = [
      { id: 0, team: 'red', role: 'forward', pos: [-0.5, 0.4], yaw: 0 },
      { id: 1, team: 'red', role: 'forward', pos: [-1.0, -0.4], yaw: 0 },
      { id: 2, team: 'red', role: 'goalkeeper', pos: [-2.8, 0], yaw: 0 },
    ];
    assert.equal(pickChaserId(red, ball), 0);
  });
});
