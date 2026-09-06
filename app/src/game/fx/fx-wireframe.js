// Holographic wireframe scan-up materialization effect.
//
// Sequence (~0.9 s, reversible):
//   1. An invisible scan height rises from the floor through the target;
//      the boundary reads on the surface itself (bright wireframe band
//      right under the scan height - no standalone disc geometry).
//   2. Below the scan line the target shows as a flickering additive
//      wireframe hologram (scanline stripes, brightness boost near the
//      scan line).
//   3. A second, fainter "solidify" line trails behind: fragments below
//      it render the real PBR materials (world-Y clip injected via
//      onBeforeCompile), with a hot edge right at the line. Once it
//      clears the top the original materials are restored directly.
//
// Played backwards, the same timeline de-materializes (solid peel ->
// hologram -> gone). Used for the ball despawn; the duck only ever
// materializes.
//
// createWireframeFx() returns an independent instance (duck and ball
// scan at the same time without sharing uniforms). The module-level
// named exports wrap a singleton so demo-wireframe.html is unchanged.
//
// Instance interface:
//   init({ THREE, scene, rig | root, camera, renderer, hidden? })
//   start() / startReverse() / update(dt) / isDone() / restore() / dispose()
// Extra: setProgress(p), playing, reversing, TOTAL_S.

export const name = "wireframe";

// ── Timeline (seconds) ──────────────────────────────────────────────────
const SCAN_S = 0.6; // wireframe scan line: floor -> top
const SOLID_DELAY_S = 0.3; // solidify line starts this long after the scan
const SOLID_S = 0.6; // solidify line: floor -> top
export const TOTAL_S = SOLID_DELAY_S + SOLID_S; // 0.9

const clamp01 = (x) => Math.min(Math.max(x, 0), 1);
// Ease-out only: the rise starts at full speed the instant the scan cues
// (a smoothstep ease-in reads as a stall near the feet) and lands softly.
const ease = (x) => 1 - (1 - x) * (1 - x);

// Deterministic pseudo-random flicker so setProgress(p) captures are
// reproducible (no Math.random).
const hash = (x) => {
  const s = Math.sin(x * 127.1) * 43758.5453;
  return s - Math.floor(s);
};
const flickerAt = (time) => {
  let f = 0.82 + 0.18 * hash(Math.floor(time * 60) + 0.5);
  if (hash(Math.floor(time * 24) + 7.7) < 0.12) f *= 0.5; // dropouts
  return f;
};

// Unique customProgramCacheKey values across every instance: a fresh
// clone of the same source material would otherwise reuse the compiled
// program without re-running onBeforeCompile, leaving clip uniforms
// unbound (see the dissolve comment in rl.js).
let clipNonce = 0;

const BOTTOM_PAD = 0.025;

// The band widths and timeline above are tuned for duck-sized targets
// (~0.35 m tall). Bigger props (the arcade cabinets) scale the spatial
// constants linearly and the duration by sqrt(scale), so the scan still
// reads as the same effect instead of a fast flash with hairline bands.
// Clamped at 1 so duck- and ball-sized targets are untouched.
const REF_SPAN = 0.35;

