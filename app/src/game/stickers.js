// Comic sticker popups: on notable game events (kick, quack, roll, ball
// spawn, ghost peer joining) a die-cut sticker or a comic onomatopoeia pops
// at a semi-random spot on screen, overshoots in, then fades out. Pure
// CSS animations, no dependencies.
//
// Fully self-contained and OPTIONAL: this module owns its DOM layer and its
// <style> tag, and imports nothing from the rest of the game. rl.js keeps a
// nullable `stickers` slot and calls `stickers?.pop("kick")` at each event
// site, so deleting the single import line in rl.js removes the feature
// without breaking anything.
//
// Image assets are the pre-cut Pollen showcase stickers (assets/stickers/,
// webp with transparency). Their URLs go through the injected `signed()`
// helper so they load on the private HF Space (?__sign JWT) as well as
// locally, where signed() is a no-op.
//
//   const stickers = initStickers({ signed, isLocked });
//   stickers.pop("quack");   // one of: kick, quack, roll, spawn, hi
//   stickers.dispose();      // remove layer + styles (tests/teardown)

// Bump when the webp files change; python http.server sends no
// Cache-Control, same convention as the mesh/module ?v= busters.
const ASSET_V = "1";
const DIR = "./assets/stickers";

// Comic palette sampled from the sticker sheet itself.
const C = {
  red: "#ff3b30",
  teal: "#1fb6a8",
  yellow: "#ffd23f",
  blue: "#2f8bff",
  pink: "#ff2d78",
};

// Per-event pools: each pop picks one variant at random. `img` is a die-cut
// webp sticker (w = on-screen width in px before jitter), `text` a pure
// CSS onomatopoeia; both together = text overlaid on the image (POP! burst).
// `cool` is the per-event rate limit in ms - repeated quacks/kicks reuse
// the sticker on screen instead of stacking a new one per press.
const EVENTS = {
  kick: {
    cool: 900,
    pool: [
      { img: "bang-red", w: 170 },
      { img: "boom", w: 175 },
      { img: "star-yellow", w: 120 },
      { text: "BAM!", color: C.red },
    ],
  },
  quack: {
    cool: 700,
    pool: [
      { img: "quack", w: 180 },
      { img: "quack-quack", w: 170 },
      { text: "QUACK!", color: C.teal },
    ],
  },
  roll: {
    cool: 1600,
    pool: [
      { text: "WHEE!", color: C.pink },
      { img: "ziouuu", w: 200 },
      { img: "shooting-star", w: 150 },
    ],
  },
  spawn: {
    cool: 900,
    pool: [
      { img: "burst-yellow", w: 140, text: "POP!", color: C.pink },
      { text: "POP!", color: C.yellow },
    ],
  },
  hi: {
    cool: 2500,
    pool: [
      { text: "HI!", color: C.blue },
      { img: "wave", w: 150 },
    ],
  },
};

const MAX_LIVE = 4; // concurrent stickers, all events combined
const LIFE_MS = 1250; // matches the CSS animation duration below

// Safe zone (viewport %): keeps stickers off the HUD corners - mode label
// top-left, REC/stats top-right (+ colour stack below it), hint keycaps
// along the bottom. The middle band is all playground.
const ZONE = { x0: 16, x1: 78, y0: 20, y1: 68 };

