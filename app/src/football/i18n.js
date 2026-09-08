// Football UI strings — EN / 中文. No i18n framework; locale lives on the store.

import { describeStrategy } from "../game/football/strategy.js";

export const LOCALES = ["en", "zh"];

const STRINGS = {
  en: {
    loadingTeams: "Loading teams...",
    bootFailed: "Boot failed - reload to retry",
    tagline:
      "Six ducks. One ball. Zero joysticks — set your side's tactics, then watch the trained policies play the match.",
    kickOff: "Kick Off",
    resume: "Resume",
    pressA: "press A",
    pressEnter: "press Enter",
    zoom: "Zoom",
    orbit: "Orbit",
    resetCamera: "Reset Camera",
    coachFooter: "coach mode — pick tactics, ducks play themselves",
    coachDesk: "Coach desk",
    yourSide: "Your side",
    formation: "Formation",
    style: "Style",
    press: "Press",
    fineTune: "Fine tune",
    fineTuneHide: "Hide fine tune",
    fineTuneShow: "Show fine tune",
    hintPlaceholder: "e.g. high press, don't blast, keeper home",
    hintApply: "Apply",
    hintPreview: "Will change",
    hintEmpty: "No tactics matched — try other words",
    rivalTactics: "Rival tactics",
    editingSide: "Editing",
    custom: "Custom",
    red: "Red",
    blue: "Blue",
    attack: "Attack",
    balanced: "Balanced",
    defend: "Defend",
    low: "Low",
    medium: "Med",
    high: "High",
    pressWord: "press",
    formationLocked: "formation locked",
    teamTactics: "Team tactics",
    knob_lineHeight: "Line",
    knob_press: "Press",
    knob_shootGreed: "Shoot",
    knob_supportWidth: "Width",
    knob_supportDepth: "Depth",
    knob_approach: "Approach",
    knob_clearStyle: "Clear",
    knob_gkRush: "GK",
    knob_spacing: "Spacing",
    back: "Back",
    danmakuOn: "CHAT",
    danmakuOff: "CHAT OFF",
    sinBin: "SIN-BIN",
    openCoach: "Open coach desk",
    langEn: "EN",
    langZh: "中",
    // Live match report (cumulative)
    boardPoss: "Possession",
    boardShots: "Shots",
    boardVs: "vs",
    pitchSim: "Live pitch",
    pitchSimHint: "△ chaser ring · nose = facing",
    fpvLabel: "FPV · chaser",
    cardTitle: "Tactics card",
    cardSub: "FULL TIME — STRATEGY REPORT",
    // HUD match states
    state_IDLE: "STANDBY",
    state_KICKOFF: "KICKOFF",
    state_PLAYING: "PLAYING",
    state_DEAD_BALL: "DEAD BALL",
    state_SET_PIECE: "SET PIECE",
    state_GOAL: "GOAL!",
    state_HALFTIME: "HALF TIME",
    state_FULLTIME: "FULL TIME",
    // Events
    ev_goal: "GOAL!{team} Team scores!",
    ev_shot: "Shot —{team}",
    ev_yellow: "Yellow card —{team}",
    ev_red: "Red card —{team}",
    ev_corner: "Corner kick —{team}",
    ev_foul: "Foul —{team}",
    ev_penalty: "Penalty —{team}",
    ev_kickoff: "Kick off!",
    ev_halftime: "Half time",
    ev_fulltime: "Full time",
    ev_extra: "Extra time!",
    ev_throw: "Throw-in —{team}",
    ev_goalkick: "Goal kick —{team}",
  },
  zh: {
    loadingTeams: "正在加载队伍…",
    bootFailed: "启动失败 — 刷新重试",
    tagline: "六只鸭子，一颗球，零手柄 — 调好己方战术，看着训练好的策略自己踢球。",
    kickOff: "开球",
    resume: "继续",
    pressA: "按 A",
    pressEnter: "按 Enter",
    zoom: "缩放",
    orbit: "环绕",
    resetCamera: "重置镜头",
    coachFooter: "教练模式 — 选战术，鸭子自己踢",
    coachDesk: "教练席",
    yourSide: "己方",
    formation: "阵型",
    style: "风格",
    press: "压迫",
    fineTune: "细调",
    fineTuneHide: "收起细调",
    fineTuneShow: "展开细调",
    hintPlaceholder: "例如：高位逼抢，别乱射，门将别出门",
    hintApply: "应用",
    hintPreview: "将修改",
    hintEmpty: "没有匹配到战术词 — 换个说法试试",
    rivalTactics: "对方战术",
    editingSide: "正在编辑",
    custom: "自定义",
    red: "红队",
    blue: "蓝队",
    attack: "进攻",
    balanced: "均衡",
    defend: "防守",
    low: "低",
    medium: "中",
    high: "高",
    pressWord: "压迫",
    formationLocked: "阵型已锁定",
    teamTactics: "球队战术",
    knob_lineHeight: "站位线",
    knob_press: "逼抢",
    knob_shootGreed: "射门",
    knob_supportWidth: "宽度",
    knob_supportDepth: "前插",
    knob_approach: "接近",
    knob_clearStyle: "解围",
    knob_gkRush: "门将",
    knob_spacing: "间距",
    back: "返回",
    danmakuOn: "弹幕",
    danmakuOff: "弹幕关",
    sinBin: "暂罚",
    openCoach: "打开教练席",
    langEn: "EN",
    langZh: "中",
    boardPoss: "控球",
    boardShots: "射门",
    boardVs: "对",
    pitchSim: "实时球场",
    pitchSimHint: "△ 追球圈 · 尖端=朝向",
    fpvLabel: "第一视角 · 追球手",
    cardTitle: "战术卡",
    cardSub: "全场结束 — 战术战报",
    state_IDLE: "待命",
    state_KICKOFF: "开球",
    state_PLAYING: "进行中",
    state_DEAD_BALL: "死球",
    state_SET_PIECE: "定位球",
    state_GOAL: "进球！",
    state_HALFTIME: "中场",
    state_FULLTIME: "全场结束",
    ev_goal: "进球！{team}得分",
    ev_shot: "射门 —{team}",
    ev_yellow: "黄牌 —{team}",
    ev_red: "红牌 —{team}",
    ev_corner: "角球 —{team}",
    ev_foul: "犯规 —{team}",
    ev_penalty: "点球 —{team}",
    ev_kickoff: "开球！",
    ev_halftime: "半场",
    ev_fulltime: "全场结束",
    ev_extra: "加时！",
    ev_throw: "界外球 —{team}",
    ev_goalkick: "球门球 —{team}",
  },
};