export function createWireframeFx() {
  // Per-instance uniforms: duck and ball must not share a scan height.
  const uScanY = { value: -1e3 };
  const uSolidY = { value: -1e3 };
  const uFlicker = { value: 1 };
  const uTime = { value: 0 };
  const uSpanK = { value: 1 }; // size factor vs REF_SPAN (>= 1)

  let ctx = null; // { THREE, scene, root, camera, renderer }
  let t = 0;
  let dir = 1; // +1 materialize, -1 dematerialize
  let playing = false;
  let finished = false;

  let minY = 0;
  let spanY = 0.3;
  let durK = 1; // timeline stretch for big targets
  const totalS = () => TOTAL_S * durK;

  const clipClones = new Map();
  let clipSaved = null; // Array<[mesh, originalMat, cloneMat]> while active

  let wireMat = null;
  let wireMeshes = [];

  const isTargetMesh = (o) => o.isMesh && !o.userData.fxOverlay;

  function clipCloneFor(orig) {
    let m = clipClones.get(orig.uuid);
    if (m) return m;
    m = orig.clone();
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uFxSolidY = uSolidY;
      shader.uniforms.uFxSpanK = uSpanK;
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vFxW;")
        .replace(
          "#include <worldpos_vertex>",
          "#include <worldpos_vertex>\nvFxW = (modelMatrix * vec4(transformed, 1.0)).xyz;",
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          "#include <common>\nvarying vec3 vFxW;\nuniform float uFxSolidY;\nuniform float uFxSpanK;",
        )
        .replace(
          "#include <clipping_planes_fragment>",
          /* glsl */ `#include <clipping_planes_fragment>
float fxEdge = 0.0;
if (vFxW.y > uFxSolidY) discard;
fxEdge = 1.0 - smoothstep(0.002 * uFxSpanK, 0.018 * uFxSpanK, uFxSolidY - vFxW.y);`,
        )
        .replace(
          "#include <dithering_fragment>",
          /* glsl */ `#include <dithering_fragment>
gl_FragColor.rgb += fxEdge * vec3(0.95, 0.32, 0.05);`,
        );
    };
    const key = `microduck-fx-wireframe-${clipNonce++}`;
    m.customProgramCacheKey = () => key;
    m.needsUpdate = true;
    clipClones.set(orig.uuid, m);
    return m;
  }

  function applyClipMaterials() {
    if (clipSaved) return;
    clipSaved = [];
    ctx.root.traverse((o) => {
      if (!isTargetMesh(o)) return;
      const orig = o.material;
      const clone = clipCloneFor(orig);
      clipSaved.push([o, orig, clone]);
      o.material = clone;
    });
  }

  function restoreClipMaterials() {
    if (!clipSaved) return;
    for (const [mesh, orig, clone] of clipSaved) {
      if (mesh.material === clone) mesh.material = orig;
    }
    clipSaved = null;
  }

  function makeWireMaterial(THREE) {
    return new THREE.ShaderMaterial({
      uniforms: { uScanY, uSolidY, uFlicker, uTime, uSpanK },
      vertexShader: /* glsl */ `
        varying vec3 vW;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vW = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uScanY, uSolidY, uFlicker, uTime, uSpanK;
        varying vec3 vW;
        void main() {
          if (vW.y > uScanY || vW.y < uSolidY) discard;
          float lead = 1.0 - smoothstep(0.0, 0.06 * uSpanK, uScanY - vW.y);
          float tail = smoothstep(0.0, 0.018 * uSpanK, vW.y - uSolidY);
          float stripes = 0.7 + 0.3 * sin(vW.y * 900.0 / uSpanK - uTime * 45.0);
          vec3 c = vec3(1.0, 0.34, 0.06) * (0.55 + 1.6 * lead);
          float a = (0.10 + 0.40 * lead) * stripes * tail * uFlicker;
          gl_FragColor = vec4(c, a);
        }`,
      wireframe: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
    });
  }

  function buildWireOverlays(THREE, root) {
    wireMat = makeWireMaterial(THREE);
    root.traverse((o) => {
      if (!isTargetMesh(o)) return;
      // Child of the source mesh with identity transform so the overlay
      // follows whatever pose the caller writes (duck joints or ball qpos).
      // userData.fxWireGeometry substitutes a coarser geometry for the
      // wireframe pass only (the ball's render sphere is too dense to read
      // as a hologram); the solidify clip still runs on the real mesh.
      const w = new THREE.Mesh(o.userData.fxWireGeometry ?? o.geometry, wireMat);
      w.userData.fxOverlay = true;
      w.renderOrder = 5;
      w.visible = false;
      o.add(w);
      wireMeshes.push(w);
    });
  }

  function applyAt(time) {
    const scanP = ease(clamp01(time / (SCAN_S * durK)));
    const solidP = ease(clamp01((time - SOLID_DELAY_S * durK) / (SOLID_S * durK)));
    uFlicker.value = flickerAt(time);
    uTime.value = time;

    const jitter = scanP > 0 && scanP < 1 ? (hash(time * 41.3) - 0.5) * 0.02 * spanY : 0;
    uScanY.value = minY + spanY * scanP + jitter;
    uSolidY.value = minY + spanY * solidP;

    const wiresOn = time > 0 && solidP < 1;
    for (const w of wireMeshes) w.visible = wiresOn;
  }

  function finish() {
    // Forward: restore the real materials (fully solid). Reverse: leave
    // the clip parked at t=0 (fully hidden) so restoring wouldn't flash
    // the solid mesh for a frame; the caller hides the object then
    // restore()s.
    if (dir > 0) restoreClipMaterials();
    else applyAt(0);
    for (const w of wireMeshes) w.visible = false;
    finished = true;
    playing = false;
  }

  function computeRange() {
    const { THREE, root } = ctx;
    root.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(root);
    minY = Math.min(box.min.y, 0) - BOTTOM_PAD;
    spanY = Math.max(box.max.y - minY, 0.04) * 1.06;
    // Size adaptation: spatial constants scale linearly with the target's
    // height, the timeline by sqrt (a 1.7 m cabinet scans in ~2 s, not
    // 0.9 s at 6x the line speed). >= 1: duck/ball keep the original look.
    uSpanK.value = Math.max(1, spanY / REF_SPAN);
    durK = Math.min(Math.sqrt(uSpanK.value), 2.5);
  }

  function arm(nextDir, resetT) {
    dir = nextDir;
    if (resetT) t = nextDir > 0 ? 0 : totalS();
    finished = false;
    computeRange();
    applyClipMaterials();
    applyAt(t);
    playing = true;
  }

  function init({ THREE, scene, rig, root, camera, renderer, hidden = true }) {
    const target = root ?? rig.placer;
    ctx = { THREE, scene, root: target, camera, renderer };
    computeRange();
    buildWireOverlays(THREE, target);
    t = 0;
    dir = 1;
    finished = false;
    playing = false;
    if (hidden) {
      applyClipMaterials();
      applyAt(0);
    }
  }

  function start() {
    // Mid-reverse: keep the current t and turn around. Fresh play: from 0.
    arm(1, !playing);
  }

  function startReverse() {
    arm(-1, !playing);
  }

  function update(dt) {
    if (!playing || finished) return;
    t += dir * dt;
    if (dir > 0 && t >= totalS()) {
      t = totalS();
      applyAt(t);
      finish();
      return;
    }
    if (dir < 0 && t <= 0) {
      t = 0;
      applyAt(t);
      finish();
      return;
    }
    applyAt(t);
  }

  function isDone() {
    return finished;
  }

  function setProgress(p) {
    playing = false;
    finished = false;
    dir = 1;
    computeRange();
    applyClipMaterials();
    t = clamp01(p) * totalS();
    applyAt(t);
  }

  function restore() {
    restoreClipMaterials();
  }

  function dispose() {
    restoreClipMaterials();
    for (const w of wireMeshes) w.parent?.remove(w);
    wireMeshes = [];
    wireMat?.dispose();
    wireMat = null;
    ctx = null;
    playing = false;
    finished = false;
  }

  return {
    init, start, startReverse, update, isDone, setProgress, restore, dispose,
    get playing() { return playing; },
    get reversing() { return playing && dir < 0; },
    get TOTAL_S() { return totalS(); },
  };
}

// Singleton for the duck (and the isolated demo page). New callers that
// need a second scan (the ball) go through createWireframeFx().
const singleton = createWireframeFx();
export const init = (...a) => singleton.init(...a);
export const start = (...a) => singleton.start(...a);
export const startReverse = (...a) => singleton.startReverse(...a);
export const update = (...a) => singleton.update(...a);
export const isDone = (...a) => singleton.isDone(...a);
export const setProgress = (...a) => singleton.setProgress(...a);
export const restore = (...a) => singleton.restore(...a);
export const dispose = (...a) => singleton.dispose(...a);
