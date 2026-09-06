// Controller: the video-game-style input core. Aggregates pluggable input
// SOURCES (keyboard, gamepad, later touch) into one game-facing surface:
//
//   - a continuous COMMAND: the [vx, vy, wz] twist the policy tracks, plus
//     auxiliary analog AXES (jaw 0..1, camera-orbit rates -1..1);
//   - discrete ACTIONS: edge-triggered events (roll, kicks, ball spawn...)
//     dispatched to subscribers the moment a source fires them;
//   - HUD support: per-source pressed-state snapshots and activity info so
//     the hint keycaps can light up per physical control and per device.
//
// The game code (rl.js) instantiates the sources, registers them here,
// calls update(dt) once per render frame, reads getCommand()/getAxes()
// where it builds the policy observation, and subscribes its trigger
// functions with on(action, cb).
//
// ── Source interface contract ────────────────────────────────────────────
// Every input source module (keyboard.js, gamepad.js, a future touch.js
// with a virtual joystick + buttons) implements:
//
//   id          Unique string ("keyboard", "gamepad", "touch"...). Action
//               subscribers receive it as meta.source, so game code can
//               attribute HUD flashes / keycap lighting to the right device.
//   connected   Boolean hardware presence. Keyboard: always true. Gamepad:
//               a pad is currently reported by navigator.getGamepads().
//   command     Float32Array(3) [vx, vy, wz], ALREADY scaled to the game's
//               velocity limits (sources take a getVelocityLimits() callback
//               returning [fwd, back, ang], so limits can change at runtime,
//               e.g. the legs <-> rollers switch). Must be a stable array
//               reference updated in place: getCommand() hands it out
//               without copying, and the control loop reads it between
//               render frames.
//   axes        { jaw, orbitX, orbitY, ride } - auxiliary continuous
//               channels. jaw in [0, 1] (mouth opening), orbit axes in
//               [-1, 1] (camera orbit rate; the inertia/smoothing lives
//               downstream in the camera code, sources report raw
//               deflection), ride in [0, 1] (LT squeeze pressure, bends
//               the wheee note's pitch). Stable object reference, updated
//               in place. Channels a source does not drive may be omitted
//               (merged as 0).
//   pressed     Plain object of booleans (stable reference) mirroring which
//               physical controls are currently down. HUD highlighting
//               only - never game logic.
//   isActive()  Whether the source currently claims authority over the
//               continuous command. Keyboard: any move key held. Gamepad:
//               stick deflected, and it keeps the claim until its smoothed
//               command settles back to ~zero.
//   init()      Attach event listeners / hardware hooks. Called by
//               Controller.init(), NOT at construction (rl.js constructs
//               the sources early but arms the listeners at the same point
//               in the boot where they historically went live).
//   dispose()   Detach everything init() attached.
//   poll(dt)    Per-frame tick (dt in seconds, clamped by the caller).
//               Read the hardware, update command/axes/pressed in place,
//               and fire edge-triggered actions via this.onAction(name).
//   onAction    (name, meta?) => void, assigned by the Controller at
//               registration. Sources may call it from poll() (gamepad
//               button edges) or straight from event handlers (keyboard:
//               keeps the historical press-to-effect latency).
//
// ── Arbitration ──────────────────────────────────────────────────────────
// Continuous command: sources are registered in PRIORITY order (first =
// highest). Each frame the first source reporting isActive() owns the
// twist; when none is active the LAST registered source's command is used
// as the fallback (it reads zero when idle). With [gamepad, keyboard] this
// reproduces the historical `padActive ? padCmd : velCmd` exactly: live
// sticks win over held keys, and the keyboard takes back over once the
// pad's smoothed command has settled.
// Aux axes are merged across ALL sources regardless of who owns the twist
// (the pad triggers drive the jaw even while walking on the keyboard):
// jaw = max over sources, orbit = largest-magnitude value per axis.
//
// ── Actions ──────────────────────────────────────────────────────────────
//   roll          one-shot roll (crouch-glide in roller mode; game decides)
//   groundPick    one-shot ground pick cycle (pad A / keyboard G)
//   kickL, kickR  one-shot kicks, explicit foot
//   alternateKick one-shot kick, feet alternated by the game
//   spawnBall     pop / respawn the kickable ball (no bound key; game/API)
//   headToggle    HEAD mode on/off (pad Y): sticks drive the head
//   sitToggle     sit <-> stand (game gates it to legs mode)
//   locoToggle    legs <-> rollers switch
//   chaseToggle   chase camera on/off
//   reset         full sim reset (Space)
//   walk          back to the walk/run mode (pad DpadUp short press)
//   quack         chirp + jaw flap (pad RT edge, Schmitt-triggered)
//
// ── Input lock ───────────────────────────────────────────────────────────
// setLocked(true) zeroes getCommand() - the twist gate used while the
// entrance/respawn ceremony plays. Discrete actions still dispatch: each
// game trigger applies its own lock policy (e.g. Space-reset and the
// chase-cam toggle historically work while locked, kicks don't).

