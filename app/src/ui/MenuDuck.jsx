// Title-menu duck stage: the simulated twin, sitting on the title screen
// like the vitrine landing's colour module - head aims at the pointer
// (idle glances at the camera when it's quiet), click/tap quacks. No
// physics, no policies: just the shared rig posed and micro-animated.
//
// Why a separate rig instead of showing the game scene: the boot
// dramaturgy keeps the in-game duck hidden until the BIOS readout cues
// the entrance scan-up, so the title screen needs its own duck. Geometry
// is free anyway - duck.js caches the GLB module-wide, so this rig and
// the game's share the same buffers.
//
// The stage is a lazy module singleton: built once on first open, then
// re-attached on every pause. The rAF loop only runs while attached.
import { useEffect, useRef } from "react";
import Box from "@mui/material/Box";
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import {
  loadKinematics, buildRig, setJoint, setJawOpen, applyPose,
  SITTING_POSE, groundFullBody, MODEL_DIR,
} from "../game/duck.js";
import { VARIANTS, DEFAULT_VARIANT, materialHookFor, applyVariant } from "../game/variants.js";
import { createWireframeFx } from "../game/fx/fx-wireframe.js";
import { playUrl } from "../game/audio.js";
import { signed } from "../game/signed.js";
import { useGame } from "../store.js";

// Aim calibration, verbatim from the vitrine's duck3d/scene.js: positive
// head_pitch is head-down on the mjlab model, so screen-up subtracts.
const SIGN_YAW = 1;
const SIGN_PITCH = -1;
const SPREAD_YAW = 0.55; // rad of head yaw across half the stage width
const SPREAD_PITCH = 0.32; // rad of head pitch across half the stage height

// Quack envelope: openness eases toward a target instead of replaying a
// fixed curve, so clicking mid-quack never snaps the jaw backwards.
const QUACK_HOLD_S = 0.3;
const QUACK_ATTACK_TAU = 0.04;
const QUACK_RELEASE_TAU = 0.09;

// The vitrine's aim framing, loosened for the menu column: the duck fills
// ~2/3 of the frame height instead of edge to edge. The look height is
// tuned WITH the zoom to put the feet (y=0) ~18% above the frame's bottom
// edge - floating well clear of the shortcut strip.
const CAM_POS = [0.28, 0.2, 0.43];
const CAM_LOOK = [0, 0.122, 0];
const CAM_ZOOM = 0.78;
const FOV_DEG = 32;

// Same voice banks as the game's quack (game.js VOICE_BANK).
const VOICE_BANK = { classic: "duck1", charcoal: "duck2", purple: "duck3", blue: "duck4" };
const CHIRP_TAKES = "abcdefghijkl";

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const rand = (a, b) => a + Math.random() * (b - a);

let stagePromise = null;
let liveStage = null;
let stageReady = false;

function getStage() {
  if (!stagePromise) {
    stagePromise = buildStage()
      .then((s) => {
        liveStage = s;
        stageReady = true;
        return s;
      })
      .catch((e) => {
        // Still flip ready: the title screen must not spin forever when
        // WebGL / assets fail - it just shows without the duck.
        stageReady = true;
        throw e;
      });
  }
  return stagePromise;
}

// Title-screen loading gate: the menu holds a spinner until the stage's
// assets are in (kinematics + GLB + rig build), so the content reveal
// and the duck's entrance scan cue together instead of the duck popping
// into an already-settled screen.
export const preloadMenuDuck = () => getStage();
export const isMenuDuckReady = () => stageReady;

