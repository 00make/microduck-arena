// Game audio: one shared AudioContext behind a master gain, three buses
// (ambient / sfx / voice). Plain functions and maps, no classes, matching
// the imperative game core. The voice bus carries the existing quack and
// wheee (the stars of the mix); sfx carries footsteps / ball thumps / UI
// clicks / the entrance sweep; ambient carries the arcade-room hum bed.
//
// Samples (CC0, Kenney.nl): footsteps and ball thumps from "Impact Sounds",
// UI clicks from "Interface Sounds" - trimmed to mono 22.05 kHz wav in
// public/assets/sfx/. The CRT entrance sweep, the ambient hum and the
// roller rumble are synthesized (oscillators + filtered noise): zero
// payload and a better fit for the retro DA.
//
// Spatialization is plain Web Audio: the context listener follows the
// camera every frame and cheap equalpower PannerNodes act as emitters on
// the duck and the ball (footsteps, thumps and the roller rumble pan and
// attenuate with the chase cam). Voice and UI stay non-spatial.
import { signed } from "./signed.js";

// ── Master kill switch ────────────────────────────────────────────────
// Kill switch: flip to true to silence the whole mix (every public entry
// point early-returns, master gain pinned to 0, context never resumed).
// Node-returning helpers (busNode, createEmitter) keep building their
// graph either way so callers stay untouched.
const SOUND_DISABLED = true;

// ── Context, master, buses ────────────────────────────────────────────
const MASTER_LEVEL = 0.9;
const BUS_LEVELS = { ambient: 1, sfx: 0.9, voice: 1 };
const MUTE_KEY = "microduck-muted";
let ctx = null;
let master = null;
const buses = {}; // name -> GainNode
let muted = false;
try { muted = localStorage.getItem(MUTE_KEY) === "1"; } catch { /* private mode */ }

function unlockOnce() {
  if (ctx?.state === "suspended") ctx.resume().catch(() => {});
}

export function audioCtx() {
  if (ctx) return ctx;
  ctx = new (window.AudioContext ?? window.webkitAudioContext)();
  master = ctx.createGain();
  master.gain.value = SOUND_DISABLED || muted ? 0 : MASTER_LEVEL;
  master.connect(ctx.destination);
  for (const [name, level] of Object.entries(BUS_LEVELS)) {
    const g = ctx.createGain();
    g.gain.value = level;
    g.connect(master);
    buses[name] = g;
  }
  // Autoplay policy: resume on the first user gesture (the Waddle-in
  // click normally lands here; keyboard covers the ?boot=1 test path).
  // While sound is disabled the context is never resumed, so the
  // suspended-state guards below keep every one-shot silent too.
  if (!SOUND_DISABLED) {
    window.addEventListener("pointerdown", unlockOnce, { passive: true });
    window.addEventListener("keydown", unlockOnce);
  }
  return ctx;
}

export function busNode(name) {
  audioCtx();
  return buses[name];
}

// ── Master mute (HUD toggle, persisted) ───────────────────────────────
// Ramped over ~50 ms instead of a hard cut; the sources keep running so
// unmuting picks the mix back up exactly where it was.
export const isMuted = () => muted;

export function setMuted(next) {
  if (SOUND_DISABLED) return;
  muted = !!next;
  try { localStorage.setItem(MUTE_KEY, muted ? "1" : "0"); } catch { /* private mode */ }
  if (!ctx) return;
  master.gain.setTargetAtTime(muted ? 0 : MASTER_LEVEL, ctx.currentTime, 0.017);
}

// ── Sample bank (decode-once cache, random takes per name) ────────────
const SFX_TAKES = { step: 5, thump: 3, click: 2 };
const bufCache = new Map(); // url -> Promise<AudioBuffer>

function bufferFor(url) {
  let p = bufCache.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => r.arrayBuffer())
      .then((ab) => audioCtx().decodeAudioData(ab));
    bufCache.set(url, p);
  }
  return p;
}

