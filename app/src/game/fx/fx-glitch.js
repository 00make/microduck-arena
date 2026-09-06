// Cyberpunk 2077-style glitch materialization for the Microduck rig.
//
// The duck appears as stacked horizontal slices that flicker in and out
// with random screen-space horizontal offsets, converging to their true
// position. Chromatic aberration is faked with two additive silhouette
// ghosts (cyan / orange) offset left-right, digital noise blocks flash
// emissive or invert the surface colour, and a final warm flash "snaps"
// everything crisp.
//
// Implementation: onBeforeCompile injections on CACHED clones of the rig
// materials (same pattern and same program-cache trap as the entrance
// dissolve in rl.js: clones are cached per original material and reused
// on every replay, each with a unique customProgramCacheKey, otherwise
// three.js would reuse a compiled program without re-binding uniforms).
// All uniforms are shared singleton objects so one JS write per frame
// drives every material.

export const name = "glitch";

const DURATION = 1.15; // seconds
const TICK_HZ = 30; // discrete glitch update rate (digital feel)
const SLICES = 24;

// ── Shared uniforms (one instance drives all cloned materials) ──────────
const uP = { value: 0 }; // progress 0..1 (0 = invisible)
const uSeed = { value: 0 }; // discrete tick, drives all hashes
const uAmp = { value: 0 }; // slice offset amplitude (view-space meters)
const uFlash = { value: 0 }; // final snap flash intensity
const uGhostOff = { value: 0 }; // RGB-split ghost separation (meters)
const uB = { value: null }; // vec4(minY, height, sliceH, 0) world bounds

let T = null; // injected THREE namespace
let rigRef = null;
let playing = false;
let scrubbed = false;
let done = true;
let elapsed = 0;

// Deterministic JS-side hash, mirrors the GLSL one.
const jhash = (n) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

// ── GLSL injection ──────────────────────────────────────────────────────
const GLSL_HELPERS = /* glsl */ `
varying vec3 vGlW;
uniform float uGlP, uGlSeed;
uniform vec4 uGlB;
float glHash2(vec2 q) { return fract(sin(dot(q, vec2(127.1, 311.7))) * 43758.5453); }
vec3 glHash3(vec2 q) { return vec3(glHash2(q), glHash2(q + 17.17), glHash2(q + 31.3)); }
`;

