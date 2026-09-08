// Per-match debug log for goal / OOB / restart forensics.
// Kept in memory during play, flushed to localStorage at fulltime / next
// kickoff / page unload so a missed goal can be inspected after the fact.

const STORAGE_KEY = 'microduck-match-logs';
const MAX_MATCHES = 10;
const MAX_EVENTS = 6000;
const DANGER_X = 2.55; // |x| beyond this → sample ball near the goals
const DANGER_MIN_GAP_MS = 120;

const LOUD = new Set([
  'match_start', 'match_end', 'goal', 'goal_disallowed', 'goal_kick',
  'corner_red', 'corner_blue', 'throw_in', 'kickoff', 'playing',
  'fulltime', 'watchdog_ball', 'near_miss_goalline', 'shot',
]);

function round3(n) {
  return Math.round(Number(n) * 1000) / 1000;
}

function ballSnap(pos, vel) {
  if (!pos) return null;
  const o = { x: round3(pos[0]), y: round3(pos[1]), z: round3(pos[2]) };
  if (vel) o.v = [round3(vel[0]), round3(vel[1]), round3(vel[2])];
  return o;
}

function readStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeStore(list) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    return true;
  } catch (e) {
    console.warn('[match-log] persist failed', e);
    return false;
  }
}

/**
 * @returns {{
 *   startMatch: (info?: object) => string,
 *   push: (type: string, data?: object) => void,
 *   noteDanger: (ctx: object) => void,
 *   flush: (reason?: string) => ?object,
 *   list: () => object[],
 *   get: (id?: string) => ?object,
 *   download: (id?: string) => ?object,
 *   clear: () => void,
 *   current: () => object,
 * }}
 */
export function createMatchDebugLog() {
  let matchId = null;
  let meta = null;
  let events = [];
  let lastDangerAt = 0;
  let lastState = null;
  let boundUnload = false;

  function ensureUnload() {
    if (boundUnload || typeof window === 'undefined') return;
    boundUnload = true;
    window.addEventListener('beforeunload', () => { flush('unload'); });
  }

  function startMatch(info = {}) {
    if (matchId && events.length) flush('next_match');
    ensureUnload();
    matchId = `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    meta = {
      id: matchId,
      startedAt: new Date().toISOString(),
      ...info,
    };
    events = [];
    lastDangerAt = 0;
    lastState = null;
    push('match_start', { ...info });
    console.info(`[match-log] started ${matchId} — dump: football.matchLog.download()`);
    return matchId;
  }

  function push(type, data = {}) {
    if (!matchId) return;
    const entry = {
      t: round3(typeof performance !== 'undefined' ? performance.now() : Date.now()),
      type,
      ...data,
    };
    events.push(entry);
    if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
    if (LOUD.has(type)) {
      console.info(`[match-log] ${type}`, data);
    }
  }

  /**
   * Throttled near-goal samples + instant samples on state / verdict changes.
   * @param {{
   *   state: string,
   *   score: {red:number,blue:number},
   *   matchTime: number,
   *   lastTouch: ?string,
   *   ball: ?number[],
   *   vel?: ?number[],
   *   goal?: ?object,
   *   oob?: ?object,
   * }} ctx
   */
  function noteDanger(ctx) {
    if (!matchId || !ctx?.ball) return;
    const pos = ctx.ball;
    const near = Math.abs(pos[0]) >= DANGER_X;
    const stateChanged = ctx.state !== lastState;
    lastState = ctx.state;

    if (ctx.goal) {
      push('goal_verdict', {
        goal: ctx.goal,
        ball: ballSnap(pos, ctx.vel),
        state: ctx.state,
        score: ctx.score,
        matchTime: round3(ctx.matchTime),
        lastTouch: ctx.lastTouch,
      });
      return;
    }
    if (ctx.oob?.kind === 'goalline') {
      push('near_miss_goalline', {
        oob: { kind: ctx.oob.kind, side: ctx.oob.side },
        ball: ballSnap(pos, ctx.vel),
        state: ctx.state,
        score: ctx.score,
        matchTime: round3(ctx.matchTime),
        lastTouch: ctx.lastTouch,
        mouthY: round3(Math.abs(pos[1])),
        pastPlane: Math.abs(pos[0]) >= 3,
        z: round3(pos[2]),
      });
      return;
    }
    if (!near && !stateChanged) return;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (!stateChanged && now - lastDangerAt < DANGER_MIN_GAP_MS) return;
    lastDangerAt = now;
    push('danger', {
      ball: ballSnap(pos, ctx.vel),
      state: ctx.state,
      score: ctx.score,
      matchTime: round3(ctx.matchTime),
      lastTouch: ctx.lastTouch,
    });
  }

  function flush(reason = 'manual') {
    if (!matchId || !events.length) return null;
    const record = {
      id: matchId,
      meta: { ...meta, endedAt: new Date().toISOString(), flushReason: reason },
      events: events.slice(),
      summary: summarize(events),
    };
    const all = readStore().filter((m) => m && m.id !== matchId);
    all.unshift(record);
    while (all.length > MAX_MATCHES) all.pop();
    writeStore(all);
    console.info(
      `[match-log] saved ${matchId} (${events.length} events, ${reason})`,
      record.summary,
    );
    return record;
  }

  function list() {
    return readStore().map((m) => ({
      id: m.id,
      startedAt: m.meta?.startedAt,
      flushReason: m.meta?.flushReason,
      summary: m.summary,
      events: m.events?.length ?? 0,
    }));
  }

  function get(id) {
    const all = readStore();
    if (!id) return all[0] || (matchId ? { id: matchId, meta, events, summary: summarize(events) } : null);
    if (id === matchId) return { id: matchId, meta, events, summary: summarize(events) };
    return all.find((m) => m.id === id) || null;
  }

  function download(id) {
    const rec = get(id);
    if (!rec || typeof document === 'undefined') return rec;
    const blob = new Blob([JSON.stringify(rec, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `microduck-match-${rec.id}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    return rec;
  }

  function clear() {
    writeStore([]);
    events = [];
    matchId = null;
    meta = null;
  }

  function current() {
    return { matchId, meta, events, count: events.length };
  }

  return { startMatch, push, noteDanger, flush, list, get, download, clear, current };
}

function summarize(evts) {
  const counts = {};
  for (const e of evts) counts[e.type] = (counts[e.type] || 0) + 1;
  const goals = evts.filter((e) => e.type === 'goal' || e.type === 'goal_verdict');
  const misses = evts.filter((e) => e.type === 'near_miss_goalline');
  return {
    counts,
    goals: goals.length,
    nearMissGoalline: misses.length,
    lastScore: [...evts].reverse().find((e) => e.score)?.score ?? null,
  };
}
