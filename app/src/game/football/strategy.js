// Coach Strategy Card (v2) — continuous 0..1 energy knobs → TUNE overlay.
// Same JSON is the handshake payload for NL / blocks / PvP lobby.
// Legacy discrete levels (push/low/…) are migrated on normalize.

import { SPAWN_POSITIONS, FIELD_HALF_L } from './constants.js';

export const STRATEGY_VERSION = 2;

export const FORMATION_IDS = ['2f1gk', '1f1d1gk'];
export const STYLE_IDS = ['attack', 'balanced', 'defend'];
/** @deprecated discrete press ids — kept for tag buckets / old saves */
export const PRESS_IDS = ['low', 'medium', 'high'];

export const KNOB_IDS = [
  'lineHeight',
  'press',
  'shootGreed',
  'supportWidth',
  'supportDepth',
  'approach',
  'clearStyle',
  'gkRush',
  'spacing',
];

/** Always-on energy bars (biggest visual regimes). */
export const PRIMARY_KNOB_IDS = ['lineHeight', 'press', 'shootGreed', 'gkRush'];

/** Legacy discrete → 0..1 */
const LEGACY_LEVEL_VALUE = Object.freeze({
  sit: 0, push: 1,
  low: 0, high: 1,
  patient: 0, greedy: 1,
  narrow: 0, wide: 1,
  near: 0, far: 1,
  tight: 0, // approach: 0=tight rush, 1=patient stand-behind
  hold: 0, boot: 1,
  home: 0, sweeper: 1,
  pack: 0, spread: 1,
  balanced: 0.5, medium: 0.5, normal: 0.5,
});

/** Balanced mid-rail defaults. */
export const DEFAULT_KNOBS = Object.freeze({
  lineHeight: 0.5,
  press: 0.5,
  shootGreed: 0.5,
  supportWidth: 0.5,
  supportDepth: 0.5,
  approach: 0.5,
  clearStyle: 0.5,
  gkRush: 0.5,
  spacing: 0.5,
});

/** Style presets — extreme enough to read in ~30s of play. */
export const STYLE_PRESET_KNOBS = Object.freeze({
  attack: Object.freeze({
    lineHeight: 0.92,
    press: 0.82,
    shootGreed: 0.88,
    supportWidth: 0.35,
    supportDepth: 0.85,
    approach: 0.35,
    clearStyle: 0.55,
    gkRush: 0.45,
    spacing: 0.4,
  }),
  balanced: Object.freeze({ ...DEFAULT_KNOBS }),
  defend: Object.freeze({
    lineHeight: 0.12,
    press: 0.1,
    shootGreed: 0.18,
    supportWidth: 0.8,
    supportDepth: 0.2,
    approach: 0.75,
    clearStyle: 0.25,
    gkRush: 0.85,
    spacing: 0.75,
  }),
});

export const DEFAULT_STRATEGY = Object.freeze({
  version: STRATEGY_VERSION,
  formation: '2f1gk',
  style: 'balanced',
  press: 'medium',
  knobs: { ...DEFAULT_KNOBS },
});

const SPAWN_1F1D1GK = [
  { team: 'red', role: 'forward', x: -0.55, y: 0.55, yaw: 0 },
  { team: 'red', role: 'defender', x: -2.0, y: -0.35, yaw: 0 },
  { team: 'red', role: 'goalkeeper', x: -2.85, y: 0.0, yaw: 0 },
  { team: 'blue', role: 'forward', x: 0.55, y: 0.55, yaw: Math.PI },
  { team: 'blue', role: 'defender', x: 2.0, y: -0.35, yaw: Math.PI },
  { team: 'blue', role: 'goalkeeper', x: 2.85, y: 0.0, yaw: Math.PI },
];

export const FORMATION_SPAWNS = Object.freeze({
  '2f1gk': SPAWN_POSITIONS,
  '1f1d1gk': SPAWN_1F1D1GK,
});

function clamp01(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}

function lerp(a, b, t) {
  return a + (b - a) * clamp01(t);
}

