// Gamepad input source (see controller.js for the source interface
// contract). Same mapping as the robot runtime (pollen-robotics/microduck):
//
//   Left stick   vertical = vx (asymmetric fwd/back), horizontal = turn,
//                EMA-smoothed like the runtime's cmd_alpha.
//   Right stick  camera orbit rate (reported raw in axes.orbitX/Y; the
//                velocity smoothing / coasting lives downstream in the
//                camera code). R3 toggles the chase cam.
//   A            ground pick: one-shot pick-up-from-the-ground cycle
//                (runtime-faithful; game gates it to walk mode)
//   X            sit <-> stand (crouch-glide in roller mode - game decides).
//                The pad can no longer launch a roll at all.
//   Y            HEAD mode toggle (runtime-faithful). While the game sets
//                `headMode`, locomotion is parked and BOTH sticks drive
//                the head instead: left = head pitch/yaw, right = neck
//                pitch/head roll (reported in `head`, deflections in
//                [-1, 1], up/left positive). The right stick stops
//                orbiting the camera for the duration.
//   RB / LB      right / left kick
//   DpadDown     sit <-> stand
//   DpadUp       short press = back to run; HOLD ~1 s = legs <-> rollers
//                (like the robot's 3 s hold, shortened for the web)
//   RT           analog jaw + quack on the rising edge, through a
//                Schmitt trigger (fire at >= 0.35, re-arm below 0.2 - a
//                single threshold re-fires on jitter, which is how one
//                squeeze used to quack several times).
//   LT           rides the looping "wheee": start on the rising edge, cut
//                the instant it releases - same Schmitt hysteresis so
//                jitter can't restart the ride. The analog pressure is
//                reported continuously in `axes.ride` so the game can
//                pick the note with the squeeze (pentatonic steps over
//                one octave - the trigger is a tiny instrument).
//                The two are mutually exclusive: an edge on one trigger
//                is CONSUMED while the other is physically down, so one
//                squeeze can never fire both sounds - even on pads that
//                mirror a combined trigger channel onto both button
//                slots (see the trigger block for the tie-break).

const PAD_DEADZONE = 0.15;
const PAD_ALPHA = 0.12; // EMA smoothing toward the stick target
const dz = (v) => (Math.abs(v) < PAD_DEADZONE ? 0 : v);

// Standard-mapping button indices.
const BTN_A = 0, BTN_X = 2, BTN_Y = 3, BTN_LB = 4, BTN_RB = 5, BTN_LT = 6, BTN_RT = 7;
const BTN_R3 = 11, BTN_DPAD_UP = 12, BTN_DPAD_DOWN = 13;

const DPAD_UP_HOLD_MS = 1000; // hold-to-switch-loco duration

// The one pad-picking rule, shared by poll() and the haptics engine
// (haptics.js): prefer a standard-mapping pad - the button indices above
// are only guaranteed by the "standard" layout - and fall back to
// whatever is connected.
export function pickPad() {
  const pads = [...(navigator.getGamepads?.() ?? [])].filter((p) => p && p.connected);
  return pads.find((p) => p.mapping === "standard") ?? pads[0];
}

export class GamepadSource {
  id = "gamepad";
  connected = false;
  command = new Float32Array(3); // [vx, 0, wz], EMA-smoothed
  axes = { jaw: 0, orbitX: 0, orbitY: 0, ride: 0 };
  // Head-mode routing flag, owned by the game (mode state machine lives
  // there); while true the sticks fill `head` instead of command/orbit.
  headMode = false;
  head = { neckPitch: 0, pitch: 0, yaw: 0, roll: 0 }; // stick deflections
  pressed = {
    a: false, x: false, y: false, rb: false, lb: false, r3: false,
    dpadDown: false, dpadUp: false,
  };
  onAction = () => {}; // assigned by the Controller at registration

  #getVelocityLimits;
  #active = false; // owns twist authority (stick input, until EMA settles)
  #dpadUpAt = 0; // wall-clock of the current DpadUp press
  #dpadUpFired = false; // latch: one loco switch per hold
  #rtDown = false; // RT physical Schmitt state (edge detection + gating)
  #ltDown = false; // LT physical Schmitt state (edge detection + gating)
  #ltRide = false; // wheee ride currently open (LT edge that wasn't blocked)

  constructor({ getVelocityLimits }) {
    this.#getVelocityLimits = getVelocityLimits;
  }

  init() {} // poll-based: nothing to attach
  dispose() {}

  isActive() {
    return this.#active;
  }