function injectGlitch(shader, { signU = null, ghost = false } = {}) {
  shader.uniforms.uGlP = uP;
  shader.uniforms.uGlSeed = uSeed;
  shader.uniforms.uGlAmp = uAmp;
  shader.uniforms.uGlFlash = uFlash;
  shader.uniforms.uGlGhostOff = uGhostOff;
  shader.uniforms.uGlSign = signU ?? { value: 0 };
  shader.uniforms.uGlB = uB;

  shader.vertexShader = shader.vertexShader
    .replace(
      "#include <common>",
      "#include <common>\n" + GLSL_HELPERS + "uniform float uGlAmp, uGlSign, uGlGhostOff;\n",
    )
    .replace(
      "#include <project_vertex>",
      /* glsl */ `#include <project_vertex>
vec4 glWp = modelMatrix * vec4(transformed, 1.0);
vGlW = glWp.xyz;
if (uGlP < 1.0) {
  float glSid = floor((glWp.y - uGlB.x) / uGlB.z);
  // Fraction of moving slices shrinks as p rises: convergence.
  float glMove = step(0.25 + 0.62 * uGlP, glHash2(vec2(glSid * 1.71 + 4.2, uGlSeed + 13.0)));
  float glOff = (glHash2(vec2(glSid, uGlSeed)) - 0.5) * 2.0 * uGlAmp * glMove;
  // Occasional whole-body frame jump for one tick.
  if (glHash2(vec2(uGlSeed, 3.17)) > 0.86) {
    glOff += (glHash2(vec2(uGlSeed, 9.91)) - 0.5) * 3.0 * uGlAmp;
  }
  glOff += uGlSign * uGlGhostOff;
  // View-space X = screen-horizontal, the classic spawn-glitch axis.
  mvPosition.x += glOff;
  gl_Position = projectionMatrix * mvPosition;
}`,
    );

  const sliceDiscard = /* glsl */ `
float glEdge = 0.0, glInvAmt = 0.0;
vec3 glAddC = vec3(0.0);
if (uGlP < 1.0) {
  float glSid = floor((vGlW.y - uGlB.x) / uGlB.z);
  float glH = glHash2(vec2(glSid, uGlSeed + 0.7));
  float glVis = smoothstep(0.02, 0.82, uGlP) * 1.35;
  // Two-three full-silhouette pre-flashes right at the start.
  float glPre = (uGlP > 0.015 && uGlP < 0.14 && glHash2(vec2(uGlSeed, 7.7)) > 0.72) ? 1.0 : 0.0;
  glVis = max(glVis, glPre);
  if (glH > glVis) discard;
  glEdge = max(glPre * 0.7, (1.0 - smoothstep(0.0, 0.3, glVis - glH)) * (1.0 - uGlP));
${ghost ? "" : /* glsl */ `
  // Digital noise blocks: world-space rectangular patches, re-seeded per
  // tick. Some invert the surface colour, most flash emissive.
  vec2 glBq = floor((vGlW.xy + vec2(vGlW.z * 0.7, vGlW.z * 0.3)) * 52.0
                    + vec2(uGlSeed * 0.373, uGlSeed * 0.719));
  vec3 glBh = glHash3(glBq + uGlSeed);
  float glBGate = (1.0 - uGlP) * 0.16;
  if (glBh.x > 1.0 - glBGate) {
    if (glBh.y < 0.3) glInvAmt = 1.0;
    else glAddC += (glBh.z < 0.6 ? vec3(0.15, 1.3, 1.5)
                  : (glBh.z < 0.85 ? vec3(1.4) : vec3(1.6, 0.5, 0.06))) * (0.7 + glBh.y);
  }
  // Faint rolling scanline shimmer.
  glAddC += vec3(0.05, 0.3, 0.35) * (1.0 - uGlP) * 0.18
            * step(0.6, fract(vGlW.y * 150.0 - uGlSeed * 0.21));
`}
}`;

  const emissiveOut = ghost
    ? "" // ghosts are pre-tinted additive silhouettes, no extra emissive
    : /* glsl */ `
gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(1.1) - gl_FragColor.rgb, glInvAmt);
gl_FragColor.rgb += glAddC;
gl_FragColor.rgb += glEdge * vec3(0.25, 1.15, 1.35);
gl_FragColor.rgb += uGlFlash * vec3(1.25, 0.7, 0.35);`;

  shader.fragmentShader = shader.fragmentShader
    .replace(
      "#include <common>",
      "#include <common>\n" + GLSL_HELPERS + "uniform float uGlFlash;\n",
    )
    .replace("#include <clipping_planes_fragment>", "#include <clipping_planes_fragment>" + sliceDiscard)
    .replace("#include <dithering_fragment>", "#include <dithering_fragment>" + emissiveOut);
}

// ── Material clones (cached, never disposed between replays) ────────────
const clones = new Map(); // original material uuid -> glitch clone
let cloneNonce = 0;
let saved = null; // Array<[mesh, originalMat, cloneMat]> while active

function cloneFor(orig) {
  let m = clones.get(orig.uuid);
  if (m) return m;
  m = orig.clone();
  m.onBeforeCompile = (shader) => injectGlitch(shader);
  const key = `microduck-glitch-${cloneNonce++}`;
  m.customProgramCacheKey = () => key;
  m.needsUpdate = true;
  clones.set(orig.uuid, m);
  return m;
}

function applyGlitchMats() {
  if (saved) return;
  saved = [];
  rigRef.placer.traverse((o) => {
    if (!o.isMesh || o.userData.glGhost) return;
    const orig = o.material;
    const m = cloneFor(orig);
    saved.push([o, orig, m]);
    o.material = m;
  });
}

function restoreMats() {
  if (!saved) return;
  for (const [mesh, orig, clone] of saved) {
    if (mesh.material === clone) mesh.material = orig;
  }
  saved = null;
}

// ── RGB-split ghosts ────────────────────────────────────────────────────
// Two additive unlit silhouette copies of every rig mesh (cyan right,
// orange left), sharing the slice-discard shader so their outline always
// matches the sliced duck. Added as children of each mesh: they inherit
// the full kinematic transform for free.
let ghostMats = [];
let ghostMeshes = [];

