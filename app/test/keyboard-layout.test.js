import test from "node:test";
import assert from "node:assert/strict";

import { readLayoutMap, resolveKeycaps } from "../src/ui/keyboard-layout.js";

const AZERTY = new Map(
  Object.entries({ KeyW: "z", KeyA: "q", KeyS: "s", KeyD: "d", KeyQ: "a", KeyE: "e" }),
);
const QWERTY = new Map(
  Object.entries({ KeyW: "w", KeyA: "a", KeyS: "s", KeyD: "d", KeyQ: "q", KeyE: "e" }),
);
const DVORAK = new Map(
  Object.entries({ KeyW: ",", KeyA: "a", KeyS: "o", KeyD: "e", KeyQ: "'", KeyE: "." }),
);

const CODES = ["KeyQ", "KeyE"];

test("resolves caps and the movement hint from the active layout", () => {
  assert.deepEqual(resolveKeycaps(CODES, QWERTY), {
    labels: { KeyW: "W", KeyA: "A", KeyS: "S", KeyD: "D", KeyQ: "Q", KeyE: "E" },
    moveHint: "arrows or WASD",
  });
  const azerty = resolveKeycaps(CODES, AZERTY);
  assert.deepEqual(azerty.labels, {
    KeyW: "Z", KeyA: "Q", KeyS: "S", KeyD: "D", KeyQ: "A", KeyE: "E",
  });
  assert.equal(azerty.moveHint, "arrows or ZQSD");

  const dvorak = resolveKeycaps(CODES, DVORAK);
  assert.equal(dvorak.labels.KeyQ, "'");
  assert.equal(dvorak.moveHint, "arrows or ,AOE");
});

test("falls back to QWERTY labels without a map", () => {
  assert.deepEqual(resolveKeycaps(CODES, null), {
    labels: { KeyW: "W", KeyA: "A", KeyS: "S", KeyD: "D", KeyQ: "Q", KeyE: "E" },
    moveHint: "arrows or WASD",
  });
  assert.equal(resolveKeycaps(["KeyX"], null).labels.KeyX, "X");
});

const ALL_QWERTY = {
  labels: { KeyW: "W", KeyA: "A", KeyS: "S", KeyD: "D", KeyQ: "Q", KeyE: "E" },
  moveHint: "arrows or WASD",
};

test("falls back entirely to QWERTY when the map misses a movement key", () => {
  const partial = new Map([["KeyW", "z"], ["KeyA", "q"], ["KeyS", "s"]]);
  assert.deepEqual(resolveKeycaps(CODES, partial), ALL_QWERTY);
});

test("falls back entirely to QWERTY when the map misses a requested key", () => {
  const partial = new Map([...AZERTY].filter(([code]) => code !== "KeyE"));
  assert.deepEqual(resolveKeycaps(CODES, partial), ALL_QWERTY);
});

test("rejects layout values that cannot sit on a keycap", () => {
  const junk = new Map(
    Object.entries({ KeyQ: "", KeyE: "  ", KeyW: "Dead", KeyA: "́", KeyS: 7 }),
  );
  assert.deepEqual(resolveKeycaps(CODES, junk), ALL_QWERTY);
});

test("a throwing map cannot break the menu", () => {
  const hostile = { get: () => { throw new Error("nope"); } };
  assert.deepEqual(resolveKeycaps(CODES, hostile), ALL_QWERTY);
});

test("readLayoutMap yields null when the API is absent or refuses", async () => {
  assert.equal(await readLayoutMap({}), null);
  assert.equal(await readLayoutMap({ keyboard: {} }), null);
  const rejects = { keyboard: { getLayoutMap: () => Promise.reject(new Error("blocked")) } };
  assert.equal(await readLayoutMap(rejects), null);
  const throws = { keyboard: { getLayoutMap: () => { throw new Error("framed"); } } };
  assert.equal(await readLayoutMap(throws), null);
});

test("readLayoutMap returns the map where the API is supported", async () => {
  const nav = { keyboard: { getLayoutMap: async () => AZERTY } };
  assert.equal(await readLayoutMap(nav), AZERTY);
});