const takeUrl = (name, i) => signed(`./assets/sfx/${name}_${"abcde"[i]}.wav`);

export function preloadSfx() {
  if (SOUND_DISABLED) return;
  for (const [name, n] of Object.entries(SFX_TAKES)) {
    for (let i = 0; i < n; i++) bufferFor(takeUrl(name, i)).catch(() => {});
  }
}

// Fire-and-forget one-shot. `out` routes to an emitter panner (spatial);
// otherwise the sound lands on the flat sfx bus.
export function playSfx(name, { gain = 1, rate = 1, out = null } = {}) {
  if (SOUND_DISABLED) return;
  const c = audioCtx();
  if (c.state === "suspended") return; // pre-gesture: stay silent, don't queue
  const take = (Math.random() * SFX_TAKES[name]) | 0;
  bufferFor(takeUrl(name, take)).then((buf) => {
    const src = c.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = c.createGain();
    g.gain.value = gain;
    src.connect(g);
    g.connect(out ?? buses.sfx);
    src.onended = () => g.disconnect();
    src.start();
  }).catch(() => {});
}

// Decoded playback for arbitrary URLs (the colourway voice banks): same
// cache, routed to a bus - replaces the old HTMLAudio chirp path so the
// quack sits behind the master gain like everything else.
export function playUrl(url, { bus = "voice", gain = 1, rate = 1 } = {}) {
  if (SOUND_DISABLED) return;
  const c = audioCtx();
  if (c.state === "suspended") return;
  bufferFor(url).then((buf) => {
    const src = c.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = c.createGain();
    g.gain.value = gain;
    src.connect(g);
    g.connect(buses[bus]);
    src.onended = () => g.disconnect();
    src.start();
  }).catch(() => {});
}

export function uiClick() {
  playSfx("click", { gain: 0.16, rate: 0.95 + Math.random() * 0.1 });
}

// ── Spatial listener + emitters ───────────────────────────────────────
// Listener follows the three.js camera (three world coords). Emitters are
// equalpower panners: cheap, and plenty for "the duck is over there".
const _fwd = { x: 0, y: 0, z: -1 };

export function updateListener(camera) {
  if (!ctx || ctx.state === "suspended") return;
  const l = ctx.listener;
  const e = camera.matrixWorld.elements;
  // Camera forward = -Z column of the world matrix, up = +Y column.
  _fwd.x = -e[8]; _fwd.y = -e[9]; _fwd.z = -e[10];
  const t = ctx.currentTime;
  if (l.positionX) {
    l.positionX.setTargetAtTime(e[12], t, 0.02);
    l.positionY.setTargetAtTime(e[13], t, 0.02);
    l.positionZ.setTargetAtTime(e[14], t, 0.02);
    l.forwardX.setTargetAtTime(_fwd.x, t, 0.02);
    l.forwardY.setTargetAtTime(_fwd.y, t, 0.02);
    l.forwardZ.setTargetAtTime(_fwd.z, t, 0.02);
    l.upX.setTargetAtTime(e[4], t, 0.02);
    l.upY.setTargetAtTime(e[5], t, 0.02);
    l.upZ.setTargetAtTime(e[6], t, 0.02);
  } else {
    l.setPosition(e[12], e[13], e[14]);
    l.setOrientation(_fwd.x, _fwd.y, _fwd.z, e[4], e[5], e[6]);
  }
}

export function createEmitter({ refDistance = 0.6 } = {}) {
  const c = audioCtx();
  const panner = c.createPanner();
  panner.panningModel = "equalpower";
  panner.distanceModel = "inverse";
  panner.refDistance = refDistance;
  panner.rolloffFactor = 1.1;
  panner.connect(buses.sfx);
  return {
    node: panner,
    setPosition(x, y, z) {
      if (panner.positionX) {
        const t = c.currentTime;
        panner.positionX.setTargetAtTime(x, t, 0.03);
        panner.positionY.setTargetAtTime(y, t, 0.03);
        panner.positionZ.setTargetAtTime(z, t, 0.03);
      } else {
        panner.setPosition(x, y, z);
      }
    },
  };
}

