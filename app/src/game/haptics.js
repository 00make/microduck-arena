// Gamepad haptics engine: named one-shot pulses plus a continuous rumble
// bed, multiplexed onto the single dual-rumble channel the Gamepad API
// exposes per pad (playEffect always REPLACES the running effect - there
// is no hardware mixing, so the mixing policy lives here).
//
// Model (the usual game-feel split):
//   strongMagnitude = heavy low-frequency motor -> mass, impacts, thuds
//   weakMagnitude   = light high-frequency motor -> texture, ticks
//
// Pulses are named presets with a priority: while one is playing, a
// lower-priority pulse is dropped (a wall bump can never eat the fall
// thud) and an equal/higher one takes the channel. `scale` multiplies
// both magnitudes so impact-style cues can ride the physics (ball |dv|,
// bump strength). Presets may be sequences (multi-tap patterns) - taps
// are scheduled with timeouts and cancelled wholesale if another pulse
// takes over mid-pattern.
//
// The bed is a 0..1 level written every control step (roller ground
// speed); it keeps the motors alive between pulses by re-issuing a short
// overlapping effect, yields the instant a pulse fires, and resumes when
// the pulse expires. Everything is fire-and-forget and safe without a
// pad or actuator (Safari, some Firefox/driver stacks): silent no-op.

import { pickPad } from "./controls/gamepad.js";

// Kill switch, mirroring SOUND_DISABLED in audio.js: flip to true and
// every entry point below early-returns.
const HAPTICS_DISABLED = false;

// One-shot presets. d/gap in ms, s/w = strong/weak magnitudes (0..1
// before scale), prio decides who wins the single channel.
const EFFECTS = {
  // Confirmed fall (recovery entry or non-recoverable tip-over).
  fall: { prio: 3, seq: [{ d: 450, s: 1.0, w: 0.7 }] },
  // Solver explosion -> instant reset: the hardest hit in the game.
  explode: { prio: 4, seq: [{ d: 550, s: 1.0, w: 1.0 }] },
  // Barrel roll finished upright: landing thump.
  land: { prio: 2, seq: [{ d: 170, s: 0.7, w: 0.35 }] },
  // Kick swing launch (the ball contact rides ballHit on top).
  kick: { prio: 1, seq: [{ d: 90, s: 0.5, w: 0.2 }] },
  // Ball impact felt through the body - scaled by the hit's |dv|.
  ballHit: { prio: 2, seq: [{ d: 120, s: 0.85, w: 0.4 }] },
  // Trunk bump against a wall or prop - scaled by |dv|.
  bump: { prio: 1, seq: [{ d: 130, s: 0.55, w: 0.25 }] },
  // Recovery success (the duck got back up): light double tap.
  recover: { prio: 2, seq: [{ d: 70, s: 0.3, w: 0.45 }, { gap: 90 }, { d: 100, s: 0.5, w: 0.65 }] },
};

// Bed tuning: texture-forward (weak motor), a whisper of mass underneath.
const BED_REFRESH_MS = 240; // re-issue cadence; duration overlaps 2x
const BED_STRONG = 0.12;
const BED_WEAK = 0.4;
const BED_FLOOR = 0.03; // below this the bed is considered off

let current = { until: 0, prio: 0 }; // the pulse owning the channel
let seqGen = 0; // generation token: bumping it cancels pending seq taps
let bedLevel = 0;
let bedIssuedAt = 0;
let bedActive = false;

const actuator = () => pickPad()?.vibrationActuator ?? null;

const play = (act, step, scale) => {
  act
    .playEffect("dual-rumble", {
      duration: step.d,
      strongMagnitude: Math.min(1, step.s * scale),
      weakMagnitude: Math.min(1, step.w * scale),
    })
    .catch(() => {});
};

function pulse(name, scale = 1) {
  if (HAPTICS_DISABLED) return;
  const fx = EFFECTS[name];
  if (!fx) return;
  const act = actuator();
  if (!act?.playEffect) return;
  const now = performance.now();
  if (now < current.until && fx.prio < current.prio) return;
  seqGen++; // cancel any in-flight sequence from the previous pulse
  const gen = seqGen;
  let at = 0;
  let total = 0;
  for (const step of fx.seq) total += (step.gap ?? 0) + (step.d ?? 0);
  current = { until: now + total, prio: fx.prio };
  bedActive = false; // the pulse owns the channel; tick() resumes the bed
  for (const step of fx.seq) {
    at += step.gap ?? 0;
    if (!step.d) continue;
    if (at === 0) {
      play(act, step, scale);
    } else {
      setTimeout(() => {
        if (gen !== seqGen) return; // a newer pulse took the channel
        const a = actuator(); // pad may have been yanked meanwhile
        if (a?.playEffect) play(a, step, scale);
      }, at);
    }
    at += step.d;
  }
}

// Continuous rumble level (0..1), meant to be written every control step
// (it only becomes motion through tick()).
function setBed(level) {
  bedLevel = HAPTICS_DISABLED ? 0 : Math.max(0, Math.min(1, level));
}

// Channel scheduler, called once per control step: re-issues the bed
// while it's on and no pulse owns the channel, and cuts the motors when
// the bed falls silent (playEffect would otherwise finish the last
// overlap on its own, a ~0.5 s tail).
function tick() {
  if (HAPTICS_DISABLED) return;
  const now = performance.now();
  if (now < current.until) return;
  const act = actuator();
  if (!act) return;
  if (bedLevel > BED_FLOOR) {
    if (now - bedIssuedAt >= BED_REFRESH_MS) {
      bedIssuedAt = now;
      bedActive = true;
      act
        .playEffect?.("dual-rumble", {
          duration: BED_REFRESH_MS * 2,
          strongMagnitude: Math.min(1, BED_STRONG * bedLevel),
          weakMagnitude: Math.min(1, BED_WEAK * bedLevel),
        })
        .catch(() => {});
    }
  } else if (bedActive) {
    bedActive = false;
    bedIssuedAt = 0;
    try { act.reset?.()?.catch?.(() => {}); } catch { /* older impls throw sync */ }
  }
}

export const haptics = { pulse, setBed, tick };
