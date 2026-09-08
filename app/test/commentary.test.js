// Unit tests for rule-based commentary (danmaku lines).
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  bankKeyForEvent,
  canIdle,
  canSpeak,
  DANGER_X,
  IDLE_GAP_S,
  lineForDanger,
  lineForEvent,
  lineForIdle,
  LINES,
} from "../src/football/commentary.js";

const rng0 = () => 0; // always first variant

describe("football/commentary: banks", () => {
  it("has matching en/zh keys", () => {
    const enKeys = Object.keys(LINES.en).sort();
    const zhKeys = Object.keys(LINES.zh).sort();
    assert.deepEqual(zhKeys, enKeys);
    for (const k of enKeys) {
      assert.ok(LINES.en[k].length >= 1, `en.${k}`);
      assert.ok(LINES.zh[k].length >= 1, `zh.${k}`);
    }
  });

  it("maps corner aliases", () => {
    assert.equal(bankKeyForEvent("corner_red"), "corner_red");
    assert.equal(bankKeyForEvent("corner_blue"), "corner_blue");
    assert.equal(bankKeyForEvent("corner"), "corner_red");
    assert.equal(bankKeyForEvent("shot"), "shot");
  });
});

describe("football/commentary: lineForEvent", () => {
  it("fills team tokens in EN and ZH", () => {
    const en = lineForEvent({ type: "goal", team: "red" }, "en", rng0);
    assert.ok(en.text.includes("Red") || en.text.includes("GOAL"));
    assert.equal(en.team, "red");
    assert.equal(en.kind, "goal");

    const zh = lineForEvent({ type: "shot", team: "blue" }, "zh", rng0);
    assert.ok(zh.text.includes("蓝队"));
    assert.equal(zh.kind, "shot");
  });

  it("returns null for unknown types", () => {
    assert.equal(lineForEvent({ type: "teleport" }, "en", rng0), null);
    assert.equal(lineForEvent(null, "en", rng0), null);
  });

  it("handles kickoff without a team", () => {
    const line = lineForEvent({ type: "kickoff" }, "en", rng0);
    assert.ok(line.text.length > 4);
    assert.equal(line.team, null);
  });
});

describe("football/commentary: idle + danger", () => {
  it("gates idle on PLAYING + silence", () => {
    assert.equal(canIdle({ matchState: "PLAYING", sinceLastLineS: IDLE_GAP_S }), true);
    assert.equal(canIdle({ matchState: "PLAYING", sinceLastLineS: 1 }), false);
    assert.equal(canIdle({ matchState: "GOAL", sinceLastLineS: 99 }), false);
  });

  it("gates global cooldown", () => {
    assert.equal(canSpeak(0), false);
    assert.equal(canSpeak(3), true);
  });

  it("picks trailing/leading when score uneven", () => {
    const line = lineForIdle({ score: { red: 2, blue: 0 } }, "en", rng0);
    assert.ok(line.kind === "idle_leading" || line.kind === "idle_trailing");
    assert.ok(line.text.length > 4);
  });

  it("emits danger only deep in the box", () => {
    assert.equal(lineForDanger({ x: 0 }, "en", rng0), null);
    assert.equal(lineForDanger({ x: DANGER_X - 0.01 }, "en", rng0), null);
    const d = lineForDanger({ x: DANGER_X + 0.05 }, "en", rng0);
    assert.equal(d.kind, "danger");
    assert.equal(d.team, "blue"); // +x threatens blue goal
    const r = lineForDanger({ x: -(DANGER_X + 0.05) }, "zh", rng0);
    assert.equal(r.team, "red");
    assert.ok(r.text.includes("红") || r.text.length > 2);
  });
});