const FORMATION = {
  en: { "2f1gk": "2F · 1GK", "1f1d1gk": "1F · 1D · 1GK" },
  zh: { "2f1gk": "2前·1门", "1f1d1gk": "1前·1卫·1门" },
};

const STORAGE_KEY = "microduck-locale";

export function detectLocale() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (LOCALES.includes(saved)) return saved;
  } catch {
    /* ignore */
  }
  if (typeof navigator !== "undefined" && /^zh\b/i.test(navigator.language || "")) {
    return "zh";
  }
  return "en";
}

export function persistLocale(locale) {
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    /* ignore */
  }
}

export function t(locale, key, vars = {}) {
  const pack = STRINGS[locale] || STRINGS.en;
  let s = pack[key] ?? STRINGS.en[key] ?? key;
  for (const [k, v] of Object.entries(vars)) {
    s = s.replaceAll(`{${k}}`, v);
  }
  return s;
}

export function formationLabel(locale, id) {
  return (FORMATION[locale] || FORMATION.en)[id] || id;
}

export function styleLabel(locale, id) {
  return t(locale, id);
}

export function pressLabel(locale, id) {
  return t(locale, id);
}

export function teamLabel(locale, id) {
  return t(locale, id);
}

/** Short coach tag: style preset or top differing knobs. */
export function strategyTag(locale, strategy) {
  if (!strategy) return "—";
  const d = describeStrategy(strategy, locale);
  if (d.style && d.style !== "custom") {
    return `${styleLabel(locale, d.style)} · ${pressLabel(locale, d.press)}`;
  }
  return d.summary || "—";
}