/** Coerce legacy string levels or numbers into 0..1. */
export function coerceKnobValue(raw) {
  if (typeof raw === 'string' && Object.prototype.hasOwnProperty.call(LEGACY_LEVEL_VALUE, raw)) {
    return LEGACY_LEVEL_VALUE[raw];
  }
  return clamp01(raw);
}

export function sanitizeKnobs(raw = {}) {
  const out = { ...DEFAULT_KNOBS };
  for (const id of KNOB_IDS) {
    if (raw[id] != null) out[id] = coerceKnobValue(raw[id]);
  }
  return out;
}

function knobsEqual(a, b, eps = 0.04) {
  for (const id of KNOB_IDS) {
    if (Math.abs(a[id] - b[id]) > eps) return false;
  }
  return true;
}

export function pressBucket(v) {
  const t = coerceKnobValue(v);
  if (t < 0.34) return 'low';
  if (t < 0.67) return 'medium';
  return 'high';
}

/** Return style id if knobs near a preset; else null. */
export function matchStylePreset(knobs) {
  const k = sanitizeKnobs(knobs);
  for (const style of STYLE_IDS) {
    if (knobsEqual(k, STYLE_PRESET_KNOBS[style])) return style;
  }
  return null;
}

/**
 * Normalize any partial / legacy card into a v2 Strategy Card (0..1 knobs).
 */
export function normalizeStrategy(partial = {}) {
  const formation = FORMATION_IDS.includes(partial.formation)
    ? partial.formation
    : DEFAULT_STRATEGY.formation;

  const hasKnobs = partial.knobs && typeof partial.knobs === 'object';
  const styleIn = partial.style === 'custom'
    ? 'custom'
    : (STYLE_IDS.includes(partial.style) ? partial.style : null);

  let knobs;
  let style;

  if (hasKnobs) {
    knobs = sanitizeKnobs({ ...DEFAULT_KNOBS, ...partial.knobs });
    if (PRESS_IDS.includes(partial.press) && partial.knobs.press == null) {
      knobs.press = coerceKnobValue(partial.press);
    }
    const matched = matchStylePreset(knobs);
    if (styleIn === 'custom') style = matched || 'custom';
    else if (styleIn && knobsEqual(knobs, STYLE_PRESET_KNOBS[styleIn])) style = styleIn;
    else style = matched || 'custom';
  } else if (styleIn && styleIn !== 'custom') {
    knobs = sanitizeKnobs({ ...STYLE_PRESET_KNOBS[styleIn] });
    if (PRESS_IDS.includes(partial.press)) knobs.press = coerceKnobValue(partial.press);
    style = matchStylePreset(knobs) || styleIn;
  } else {
    knobs = sanitizeKnobs({ ...DEFAULT_KNOBS });
    if (PRESS_IDS.includes(partial.press)) {
      knobs.press = coerceKnobValue(partial.press);
      style = matchStylePreset(knobs) || 'custom';
    } else {
      style = 'balanced';
    }
  }

  return {
    version: STRATEGY_VERSION,
    formation,
    style,
    press: pressBucket(knobs.press),
    knobs,
  };
}

export function strategyFromStylePreset(style, formation) {
  const s = STYLE_IDS.includes(style) ? style : 'balanced';
  return normalizeStrategy({
    formation: formation || DEFAULT_STRATEGY.formation,
    style: s,
    knobs: { ...STYLE_PRESET_KNOBS[s] },
  });
}

export function mergeStrategy(prev, partial = {}) {
  const base = normalizeStrategy(prev);

  if (partial.style && STYLE_IDS.includes(partial.style)) {
    const presetKnobs = { ...STYLE_PRESET_KNOBS[partial.style] };
    if (partial.knobs == null || knobsEqual(sanitizeKnobs(partial.knobs), presetKnobs)) {
      let card = strategyFromStylePreset(partial.style, partial.formation ?? base.formation);
      if (partial.press != null && coerceKnobValue(partial.press) !== card.knobs.press) {
        card = normalizeStrategy({
          ...card,
          knobs: { ...card.knobs, press: coerceKnobValue(partial.press) },
        });
      }
      return card;
    }
  }

  const nextKnobs = partial.knobs
    ? sanitizeKnobs({ ...base.knobs, ...partial.knobs })
    : { ...base.knobs };
  if (partial.press != null && (!partial.knobs || partial.knobs.press == null)) {
    nextKnobs.press = coerceKnobValue(partial.press);
  }
  const forceCustom = partial.style === 'custom' || !!partial.knobs;
  return normalizeStrategy({
    formation: partial.formation ?? base.formation,
    style: forceCustom ? 'custom' : (partial.style ?? base.style),
    knobs: nextKnobs,
  });
}