// ── Ambient bed (synthesized arcade-room hum) ─────────────────────────
// Mains hum (60 Hz + weak 120 Hz octave) plus a slow-breathing bed of
// lowpassed noise. Sits VERY low in the mix. The whole bed runs through a
// duck filter + duck gain automated when the pause/title overlay opens.
const AMBIENT_LEVEL = 0.05;
const AMBIENT_DUCKED = 0.018;
let ambient = null; // { duckGain, duckFilter }

export function startAmbient() {
  if (SOUND_DISABLED || ambient) return;
  const c = audioCtx();
  const duckFilter = c.createBiquadFilter();
  duckFilter.type = "lowpass";
  duckFilter.frequency.value = 18000;
  const duckGain = c.createGain();
  duckGain.gain.value = 0; // fade in below
  duckFilter.connect(duckGain);
  duckGain.connect(buses.ambient);

  const hum = c.createOscillator();
  hum.type = "sine";
  hum.frequency.value = 60;
  const humG = c.createGain();
  humG.gain.value = 0.5;
  hum.connect(humG);
  humG.connect(duckFilter);

  const hum2 = c.createOscillator();
  hum2.type = "triangle";
  hum2.frequency.value = 120;
  const hum2G = c.createGain();
  hum2G.gain.value = 0.14;
  hum2.connect(hum2G);
  hum2G.connect(duckFilter);

  const noise = c.createBufferSource();
  noise.buffer = noiseBuffer(c, 2.0);
  noise.loop = true;
  const noiseF = c.createBiquadFilter();
  noiseF.type = "lowpass";
  noiseF.frequency.value = 260;
  const noiseG = c.createGain();
  noiseG.gain.value = 0.5;
  noise.connect(noiseF);
  noiseF.connect(noiseG);
  noiseG.connect(duckFilter);

  // Slow breathing on the noise bed (~0.08 Hz) so the room feels alive.
  const lfo = c.createOscillator();
  lfo.frequency.value = 0.08;
  const lfoG = c.createGain();
  lfoG.gain.value = 0.15;
  lfo.connect(lfoG);
  lfoG.connect(noiseG.gain);

  hum.start();
  hum2.start();
  noise.start();
  lfo.start();
  duckGain.gain.setTargetAtTime(AMBIENT_LEVEL, c.currentTime, 1.2);
  ambient = { duckGain, duckFilter };
}

export function setAmbientDucked(ducked) {
  if (!ambient) return;
  const t = ctx.currentTime;
  ambient.duckGain.gain.setTargetAtTime(ducked ? AMBIENT_DUCKED : AMBIENT_LEVEL, t, 0.25);
  ambient.duckFilter.frequency.setTargetAtTime(ducked ? 300 : 18000, t, 0.25);
}

