// Rule-based match commentary for danmaku. Pure + testable — no React.
// Tone: esports roast with light duck flavor. Locale: en | zh.

import { FIELD_HALF_L, PENALTY_AREA_L } from "../game/football/constants.js";

/** Seconds of silence before idle filler can fire while PLAYING. */
export const IDLE_GAP_S = 22;
/** Min gap between any two commentary spawns (anti-spam). */
export const GLOBAL_COOLDOWN_S = 2.2;
/** Soft "ball in box" lines cooldown. */
export const DANGER_COOLDOWN_S = 28;
/** |x| past this counts as attacking-third pressure (m). */
export const DANGER_X = FIELD_HALF_L - PENALTY_AREA_L; // 1.8

const TEAM = {
  en: { red: "Red", blue: "Blue" },
  zh: { red: "红队", blue: "蓝队" },
};

function teamName(locale, team) {
  const pack = TEAM[locale] || TEAM.en;
  return pack[team] || team || "";
}

function pick(list, rng = Math.random) {
  if (!list?.length) return null;
  const i = Math.floor(rng() * list.length) % list.length;
  return list[i];
}

function fill(template, vars) {
  if (!template) return null;
  let s = template;
  for (const [k, v] of Object.entries(vars)) {
    s = s.replaceAll(`{${k}}`, v);
  }
  return s;
}

// ── Line banks ────────────────────────────────────────────────────────────
// Keys mirror matchEvents.type (+ soft: shot, idle_*, danger, kickoff_start,
// extra_time, fulltime_result). Multiple variants per key; pick() chooses.

export const LINES = {
  en: {
    goal: [
      "GOAL! {team} finally put one in the net!",
      "It's in! {team} ducks go wild!",
      "{team} scores — the silence is over!",
      "What a strike! {team} takes the lead… or pads it.",
    ],
    goal_disallowed: [
      "No goal — VAR energy without the VAR.",
      "Waved off! {team} celebration cut short.",
    ],
    shot: [
      "{team} lets fly — keeper's problem now!",
      "Shot from {team}! Close one!",
      "{team} testing the goalmouth — duck bravery!",
    ],
    corner_red: [
      "Corner to Red — crowded box incoming.",
      "Red corner. Someone please clear this.",
    ],
    corner_blue: [
      "Corner to Blue — set-piece lottery!",
      "Blue corner. Wings out, eyes on the ball.",
    ],
    throw_in: [
      "Throw-in — {team} restarts the chaos.",
      "Out of play. {team} gets the throw.",
    ],
    goal_kick: [
      "Goal kick — {team} resets from the back.",
      "Keeper's ball. Deep breath, {team}.",
    ],
    penalty: [
      "Sin-bin! {team} duck parked for a nap.",
      "Off you go — {team} down a bird.",
    ],
    penalty_reset: [
      "Still in the bin — clock refreshed for {team}.",
    ],
    yellow_card: [
      "Yellow! {team} getting chatty with the ref.",
      "Booking for {team} — careful now.",
    ],
    red_card: [
      "RED CARD! {team} is a duck short.",
      "Sent off! {team} in serious trouble.",
    ],
    kickoff: [
      "Kickoff! Six ducks. One ball. No mercy.",
      "We're live — let the waddle war begin!",
    ],
    extra_time: [
      "Extra time! Golden goal — next score wins.",
      "Into extras. One touch of glory left.",
    ],
    fulltime: [
      "Full time! What a scrap.",
      "Whistle! Ducks collapse in a heap.",
    ],
    idle_stalemate: [
      "Midfield laundry cycle continues…",
      "Still 0 drama per minute. Patience.",
      "Someone please invent a shot.",
      "Possession ping-pong. Classic duckball.",
      "The ball has trust issues with both goals.",
    ],
    idle_tied: [
      "Deadlocked. Tension in the feathers.",
      "Scoreboard frozen — who blinks first?",
    ],
    idle_leading: [
      "{team} protecting the lead like it's treasure.",
      "{team} ahead — can they close this out?",
    ],
    idle_trailing: [
      "{team} hunting an equalizer. Wings out!",
      "Comeback window open for {team}.",
    ],
    danger: [
      "Ball in the box! {team} under the pump!",
      "Danger zone — {team} scrambling!",
      "Scramble at the near post!",
    ],
  },
  zh: {
    goal: [
      "进了！{team}总算踢进一个！",
      "球进了！{team}鸭子炸窝了！",
      "{team}得分 — 沉默结束！",
      "好球！{team}改写比分！",
    ],
    goal_disallowed: [
      "进球无效 — 没有 VAR 也有 VAR 味。",
      "吹掉了！{team}庆祝白跳了。",
    ],
    shot: [
      "{team}起脚打门 — 门将接招！",
      "{team}射门！险些破门！",
      "{team}试射 — 鸭子胆真肥！",
    ],
    corner_red: [
      "红队角球 — 禁区要挤成罐头了。",
      "红队角球。求一个解围。",
    ],
    corner_blue: [
      "蓝队角球 — 定位球开盲盒！",
      "蓝队角球。展翅盯球。",
    ],
    throw_in: [
      "界外球 — {team}重新开闹。",
      "出界了。{team}掷界外。",
    ],
    goal_kick: [
      "球门球 — {team}从后场重启。",
      "门将的球。{team}深呼吸。",
    ],
    penalty: [
      "暂罚！{team}一只鸭去罚站了。",
      "下场歇着 — {team}少一人。",
    ],
    penalty_reset: [
      "还在罚站 — {team}计时重来。",
    ],
    yellow_card: [
      "黄牌！{team}跟裁判侃上了。",
      "{team}吃牌 — 悠着点。",
    ],
    red_card: [
      "红牌！{team}少一只鸭了。",
      "罚下！{team}麻烦大了。",
    ],
    kickoff: [
      "开球！六只鸭，一颗球，不讲武德。",
      "比赛开始 — 摇摆战争开打！",
    ],
    extra_time: [
      "加时！金球制 — 进一个就赢。",
      "进入加时。荣耀只差一脚。",
    ],
    fulltime: [
      "全场完！打得真惨烈。",
      "吹哨了！鸭子摊成一地。",
    ],
    idle_stalemate: [
      "中场还在洗衣服…",
      "每分钟零剧情。再等等。",
      "拜托谁射一下吧。",
      "控球乒乓。经典鸭球。",
      "这球对两个球门都有阴影。",
    ],
    idle_tied: [
      "僵住了。羽毛都紧绷。",
      "比分冻结 — 谁先眨眼？",
    ],
    idle_leading: [
      "{team}护分护得像护宝。",
      "{team}领先 — 能不能收住？",
    ],
    idle_trailing: [
      "{team}在追平。翅膀张开！",
      "{team}逆转窗口开着。",
    ],
    danger: [
      "球进禁区了！{team}顶不住！",
      "危险！{team}在忙乱解围！",
      "近门柱混战！",
    ],
  },
};