/**
 * Compile continuous knobs → TUNE patch.
 * Ranges are intentionally wide so attack vs defend is readable in-game.
 * LINE_HOLD_MID / LINE_PUSH_MID are hard regime flags for decideAll.
 */
export function knobsToOverlay(knobsIn) {
  const k = sanitizeKnobs(knobsIn);
  const lh = k.lineHeight;
  const pr = k.press;
  const sg = k.shootGreed;
  return {
    // Line / shape — huge geometric swing
    FORMATION_X_ADVANCE: lerp(-0.2, 1.15, lh),
    FORMATION_X_RETREAT: lerp(-1.2, 0.35, lh),
    GUARD_X_FRAC: lerp(0.82, 0.36, lh),
    SUPPORT_X_FRAC: lerp(0.18, 0.72, lh),
    LINE_HOLD_MID: lh < 0.35 ? 1 : 0,
    LINE_PUSH_MID: lh > 0.65 ? 1 : 0,

    // Press — 0 = only chaser; 1 = second man hunts from ~2.4 m
    SECOND_PRESS_DIST: lerp(0, 2.45, pr),
    CHASE_HYSTERESIS: lerp(0.42, 0.1, pr),
    FACE_COST_WEIGHT: lerp(0.45, 0.2, pr),
    CHASE_SPEED: lerp(0.2, 0.25, pr),
    DEF_CHASE_SPEED: lerp(0.2, 0.25, pr),

    // Shoot greed
    SHOOT_ANGLE: lerp(0.12, 0.58, sg),
    SHOOT_DIST: lerp(0.28, 0.58, sg),

    SUPPORT_LATERAL: lerp(0.3, 1.3, k.supportWidth),
    SUPPORT_AHEAD: lerp(0.1, 1.2, k.supportDepth),
    APPROACH_OFFSET: lerp(0.16, 0.78, k.approach),
    DEF_CLEAR_DIST: lerp(0.24, 0.55, k.clearStyle),
    TEAMMATE_BALL_DIST: lerp(0.35, 0.9, k.clearStyle),
    GK_DIVE_DIST: lerp(0.85, 2.35, k.gkRush),
    AVOID_RADIUS: lerp(0.28, 0.95, k.spacing),
    AVOID_STRENGTH: lerp(0.18, 0.7, k.spacing),
  };
}

export function getTuneOverlay(strategy) {
  return knobsToOverlay(normalizeStrategy(strategy).knobs);
}

/**
 * Spawn table + lineHeight bias so kickoff posture already looks different.
 */
export function buildSpawnTable(strategyByTeam = {}) {
  return SPAWN_POSITIONS.map((base, id) => {
    const strat = normalizeStrategy(strategyByTeam[base.team]);
    const table = FORMATION_SPAWNS[strat.formation] || FORMATION_SPAWNS['2f1gk'];
    const slot = table[id] || base;
    const lh = strat.knobs.lineHeight;
    const push = (lh - 0.5) * 1.1; // ±0.55 m
    const sign = slot.team === 'red' ? 1 : -1;
    let bias = push * sign;
    if (slot.role === 'goalkeeper') bias *= 0.12;
    else if (slot.role === 'defender') bias *= 0.55;
    const lim = FIELD_HALF_L - 0.35;
    const x = Math.max(-lim, Math.min(lim, slot.x + bias));
    return {
      team: slot.team,
      role: slot.role,
      x,
      y: slot.y,
      yaw: slot.yaw,
    };
  });
}