function noiseBuffer(c, seconds) {
  const n = (c.sampleRate * seconds) | 0;
  const buf = c.createBuffer(1, n, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

// ── Materialize sweeps (phase-locked to the wireframe FX) ─────────────
// fx-wireframe.js runs two overlapping passes over totalS seconds (duck:
// 0.9 s): a wireframe scan line over the first 2/3 and a trailing
// solidify line over the last 2/3, BOTH driven by the same ease-out
// (1 - (1-x)^2): the line launches at full speed and decelerates into
// the top. The pitch of each layer follows that exact curve (sampled
// into setValueCurveAtTime), so the sweep rushes then settles exactly
// like the line the player watches - not a straight climb through it.
//
//   scan   [0 .. 2/3 T]  square, 150 -> 1500 Hz along the fx ease
//   solid  [1/3 T .. T]  triangle an octave down, same curve, trailing
//   T                    resolve: sine drop thunk + soft high ping
//
// Props reuse the same voice via playPropSweep: their fx stretches the
// timeline by sqrt(size) (see fx-wireframe REF_SPAN), so the duration
// itself encodes the target's size - the sweep divides its pitch by
// that stretch, and big objects (arcade cabinet) materialize DEEPER
// and longer while small ones chirp through quickly.
const FX_EASE = (x) => 1 - (1 - x) * (1 - x); // fx-wireframe's ease()
const FX_BASE_S = 0.9; // fx TOTAL_S before size stretch

function easedPitchCurve(f0, f1, n = 48) {
  const arr = new Float32Array(n);
  for (let i = 0; i < n; i++) arr[i] = f0 * (f1 / f0) ** FX_EASE(i / (n - 1));
  return arr;
}

// One materialize voice. level scales every layer; pitchK divides the
// whole sweep's register (bigger target = lower); shimmer + ping are the
// duck's hero garnish, props skip them.
function materializeSweep(c, { totalS, level = 1, pitchK = 1, hero = true }) {
  const T = Math.max(0.3, totalS);
  const t0 = c.currentTime + 0.01;
  const scanEnd = t0 + T * (2 / 3);
  const solidStart = t0 + T * (1 / 3);
  const tEnd = t0 + T;
  const k = 1 / pitchK;

  const out = c.createGain();
  out.gain.value = level;
  const tone = c.createBiquadFilter();
  tone.type = "lowpass";
  tone.frequency.value = 5200; // tame the squares' buzz, keep the bite
  tone.connect(out);
  out.connect(buses.sfx);

  // Static tick right as the scan cues.
  const tick = c.createBufferSource();
  tick.buffer = noiseBuffer(c, 0.06);
  const tickF = c.createBiquadFilter();
  tickF.type = "highpass";
  tickF.frequency.value = 2500;
  const tickG = c.createGain();
  tickG.gain.setValueAtTime(0.1, t0);
  tickG.gain.exponentialRampToValueAtTime(0.001, t0 + 0.06);
  tick.connect(tickF);
  tickF.connect(tickG);
  tickG.connect(out);
  tick.start(t0);

  // Scan pass: rising square riding the scan line's exact ease-out.
  const scan = c.createOscillator();
  scan.type = "square";
  scan.frequency.setValueCurveAtTime(
    easedPitchCurve(150 * k, 1500 * k), t0, T * (2 / 3),
  );
  const scanG = c.createGain();
  scanG.gain.setValueAtTime(0, t0);
  scanG.gain.linearRampToValueAtTime(0.14, t0 + 0.03);
  scanG.gain.setValueAtTime(0.14, scanEnd - 0.05);
  scanG.gain.exponentialRampToValueAtTime(0.001, scanEnd + 0.08);
  scan.connect(scanG);
  scanG.connect(tone);
  scan.start(t0);
  scan.stop(scanEnd + 0.1);

  // Solidify pass: same eased climb an octave down, trailing like the
  // second line, swelling as the target fills in solid.
  const solid = c.createOscillator();
  solid.type = "triangle";
  solid.frequency.setValueCurveAtTime(
    easedPitchCurve(85 * k, 760 * k), solidStart, T * (2 / 3),
  );
  const solidG = c.createGain();
  solidG.gain.setValueAtTime(0, solidStart);
  solidG.gain.linearRampToValueAtTime(0.08, solidStart + 0.06);
  solidG.gain.linearRampToValueAtTime(0.16, tEnd - 0.05);
  solidG.gain.exponentialRampToValueAtTime(0.001, tEnd + 0.06);
  solid.connect(solidG);
  solidG.connect(tone);
  solid.start(solidStart);
  solid.stop(tEnd + 0.1);

  if (hero) {
    // Hologram shimmer: airy bandpassed noise, centre frequency easing
    // up with the reveal like everything else.
    const shimmer = c.createBufferSource();
    shimmer.buffer = noiseBuffer(c, T);
    const shimF = c.createBiquadFilter();
    shimF.type = "bandpass";
    shimF.frequency.setValueCurveAtTime(
      easedPitchCurve(1800 * k, 5200 * k), t0, T,
    );
    shimF.Q.value = 1.2;
    const shimG = c.createGain();
    shimG.gain.setValueAtTime(0, t0);
    shimG.gain.linearRampToValueAtTime(0.05, t0 + 0.1);
    shimG.gain.setValueAtTime(0.05, tEnd - 0.15);
    shimG.gain.linearRampToValueAtTime(0, tEnd);
    shimmer.connect(shimF);
    shimF.connect(shimG);
    shimG.connect(out);
    shimmer.start(t0);
  }

  // Resolve: pitch-drop thunk right when the solidify line clears the
  // top and the real materials land. Deeper for bigger targets.
  const thunk = c.createOscillator();
  thunk.type = "sine";
  thunk.frequency.setValueAtTime(170 * k, tEnd);
  thunk.frequency.exponentialRampToValueAtTime(62 * k, tEnd + 0.13);
  const thunkG = c.createGain();
  thunkG.gain.setValueAtTime(hero ? 0.3 : 0.22, tEnd);
  thunkG.gain.exponentialRampToValueAtTime(0.001, tEnd + 0.22);
  thunk.connect(thunkG);
  thunkG.connect(out);
  thunk.start(tEnd);
  thunk.stop(tEnd + 0.25);

  if (hero) {
    const ping = c.createOscillator();
    ping.type = "sine";
    ping.frequency.value = 1320;
    const pingG = c.createGain();
    pingG.gain.setValueAtTime(0.07, tEnd);
    pingG.gain.exponentialRampToValueAtTime(0.001, tEnd + 0.3);
    ping.connect(pingG);
    pingG.connect(out);
    ping.start(tEnd);
    ping.stop(tEnd + 0.32);
    ping.onended = () => out.disconnect();
  } else {
    thunk.onended = () => out.disconnect();
  }
}

// The duck's hero sweep (entrance and every respawn scan-up).
export function playEntranceSweep(totalS = 0.9) {
  if (SOUND_DISABLED) return;
  const c = audioCtx();
  if (c.state === "suspended") return;
  materializeSweep(c, { totalS, level: 1, pitchK: 1, hero: true });
}

// One prop materializing (arcade cabinet, boombox...). The fx stretches
// its timeline by sqrt(size), so recover that stretch from the duration
// and drop the register by it: a 2.2 s cabinet sweeps ~2.5x deeper than
// the duck, a duck-sized prop sounds like a quieter duck. A tiny random
// detune keeps staggered props from phasing into one thick chord.
export function playPropSweep(totalS = 0.9) {
  if (SOUND_DISABLED) return;
  const c = audioCtx();
  if (c.state === "suspended") return;
  const durK = Math.max(1, totalS / FX_BASE_S);
  const detune = 2 ** ((Math.random() - 0.5) * 0.16);
  materializeSweep(c, {
    totalS,
    level: 0.4,
    pitchK: durK * detune,
    hero: false,
  });
}

// ── BIOS / menu one-shots (synthesized, retro POST language) ──────────
// All guarded on a suspended context: the BIOS replay only starts after
// the enter click (the unlock gesture), but a gamepad-only entry can
// leave the context locked - then these simply stay silent.

// Single POST beep, the classic "one beep = all good".
export function playBiosBeep() {
  if (SOUND_DISABLED) return;
  const c = audioCtx();
  if (c.state === "suspended") return;
  const t0 = c.currentTime + 0.01;
  const osc = c.createOscillator();
  osc.type = "square";
  osc.frequency.value = 940;
  const g = c.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(0.08, t0 + 0.008);
  g.gain.setValueAtTime(0.08, t0 + 0.1);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.16);
  osc.connect(g);
  g.connect(buses.sfx);
  osc.start(t0);
  osc.stop(t0 + 0.18);
  osc.onended = () => g.disconnect();
}

// Teletype tick, one per printed POST line. Whisper-level.
export function playBiosTick() {
  if (SOUND_DISABLED) return;
  const c = audioCtx();
  if (c.state === "suspended") return;
  const t0 = c.currentTime;
  const osc = c.createOscillator();
  osc.type = "square";
  osc.frequency.value = 1750 + Math.random() * 350;
  const g = c.createGain();
  g.gain.setValueAtTime(0.02, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.018);
  osc.connect(g);
  g.connect(buses.sfx);
  osc.start(t0);
  osc.stop(t0 + 0.02);
  osc.onended = () => g.disconnect();
}

// Menu-confirm bloop (Waddle in / Resume / pad A): two rising square
// notes, C5 -> G5. This rides the very gesture that unlocks the context,
// so a suspended context gets one resume-then-play attempt.
export function playConfirmBloop() {
  if (SOUND_DISABLED) return;
  const c = audioCtx();
  if (c.state === "suspended") {
    c.resume().then(() => confirmNow(c)).catch(() => {});
    return;
  }
  confirmNow(c);
}

function confirmNow(c) {
  const t0 = c.currentTime + 0.01;
  const tone = c.createBiquadFilter();
  tone.type = "lowpass";
  tone.frequency.value = 4200;
  tone.connect(buses.sfx);
  const osc = c.createOscillator();
  osc.type = "square";
  osc.frequency.setValueAtTime(523, t0);
  osc.frequency.setValueAtTime(784, t0 + 0.07);
  const g = c.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(0.13, t0 + 0.01);
  g.gain.setValueAtTime(0.13, t0 + 0.12);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.2);
  osc.connect(g);
  g.connect(tone);
  osc.start(t0);
  osc.stop(t0 + 0.22);
  osc.onended = () => tone.disconnect();
}

