// Controls use physical KeyboardEvent.code positions; getLayoutMap() provides
// the characters printed on those keys for the active layout.
const MOVEMENT_CODES = ["KeyW", "KeyA", "KeyS", "KeyD"];
const MOVEMENT_FALLBACK_HINT = "arrows or WASD";

function keycap(value) {
  if (typeof value !== "string") return null;
  const glyph = value.trim();
  if ([...glyph].length !== 1 || /[\p{M}\p{C}\p{Z}]/u.test(glyph)) return null;
  const upper = glyph.toUpperCase();
  return [...upper].length === 1 ? upper : glyph; // "ß" must not become "SS"
}

export function resolveKeycaps(codes, layoutMap) {
  const required = [...new Set([...MOVEMENT_CODES, ...codes])];
  const labels = {};
  let complete = true;
  for (const code of required) {
    let label = null;
    try {
      label = keycap(layoutMap?.get?.(code));
    } catch {
      label = null;
    }
    if (!label) complete = false;
    labels[code] = label;
  }
  if (!complete) {
    for (const code of required) labels[code] = code.replace(/^Key/, "");
    return { labels, moveHint: MOVEMENT_FALLBACK_HINT };
  }
  return {
    labels,
    moveHint: `arrows or ${MOVEMENT_CODES.map((code) => labels[code]).join("")}`,
  };
}

export async function readLayoutMap(nav = globalThis.navigator) {
  try {
    return (await nav?.keyboard?.getLayoutMap?.()) ?? null;
  } catch {
    return null;
  }
}