const ZERO_CMD = new Float32Array(3);

export class Controller {
  #sources = [];
  #listeners = new Map(); // action -> Set(cb)
  #locked = false;
  #axes = { jaw: 0, orbitX: 0, orbitY: 0, ride: 0 };

  constructor({ sources = [] } = {}) {
    for (const s of sources) this.addSource(s);
  }

  // Register in priority order (first registered wins arbitration ties).
  addSource(source) {
    source.onAction = (action, meta) =>
      this.#dispatch(action, { source: source.id, ...meta });
    this.#sources.push(source);
  }

  // Read-only source list, for advanced per-source queries the merged view
  // can't answer (e.g. "is ANY source commanding a turn right now?").
  get sources() {
    return this.#sources;
  }

  // Arm every source's listeners/hardware hooks.
  init() {
    for (const s of this.#sources) s.init?.();
  }

  dispose() {
    for (const s of this.#sources) s.dispose?.();
  }

  // Per-frame tick: poll every source (they fire their edge actions from
  // inside poll), then merge the aux axes.
  update(dt) {
    for (const s of this.#sources) s.poll?.(dt);
    let jaw = 0, ox = 0, oy = 0, ride = 0;
    for (const s of this.#sources) {
      const a = s.axes;
      if (!a) continue;
      jaw = Math.max(jaw, a.jaw ?? 0);
      ride = Math.max(ride, a.ride ?? 0);
      if (Math.abs(a.orbitX ?? 0) > Math.abs(ox)) ox = a.orbitX;
      if (Math.abs(a.orbitY ?? 0) > Math.abs(oy)) oy = a.orbitY;
    }
    this.#axes.jaw = jaw;
    this.#axes.orbitX = ox;
    this.#axes.orbitY = oy;
    this.#axes.ride = ride;
  }

  setLocked(v) {
    this.#locked = !!v;
  }

  get locked() {
    return this.#locked;
  }

  // Merged continuous twist [vx, vy, wz] (see the arbitration notes above).
  // Returns live source arrays without copying - treat as read-only.
  getCommand() {
    if (this.#locked) return ZERO_CMD;
    for (const s of this.#sources) if (s.isActive()) return s.command;
    const fallback = this.#sources[this.#sources.length - 1];
    return fallback ? fallback.command : ZERO_CMD;
  }

  // Merged aux axes { jaw, orbitX, orbitY }, refreshed by update().
  getAxes() {
    return this.#axes;
  }

  // Any source claiming twist authority (HUD "user is driving" signal).
  anyActive() {
    return this.#sources.some((s) => s.isActive());
  }

  // Per-source pressed snapshots for HUD keycap highlighting:
  // { keyboard: {...}, gamepad: {...} }.
  getPressed() {
    const out = {};
    for (const s of this.#sources) out[s.id] = s.pressed ?? {};
    return out;
  }

  // Subscribe to a discrete action; cb(meta) with meta.source = source id.
  // Returns an unsubscribe function.
  on(action, cb) {
    let set = this.#listeners.get(action);
    if (!set) this.#listeners.set(action, (set = new Set()));
    set.add(cb);
    return () => set.delete(cb);
  }

  #dispatch(action, meta) {
    const set = this.#listeners.get(action);
    if (!set) return;
    for (const cb of set) cb(meta);
  }
}