// ── Entrance line blips ───────────────────────────────────────────────
// One tiny tick per grid/wall section line as it starts drawing in. `u`
// is the line's own draw jitter (0..1), reused as pitch variation so the
// flurry chirps instead of machine-gunning. Very low in the mix.
export function playLineBlip(u = 0.5) {
  if (SOUND_DISABLED) return;
  const c = audioCtx();
  if (c.state === "suspended") return;
  const t0 = c.currentTime;
  const osc = c.createOscillator();
  osc.type = "triangle";
  osc.frequency.value = 1400 * 2 ** (u * 0.9); // ~1.4-2.6 kHz across lines
  const g = c.createGain();
  g.gain.setValueAtTime(0.05, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.05);
  osc.connect(g);
  g.connect(buses.sfx);
  osc.start(t0);
  osc.stop(t0 + 0.06);
  osc.onended = () => g.disconnect();
}

// ── Roller rumble (synthesized rolling-noise loop) ────────────────────
// Bandpassed noise on the duck emitter; gain and a slight pitch follow
// ground speed, silent at rest. Built lazily on first use.
let rumble = null; // { gain, src }

export function setRumble(level, out = null) {
  if (SOUND_DISABLED) return;
  const c = audioCtx();
  if (!rumble) {
    if (level <= 0) return;
    const src = c.createBufferSource();
    src.buffer = noiseBuffer(c, 1.5);
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = 110;
    f.Q.value = 0.8;
    const g = c.createGain();
    g.gain.value = 0;
    src.connect(f);
    f.connect(g);
    g.connect(out?.node ?? buses.sfx);
    src.start();
    rumble = { gain: g, src };
  }
  const t = c.currentTime;
  rumble.gain.gain.setTargetAtTime(Math.min(1, level) * 0.22, t, 0.08);
  rumble.src.playbackRate.setTargetAtTime(0.85 + 0.5 * Math.min(1, level), t, 0.12);
}