/** Map raw matchEvents.type → line bank key. */
export function bankKeyForEvent(type) {
  if (!type) return null;
  if (type === "corner" || type === "corner_red" || type === "corner_blue") {
    return type === "corner" ? "corner_red" : type;
  }
  return type;
}

/**
 * Build one commentary string for a hard/soft match event.
 * @returns {{ text: string, team: ?string, kind: string } | null}
 */
export function lineForEvent(ev, locale = "en", rng = Math.random) {
  if (!ev?.type) return null;
  const key = bankKeyForEvent(ev.type);
  const pack = LINES[locale] || LINES.en;
  const bank = pack[key] || LINES.en[key];
  if (!bank) return null;
  const team = teamName(locale, ev.team);
  const text = fill(pick(bank, rng), { team });
  if (!text) return null;
  return { text, team: ev.team || null, kind: key };
}

/**
 * Idle / soft situational line while PLAYING.
 * @param {object} ctx
 * @param {'en'|'zh'} locale
 * @param {() => number} rng
 * @returns {{ text: string, team: ?string, kind: string } | null}
 */
export function lineForIdle(ctx, locale = "en", rng = Math.random) {
  const pack = LINES[locale] || LINES.en;
  const score = ctx?.score || { red: 0, blue: 0 };
  const red = score.red | 0;
  const blue = score.blue | 0;

  let key = "idle_stalemate";
  let team = null;
  if (red === blue) {
    key = rng() < 0.55 ? "idle_tied" : "idle_stalemate";
  } else if (rng() < 0.5) {
    key = "idle_leading";
    team = red > blue ? "red" : "blue";
  } else {
    key = "idle_trailing";
    team = red > blue ? "blue" : "red";
  }

  const bank = pack[key] || LINES.en[key];
  const text = fill(pick(bank, rng), { team: teamName(locale, team) });
  if (!text) return null;
  return { text, team, kind: key };
}

/**
 * Ball deep in a penalty area → danger line.
 * @returns {{ text: string, team: ?string, kind: string } | null}
 */
export function lineForDanger(ball, locale = "en", rng = Math.random) {
  if (!ball || !Number.isFinite(ball.x)) return null;
  if (Math.abs(ball.x) < DANGER_X) return null;
  // Defending team is the one whose goal is threatened.
  const defending = ball.x > 0 ? "blue" : "red";
  const pack = LINES[locale] || LINES.en;
  const text = fill(pick(pack.danger || LINES.en.danger, rng), {
    team: teamName(locale, defending),
  });
  if (!text) return null;
  return { text, team: defending, kind: "danger" };
}

/**
 * Decide whether idle filler is allowed given silence clocks.
 * @param {{ matchState: string, sinceLastLineS: number }} ctx
 */
export function canIdle(ctx) {
  if (ctx?.matchState !== "PLAYING") return false;
  return (ctx.sinceLastLineS ?? 0) >= IDLE_GAP_S;
}

/**
 * Global anti-spam gate.
 */
export function canSpeak(sinceLastLineS) {
  return (sinceLastLineS ?? Infinity) >= GLOBAL_COOLDOWN_S;
}