async function buildStage() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV_DEG, 1, 0.05, 20);
  camera.position.set(
    ...CAM_LOOK.map((l, i) => l + (CAM_POS[i] - l) / CAM_ZOOM),
  );
  camera.lookAt(...CAM_LOOK);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  // Same output pipeline the variant palette was calibrated against.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const el = renderer.domElement;
  el.style.position = "absolute";
  el.style.inset = "0";
  el.style.width = "100%";
  el.style.height = "100%";
  // Anti-flicker: invisible until the first frame has been presented.
  el.style.opacity = "0";
  el.style.transition = "opacity 0.45s ease";

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment()).texture;
  scene.environmentIntensity = 0.25;

  // Vitrine light rig: strong white key, soft fill, warm orange rim.
  scene.add(new THREE.AmbientLight(0xffffff, 0.45));
  const key = new THREE.DirectionalLight(0xffffff, 1.25);
  key.position.set(2, 4, 2);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.4);
  fill.position.set(-2, 2, 1.5);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffb366, 0.7);
  rim.position.set(0, 3, -2);
  scene.add(rim);

  const k = await loadKinematics(`${MODEL_DIR}/kinematics.json`);
  let appliedVariant = useGame.getState().variant ?? DEFAULT_VARIANT;
  if (!VARIANTS[appliedVariant]) appliedVariant = DEFAULT_VARIANT;
  const rig = await buildRig(k, {
    materialForMesh: materialHookFor(VARIANTS[appliedVariant]),
  });
  // Face the camera: MJCF forward is +X; the placer yaw turns it to +Z.
  rig.placer.rotation.y = -Math.PI / 2;
  scene.add(rig.placer);
  applyPose(rig, SITTING_POSE);
  groundFullBody(rig);

  // Vitrine-style entrance: the duck materializes with the wireframe
  // scan-up the first time the menu shows. Hidden (clip at floor level)
  // until the stage is attached, then start() cues the scan; once done
  // the fx restores the real materials and is dropped for good - pause
  // reopens show the solid duck immediately.
  //
  // Shader pre-warm: the scan cycles through three material states, each
  // compiling its GPU program on the frame it first renders - the plain
  // PBR originals (restored when the scan finishes), the per-mesh clip
  // clones (unique customProgramCacheKey each, so ~30 separate PBR
  // compiles), and the wireframe ShaderMaterial (only drawn once the
  // scan is running). Left alone, those compiles land mid-animation as
  // driver-timed freezes. The canvas is still detached and invisible
  // here, so render each state once now: solid first, then a mid-scan
  // frame (wires on, clones clipping), then rewind to hidden.
  renderer.render(scene, camera);
  let entranceFx = createWireframeFx();
  entranceFx.init({ THREE, scene, root: rig.placer, camera, renderer, hidden: true });
  entranceFx.setProgress(0.5);
  renderer.render(scene, camera);
  entranceFx.setProgress(0);
  let entranceStarted = false;

  const headPivot = rig.joints.get("head_yaw").body;
  const headWorld = new THREE.Vector3();
  const camDir = new THREE.Vector3();

  // ── Pointer → aim state ───────────────────────────────────────────────
  const ndc = new THREE.Vector2(0, 0);
  let mountEl = null;
  let lastT = 0;
  let lastMouseT = -Infinity;
  let hasFocus = document.hasFocus();
  let mouseInside = true;
  let az = 0, el2 = 0;
  let attention = 0;
  const o1 = rand(0, 6.3), o2 = rand(0, 6.3);
  let quackHoldUntil = -Infinity;
  let quackOpen = 0;

  const onPointerMove = (e) => {
    if (!mountEl) return;
    const r = mountEl.getBoundingClientRect();
    if (!r.width || !r.height) return;
    ndc.x = clamp(((e.clientX - r.left) / r.width) * 2 - 1, -2, 2);
    ndc.y = clamp(-(((e.clientY - r.top) / r.height) * 2 - 1), -2, 2);
    lastMouseT = lastT;
    mouseInside = true;
  };
  const onBlur = () => { hasFocus = false; };
  const onFocus = () => { hasFocus = true; };
  const onMouseLeave = () => { mouseInside = false; };
  const onMouseEnter = () => { mouseInside = true; };
  // Any click on the title screen quacks, not just the stage box: the
  // overlay owns the whole viewport while the menu is up, and the quack
  // never swallows the event (buttons underneath still do their thing).
  const onPointerDown = () => quack();

  function quack() {
    quackHoldUntil = lastT + QUACK_HOLD_S;
    const bank = VOICE_BANK[appliedVariant] ?? "duck1";
    const take = CHIRP_TAKES[(Math.random() * CHIRP_TAKES.length) | 0];
    // The click that lands here is a user gesture, so this also unlocks
    // the shared AudioContext on the very first interaction.
    playUrl(signed(`./assets/voices/${bank}/chirp_${take}.wav`), { gain: 0.7 });
  }

  function step(dt, t) {
    lastT = t;
    headPivot.getWorldPosition(headWorld);
    camDir.copy(camera.position).sub(headWorld);
    const azCam = Math.atan2(camDir.x, camDir.z);
    const elCam = Math.atan2(camDir.y, Math.hypot(camDir.x, camDir.z));

    // Attention 0..1: eases toward 1 while the page is focused, the
    // pointer is around and moved recently; lazy camera glances otherwise.
    const engaged = hasFocus && mouseInside && t - lastMouseT < 3.0;
    attention += ((engaged ? 1 : 0) - attention) * (1 - Math.exp(-dt / 0.3));

    const azAim = azCam + ndc.x * SPREAD_YAW;
    const elAim = elCam * 0.5 + ndc.y * SPREAD_PITCH;
    const azIdle = azCam + 0.45 * Math.sin(0.21 * t + o1) * Math.sin(0.09 * t + o2) * 2;
    const elIdle = elCam * 0.5 + 0.1 * Math.sin(0.4 * t + o2);
    const azT = azIdle + (azAim - azIdle) * attention;
    const elT = elIdle + (elAim - elIdle) * attention;
    const kSmooth = 1 - Math.exp(-dt * (2.5 + 7.5 * attention));
    az += (azT - az) * kSmooth;
    el2 += (elT - el2) * kSmooth;

    const breathe = Math.sin(t * 1.4) * 0.025;
    setJoint(rig, "neck_pitch", SITTING_POSE.neck_pitch + breathe);
    setJoint(rig, "head_yaw", SIGN_YAW * az);
    setJoint(rig, "head_pitch", SITTING_POSE.head_pitch + SIGN_PITCH * el2);
    setJoint(rig, "head_roll", 0.3 * SIGN_YAW * (az - azCam));

    const quackTarget = t < quackHoldUntil ? 1 : 0;
    const tau = quackTarget > quackOpen ? QUACK_ATTACK_TAU : QUACK_RELEASE_TAU;
    quackOpen += (quackTarget - quackOpen) * (1 - Math.exp(-dt / tau));
    setJawOpen(rig, quackOpen);

    if (entranceFx) {
      if (!entranceStarted) {
        entranceFx.start();
        entranceStarted = true;
      }
      entranceFx.update(dt);
      if (entranceFx.isDone()) {
        entranceFx.dispose();
        entranceFx = null;
      }
    }

    // Colourway follows the in-game duck (store.variant), fading live.
    // Deferred while the entrance scan holds its clip-material clones:
    // an applyVariant mid-scan would repaint clones that get thrown away
    // on restore. The sync lands on the first frame after the scan.
    const v = useGame.getState().variant;
    if (!entranceFx && v !== appliedVariant && VARIANTS[v]) {
      appliedVariant = v;
      applyVariant(rig, v);
    }

    renderer.render(scene, camera);
    if (el.style.opacity === "0") el.style.opacity = "1";
  }

  // ── Attach / detach (rAF only runs while a mount hosts the canvas) ────
  let raf = 0;
  let prevNow = 0;
  const loop = (now) => {
    raf = requestAnimationFrame(loop);
    const dt = Math.min((now - prevNow) / 1000, 0.05);
    prevNow = now;
    step(dt, now / 1000);
  };

  function resize() {
    if (!mountEl) return;
    const w = mountEl.clientWidth;
    const h = mountEl.clientHeight;
    if (!w || !h) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }
  const resizeObserver = new ResizeObserver(resize);

  function attach(mount) {
    if (!mount || mountEl === mount) return;
    detach();
    mountEl = mount;
    mount.appendChild(el);
    resizeObserver.observe(mount);
    resize();
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    document.addEventListener("mouseleave", onMouseLeave);
    document.addEventListener("mouseenter", onMouseEnter);
    prevNow = performance.now();
    raf = requestAnimationFrame(loop);
  }
  function detach() {
    if (!mountEl) return;
    cancelAnimationFrame(raf);
    resizeObserver.disconnect();
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerdown", onPointerDown);
    window.removeEventListener("blur", onBlur);
    window.removeEventListener("focus", onFocus);
    document.removeEventListener("mouseleave", onMouseLeave);
    document.removeEventListener("mouseenter", onMouseEnter);
    el.remove();
    mountEl = null;
  }

  const stage = { attach, detach, quack, step };
  // Deterministic hook for automated verification, same spirit as the
  // game's window.rl: rAF pauses in background tabs, so tests drive
  // frames by hand.
  window.__menuDuck = stage;
  return stage;
}

export default function MenuDuck({ sx }) {
  const hostRef = useRef(null);

  useEffect(() => {
    let disposed = false;
    getStage()
      .then((stage) => {
        if (disposed) return;
        if (hostRef.current) stage.attach(hostRef.current);
      })
      .catch((e) => console.warn("menu duck disabled:", e));
    return () => {
      disposed = true;
      liveStage?.detach();
    };
  }, []);

  return (
    <Box
      ref={hostRef}
      aria-hidden
      sx={{
        position: "relative",
        touchAction: "manipulation",
        userSelect: "none",
        ...sx,
      }}
    />
  );
}