const CSS = `
#sticker-layer {
  position: fixed;
  inset: 0;
  z-index: 9; /* above the CRT overlay (5), below the HUD (10) */
  pointer-events: none;
  overflow: hidden;
}
#sticker-layer .sticker {
  position: absolute;
  will-change: transform, opacity;
  animation: sticker-pop ${LIFE_MS}ms cubic-bezier(0.22, 1, 0.36, 1) forwards;
}
#sticker-layer .sticker img {
  display: block;
  filter: drop-shadow(0 4px 10px rgba(0, 0, 0, 0.35));
}
#sticker-layer .sticker-text {
  font-family: "Arial Black", "Avenir-Black", "Helvetica Neue", sans-serif;
  font-weight: 900;
  font-style: italic;
  font-size: clamp(2.4rem, 5.5vw, 4.2rem);
  letter-spacing: 0.02em;
  white-space: nowrap;
  -webkit-text-stroke: 0.24em #fff;
  paint-order: stroke fill;
  text-shadow: 0.07em 0.1em 0 rgba(20, 10, 40, 0.85);
  filter: drop-shadow(0 4px 10px rgba(0, 0, 0, 0.35));
}
/* Text overlaid on a die-cut sticker (e.g. POP! on the blank burst). */
#sticker-layer .sticker-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: clamp(1.6rem, 3.2vw, 2.4rem);
  transform: rotate(-8deg);
}
/* Pop-in with scale overshoot + a small rotation settle, short hold, then
   shrink/fade. --rot / --s carry the per-pop random jitter. */
@keyframes sticker-pop {
  0%   { transform: translate(-50%, -50%) rotate(calc(var(--rot) - 12deg)) scale(0); opacity: 0; }
  14%  { transform: translate(-50%, -50%) rotate(calc(var(--rot) + 3deg)) scale(calc(var(--s) * 1.22)); opacity: 1; }
  26%  { transform: translate(-50%, -50%) rotate(var(--rot)) scale(calc(var(--s) * 0.96)); }
  36%  { transform: translate(-50%, -50%) rotate(var(--rot)) scale(var(--s)); }
  78%  { transform: translate(-50%, -50%) rotate(var(--rot)) scale(var(--s)); opacity: 1; }
  100% { transform: translate(-50%, -50%) rotate(var(--rot)) scale(calc(var(--s) * 0.5)); opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  #sticker-layer .sticker { animation-duration: 1ms; }
}
`;

const rand = (a, b) => a + Math.random() * (b - a);

export function initStickers({ signed = (u) => u, isLocked = () => false } = {}) {
  const url = (name) => signed(`${DIR}/${name}.webp?v=${ASSET_V}`);

  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);

  const layer = document.createElement("div");
  layer.id = "sticker-layer";
  layer.setAttribute("aria-hidden", "true");
  document.body.appendChild(layer);

  // Warm the image cache so the first pop of each sticker isn't a blank
  // frame while the webp downloads.
  for (const { pool } of Object.values(EVENTS))
    for (const v of pool) if (v.img) new Image().src = url(v.img);

  const lastAt = new Map(); // event -> last pop timestamp
  // Avoid showing the same variant twice in a row per event.
  const lastPick = new Map();

  const pop = (event) => {
    const cfg = EVENTS[event];
    if (!cfg) return;
    if (isLocked()) return; // no stickers during the entrance/reset ceremony
    const now = performance.now();
    if (now - (lastAt.get(event) ?? -Infinity) < cfg.cool) return;
    if (layer.childElementCount >= MAX_LIVE) return;
    lastAt.set(event, now);

    let i = (Math.random() * cfg.pool.length) | 0;
    if (cfg.pool.length > 1 && i === lastPick.get(event)) i = (i + 1) % cfg.pool.length;
    lastPick.set(event, i);
    const v = cfg.pool[i];

    const el = document.createElement("div");
    el.className = "sticker";
    el.style.left = `${rand(ZONE.x0, ZONE.x1)}%`;
    el.style.top = `${rand(ZONE.y0, ZONE.y1)}%`;
    el.style.setProperty("--rot", `${rand(-14, 14)}deg`);
    el.style.setProperty("--s", rand(0.88, 1.12).toFixed(2));

    if (v.img) {
      const img = document.createElement("img");
      img.src = url(v.img);
      img.width = v.w;
      img.alt = "";
      el.appendChild(img);
      if (v.text) {
        const t = document.createElement("span");
        t.className = "sticker-text sticker-overlay";
        t.style.color = v.color;
        t.textContent = v.text;
        el.appendChild(t);
      }
    } else {
      const t = document.createElement("span");
      t.className = "sticker-text";
      t.style.color = v.color;
      t.textContent = v.text;
      el.appendChild(t);
    }

    el.addEventListener("animationend", () => el.remove(), { once: true });
    // Fallback sweep in case the animation never fires (hidden tab).
    setTimeout(() => el.remove(), LIFE_MS + 500);
    layer.appendChild(el);
  };

  return {
    pop,
    dispose() {
      layer.remove();
      style.remove();
    },
  };
}