function makeGhostMat(r, g, b, sign) {
  const m = new T.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: T.AdditiveBlending,
  });
  m.color.setRGB(r, g, b);
  const signU = { value: sign };
  m.onBeforeCompile = (shader) => injectGlitch(shader, { signU, ghost: true });
  m.customProgramCacheKey = () => `microduck-glitch-ghost-${sign > 0 ? "r" : "l"}`;
  return m;
}

function buildGhosts() {
  ghostMats = [makeGhostMat(0.0, 1.1, 1.3, +1), makeGhostMat(1.3, 0.35, 0.02, -1)];
  const hosts = [];
  rigRef.placer.traverse((o) => {
    if (o.isMesh && !o.userData.glGhost) hosts.push(o);
  });
  for (const mesh of hosts) {
    for (const mat of ghostMats) {
      const gm = new T.Mesh(mesh.geometry, mat);
      gm.userData.glGhost = true;
      gm.renderOrder = 2;
      gm.frustumCulled = false;
      gm.visible = false;
      mesh.add(gm);
      ghostMeshes.push(gm);
    }
  }
}

function setGhostsVisible(v) {
  for (const gm of ghostMeshes) gm.visible = v;
}

// ── Deterministic per-progress uniform state ────────────────────────────
// Everything derives from p alone (tick included), so setProgress(p) gives
// reproducible frames for debugging/screenshots.
function setUniformsFor(p) {
  uP.value = p;
  const tick = Math.floor(p * DURATION * TICK_HZ);
  uSeed.value = tick;
  const h = uB.value.y; // duck height
  const gate = 0.35 + 0.65 * jhash(tick + 3.7);
  uAmp.value = p < 0.92 ? h * 0.3 * Math.pow(1 - p, 1.3) * gate : 0;
  uGhostOff.value =
    p > 0.04 && p < 0.9 ? (0.06 + 0.3 * jhash(tick + 11.1)) * (1 - p) * h : 0;
  uFlash.value = p > 0.86 ? 1.5 * Math.exp(-16 * (p - 0.86) * DURATION) : 0;
  const ghostOp =
    p > 0.04 && p < 0.9 ? (0.05 + 0.32 * (1 - p)) * (0.4 + 0.6 * jhash(tick + 5.5)) : 0;
  for (const m of ghostMats) m.opacity = ghostOp;
}

function finish() {
  uP.value = 1;
  uFlash.value = 0;
  setGhostsVisible(false);
  restoreMats();
  playing = false;
  done = true;
}

// ── Public interface ────────────────────────────────────────────────────
export function init({ THREE, scene, rig, camera, renderer }) {
  T = THREE;
  rigRef = rig;
  rig.placer.updateWorldMatrix(true, true);
  const box = new T.Box3().setFromObject(rig.placer);
  const minY = box.min.y;
  const height = Math.max(1e-3, box.max.y - minY);
  uB.value = new T.Vector4(minY, height, height / SLICES, 0);
  buildGhosts();
  // Duck starts invisible: p=0 discards every fragment.
  uP.value = 0;
  applyGlitchMats();
  done = true;
  playing = false;
}

export function start() {
  applyGlitchMats();
  setGhostsVisible(true);
  elapsed = 0;
  playing = true;
  scrubbed = false;
  done = false;
  setUniformsFor(0);
}

export function update(dt, t) {
  if (!playing || scrubbed) return;
  elapsed += dt;
  const p = Math.min(1, elapsed / DURATION);
  setUniformsFor(p);
  if (p >= 1) finish();
}

export function isDone() {
  return done;
}

export function dispose() {
  restoreMats();
  for (const gm of ghostMeshes) gm.parent?.remove(gm);
  ghostMeshes = [];
  for (const m of ghostMats) m.dispose();
  ghostMats = [];
  for (const m of clones.values()) m.dispose();
  clones.clear();
  playing = false;
  done = true;
  rigRef = null;
}

// Debug hook: freeze the effect at an exact progress value (deterministic,
// used by the demo page for mid-effect screenshots). start() resumes
// normal playback.
export function setProgress(p) {
  scrubbed = true;
  if (p >= 1) {
    finish();
    return;
  }
  playing = true;
  done = false;
  applyGlitchMats();
  setGhostsVisible(true);
  setUniformsFor(Math.max(0, p));
}