export function strategiesForUser(userTeam, userStrategy, opponentStrategy) {
  const mine = normalizeStrategy(userStrategy);
  const theirs = normalizeStrategy(opponentStrategy ?? DEFAULT_STRATEGY);
  return {
    red: userTeam === 'red' ? mine : theirs,
    blue: userTeam === 'blue' ? mine : theirs,
  };
}

export function buildStrategyByTeam(strategyByTeam = {}) {
  return {
    red: normalizeStrategy(strategyByTeam.red || DEFAULT_STRATEGY),
    blue: normalizeStrategy(strategyByTeam.blue || DEFAULT_STRATEGY),
  };
}

export function strategyFingerprint(strategy) {
  const s = normalizeStrategy(strategy);
  const raw = `${s.formation}|${KNOB_IDS.map((id) => s.knobs[id].toFixed(2)).join(',')}`;
  let h = 2166136261;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

const IMPACT_COPY = {
  en: {
    lineHeight: '0 sit deep · 1 push high (hard midline lock)',
    press: '0 only chaser · 1 second man hunts hard',
    shootGreed: '0 wait to aim · 1 blast early',
    supportWidth: 'Support lane width',
    supportDepth: 'How far past the ball the 2nd man sits',
    approach: '0 rush the ball · 1 stand further behind',
    clearStyle: '0 hold · 1 boot clearances',
    gkRush: '0 stay home · 1 sweeper keeper',
    spacing: 'Teammate spacing',
  },
  zh: {
    lineHeight: '0 回收死守 · 1 全线压上（会锁中线）',
    press: '0 只一人追 · 1 第二人死命逼抢',
    shootGreed: '0 对准再射 · 1 见空档就踢',
    supportWidth: '支援横向拉开',
    supportDepth: '第二人前插深度',
    approach: '0 贴球冲 · 1 绕到球后更远',
    clearStyle: '0 控住 · 1 直接解围',
    gkRush: '0 门将死守 · 1 出门清道夫',
    spacing: '队友站位间距',
  },
};

const POLE_LABELS = {
  en: {
    lineHeight: ['Sit', 'Push'],
    press: ['Park', 'Hunt'],
    shootGreed: ['Patient', 'Greedy'],
    supportWidth: ['Narrow', 'Wide'],
    supportDepth: ['Near', 'Far'],
    approach: ['Tight', 'Patient'],
    clearStyle: ['Hold', 'Boot'],
    gkRush: ['Home', 'Sweep'],
    spacing: ['Pack', 'Spread'],
  },
  zh: {
    lineHeight: ['回收', '压上'],
    press: ['摆烂', '逼抢'],
    shootGreed: ['稳射', '抢射'],
    supportWidth: ['收窄', '拉开'],
    supportDepth: ['贴球', '前插'],
    approach: ['贴身', '绕后'],
    clearStyle: ['控住', '解围'],
    gkRush: ['死守', '清道夫'],
    spacing: ['紧凑', '疏开'],
  },
};

export function knobImpact(locale, knobId) {
  const pack = IMPACT_COPY[locale] || IMPACT_COPY.en;
  return pack[knobId] || IMPACT_COPY.en[knobId] || knobId;
}

export function knobPoles(locale, knobId) {
  const pack = POLE_LABELS[locale] || POLE_LABELS.en;
  return pack[knobId] || POLE_LABELS.en[knobId] || ['0', '1'];
}

/** @deprecated discrete labels — maps 0..1 to a short pole word */
export function knobLevelLabel(locale, level) {
  if (typeof level === 'number' || (typeof level === 'string' && /^-?\d/.test(level))) {
    const v = coerceKnobValue(level);
    return `${Math.round(v * 100)}%`;
  }
  return String(level);
}

export function describeStrategy(strategy, locale = 'en') {
  const s = normalizeStrategy(strategy);
  const diffs = [];
  const highlights = [];
  for (const id of PRIMARY_KNOB_IDS) {
    if (Math.abs(s.knobs[id] - 0.5) < 0.08) continue;
    const [lo, hi] = knobPoles(locale, id);
    const label = s.knobs[id] >= 0.5 ? hi : lo;
    highlights.push(label);
    diffs.push(`${id}:${s.knobs[id].toFixed(2)}`);
  }
  return {
    formation: s.formation,
    style: s.style,
    press: s.press,
    knobs: s.knobs,
    fingerprint: strategyFingerprint(s),
    highlights,
    summary: highlights.length ? highlights.join(' · ') : (locale === 'zh' ? '均衡' : 'Balanced'),
    impacts: Object.fromEntries(KNOB_IDS.map((id) => [id, knobImpact(locale, id)])),
    diffs,
  };
}

export function parseStrategyHints(text) {
  const raw = String(text || '');
  if (!raw.trim()) return { knobs: {} };
  const t = raw.toLowerCase();
  const knobs = {};

  if (/高位逼抢|高位压迫|全力逼抢|press\s*high|high\s*press|gegenpress/.test(t) ||
      (/逼抢|压迫|press/.test(t) && /高|high|强/.test(t))) {
    knobs.press = 0.9;
    knobs.lineHeight = 0.9;
  } else if (/低位|摆大巴|park\s*the\s*bus|low\s*press|press\s*low/.test(t) ||
      (/逼抢|压迫|press/.test(t) && /低|low|弱/.test(t))) {
    knobs.press = 0.1;
    knobs.lineHeight = 0.1;
  }

  if (/压上|压着打|push\s*up|high\s*line/.test(t)) knobs.lineHeight = 0.9;
  if (/回收|缩着|坐深|sit\s*deep|low\s*block/.test(t)) knobs.lineHeight = 0.1;

  if (/别乱射|稳一点.*射|对准再射|patient\s*shoot|don't\s*blast|no\s*rush\s*shot/.test(t) ||
      /稳射|耐心射/.test(t)) {
    knobs.shootGreed = 0.15;
  } else if (/抢射|见缝就射|greedy\s*shoot|shoot\s*early|blast/.test(t)) {
    knobs.shootGreed = 0.9;
  }

  if (/门将别|别瞎出门|门将死守|keeper\s*home|gk\s*home|stay\s*home/.test(t)) {
    knobs.gkRush = 0.1;
  } else if (/清道夫|门将出击|sweeper\s*keeper|gk\s*rush/.test(t)) {
    knobs.gkRush = 0.9;
  }

  if (/解围|清出去|boot\s*it|clear\s*it/.test(t)) knobs.clearStyle = 0.9;
  if (/别解围|控住再出|hold\s*possession/.test(t)) knobs.clearStyle = 0.15;

  if (/绕到球后|站稳再踢|patient\s*approach|stand\s*behind/.test(t)) {
    knobs.approach = 0.85;
  } else if (/贴着球|直接冲|tight\s*approach|rush\s*the\s*ball/.test(t)) {
    knobs.approach = 0.15;
  }

  if (/拉开|站开|wide\s*support|spread\s*out/.test(t)) {
    knobs.supportWidth = 0.85;
    knobs.spacing = 0.85;
  } else if (/挤一起|收紧|narrow\s*support|pack\s*tight/.test(t)) {
    knobs.supportWidth = 0.15;
    knobs.spacing = 0.15;
  }

  if (/前插|插上|support\s*far|get\s*ahead/.test(t)) knobs.supportDepth = 0.9;
  if (/贴着支援|support\s*near/.test(t)) knobs.supportDepth = 0.15;

  return { knobs };
}

export function knobsDiff(before, patchKnobs = {}) {
  const a = sanitizeKnobs(before);
  const entries = [];
  for (const id of KNOB_IDS) {
    if (patchKnobs[id] == null) continue;
    const to = coerceKnobValue(patchKnobs[id]);
    if (Math.abs(to - a[id]) > 0.02) {
      entries.push({ id, from: a[id], to });
    }
  }
  return entries;
}

/** @deprecated kept so old imports don't crash */
export const KNOB_LEVELS = null;
export const KNOB_OVERLAYS = null;
