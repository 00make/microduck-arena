// Touch input source (see controller.js for the source interface
// contract). Game Boy layout, two thumbs:
//
//   Left thumb   FLOATING analog stick: the lower-left quadrant of the
//                screen (#touch-zone) is the grab area, and the stick base
//                (#touch-stick) re-anchors under the finger wherever it
//                lands - so the thumb never has to find a fixed circle -
//                then snaps back to its resting spot on release. Vertical
//                = vx (asymmetric fwd/back limits), horizontal = turn. The
//                nub tracks the finger clamped to the base circle; the
//                command is EMA-smoothed like the gamepad's so releases
//                don't snap.
//   Right thumb  two round caps: A (#touch-a) fires alternateKick - the
//                game alternates feet; B (#touch-b) quacks on press and
//                holds the beak open (axes.jaw = 1) while held.
//
// The overlay DOM lives in index.html (#touch-ui); this module only wires
// pointer events to it. `connected` (mirrored onto body.touch-mode by
// rl.js, which is what actually shows the overlay) arms two ways:
//   - (pointer: coarse) matches: phones/tablets, before any touch;
//   - OR the first real touch anywhere: catches DevTools device modes and
//     hybrid laptops the media query misses. Latching, like a gamepad.

const TOUCH_ALPHA = 0.18; // EMA smoothing toward the stick target
const TOUCH_DEADZONE = 0.12; // normalized deflection ignored around center

export class TouchSource {
  id = "touch";
  connected = false;
  command = new Float32Array(3); // [vx, 0, wz], EMA-smoothed
  axes = { jaw: 0, orbitX: 0, orbitY: 0 };
  pressed = { stick: false, a: false, b: false };
  onAction = () => {}; // assigned by the Controller at registration

  #getVelocityLimits;
  #active = false; // owns twist authority (stick engaged, until EMA settles)
  #target = [0, 0]; // normalized deflection [x, right+] [y, up+]
  #mq = null;
  #onMq = null;
  #disposers = [];

  constructor({ getVelocityLimits }) {
    this.#getVelocityLimits = getVelocityLimits;
  }

  init() {
    this.#mq = window.matchMedia("(pointer: coarse)");
    // Latching: once a device has proven it can touch, keep the thumbs.
    // __microduckTouched carries a touch seen by the title page before
    // this module booted.
    if (window.__microduckTouched) this.connected = true;
    this.#onMq = () => { this.connected = this.connected || this.#mq.matches; };
    this.#mq.addEventListener("change", this.#onMq);
    this.#onMq();
    const armTouch = () => { this.connected = true; };
    window.addEventListener("touchstart", armTouch, { once: true, passive: true });
    this.#disposers.push(() => window.removeEventListener("touchstart", armTouch));

    const zone = document.getElementById("touch-zone");
    const stick = document.getElementById("touch-stick");
    const nub = stick?.querySelector(".nub");
    if (zone && stick && nub) this.#bindStick(zone, stick, nub);

    this.#bindButton("touch-a", "a", () => this.onAction("alternateKick"));
    this.#bindButton("touch-b", "b", () => this.onAction("quack"));
  }

  dispose() {
    this.#mq?.removeEventListener("change", this.#onMq);
    for (const off of this.#disposers) off();
    this.#disposers = [];
  }

  isActive() {
    return this.#active;
  }

  poll() {
    const [x, y] = this.#target;
    const [limF, limB, limA] = this.#getVelocityLimits();
    const tvx = y >= 0 ? y * limF : y * -limB;
    const twz = -x * limA;
    this.command[0] += TOUCH_ALPHA * (tvx - this.command[0]);
    this.command[2] += TOUCH_ALPHA * (twz - this.command[2]);
    // Same authority rule as the gamepad sticks: grab on input, release
    // once the smoothed command has settled back to ~zero.
    if (this.pressed.stick) this.#active = true;
    else if (this.#active && Math.abs(this.command[0]) + Math.abs(this.command[2]) < 0.01) {
      this.#active = false;
      this.command.fill(0);
    }
    // B holds the beak open; quack itself fired on the press edge.
    this.axes.jaw = this.pressed.b ? 1 : 0;
  }

  #on(el, type, fn) {
    el.addEventListener(type, fn);
    this.#disposers.push(() => el.removeEventListener(type, fn));
  }

  #bindStick(zone, stick, nub) {
    let pointerId = null;
    let center = null; // stick center while grabbed, zone-local px
    const setFrom = (e) => {
      const zr = zone.getBoundingClientRect();
      const R = stick.offsetWidth / 2;
      const travel = R * 0.62; // max nub travel inside the base circle
      let dx = e.clientX - zr.left - center.x;
      let dy = e.clientY - zr.top - center.y;
      const d = Math.hypot(dx, dy);
      if (d > travel) { dx *= travel / d; dy *= travel / d; }
      nub.style.transform = `translate(${dx}px, ${dy}px)`;
      const nx = dx / travel, ny = -dy / travel; // up is +y
      const mag = Math.hypot(nx, ny);
      const live = mag >= TOUCH_DEADZONE;
      this.#target[0] = live ? nx : 0;
      this.#target[1] = live ? ny : 0;
    };
    const release = () => {
      pointerId = null;
      center = null;
      this.pressed.stick = false;
      stick.classList.remove("live");
      nub.style.transform = "";
      // Back to the CSS resting spot until the next grab.
      stick.style.left = "";
      stick.style.top = "";
      stick.style.bottom = "";
      this.#target[0] = 0;
      this.#target[1] = 0;
    };
    this.#on(zone, "pointerdown", (e) => {
      e.preventDefault();
      pointerId = e.pointerId;
      // Anchor the base exactly under the finger - a clamped anchor would
      // start the stick with a phantom deflection near the zone edges. The
      // circle clipping off-screen there is the standard floating-stick
      // look, and it takes no pointer events anyway.
      const zr = zone.getBoundingClientRect();
      const R = stick.offsetWidth / 2;
      center = { x: e.clientX - zr.left, y: e.clientY - zr.top };
      stick.style.left = `${center.x - R}px`;
      stick.style.top = `${center.y - R}px`;
      stick.style.bottom = "auto";
      this.pressed.stick = true;
      stick.classList.add("live");
      setFrom(e); // zero deflection at grab
      // Last: capture can throw on exotic pointers and must not eat the
      // press state above.
      try { zone.setPointerCapture(e.pointerId); } catch {}
    });
    this.#on(zone, "pointermove", (e) => {
      if (e.pointerId === pointerId) setFrom(e);
    });
    this.#on(zone, "pointerup", (e) => {
      if (e.pointerId === pointerId) release();
    });
    this.#on(zone, "pointercancel", (e) => {
      if (e.pointerId === pointerId) release();
    });
  }

  #bindButton(elId, key, fire) {
    const el = document.getElementById(elId);
    if (!el) return;
    this.#on(el, "pointerdown", (e) => {
      e.preventDefault();
      this.pressed[key] = true;
      el.classList.add("down");
      fire(); // on the press edge, not the release: arcade latency
      try { el.setPointerCapture(e.pointerId); } catch {}
    });
    const release = () => {
      this.pressed[key] = false;
      el.classList.remove("down");
    };
    this.#on(el, "pointerup", release);
    this.#on(el, "pointercancel", release);
  }
}
