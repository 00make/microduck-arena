// Cutscene layer: page-load entrance and every later respawn.
//
// Physics (resetSim) snaps the duck to the stand keyframe; this module
// owns what the player sees around that snap. Two mutually exclusive
// timelines share the duck's wireframe FX:
//
//   entrance (once)  grid + walls draw in, then the duck scans up
//   respawn  (every kill / Space / loco switch)
//     0.00  duck clipped away, camera glides home from the kill view
//     0.80  camera almost settled -> duck scan-up cues
//     0.90  camera lands
//     1.70  scan done, inputs unlock
//
// rl.js injects the world (rig, grid, camera reset) and the lock/flash
// callbacks; this file never touches MuJoCo.

import { entranceLineCues } from "./arena.js";

export const CAM_RESET_S = 0.9;
export const RESPAWN_SCAN_AT = 0.8; // cue scan-up at 80% of the camera glide

const ENTRANCE_GRID_S = 1.1;
const ENTRANCE_WALL_DELAY_S = 0.35;
const ENTRANCE_WALL_S = 0.9;
const ENTRANCE_FX_START_S = 0.6;

const clamp01 = (x) => Math.min(Math.max(x, 0), 1);

export function createCeremony({
  THREE, scene, camera, renderer, fx,
  getRig, grid, wallMats,
  syncRig, startCameraReset,
  setLocked, flashReset,
  onScanCue = () => {},
  onLineCue = () => {},
  onPropCue = () => {},
}) {
  const ENTRANCE_TOTAL_S = Math.max(
    ENTRANCE_GRID_S,
    ENTRANCE_WALL_DELAY_S + ENTRANCE_WALL_S,
    ENTRANCE_FX_START_S + fx.TOTAL_S,
  );

  // Per-line audio cues for the entrance draw-in: normalized reveal times
  // from arena.js (exact same hashed stagger as the shaders), mapped onto
  // this timeline's grid/wall reveal windows. Entrance-only: respawns
  // never redraw the arena.
  const cues = entranceLineCues();
  const lineCues = [
    ...cues.grid.map((c) => ({ at: c.at * ENTRANCE_GRID_S, u: c.u })),
    ...cues.walls.map((c) => ({
      at: ENTRANCE_WALL_DELAY_S + c.at * ENTRANCE_WALL_S, u: c.u,
    })),
  ].sort((a, b) => a.at - b.at);
  let lineCueIdx = lineCues.length; // parked until startEntrance

  let fxRig = null;
  let fxPrev = null;
  // Decorative props (addPropFx): each owns a wireframe FX bound to its
  // own root. They cue whenever the duck's scan cues (entrance and every
  // respawn), offset by their stagger, and drive on their OWN clock so a
  // late-finishing prop never extends the input lock or the ceremony's
  // completion checks.
  const props = []; // { fx, delayS, at, started, prev }
  let entranceT0 = null;
  let entranceFxCued = false;
  let entranceDone = false;
  let respawn = null; // { t0, scanCued } | null
  let entranceFinishedResolve;
  const entranceFinished = new Promise((r) => { entranceFinishedResolve = r; });

  function bind() {
    const rig = getRig();
    if (fxRig === rig) return;
    fx.dispose();
    fx.init({ THREE, scene, rig, camera, renderer });
    rig.placer.traverse((o) => {
      if (o.isMesh && !o.userData.meshName) o.userData.fxOverlay = true;
    });
    fxRig = rig;
  }

  function fxStart() {
    bind();
    fx.start();
    fxPrev = performance.now();
    propsCue();
    // Sound cue riding the same trigger as the visual scan; the duration
    // lets the sweep span the materialize exactly.
    onScanCue(fx.TOTAL_S);
  }
  function propsCue() {
    const now = performance.now();
    for (const p of props) {
      p.at = now + p.delayS * 1000;
      p.started = false;
      p.prev = null;
    }
  }
  function propsHide() {
    for (const p of props) {
      p.fx.setProgress(0);
      p.at = null;
      p.started = false;
    }
  }
  function propsFinish() {
    for (const p of props) {
      if (!p.started) p.fx.start();
      p.fx.update(1e3);
      p.at = null;
    }
  }
  // Deterministic screenshot/test hook (setFx): park every prop at the
  // same scan progress as the duck, detached from the timed driver.
  function propsSetProgress(v) {
    for (const p of props) {
      p.fx.setProgress(v);
      p.at = null;
      p.started = false;
    }
  }
  function driveProps() {
    const now = performance.now();
    for (const p of props) {
      if (p.at === null || now < p.at) continue;
      if (!p.started) {
        p.fx.start();
        // Audio twin, cued the frame this prop's scan actually starts;
        // TOTAL_S carries the size-stretched duration so the sound can
        // match both length and register.
        onPropCue(p.fx.TOTAL_S);
        p.started = true;
        p.prev = now;
        continue;
      }
      if (p.fx.isDone()) continue;
      const dt = Math.min((now - p.prev) / 1000, 0.25);
      p.prev = now;
      p.fx.update(dt);
    }
  }
  function fxDrive() {
    if (fxPrev === null || fx.isDone()) return;
    const now = performance.now();
    const dt = Math.min((now - fxPrev) / 1000, 0.25);
    fxPrev = now;
    fx.update(dt);
  }
  function fxForceFinish() {
    if (!fx.isDone()) fx.update(1e3);
  }

  function startEntrance() {
    if (entranceT0 !== null || entranceDone) return;
    entranceT0 = performance.now();
    entranceFxCued = false;
    lineCueIdx = 0;
    grid.material.uniforms.uReveal.value = 0;
    for (const m of wallMats) m.uniforms.uReveal.value = 0;
  }

  function driveEntrance() {
    if (entranceT0 === null) return;
    const t = (performance.now() - entranceT0) / 1000;
    // Fire the per-line blips as their lines start drawing in.
    while (lineCueIdx < lineCues.length && lineCues[lineCueIdx].at <= t) {
      onLineCue(lineCues[lineCueIdx].u);
      lineCueIdx++;
    }
    grid.material.uniforms.uReveal.value = clamp01(t / ENTRANCE_GRID_S);
    const wallR = clamp01((t - ENTRANCE_WALL_DELAY_S) / ENTRANCE_WALL_S);
    for (const m of wallMats) m.uniforms.uReveal.value = wallR;
    if (t >= ENTRANCE_FX_START_S && !entranceFxCued) {
      entranceFxCued = true;
      fxStart();
    }
    fxDrive();
    if (t >= ENTRANCE_TOTAL_S) {
      if (!fx.isDone() && t < ENTRANCE_TOTAL_S + 0.5) return;
      fxForceFinish();
      entranceT0 = null;
      entranceDone = true;
      grid.material.uniforms.uReveal.value = 1;
      for (const m of wallMats) m.uniforms.uReveal.value = 1;
      setLocked(false);
      entranceFinishedResolve();
    }
  }

  function playRespawn() {
    if (!entranceDone) return;
    setLocked(true);
    flashReset();
    bind();
    startCameraReset();
    syncRig();
    fx.setProgress(0);
    propsHide();
    respawn = { t0: performance.now(), scanCued: false };
  }

  function driveRespawn() {
    if (!respawn) return;
    const u = (performance.now() - respawn.t0) / 1000 / CAM_RESET_S;
    if (!respawn.scanCued && u >= RESPAWN_SCAN_AT) {
      respawn.scanCued = true;
      fxStart();
    }
    if (respawn.scanCued) fxDrive();
    if (respawn.scanCued && fx.isDone()) {
      respawn = null;
      setLocked(false);
    }
  }

  function drive() {
    driveEntrance();
    driveRespawn();
    driveProps();
  }

  function setReveal(floor, wall = floor) {
    entranceT0 = null;
    grid.material.uniforms.uReveal.value = floor;
    for (const m of wallMats) m.uniforms.uReveal.value = wall;
  }

  function setFx(p) {
    entranceT0 = null;
    respawn = null;
    bind();
    if (p >= 1) {
      fx.start();
      fxForceFinish();
      propsFinish();
      setLocked(false);
      entranceFinishedResolve();
    } else {
      fx.setProgress(p);
      propsSetProgress(p);
    }
  }

  // Register a decorative prop's wireframe FX (already init'd on its own
  // root, hidden). It materializes delayS after each duck scan cue.
  function addPropFx(propFx, delayS = 0) {
    props.push({ fx: propFx, delayS, at: null, started: false, prev: null });
  }

  // Boot hidden: clip parked below the feet from the first frame.
  bind();

  return {
    CAM_RESET_S,
    startEntrance,
    playRespawn,
    drive,
    bind,
    setReveal,
    setFx,
    addPropFx,
    entranceFinished,
    get entranceDone() { return entranceDone; },
    get respawnActive() { return respawn !== null; },
  };
}
