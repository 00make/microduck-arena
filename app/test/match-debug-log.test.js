import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMatchDebugLog } from '../src/game/football/match-debug-log.js';

describe('createMatchDebugLog', () => {
  let store;
  beforeEach(() => {
    store = {};
    globalThis.localStorage = {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    };
  });

  it('starts a match, records loud events, and flushes to storage', () => {
    const log = createMatchDebugLog();
    const id = log.startMatch({ simSpeed: 2 });
    log.push('shot', { team: 'blue' });
    log.noteDanger({
      state: 'PLAYING',
      score: { red: 0, blue: 0 },
      matchTime: 12,
      lastTouch: 'blue',
      ball: [-3.01, 0.2, 0.05],
      oob: { kind: 'goalline', side: -1 },
    });
    log.push('goal_kick', { team: 'red' });
    const saved = log.flush('fulltime');
    assert.equal(saved.id, id);
    assert.ok(saved.summary.nearMissGoalline >= 1);
    assert.equal(log.list().length, 1);
    assert.equal(log.get(id).events.some((e) => e.type === 'shot'), true);
  });
});