  poll() {
    const prev = this.pressed;
    // A non-standard pad (mapping "") is a last-resort fallback in
    // pickPad - its indices are firmware-defined and some mirror one
    // combined trigger channel onto both trigger slots.
    const gp = pickPad();
    this.connected = !!gp;
    if (!gp) {
      if (this.#active) {
        this.#active = false;
        this.command.fill(0);
        this.axes.jaw = 0;
      }
      this.axes.orbitX = 0;
      this.axes.orbitY = 0;
      this.axes.ride = 0;
      this.#zeroHead();
      // A pad yanked mid-ride must not leave the wheee looping forever.
      if (this.#ltRide) {
        this.#ltRide = false;
        this.#ltDown = false;
        this.onAction("wheeeStop");
      }
      return;
    }
    const now = performance.now();

    const lx = dz(gp.axes[0] ?? 0), ly = dz(gp.axes[1] ?? 0);
    const rx = dz(gp.axes[2] ?? 0), ry = dz(gp.axes[3] ?? 0);
    const [limF, limB, limA] = this.#getVelocityLimits();
    let target;
    if (this.headMode) {
      // HEAD mode: locomotion parks (EMA settles to zero), the camera
      // orbit is frozen, and the sticks report head deflections instead
      // (up/left positive; sign-to-joint mapping lives in the game).
      target = [0, 0, 0];
      this.head.pitch = -ly;
      this.head.yaw = -lx;
      this.head.neckPitch = -ry;
      this.head.roll = -rx;
      this.axes.orbitX = 0;
      this.axes.orbitY = 0;
    } else {
      // Left stick only: vertical = forward/back, horizontal = turn.
      // (No strafe; the right stick doesn't drive movement.)
      const up = -ly; // browser sticks report up as -1
      target = [
        up >= 0 ? up * limF : up * -limB,
        0,
        -lx * limA,
      ];
      this.#zeroHead();
      // Right stick: raw (deadzoned) orbit rate. Reported every frame -
      // the downstream camera step needs the zeros too so a released
      // stick coasts to a stop.
      this.axes.orbitX = rx;
      this.axes.orbitY = ry;
    }
    for (let i = 0; i < 3; i++) this.command[i] += PAD_ALPHA * (target[i] - this.command[i]);
    // Sticks grab command authority on first input, release when back at
    // rest (then the keyboard takes over again through the Controller's
    // arbitration). In head mode the sticks belong to the head, so they
    // never claim the twist.
    const stickInput = !this.headMode && (lx !== 0 || ly !== 0);
    if (stickInput) this.#active = true;
    else if (
      this.#active &&
      Math.abs(this.command[0]) + Math.abs(this.command[1]) + Math.abs(this.command[2]) < 0.01
    ) {
      this.#active = false;
      this.command.fill(0);
    }

    // R3 (right stick click): chase-cam toggle, gamepad twin of KeyC.
    const r3 = !!gp.buttons[BTN_R3]?.pressed;
    if (r3 && !prev.r3) this.onAction("chaseToggle");
    prev.r3 = r3;

    const a = !!gp.buttons[BTN_A]?.pressed;
    if (a && !prev.a) this.onAction("groundPick");
    prev.a = a;

    const x = !!gp.buttons[BTN_X]?.pressed;
    if (x && !prev.x) this.onAction("sitToggle");
    prev.x = x;

    const y = !!gp.buttons[BTN_Y]?.pressed;
    if (y && !prev.y) this.onAction("headToggle");
    prev.y = y;

    const rb = !!gp.buttons[BTN_RB]?.pressed;
    if (rb && !prev.rb) this.onAction("kickR");
    prev.rb = rb;
    const lb = !!gp.buttons[BTN_LB]?.pressed;
    if (lb && !prev.lb) this.onAction("kickL");
    prev.lb = lb;

    const dpadDown = !!gp.buttons[BTN_DPAD_DOWN]?.pressed;
    if (dpadDown && !prev.dpadDown) this.onAction("sitToggle");
    prev.dpadDown = dpadDown;

    // DpadUp: short press = back to run; hold fires ONE loco switch.
    const dpadUp = !!gp.buttons[BTN_DPAD_UP]?.pressed;
    if (dpadUp && !prev.dpadUp) {
      this.#dpadUpAt = now;
      this.#dpadUpFired = false;
      this.onAction("walk");
    }
    if (dpadUp && !this.#dpadUpFired && now - this.#dpadUpAt >= DPAD_UP_HOLD_MS) {
      this.#dpadUpFired = true; // latch: one switch per hold
      this.onAction("locoToggle");
    }
    prev.dpadUp = dpadUp;

    // Triggers. Both open the beak analogically - the duck sings the
    // wheee with its mouth, wider with the squeeze (jaw is purely visual:
    // no sound and no policy input ever reads it, so this can't re-open
    // the cross-talk fixed below). Physical Schmitt edges are detected
    // first - state must advance even for blocked edges, so releasing a
    // blocker never retro-fires the suppressed action - then the actions
    // are gated so the two triggers stay mutually exclusive.
    const rt = gp.buttons[BTN_RT]?.value ?? 0;
    const lt = gp.buttons[BTN_LT]?.value ?? 0;
    this.axes.jaw = Math.max(rt, lt);
    this.axes.ride = lt; // raw squeeze, consumed per-frame for the wheee pitch
    const rtEdge = !this.#rtDown && rt >= 0.35;
    if (rtEdge) this.#rtDown = true;
    else if (this.#rtDown && rt < 0.2) this.#rtDown = false;
    const ltEdge = !this.#ltDown && lt >= 0.3;
    if (ltEdge) this.#ltDown = true;
    else if (this.#ltDown && lt < 0.2) this.#ltDown = false;
    // LT wheee ride first: blocked only if RT was already down BEFORE
    // this frame. On pads that mirror one combined trigger channel onto
    // both button slots a squeeze raises rt and lt together; treating the
    // same-frame rt rise as "engaged" would hand the race to the quack
    // (the old bug: LT presses fired RT's sound). The LT edge wins the
    // tie deterministically; cut the ride the instant LT drops below the
    // low rail.
    const rtWasDown = this.#rtDown && !rtEdge;
    if (ltEdge && !rtWasDown) {
      this.#ltRide = true;
      this.onAction("wheeeStart");
    } else if (this.#ltRide && !this.#ltDown) {
      this.#ltRide = false;
      this.onAction("wheeeStop");
    }
    // RT quack: consumed while LT is down or the ride is open. In the
    // mirrored case above the lt rise opened the ride and set #ltDown in
    // the same frame, so the phantom rt edge always lands here.
    if (rtEdge && !this.#ltDown && !this.#ltRide) this.onAction("quack");
  }

  #zeroHead() {
    this.head.neckPitch = 0;
    this.head.pitch = 0;
    this.head.yaw = 0;
    this.head.roll = 0;
  }
}
