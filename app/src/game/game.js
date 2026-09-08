// Microduck RL playground core: the REAL trained policies, not a procedural
// waddle. Framework-agnostic port of the pre-React rl.js.
//
// Physics runs in MuJoCo compiled to WebAssembly (the official
// @mujoco/mujoco bindings), stepping the same MJCF the policies were
// trained on (pollen-robotics/microduck_rl). The controller is one of the
// exported ONNX checkpoints from pollen-robotics/microduck, executed with
// onnxruntime-web at 50 Hz (timestep 0.005 s, decimation 4) - exactly the
// loop from microduck_rl/scripts/infer_policy.py.
//
// Obs layout (61D, "new-cmd-obs" flavor, from the ONNX metadata):
//   [base_ang_vel(3), projected_gravity(3), joint_pos(14), joint_vel(14),
//    last_action(14), command(13)]
//
// Integration contract with the React shell:
//   - bootGame({ scene, camera, renderer }) is called once from inside the
//     R3F canvas; it loads everything, wires inputs and starts the 50 Hz
//     control loop.
//   - frame(dt) is called by R3F's useFrame every animation frame; it does
//     everything the old rAF loop did EXCEPT renderer.render (R3F renders).
//   - UI state flows out through the zustand store (throttled), UI intents
//     flow back in through gameApi.

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { signed } from "./signed.js";
import {
  POLICIES, JOINT_NAMES, DEFAULT_POSE, NUM_JOINTS, OBS_SIZE, CMD_SIZE,
  ACTION_SCALE, TIMESTEP, DECIMATION, CTRL_DT,
  VEL_FWD, VEL_BACK, VEL_ANG, RVEL_FWD, RVEL_BACK, RVEL_ANG,
  CROUCH_PERIOD_S, CROUCH_END_PHASE,
  GROUND_PICK_PERIOD_S, GROUND_PICK_END_PHASE,
  BALL_RADIUS, BALL_PARK_POS, ARENA_HALF, SPAWN_X, SPAWN_Y,
  RELIEF_BUMPS, RELIEF_HMAX, RELIEF_GRID, RELIEF_SINK, RELIEF_RATE,
} from "./constants.js";
import { loadProps, propColliders } from "./props.js";
import {
  buildRig, cloneRig, loadKinematics, setJoint, setJawOpen, MODEL_DIR, MESH_VERSION,
  loadGlbGeometries, geometryToBinaryStl,
} from "./duck.js";
import {
  VARIANTS, materialHookFor, DEFAULT_VARIANT, applyVariant,
} from "./variants.js";
import { Controller } from "./controls/controller.js";
import { KeyboardSource } from "./controls/keyboard.js";
import { GamepadSource } from "./controls/gamepad.js";
import { haptics } from "./haptics.js";
import { TouchSource } from "./controls/touch.js";
import { WaypointSource } from "./controls/waypoint.js";
import * as fx from "./fx/fx-wireframe.js";
import { createCeremony, CAM_RESET_S } from "./ceremony.js";
import {
  audioCtx, busNode, preloadSfx, playSfx, playUrl, updateListener,
  createEmitter, startAmbient, setAmbientDucked, playEntranceSweep,
  playPropSweep, playLineBlip, setRumble,
} from "./audio.js";
import { createBallActor } from "./ball-actor.js";
import { initGhosts } from "./ghosts.js";
import { makeInfiniteGrid, makeArenaWalls } from "./arena.js";
import { createBallVisual } from "./ball-visual.js";
// Football-mode field plumbing (inert on the default sandbox path: the
// goal-openings branch only runs when fieldConfig.walls asks for it).
import { getGoalCollisionGeoms, createGoalMesh } from "./football/goal.js";
import { GOAL_WIDTH, SPAWN_POSITIONS, BALL_SPAWN, PENALTY_DURATION_S, FIELD_HALF_W } from "./football/constants.js";
import {
  DEFAULT_STRATEGY,
  buildSpawnTable,
  getTuneOverlay,
  normalizeStrategy,
  mergeStrategy,
  strategiesForUser,
  strategyFingerprint,
} from "./football/strategy.js";
import { buildTacticsBoard, createMatchStats } from "./football/tactics-board.js";
// Multi-duck match plumbing: SANDBOX_CONFIG is the default matchConfig that
// reproduces the single-duck arena exactly; FOOTBALL_CONFIG (passed in by
// FootballCanvas) drives the 3v3 pitch. createDuckInstance holds per-duck
// runtime state; createAgent builds the role-specific AI.
import { SANDBOX_CONFIG } from "./football/match-config.js";
import { createDuckInstance } from "./football/duck-instance.js";
import { createAgent, decideAll, assignChaserId } from "./football/ai/index.js";
import { createReferee } from "./football/referee.js";
import { createCelebration } from "./football/celebration.js";
import { initStickers } from "./stickers.js";
import { useGame, gameApi, bootLine, bootNote, bootHalt, bootLog } from "../store.js";

// Physics + inference runtimes are vendored npm dependencies (no CDN):
// everything visitors execute is built from package-lock-verified
// tarballs and served from the Space itself, closing the jsDelivr
// supply-chain surface. The .wasm binaries ride the bundle as hashed
// assets via Vite ?url imports; the JS modules stay dynamic imports so
// they land in their own lazy chunks like before.
import mujocoWasmUrl from "@mujoco/mujoco/mujoco.wasm?url";
import ortWasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";

let bootStarted = false;

// ── Boot stall watchdog ────────────────────────────────────────────────
// boot() awaits a long chain: WASM instantiate, MJCF compile, 7 ONNX
// sessions, GLB + mesh fetches, rig build. If any single link wedges - a
// fetch that never settles, a worker that never posts back, or a main-thread
// freeze in the 50 Hz control loop (which is started part-way through boot,
// before bootDone) - nothing throws, so bootHalt never runs and both title
// gates sit on "Loading" forever with an empty console and no window.rl /
// window.football. The watchdog fingerprints the BIOS log and, once it stops
// advancing, converts that silent hang into the halt screen naming the stage
// still in flight.
const BOOT_STALL_MS = 45000;
const BOOT_WATCHDOG_POLL_MS = 2000;

// Everything the BIOS readout can show, flattened: a stage that only ticks
// its progress counter ("LOADING POLICIES 3/7") still counts as progress.
function bootStageFingerprint() {
  let fp = String(bootLog.length);
  for (const e of bootLog) fp += `|${e.label}:${e.status ?? "-"}:${e.progress ?? ""}`;
  return fp;
}

// The stage the boot is stuck on: the newest BIOS line still pending, or the
// last line written when nothing is pending (boot wedged between lines).
function pendingBootStage() {
  for (let i = bootLog.length - 1; i >= 0; i--) {
    const e = bootLog[i];
    if (!e.raw && e.status === null) return e.label;
  }
  return bootLog.length ? bootLog[bootLog.length - 1].label : "BOOT";
}

// Trunk yaw from the freejoint quat (MuJoCo wxyz), Z-up so this is rotation
// about z. Shared by the chase cam and the waypoint follower - both need
// "which way is the duck facing" in MJCF ground coords.
function duckYaw(qpos) {
  return Math.atan2(
    2 * (qpos[3] * qpos[6] + qpos[4] * qpos[5]),
    1 - 2 * (qpos[5] * qpos[5] + qpos[6] * qpos[6]),
  );
}

// HMR teardown for the ghost session: invalidating this module (directly or
// via an edit to ghosts.js) used to stack a live 15 Hz broadcast interval
// plus a ghost room per reload (the historical "stale module" bug class).
const liveGhostSessions = new Set();
// Same reasoning for the 50 Hz control loop: it belongs to the module
// instance that started it, so a dispose has to stop it - otherwise the
// thrown-away instance keeps stepping a model nobody renders.
const liveControlLoops = new Set();
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    for (const stop of liveControlLoops) stop();
    liveControlLoops.clear();
    for (const g of liveGhostSessions) g.destroy();
    liveGhostSessions.clear();
  });
  // Self-accept + hard reload. With no accept boundary here an edit anywhere
  // in the game module graph bubbles up to React Fast Refresh, which keeps
  // the mounted canvas and its already-run bootGame effect: the fresh module
  // instance's one-shot gate never fires again, so the tab is left with a
  // dead sim, an empty console and a title screen that never drops its
  // loading gate. A reload always comes back up through a clean boot.
  import.meta.hot.accept(() => {
    window.location.reload();
  });
}

export async function bootGame({ scene, camera, renderer, matchConfig }) {
  if (bootStarted) return;
  bootStarted = true;
  let lastFp = bootStageFingerprint();
  let lastProgress = performance.now();
  const watchdog = setInterval(() => {
    const s = useGame.getState();
    if (s.bootDone || s.bootFailed) return;
    const now = performance.now();
    // A background tab throttles timers, network and rAF alike: that is not
    // a stall, so keep the grace clock parked until the tab is visible.
    if (typeof document !== "undefined" && document.hidden) { lastProgress = now; return; }
    const fp = bootStageFingerprint();
    if (fp !== lastFp) { lastFp = fp; lastProgress = now; return; }
    if (now - lastProgress < BOOT_STALL_MS) return;
    const where = pendingBootStage();
    console.error(
      `[game] boot stalled at "${where}": no BIOS progress for`
      + ` ${Math.round((now - lastProgress) / 1000)}s`,
    );
    bootHalt(`BOOT STALLED AT ${where}`);
  }, BOOT_WATCHDOG_POLL_MS);
  try {
    await boot({ scene, camera, renderer, matchConfig });
  } catch (err) {
    console.error("[game] boot failed", err);
    bootHalt(err?.message || String(err));
    // boot() has unwound, so release the one-shot gate: a later mount (or a
    // retry after a transient network failure) must be able to boot again
    // instead of finding the tab permanently latched on a dead instance.
    bootStarted = false;
  } finally {
    clearInterval(watchdog);
  }
}

async function boot({ scene, camera, renderer, matchConfig: cfg }) {
  // Match configuration: SANDBOX_CONFIG (single duck, square arena) is the
  // default and reproduces existing behaviour byte-for-byte; FootballCanvas
  // passes FOOTBALL_CONFIG to boot the 3v3 pitch. isFootball gates every
  // multi-duck branch below so the sandbox path stays untouched.
  const matchConfig = cfg ?? SANDBOX_CONFIG;
  const isFootball = matchConfig.mode === "football";
  const setStore = useGame.setState;
  const store = useGame.getState;

  // Coach tactics: mutable spawn table + per-team strategy cards. Knobs apply
  // every AI tick; formation roles/spawns apply at kickoff (locked after start).
  let activeSpawns = SPAWN_POSITIONS.map((s) => ({ ...s }));
  let strategyByTeam = strategiesForUser(
    store().userTeam || "red",
    store().userStrategy || DEFAULT_STRATEGY,
    store().opponentStrategy || DEFAULT_STRATEGY,
  );
  let formationLocked = false;

  bootNote("Microduck BIOS v1.0");
  bootLine("MEMORY CHECK")("640K OK");
  bootLine("DUCK FIRMWARE")("PRESENT");

  // Surface async boot failures in the BIOS halt screen. Gated on the boot
  // still being in flight: post-boot async noise (ghost relay hiccups,
  // audio autoplay rejections...) must NOT cue the halt screen.
  const bootGuard = (e, msg) => {
    if (!store().bootDone && !store().bootFailed) bootHalt(msg);
  };
  window.addEventListener("unhandledrejection", (e) => {
    console.error("[game] unhandled rejection", e.reason);
    bootGuard(e, e.reason?.message || String(e.reason));
  });
  window.addEventListener("error", (e) => {
    console.error("[game] window error", e.message);
    bootGuard(e, e.message);
  });

  // Halting at the failure site: a rejected await inside this async boot
  // would otherwise only surface through the caller's catch.
  const traced = (label, p) => {
    const done = bootLine(label);
    return p.then(
      (v) => { done("OK"); return v; },
      (err) => {
        done("FAILED");
        console.error(`[game] ${label} FAILED`, err);
        bootHalt(err?.message || String(err));
        throw err;
      },
    );
  };

  // ── Runtimes (vendored, lazy chunks) ─────────────────────────────────
  const [{ default: loadMujocoFactory }, ort] = await traced(
    "RUNTIME MODULES",
    Promise.all([
      import("@mujoco/mujoco"),
      // wasm-only build: the sessions only ever use the "wasm" execution
      // provider, and the default entry would emit the 26 MB WebGPU (jsep)
      // wasm into the dist for nothing.
      import("onnxruntime-web/wasm"),
    ]),
  );
  // The bundler build embeds its JS loader; only the .wasm binary is
  // fetched at runtime, from our own hashed asset.
  ort.env.wasm.wasmPaths = { wasm: ortWasmUrl };
  ort.env.wasm.numThreads = 1; // single-threaded to avoid Worker document polyfill crash on static hosting

  // ── MJCF preparation ────────────────────────────────────────────────
  // robot_allcollisions.xml is what infer_policy.py's scene.xml includes:
  // it carries body/shell collision geoms that robot_walk.xml lacks, which
  // the sitstand policy needs (a sit rests the trunk on the ground).
  // Visual meshes are irrelevant to the dynamics: every body carries an
  // explicit <inertial>, and visual geoms have contype=0 conaffinity=0.
  // Stripping them means the MuJoCo VFS only needs the ~10 meshes
  // referenced by collision geoms. Works for both variants.
  async function buildPhysicsXml(xmlFile, fieldConfig = {}) {
    // Field shape overrides. The defaults reproduce the single-duck sandbox
    // arena EXACTLY (square ARENA_HALF, closed walls, relief + props on, no
    // goals), so an empty fieldConfig yields byte-identical MJCF to before.
    const {
      halfX = ARENA_HALF,
      halfY = ARENA_HALF,
      walls = "closed",     // 'closed' | 'goal-openings'
      relief = true,
      props = true,
      goalGeoms = [],       // optional pre-built MJCF geom descriptors
      // Multi-duck injection: one entry per robot. The sandbox default is a
      // single duck with an empty prefix (no injection, byte-identical MJCF);
      // football passes six prefixed ducks with spawn poses.
      ducks: duckConfigs = [{ prefix: "", spawn: null }],
      ballPark = BALL_PARK_POS, // ball freejoint rest pose (keyframe + body)
    } = fieldConfig;
    const src = await (await fetch(signed(`${MODEL_DIR}/${xmlFile}`))).text();
    const doc = new DOMParser().parseFromString(src, "text/xml");
    for (const g of [...doc.querySelectorAll('geom[class="visual"]')]) g.remove();
    const usedMeshes = new Set(
      [...doc.querySelectorAll("geom[mesh]")].map((g) => g.getAttribute("mesh")),
    );
    for (const m of [...doc.querySelectorAll("asset > mesh")]) {
      const name = m.getAttribute("name") ?? m.getAttribute("file").replace(/\.stl$/i, "");
      if (!usedMeshes.has(name)) m.remove();
    }
    const root = doc.documentElement;
    const el = (tag, attrs) => {
      const e = doc.createElement(tag);
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
      return e;
    };
    root.appendChild(el("option", { timestep: String(TIMESTEP) }));
    doc.querySelector("worldbody").appendChild(
      el("geom", { name: "floor", type: "plane", size: "0 0 0.05", pos: "0 0 0" }),
    );
    // Arena walls: four static boxes (no joints, so no qpos/keyframe
    // impact); default contype/conaffinity collides with ball and duck.
    const ht = 0.05 / 2, hh = 0.25 / 2;
    // Per-axis wall offsets (centre distance from origin) and spans (wall
    // half-length incl. the 0.05 m corner overlap). Both axes collapse to
    // the original ARENA_HALF values for the square sandbox, so the default
    // (closed) branch emits byte-identical geoms to the pre-parameterised
    // version.
    const offX = halfX + ht, offY = halfY + ht;
    const spanX = halfX + 0.05, spanY = halfY + 0.05;
    let wallDefs;
    if (walls === "goal-openings") {
      // End walls (+-X) each split into two segments leaving a GOAL_WIDTH
      // mouth centred on y = 0; side walls (+-Y) stay full length.
      const goalHalf = GOAL_WIDTH / 2;
      const segHalf = (spanY - goalHalf) / 2;
      const segC = goalHalf + segHalf;
      wallDefs = [];
      for (const sx of [1, -1]) {
        for (const sy of [1, -1]) {
          wallDefs.push({
            name: `wall_${sx > 0 ? "p" : "n"}x_${sy > 0 ? "p" : "n"}y`,
            pos: `${sx * offX} ${sy * segC} ${hh}`,
            size: `${ht} ${segHalf} ${hh}`,
          });
        }
      }
      wallDefs.push(
        { name: "wall_py", pos: `0 ${offY} ${hh}`, size: `${spanX} ${ht} ${hh}` },
        { name: "wall_ny", pos: `0 ${-offY} ${hh}`, size: `${spanX} ${ht} ${hh}` },
      );
    } else {
      wallDefs = [
        { name: "wall_px", pos: `${offX} 0 ${hh}`, size: `${ht} ${spanY} ${hh}` },
        { name: "wall_nx", pos: `${-offX} 0 ${hh}`, size: `${ht} ${spanY} ${hh}` },
        { name: "wall_py", pos: `0 ${offY} ${hh}`, size: `${spanX} ${ht} ${hh}` },
        { name: "wall_ny", pos: `0 ${-offY} ${hh}`, size: `${spanX} ${ht} ${hh}` },
      ];
    }
    for (const w of wallDefs) {
      doc.querySelector("worldbody").appendChild(
        el("geom", { name: w.name, type: "box", pos: w.pos, size: w.size }),
      );
    }
    // Goal cages (goal-openings only): solid post / crossbar / net geoms just
    // behind each mouth so a ball that crosses the line is trapped. Honours
    // injected descriptors when supplied, else derives both goals locally.
    if (walls === "goal-openings") {
      const geoms = goalGeoms.length
        ? goalGeoms
        : [...getGoalCollisionGeoms("red"), ...getGoalCollisionGeoms("blue")];
      for (const g of geoms) {
        const attrs = { name: g.name, type: g.type, pos: g.pos, size: g.size };
        if (g.euler) attrs.euler = g.euler;
        doc.querySelector("worldbody").appendChild(el("geom", attrs));
      }
    }
    // Prop library colliders: one static box per enabled prop
    // (declared in props.js next to the visual placement, optionally
    // yawed via euler to match off-axis staging) so the duck and ball
    // can't clip through the dressing. Skipped on the football pitch.
    if (props) {
      for (const c of propColliders()) {
        const attrs = { name: c.name, type: "box", pos: c.pos, size: c.size };
        if (c.euler) attrs.euler = c.euler;
        doc.querySelector("worldbody").appendChild(el("geom", attrs));
      }
    }
    // Kickable ball: a light free sphere (beach-ball feel). MuJoCo has no
    // restitution parameter - the bounce comes from solref damping < 1, and
    // the rolling-friction term makes it come to rest. Appended AFTER the
    // robot body so the trunk freejoint stays first in qpos.
    const ballBody = el("body", { name: "ball", pos: ballPark });
    ballBody.appendChild(el("freejoint", { name: "ball_freejoint" }));
    // condim 6 enables the torsional + rolling friction components; with
    // the default condim 3 a rolling ball never decelerates.
    ballBody.appendChild(el("geom", {
      name: "ball_geom", type: "sphere", size: String(BALL_RADIUS),
      mass: "0.03", friction: "0.4 0.01 0.003", solref: "0.03 0.4", condim: "6",
    }));
    doc.querySelector("worldbody").appendChild(ballBody);
    // Relief terraces: one kinematically driven box per raisable grid
    // cell, on a vertical slide joint (qpos written directly each control
    // step, like the ball). q = 0 parks the box fully below the floor;
    // q = h + RELIEF_EPS puts its top exactly at h. Appended after the
    // ball so the keyframe layout stays robot + ball + relief.
    // Relief heightfield: a static hfield over the whole arena, elevation
    // data filled at runtime from the shared analytic bump function (see
    // driveRelief). It compiles flat (no file/elevation = zeros) and has
    // no joints, so qpos and the keyframe are untouched. The geom sits
    // RELIEF_SINK below the floor so a near-zero z-size is fully buried;
    // raising the terrain = scaling model.hfield_size z at runtime. The
    // football pitch plays flat, so relief === false skips it entirely.
    if (relief) {
      doc.querySelector("asset").appendChild(el("hfield", {
        name: "terrain", nrow: String(RELIEF_GRID), ncol: String(RELIEF_GRID),
        size: `${halfX} ${halfY} ${RELIEF_HMAX} 0.1`,
      }));
      doc.querySelector("worldbody").appendChild(el("geom", {
        name: "terrain", type: "hfield", hfield: "terrain",
        pos: `0 0 ${-RELIEF_SINK}`,
      }));
    }
    // ── Multi-duck injection (football mode) ───────────────────────────
    // Six robots share one MJCF: clone the (already visual-stripped)
    // trunk_base body and prefix every model-internal name reference so the
    // copies don't collide. Shared resources (class/childclass/mesh/
    // material/file) are deliberately NOT prefixed. The original body and
    // the original sensor/actuator sections are removed and re-injected once
    // per duck, in order, so qpos/ctrl/sensordata lay out as duck0, duck1,
    // ..., duck5, ball. Skipped entirely for the single-duck sandbox.
    const multiDuck = duckConfigs.length > 1;
    if (multiDuck) {
      const worldbody = doc.querySelector("worldbody");
      const origBody = worldbody.querySelector('body[name="trunk_base"]');
      const ballBodyEl = worldbody.querySelector('body[name="ball"]');
      const origClone = origBody.cloneNode(true);
      origBody.remove();
      const PREFIX_ATTRS = ["name", "site", "body", "objname", "joint",
        "body1", "body2", "target", "tendon", "refsite"];
      const prefixSubtree = (node, prefix) => {
        for (const attr of PREFIX_ATTRS) {
          const val = node.getAttribute?.(attr);
          // Guard on '/' so an already-prefixed name is never doubled.
          if (val && !val.includes("/")) node.setAttribute(attr, prefix + val);
        }
        for (const child of node.children) prefixSubtree(child, prefix);
      };
      const sensorParent = doc.querySelector("sensor");
      const actuatorParent = doc.querySelector("actuator");
      const origSensors = sensorParent ? [...sensorParent.children].map((s) => s.cloneNode(true)) : [];
      const origActuators = actuatorParent ? [...actuatorParent.children].map((a) => a.cloneNode(true)) : [];
      while (sensorParent && sensorParent.firstChild) sensorParent.removeChild(sensorParent.firstChild);
      while (actuatorParent && actuatorParent.firstChild) actuatorParent.removeChild(actuatorParent.firstChild);
      for (const dc of duckConfigs) {
        const bodyClone = origClone.cloneNode(true);
        prefixSubtree(bodyClone, dc.prefix);
        worldbody.insertBefore(bodyClone, ballBodyEl);
        if (sensorParent) for (const s of origSensors) {
          const sc = s.cloneNode(true); prefixSubtree(sc, dc.prefix); sensorParent.appendChild(sc);
        }
        if (actuatorParent) for (const a of origActuators) {
          const ac = a.cloneNode(true); prefixSubtree(ac, dc.prefix); actuatorParent.appendChild(ac);
        }
      }
    }
    // STAND keyframe. qpos must cover every joint in document order and ctrl
    // every actuator. Sandbox: the single trunk freejoint (7) + 14 hinges +
    // ball freejoint (7), parked 50 m away. Football: per duck a freejoint
    // (spawn pose, yaw -> quat) + its 14 hinges, then the ball at the centre
    // spot; ctrl is six blocks of DEFAULT_POSE.
    const poseByName = new Map(JOINT_NAMES.map((n, i) => [n, DEFAULT_POSE[i]]));
    const pose14 = Array.from(DEFAULT_POSE).join(" ");
    const kf = doc.createElement("keyframe");
    if (multiDuck) {
      const qposParts = [];
      const ctrlParts = [];
      for (const dc of duckConfigs) {
        const [sx, sy, sz] = dc.spawn;
        const yaw = dc.yaw ?? 0;
        const qw = Math.cos(yaw / 2), qz = Math.sin(yaw / 2);
        qposParts.push(`${sx} ${sy} ${sz} ${qw} 0 0 ${qz}`);
        const duckBody = doc.querySelector(`body[name="${dc.prefix}trunk_base"]`);
        // Hinge qpos in document order (= MuJoCo qpos order), value by bare
        // name so a prefixed joint still resolves to its DEFAULT_POSE slot.
        const hinges = [...duckBody.querySelectorAll("joint")]
          .map((j) => poseByName.get(j.getAttribute("name").split("/").pop()) ?? 0)
          .join(" ");
        qposParts.push(hinges);
        ctrlParts.push(pose14);
      }
      qposParts.push(`${ballPark} 1 0 0 0`);
      kf.appendChild(el("key", {
        name: "STAND",
        qpos: qposParts.join(" "),
        ctrl: ctrlParts.join(" "),
      }));
    } else {
      const qposFree = `${SPAWN_X} ${SPAWN_Y} 0.12 1 0 0 0`;
      const qposJoints = [...doc.querySelectorAll("body > joint")]
        .map((j) => poseByName.get(j.getAttribute("name")) ?? 0)
        .join(" ");
      kf.appendChild(el("key", {
        name: "STAND",
        qpos: `${qposFree} ${qposJoints} ${BALL_PARK_POS} 1 0 0 0`,
        ctrl: pose14,
      }));
    }
    root.appendChild(kf);
    const meshFiles = [...doc.querySelectorAll("asset > mesh")].map((m) => m.getAttribute("file"));
    return { xml: new XMLSerializer().serializeToString(doc), meshFiles };
  }

  // ── Boot physics + policy in parallel with the render rig ────────────
  const [mujoco, { xml, meshFiles }, k] = await Promise.all([
    traced("MUJOCO WASM", loadMujocoFactory({
      // Emscripten sidecar resolution: point at the Vite-emitted asset
      // instead of a path relative to the module's own URL.
      locateFile: (p) => (p.endsWith(".wasm") ? mujocoWasmUrl : p),
    })),
    traced("PHYSICS MJCF", buildPhysicsXml("robot_allcollisions.xml", {
      ...matchConfig.field,
      ducks: matchConfig.ducks,
      ballPark: matchConfig.ball.parkPos,
    })),
    traced("KINEMATICS", loadKinematics(`${MODEL_DIR}/kinematics.json`)),
  ]);

  const doneMeshes = bootLine("MESH ASSETS");
  const vfs = new mujoco.MjVFS();
  // One shared VFS for both variants; already-loaded files are skipped so
  // the roller lazy-load only fetches its leftover meshes.
  const vfsFiles = new Set();
  async function addMeshesToVfs(files) {
    const geoms = await loadGlbGeometries();
    await Promise.all(
      files.map(async (f) => {
        if (vfsFiles.has(f)) return;
        vfsFiles.add(f);
        // Legs/body meshes live in the visual GLB: rebuild binary STL in
        // memory so MuJoCo never triggers a second download. Roller-only
        // files (not in the GLB) still fetch as STL.
        const entry = geoms.get(f);
        const buf = entry
          ? geometryToBinaryStl(entry.welded)
          : await (await fetch(signed(`${MODEL_DIR}/meshes/${f}?v=${MESH_VERSION}`), { cache: "force-cache" })).arrayBuffer();
        // meshdir="assets" in the MJCF, so the compiler looks up "assets/<f>".
        vfs.addBuffer(`assets/${f}`, new Uint8Array(buf));
      }),
    );
  }
  try {
    await addMeshesToVfs(meshFiles);
  } catch (err) {
    doneMeshes("FAILED");
    bootHalt(err?.message || String(err));
    throw err;
  }
  doneMeshes(`${meshFiles.length} FILES`);

  const sessions = {};
  // Always boot on the classic (orange) colourway; the quickbar re-skins live.
  let currentVariant = DEFAULT_VARIANT;
  const rigPromise = (async () => {
    const doneRig = bootLine("RENDER RIG");
    try {
      const builtRig = await buildRig(k, { materialForMesh: materialHookFor(VARIANTS[currentVariant]) });
      doneRig("OK");
      return builtRig;
    } catch (err) {
      doneRig("FAILED");
      bootHalt(err?.message || String(err));
      throw err;
    }
  })();
  // Boot policies with a live [n/7] counter on the BIOS line.
  const donePolicies = bootLine("LOADING POLICIES");
  const sessionOpts = { executionProviders: ["wasm"] };
  let policiesLoaded = 0;
  const bootPolicy = (url) =>
    ort.InferenceSession.create(signed(url), sessionOpts).then((s) => {
      donePolicies.progress(`${++policiesLoaded}/7`);
      return s;
    });
  try {
    [sessions.walk, sessions.sitstand, sessions.roll, sessions.kickL, sessions.kickR,
     sessions.groundpick, sessions.stand] =
      await Promise.all([
        bootPolicy(POLICIES.walk),
        bootPolicy(POLICIES.sitstand),
        bootPolicy(POLICIES.roll),
        bootPolicy(POLICIES.kickL),
        bootPolicy(POLICIES.kickR),
        bootPolicy(POLICIES.groundpick),
        bootPolicy(POLICIES.stand),
      ]);
  } catch (err) {
    donePolicies("FAILED");
    bootHalt(err?.message || String(err));
    throw err;
  }
  donePolicies("7/7");

  const doneCompile = bootLine("COMPILING PHYSICS");
  let model, data;
  try {
    model = mujoco.MjModel.from_xml_string(xml, vfs);
    data = new mujoco.MjData(model);
  } catch (err) {
    doneCompile("FAILED");
    bootHalt(err?.message || String(err));
    throw err;
  }
  doneCompile("COMPILED");

  // Addresses resolved once per compiled variant. qpos/qvel/sensordata
  // views are re-read at each use: the WASM heap can grow and detach
  // earlier TypedArray views.
  const JOINT_SET = new Set(JOINT_NAMES);
  // Resolve one duck's physics addresses. prefix is '' for the sandbox duck
  // and 'd0/'...'d5/' in football, applied to every per-duck name lookup so
  // the six prefixed copies resolve independently. Global singletons (the
  // STAND keyframe, the ball freejoint) carry no prefix.
  function resolveAddrs(model, kin, prefix = "") {
    return {
      qposAdr: JOINT_NAMES.map((n) => model.jnt(prefix + n).qposadr),
      dofAdr: JOINT_NAMES.map((n) => model.jnt(prefix + n).dofadr),
      // Trunk freejoint (7 qpos / 6 dof): the duck's world pose, used to
      // cache positions for the AI and to reset a single fallen duck.
      freejointQposAdr: model.jnt(prefix + "trunk_base_freejoint").qposadr,
      freejointDofAdr: model.jnt(prefix + "trunk_base_freejoint").dofadr,
      gyroAdr: model.sensor(prefix + "imu_ang_vel").adr,
      trunkId: mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY.value, prefix + "trunk_base"),
      standKeyId: mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_KEY.value, "STAND"),
      ballQposAdr: model.jnt("ball_freejoint").qposadr,
      ballDofAdr: model.jnt("ball_freejoint").dofadr,
      // Foot bodies for the footstep audio heuristic (-1 when a variant
      // has no ankles, e.g. if a future model renames them).
      ankleIds: ["ankle_left", "ankle_right"].map(
        (n) => mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY.value, prefix + n)),
      // Unactuated hinges (the roller variant's 4 passive wheels): not in
      // the obs or ctrl, but synced to the render rig so the wheels spin.
      extraJoints: kin.bodies
        .filter((b) => b.joint && b.joint.type === "hinge" && !JOINT_SET.has(b.joint.name))
        .map((b) => ({ name: b.joint.name, adr: model.jnt(prefix + b.joint.name).qposadr })),
    };
  }

  // ── Per-duck instances + addresses ───────────────────────────────────
  // Football compiles N prefixed ducks into one model; sandbox has a single
  // duck with an empty prefix. Each duck resolves its own qpos / dof /
  // sensor / body addresses and gets a ctrl block offset (i * NUM_JOINTS).
  const ducks = matchConfig.ducks.map((dc, i) => {
    const addrs = resolveAddrs(model, k, dc.prefix);
    addrs.ctrlOffset = i * NUM_JOINTS;
    return createDuckInstance(i, dc, addrs, null); // rig wired at scene assembly
  });
  // Active-variant address block, swapped wholesale by activateLoco. In
  // sandbox mode there is exactly one duck with an empty prefix, so this is
  // byte-identical to the old single resolveAddrs(model, k) call.
  let { qposAdr, dofAdr, gyroAdr, trunkId, standKeyId, ballQposAdr, ballDofAdr, extraJoints,
    ankleIds } = ducks[0].addrs;

  // Model-shape sanity: football = N ducks x 21 qpos + 7 ball, N x 14 ctrl;
  // sandbox stays 28 / 14. A mismatch means the MJCF injection drifted.
  if (isFootball) {
    console.assert(model.nq === ducks.length * 21 + 7,
      `[football] unexpected nq ${model.nq} (want ${ducks.length * 21 + 7})`);
    console.assert(model.nu === ducks.length * NUM_JOINTS,
      `[football] unexpected nu ${model.nu} (want ${ducks.length * NUM_JOINTS})`);
  }

  // ── Football AI agents (10 Hz tactical layer) ────────────────────────
  // One role-specific agent per duck; decide() reads a plain game-state
  // snapshot and writes a locomotion twist (+ occasional kick) onto the duck.
  if (matchConfig.ai) {
    for (const duck of ducks) {
      const s = activeSpawns[duck.id] || SPAWN_POSITIONS[duck.id];
      duck.agent = createAgent(duck, {
        team: duck.team, role: duck.role, spawnX: s.x, spawnY: s.y,
      });
    }
  }

  // Locomotion variants stay resident once built (model + data + rig +
  // addresses); legs is registered when its render rig resolves below.
  const locos = {};
  let loco = "legs"; // "legs" | "rollers"
  const velLims = () => (loco === "rollers"
    ? [RVEL_FWD, RVEL_BACK, RVEL_ANG]
    : [VEL_FWD, VEL_BACK, VEL_ANG]);

  const lastAction = new Float32Array(NUM_JOINTS);
  const obs = new Float32Array(OBS_SIZE);
  const cmd = new Float32Array(CMD_SIZE); // [vx, vy, wz, head(4), body(6)]
  // Input controller: keyboard + gamepad + touch sources merged into one
  // continuous command + discrete action surface, in priority order.
  const kbSource = new KeyboardSource({ getVelocityLimits: () => velLims() });
  const padSource = new GamepadSource({ getVelocityLimits: () => velLims() });
  const touchSource = new TouchSource({ getVelocityLimits: () => velLims() });
  // Click-to-walk (PLAN.md Project 1 Phase A): reads zero until a floor
  // click arms a target, so - like the keyboard before it - it doubles as
  // the fallback. Any keyboard/pad/touch input preempts it by arbitration
  // order alone; getManualOverride also cancels the pending target outright
  // so releasing manual input doesn't snap the duck back onto a stale click.
  const waypointSource = new WaypointSource({
    camera, renderer,
    getVelocityLimits: () => velLims(),
    getDuckPose: () => {
      const qpos = data.qpos;
      return [qpos[0], qpos[1], duckYaw(qpos)];
    },
    isSuppressed: () => inputLocked || headMode || mode !== "walk" || !!grab,
    getManualOverride: () => padSource.isActive() || touchSource.isActive() || kbSource.isActive(),
  });
  // Keyboard, pad and touch preempt by priority; waypoint is the fallback.
  const controller = new Controller({ sources: [padSource, touchSource, kbSource, waypointSource] });
  // Right-stick camera state, read by the telemetry before the camera-orbit
  // section below has evaluated.
  let padOrbitLive = false;
  // Robot input gate: twist commands, mode changes, rolls, kicks and ball
  // spawns all stay inert until the entrance sequence has fully played out.
  let inputLocked = true;
  let ceremony = null;
  let ball = null;
  let stickers = null; // comic popups (football: enabled; sandbox: disabled)
  // ── Football: referee integration state ──
  let referee = null;
  let celebration = null;
  let matchStats = isFootball ? createMatchStats() : null;
  let prevBallX = 0, prevBallY = 0;
  let matchStoreTick = 0;

  let mode = "walk"; // "walk" | "sitstand" | "roll" | "kickL" | "kickR" | "crouch" | "groundpick"
  let sitFlag = 0;
  const isKick = () => mode === "kickL" || mode === "kickR";

  // HEAD mode (runtime-faithful, pad Y): locomotion is zeroed and both
  // sticks drive the head command slots cmd[3..6] = [neck_pitch,
  // head_pitch, head_yaw, head_roll]. Targets are stick * HEAD_MAX,
  // EMA-smoothed at 50 Hz in buildObs like the runtime (alpha 0.2).
  // Offsets PERSIST when leaving head mode; only a sim reset zeroes them.
  let headMode = false;
  const HEAD_MAX = 2.5; // rad at full deflection (runtime head_max)
  const HEAD_ALPHA = 0.2;
  // Stick-to-joint polarity (deflections come in up/left = +1), tuned
  // visually in the sim: cmd + means UP for neck_pitch but DOWN for
  // head_pitch, LEFT for head_yaw but RIGHT-tilt for head_roll - hence
  // the mixed signs, so stick up = look up, stick left = turn/tilt left.
  // Order matches cmd[3..6] = [neck_pitch, head_pitch, head_yaw, head_roll].
  const HEAD_SIGNS = new Float32Array([1, -1, 1, -1]);
  const headTarget = new Float32Array(4);
  const headSmooth = new Float32Array(4);
  // Local-only kickable ball: false while parked at the keyframe spot
  // (mesh hidden), true once popped in front of the duck.
  let ballActive = false;

  // The twist the policy actually receives. Mid-roll every movement input
  // is ignored (zero twist) until the roll hands back to walk on its own.
  // HEAD mode also zeroes it: the runtime stops the robot while the
  // sticks drive the head.
  const ZERO_CMD = new Float32Array(3);
  function effectiveCmd() {
    if (inputLocked || headMode || mode === "roll" || mode === "crouch" ||
        mode === "groundpick" || isKick() || postKickLock > 0 || recovery)
      return ZERO_CMD;
    return controller.getCommand();
  }
  let rollRun = null;
  let crouchRun = null;
  let pickRun = null;
  let kickRun = null;
  let KICK_STEPS = 25;
  // Post-kick grace: keep commands zeroed for a beat after the kick window
  // hands back to walk. Step-counted like everything else.
  const POST_KICK_LOCK_STEPS = 20; // 0.4 s at 50 Hz
  let postKickLock = 0;

  // Pending mode-transition timers (sit hand-over, stand-up hand-back).
  let sitTimer = null;
  let standTimer = null;
  let fallenSince = null;

  // ── Automatic fall recovery (legs walk mode only) ────────────────────
  // Mirrors the runtime's --fall-detect state machine (main.rs ~3658):
  // a debounced tip (gz > -0.5 for 0.2 s) freezes ctrl on the current
  // pose for a short settle (the runtime goes limp), then hands the duck
  // to the stand policy with all commands zeroed until it's been upright
  // (gz < -0.85) for a full second. If it can't get up within 6 s, fall
  // back to the old kill: resetSim + materialization. Rollers keep the
  // plain kill (the runtime declares fall-detect roller-incompatible),
  // and so do sit/roll/kick/crouch/groundpick and the entrance lock.
  const FALL_DEBOUNCE_STEPS = 10; // 0.2 s of gz > -0.5 before triggering
  const FALL_SETTLE_STEPS = 15; // 0.3 s ctrl freeze once triggered
  const RECOVER_UPRIGHT_STEPS = 50; // 1 s of gz < -0.85 to declare recovered
  const RECOVER_GIVEUP_STEPS = 300; // 6 s of stand attempts before reset
  let recovery = null; // null | { state: "fallen"|"recovering", steps, uprightSteps }
  let fallDebounce = 0;

  function clearModeTimers() {
    clearTimeout(sitTimer); sitTimer = null;
    clearTimeout(standTimer); standTimer = null;
  }

  // ── Mouse grab, physics side (MuJoCo-viewer-style perturbation) ───────
  // While a grab is live, EVERY PHYSICS SUBSTEP writes a spring-damper
  // force on the grabbed free body via xfrc_applied (world frame),
  // pulling it toward the cursor target. Formula and gains mirror the
  // native viewer's mjv_applyPerturbForce (engine_vis_interact.c):
  //   F = -stiffness*mass*(pos - ref) - sqrt(stiffness)*mass*vel
  // with stiffness = m->vis.map.stiffness default (100) and the damping
  // coefficient sqrt(stiffness) exactly as MuJoCo computes it. Two
  // deliberate departures: mass is the subtree mass instead of the
  // Jacobian-derived localmass (equivalent for a free body pulled at its
  // root, and the bindings expose no mj_jac), and the force acts
  // torque-free at the freejoint origin instead of at the picked point
  // (the viewer adds moment_arm x F; skipping it avoids spinning the duck
  // the walking policy would then fight). The early per-CONTROL-step
  // version of this (50 Hz zero-order hold, damping on 4-substep-stale
  // velocity) was the jitter the user felt: a stiff spring held over 20 ms
  // limit-cycles. Per-substep application is what the viewer does.
  // Pointer wiring (raycast pick, target plane, cursor) lives after the
  // camera section below; this block stays above resetSim so the control
  // loop and resets can reference it during boot.
  const GRAB_STIFFNESS = 100; // MuJoCo vis.map.stiffness default
  const GRAB_DAMPING = Math.sqrt(GRAB_STIFFNESS); // viewer's damping coefficient
  const GRAB_MAX_ACC = 200; // safety clamp only - the viewer has none
  let grab = null; // { bodyId, qAdr, dofAdr, mass, target: [x,y,z] MJCF }
  let endGrabHook = () => {}; // reassigned by the pointer wiring
  function applyGrabForce() {
    if (!grab) return;
    const qpos = data.qpos, qvel = data.qvel;
    let fx = GRAB_STIFFNESS * (grab.target[0] - qpos[grab.qAdr]) - GRAB_DAMPING * qvel[grab.dofAdr];
    let fy = GRAB_STIFFNESS * (grab.target[1] - qpos[grab.qAdr + 1]) - GRAB_DAMPING * qvel[grab.dofAdr + 1];
    let fz = GRAB_STIFFNESS * (grab.target[2] - qpos[grab.qAdr + 2]) - GRAB_DAMPING * qvel[grab.dofAdr + 2];
    const n = Math.hypot(fx, fy, fz);
    if (n > GRAB_MAX_ACC) {
      const s = GRAB_MAX_ACC / n;
      fx *= s; fy *= s; fz *= s;
    }
    // Fresh view each call: the WASM heap can grow and detach old ones.
    const xfrc = data.xfrc_applied;
    const a = grab.bodyId * 6;
    xfrc[a] = grab.mass * fx;
    xfrc[a + 1] = grab.mass * fy;
    xfrc[a + 2] = grab.mass * fz;
  }
  function releaseGrabForce() {
    if (!grab) return;
    const xfrc = data.xfrc_applied;
    const a = grab.bodyId * 6;
    xfrc[a] = 0; xfrc[a + 1] = 0; xfrc[a + 2] = 0;
    grab = null;
  }

  function resetSim() {
    // A live grab must not survive a reset: the per-step spring would
    // immediately yank the respawned duck toward the stale cursor target.
    endGrabHook();
    // Single reset path: Space, fall-kill, failed roll, loco switch.
    clearModeTimers();
    rollRun = null;
    kickRun = null;
    crouchRun = null;
    pickRun = null;
    postKickLock = 0;
    fallenSince = null;
    recovery = null;
    fallDebounce = 0;
    mode = "walk";
    // Head mode exits and its offsets DO reset here (the one place).
    headMode = false;
    padSource.headMode = false;
    headTarget.fill(0);
    headSmooth.fill(0);
    mujoco.mj_resetDataKeyframe(model, data, standKeyId);
    mujoco.mj_forward(model, data);
    lastAction.fill(0);
    sitFlag = 0;
    // Park the ball in physics immediately; if it was on screen, the
    // reverse scan peels it away at its last pose. A queued B-respawn is
    // cancelled: a reset means no ball.
    ball?.despawn({ cancelQueued: true, parkPhysics: parkBallPhysics });
    ballActive = false;
    syncButtons();
    // Football: the keyframe reset just put all six ducks back at their
    // spawn poses - restart the match (referee emits 'kickoff' which places
    // ball + ducks correctly via executeKickoff).
    if (isFootball) {
      cacheDuckPoses();
      if (referee) {
        celebration?.cancel();
        referee.startMatch();
      } else if (ball) {
        spawnBallFootball();
      }
      return;
    }
    ceremony?.playRespawn();
  }
  resetSim();

  function parkBallPhysics() {
    const qpos = data.qpos, qvel = data.qvel;
    qpos[ballQposAdr] = 50;
    qpos[ballQposAdr + 1] = 0;
    qpos[ballQposAdr + 2] = BALL_RADIUS;
    qpos[ballQposAdr + 3] = 1;
    qpos[ballQposAdr + 4] = 0;
    qpos[ballQposAdr + 5] = 0;
    qpos[ballQposAdr + 6] = 0;
    for (let i = 0; i < 6; i++) qvel[ballDofAdr + i] = 0;
    mujoco.mj_forward(model, data);
    ballActive = false;
  }

  // Pop / respawn the ball ~0.35 m in front of the duck, with a small
  // random heading + distance jitter. If the ball is already on screen,
  // peel it away first (reverse scan) and pop the new one when that
  // finishes - same appear/disappear pair as the duck's wireframe ceremony.
  function spawnBall(opts = {}) {
    if (inputLocked && !opts.fromQueue) return;
    if (!ball) return;
    if (ball.visual !== "hidden") {
      ball.queueRespawn();
      ball.despawn({ parkPhysics: parkBallPhysics });
      return;
    }
    const qpos = data.qpos, qvel = data.qvel;
    const yaw = Math.atan2(
      2 * (qpos[3] * qpos[6] + qpos[4] * qpos[5]),
      1 - 2 * (qpos[5] * qpos[5] + qpos[6] * qpos[6]),
    );
    const heading = yaw + (Math.random() - 0.5) * 0.7;
    const dist = 0.35 + (Math.random() - 0.5) * 0.1;
    const lim = ARENA_HALF - BALL_RADIUS - 0.05;
    const clamp = (v) => Math.min(lim, Math.max(-lim, v));
    qpos[ballQposAdr] = clamp(qpos[0] + Math.cos(heading) * dist);
    qpos[ballQposAdr + 1] = clamp(qpos[1] + Math.sin(heading) * dist);
    qpos[ballQposAdr + 2] = BALL_RADIUS + 0.02;
    qpos[ballQposAdr + 3] = 1;
    qpos[ballQposAdr + 4] = 0;
    qpos[ballQposAdr + 5] = 0;
    qpos[ballQposAdr + 6] = 0;
    for (let i = 0; i < 6; i++) qvel[ballDofAdr + i] = 0;
    mujoco.mj_forward(model, data);
    ballActive = true;
    // Snap the mesh to the new pose BEFORE the scan starts: the FX
    // recomputes its bbox from the live mesh.
    ball.poseFromQpos(qpos, ballQposAdr);
    ball.appear();
    stickers?.pop("spawn");
  }

  // ── Observation ─────────────────────────────────────────────────────
  const _q = new THREE.Quaternion();
  const _g = new THREE.Vector3();

  function buildObs() {
    const qpos = data.qpos, qvel = data.qvel, sens = data.sensordata;
    let i = 0;
    for (let a = 0; a < 3; a++) obs[i++] = sens[gyroAdr + a];
    // projected gravity: world -z rotated into the trunk frame
    const xq = data.body(trunkId).xquat; // [w, x, y, z]
    _q.set(xq[1], xq[2], xq[3], xq[0]).conjugate();
    _g.set(0, 0, -1).applyQuaternion(_q);
    obs[i++] = _g.x; obs[i++] = _g.y; obs[i++] = _g.z;
    for (let j = 0; j < NUM_JOINTS; j++) obs[i++] = qpos[qposAdr[j]] - DEFAULT_POSE[j];
    for (let j = 0; j < NUM_JOINTS; j++) obs[i++] = qvel[dofAdr[j]];
    for (let j = 0; j < NUM_JOINTS; j++) obs[i++] = lastAction[j];
    // command: walking/drive use the twist; sitstand uses cmd[0] as the
    // posture flag; the crouch-glide one-shot carries its phase encoding in
    // the vel slots (ground-pick convention: [cos, sin, 0]).
    cmd.fill(0, 0, 3);
    if (mode === "sitstand") {
      cmd[0] = sitFlag;
    } else if (mode === "crouch" && crouchRun) {
      const a = 2 * Math.PI * crouchRun.phase;
      cmd[0] = Math.cos(a);
      cmd[1] = Math.sin(a);
    } else if (mode === "groundpick" && pickRun) {
      const a = 2 * Math.PI * pickRun.phase;
      cmd[0] = Math.cos(a);
      cmd[1] = Math.sin(a);
    } else {
      const c = effectiveCmd();
      cmd[0] = c[0]; cmd[1] = c[1]; cmd[2] = c[2];
    }
    // Head slots cmd[3..6]: EMA toward the stick targets at 50 Hz (this
    // runs once per control step), exactly the runtime's smoothing. Kept
    // filled outside head mode too - offsets persist like on the robot.
    for (let h = 0; h < 4; h++) headSmooth[h] += HEAD_ALPHA * (headTarget[h] - headSmooth[h]);
    // Ground pick parity: the runtime zero-pads the head (and body) slots
    // for its obs (mjlab's zero_command_padding), so persisted head
    // offsets must not leak into the pick policy's command buffer. Fall
    // recovery zeroes them too: the stand policy gets an all-zero command.
    const gpZero = mode === "groundpick" || recovery !== null;
    cmd[3] = gpZero ? 0 : headSmooth[0]; cmd[4] = gpZero ? 0 : headSmooth[1];
    cmd[5] = gpZero ? 0 : headSmooth[2]; cmd[6] = gpZero ? 0 : headSmooth[3];
    for (let c = 0; c < CMD_SIZE; c++) obs[i++] = cmd[c];
    return obs;
  }

  // The ONNX session for the current mode: in the roller variant the main
  // velocity mode runs the drive (skating) policy instead of the walker,
  // and the fall-recovery state machine overrides everything with the
  // get-up policy while it owns the duck.
  const activeSession = () => {
    if (recovery?.state === "recovering") return sessions.stand;
    return sessions[loco === "rollers" && mode === "walk" ? "drive" : mode];
  };

  // ── Control loop (50 Hz, async because ONNX inference is async) ──────
  let ctrlHz = 0;

  // Fresh projected-gravity z straight from the trunk pose (buildObs is
  // skipped during the fall-recovery settle, so obs[5] can go stale).
  function projGravZ() {
    const xq = data.body(trunkId).xquat; // [w, x, y, z]
    _q.set(xq[1], xq[2], xq[3], xq[0]).conjugate();
    _g.set(0, 0, -1).applyQuaternion(_q);
    return _g.z;
  }

  // Dead pose: "fallen" = trunk tilted past ~60 deg or sunk below the
  // floor. NaN/Inf is a solver explosion: no grace, reset on the spot.
  // In legs walk mode a debounced fall now goes to the recovery state
  // machine instead of the kill; everywhere else (rollers, sit, one-shots,
  // entrance lock) the old grace-then-reset behavior stands.
  function poseIsDead() {
    const z = data.qpos[2];
    const gz = projGravZ();
    if (!Number.isFinite(z) || !Number.isFinite(gz)) return "exploded";
    if (gz > -0.5 || z < 0.02) return "fallen";
    return null;
  }

  // ── Sim-driven audio (footsteps / roller rumble / ball impacts) ──────
  // Footsteps use a per-foot height heuristic instead of MuJoCo contacts
  // (the WASM bindings expose no contact array): each ankle's height
  // RELATIVE to the lower ankle (the planted foot approximates the local
  // ground, so the measure self-calibrates on the relief terrain), with
  // lift/contact hysteresis and a per-foot debounce. Tap gain scales with
  // the landing speed. Rollers get a speed-following rumble loop instead,
  // and the ball thumps on velocity deltas between control steps.
  const STEP_LIFT = 0.012; // m above the planted foot = foot in swing
  const STEP_CONTACT = 0.005; // m: dropping below this while in swing = step
  const STEP_DEBOUNCE_MS = 130;
  const stepFeet = [
    { air: false, prevZ: 0, lastAt: 0 },
    { air: false, prevZ: 0, lastAt: 0 },
  ];
  const duckEmitter = createEmitter({ refDistance: 0.5 });
  const ballEmitter = createEmitter({ refDistance: 0.5 });
  const ballPrevV = [0, 0, 0];
  let ballPrevValid = false;
  let ballThumpAt = 0;
  // Body bumps: trunk velocity deltas gated on obstacle proximity (walls
  // or prop collider footprints) so the walking gait's own accelerations
  // (comparable in magnitude to a slow wall hit) never false-trigger.
  // Duller than the ball thumps: same samples pitched way down.
  const BUMP_DV = 0.35; // m/s per control step
  const BUMP_DEBOUNCE_MS = 300; // rubbing a wall must not machine-gun
  const BUMP_WALL_PAD = 0.16; // trunk half-width-ish reach to a wall
  const bumpZones = propColliders().map((c) => {
    const [px, py] = c.pos.split(" ").map(Number);
    const [sx, sy] = c.size.split(" ").map(Number);
    return { x: px, y: py, r: Math.hypot(sx, sy) + 0.14 };
  });
  const bumpPrevV = [0, 0, 0];
  let bumpPrevValid = false;
  let bumpAt = 0;
  function nearObstacle(x, y) {
    if (Math.max(Math.abs(x), Math.abs(y)) > ARENA_HALF - BUMP_WALL_PAD) return true;
    for (const z of bumpZones) {
      if (Math.hypot(x - z.x, y - z.y) < z.r) return true;
    }
    return false;
  }

  function stepAudioSim() {
    const now = performance.now();
    if (loco === "legs" && !inputLocked && ankleIds[0] >= 0 && ankleIds[1] >= 0) {
      const xpos = data.xpos;
      const zL = xpos[ankleIds[0] * 3 + 2];
      const zR = xpos[ankleIds[1] * 3 + 2];
      const ground = Math.min(zL, zR);
      for (let i = 0; i < 2; i++) {
        const f = stepFeet[i];
        const z = i === 0 ? zL : zR;
        const rel = z - ground;
        const vz = (z - f.prevZ) / CTRL_DT;
        f.prevZ = z;
        if (rel > STEP_LIFT) {
          f.air = true;
        } else if (f.air && rel < STEP_CONTACT && vz < -0.02 &&
                   now - f.lastAt > STEP_DEBOUNCE_MS) {
          f.air = false;
          f.lastAt = now;
          const u = Math.min(1, Math.abs(vz) / 0.35);
          playSfx("step", {
            gain: 0.12 + 0.14 * u,
            rate: 0.9 + Math.random() * 0.25,
            out: duckEmitter.node,
          });
        }
      }
    }
    // Roller rumble: gain and slight pitch follow ground speed - and the
    // pad's haptic bed mirrors it (texture on the weak motor).
    const speed = Math.hypot(data.qvel[0], data.qvel[1]);
    const rollLevel = loco === "rollers" && !inputLocked ? Math.min(1, speed / 0.5) : 0;
    setRumble(rollLevel, duckEmitter);
    haptics.setBed(rollLevel);
    // Body bumps: trunk |dv| against a nearby wall/prop. The proximity
    // gate keeps gait/kick jerks (which rival slow wall hits) silent.
    if (!inputLocked) {
      const v = data.qvel;
      if (bumpPrevValid) {
        const dv = Math.hypot(v[0] - bumpPrevV[0], v[1] - bumpPrevV[1], v[2] - bumpPrevV[2]);
        if (dv > BUMP_DV && now - bumpAt > BUMP_DEBOUNCE_MS &&
            nearObstacle(data.qpos[0], data.qpos[1])) {
          bumpAt = now;
          const u = Math.min(1, (dv - BUMP_DV) / 1.5);
          playSfx("thump", {
            gain: 0.12 + 0.3 * u,
            rate: 0.55 + 0.15 * u + Math.random() * 0.06, // way below the ball's range
            out: duckEmitter.node,
          });
          haptics.pulse("bump", 0.5 + 0.5 * u); // shove felt in the hands
        }
      }
      bumpPrevV[0] = v[0]; bumpPrevV[1] = v[1]; bumpPrevV[2] = v[2];
      bumpPrevValid = true;
    } else {
      bumpPrevValid = false;
    }
    // Ball impacts: |dv| between control steps. Gravity alone accounts for
    // ~0.2 m/s per 20 ms step; the 0.5 threshold clears it and rolling noise.
    if (ballActive) {
      const v = data.qvel;
      const b = ballDofAdr;
      if (ballPrevValid) {
        const dv = Math.hypot(
          v[b] - ballPrevV[0], v[b + 1] - ballPrevV[1], v[b + 2] - ballPrevV[2]);
        if (dv > 0.5 && now - ballThumpAt > 90) {
          ballThumpAt = now;
          const u = Math.min(1, (dv - 0.5) / 3.5); // full at kick-grade hits
          playSfx("thump", {
            gain: 0.14 + 0.4 * u,
            rate: 1.25 - 0.45 * u + Math.random() * 0.08,
            out: ballEmitter.node,
          });
          // Haptics only when the duck plausibly caused/received the hit:
          // a far bounce off a wall shouldn't shake the hands.
          const bq = ballQposAdr;
          const dBall = Math.hypot(
            data.qpos[bq] - data.qpos[0], data.qpos[bq + 1] - data.qpos[1]);
          if (dBall < 0.6) haptics.pulse("ballHit", 0.4 + 0.6 * u);
        }
      }
      ballPrevV[0] = v[b]; ballPrevV[1] = v[b + 1]; ballPrevV[2] = v[b + 2];
      ballPrevValid = true;
    } else {
      ballPrevValid = false;
    }
    // Haptic channel scheduler: keeps the roller bed alive between pulses
    // and cuts the motors when it falls silent. 50 Hz, like everything here.
    haptics.tick();
  }

  // ══════════════════════════════════════════════════════════════════
  // ── Football mode (multi-duck) ────────────────────────────────────
  // Everything between this banner and the control-step dispatcher runs
  // ONLY when matchConfig.mode === 'football' (six prefixed ducks in one
  // model, AI-driven). The sandbox path (controlStepSandbox / buildObs /
  // syncRig / frame) is untouched and remains the single-duck code path.
  // ══════════════════════════════════════════════════════════════════

  // Shared ONNX session pool: every duck draws the same walk / kick / stand
  // sessions as the sandbox duck, selected from that duck's own mode. The
  // fall-recovery ladder overrides with the get-up policy while it owns the
  // duck (mirrors activeSession()).
  function sessionFor(duck) {
    if (duck.recovery?.state === "recovering") return sessions.stand;
    return sessions[duck.mode] ?? sessions.walk;
  }

  // Per-duck projected-gravity z (trunk tilt), read from that duck's own
  // trunk body quaternion. Mirrors projGravZ() but addressed per duck.
  function duckProjGravZ(duck) {
    const xq = data.body(duck.addrs.trunkId).xquat; // [w, x, y, z]
    _q.set(xq[1], xq[2], xq[3], xq[0]).conjugate();
    _g.set(0, 0, -1).applyQuaternion(_q);
    return _g.z;
  }

  // Per-duck dead-pose test: "fallen" = trunk tipped past ~60 deg or sunk
  // below the floor; NaN/Inf is a solver explosion (no grace, reset now).
  function duckPoseIsDead(duck) {
    const fj = duck.addrs.freejointQposAdr;
    const z = data.qpos[fj + 2];
    const gz = duckProjGravZ(duck);
    if (!Number.isFinite(z) || !Number.isFinite(gz)) return "exploded";
    if (gz > -0.5 || z < 0.02) return "fallen";
    return null;
  }

  // Build the 61D observation for one duck into its own obsBuf, reading that
  // duck's addresses. Same layout as buildObs(): [ang_vel(3), proj_gravity(3),
  // joint_pos(14), joint_vel(14), last_action(14), command(13)]. The command
  // twist slots are written by the AI layer (runAiDecisions); a kick one-shot
  // zeroes them like the runtime, and head/body slots stay zero (football
  // ducks never enter head mode).
  function buildObsForDuck(duck) {
    const { qposAdr: qa, dofAdr: da, gyroAdr: ga, trunkId: ti } = duck.addrs;
    const buf = duck.obsBuf;
    const q = data.qpos, v = data.qvel, s = data.sensordata;
    let i = 0;
    for (let a = 0; a < 3; a++) buf[i++] = s[ga + a];
    const xq = data.body(ti).xquat;
    _q.set(xq[1], xq[2], xq[3], xq[0]).conjugate();
    _g.set(0, 0, -1).applyQuaternion(_q);
    buf[i++] = _g.x; buf[i++] = _g.y; buf[i++] = _g.z;
    for (let j = 0; j < NUM_JOINTS; j++) buf[i++] = q[qa[j]] - DEFAULT_POSE[j];
    for (let j = 0; j < NUM_JOINTS; j++) buf[i++] = v[da[j]];
    for (let j = 0; j < NUM_JOINTS; j++) buf[i++] = duck.lastAction[j];
    // Feed the smoothed twist (cmdSm, eased toward cmd at 50 Hz) so a 10 Hz
    // decision step never jerks the tracker (Bug B). A kick one-shot is a
    // blind fixed animation: its command slots are zeroed regardless.
    const kicking = duck.mode === "kickL" || duck.mode === "kickR";
    const cs = duck.cmdSm;
    buf[i++] = kicking ? 0 : cs[0];  // vx
    buf[i++] = 0;                    // no strafe: AI writes vx and wz only
    buf[i++] = kicking ? 0 : cs[2];  // wz
    // Head slots stay zero for football: feeding gaze into the walk ONNX
    // (large neck/pitch near the ball) topples chasers, then the pile-up
    // knocks the rest. FPV is a separate eye-cam (heading-led, light ball bias).
    for (let k = 3; k < CMD_SIZE; k++) buf[i++] = 0;
    return buf;
  }

  // Reset ONE duck to its spawn pose (freejoint + hinges) and zero its
  // velocities, leaving the other ducks and the ball untouched. Used by the
  // per-duck fall recovery instead of the whole-model resetSim().
  function resetDuck(duck) {
    const q = data.qpos, v = data.qvel;
    const fj = duck.addrs.freejointQposAdr;
    const dc = matchConfig.ducks[duck.id];
    const [sx, sy, sz] = dc.spawn;
    const yaw = dc.yaw ?? 0;
    const qw = Math.cos(yaw / 2), qz = Math.sin(yaw / 2);
    q[fj] = sx; q[fj + 1] = sy; q[fj + 2] = sz;
    q[fj + 3] = qw; q[fj + 4] = 0; q[fj + 5] = 0; q[fj + 6] = qz;
    for (let j = 0; j < NUM_JOINTS; j++) q[duck.addrs.qposAdr[j]] = DEFAULT_POSE[j];
    const fd = duck.addrs.freejointDofAdr;
    for (let i = 0; i < 6; i++) v[fd + i] = 0;
    for (let j = 0; j < NUM_JOINTS; j++) v[duck.addrs.dofAdr[j]] = 0;
    duck.recovery = null;
    duck.fallDebounce = 0;
    duck.fallenSince = null;
    duck.mode = "walk";
    duck.lastAction.fill(0);
    duck.kickRun = null;
    duck.postKickLock = 0;
    duck.cmd.fill(0);
    duck.cmdSm.fill(0);
    mujoco.mj_forward(model, data);
  }

  // Per-duck state machine: penalty sin-bin countdown, the kick one-shot
  // window, and the fall-recovery ladder (settle -> stand policy -> upright
  // exit or give-up reset). Mirrors the sandbox controlStep tail per duck.
  function updateDuckStateFootball(duck) {
    if (duck.penaltyTimer > 0) duck.penaltyTimer = Math.max(0, duck.penaltyTimer - CTRL_DT);
    // One-shot kick: fixed window, then straight back to walking.
    if ((duck.mode === "kickL" || duck.mode === "kickR") && duck.kickRun) {
      duck.kickRun.steps++;
      if (duck.kickRun.steps >= KICK_STEPS) {
        duck.kickRun = null;
        duck.mode = "walk";
        duck.postKickLock = POST_KICK_LOCK_STEPS;
      }
    }
    if (duck.postKickLock > 0 && duck.mode === "walk") duck.postKickLock--;
    // Fall recovery.
    const death = duckPoseIsDead(duck);
    if (death === "exploded") {
      resetDuck(duck);
    } else if (duck.recovery) {
      duck.recovery.steps++;
      if (duck.recovery.state === "fallen") {
        if (duck.recovery.steps >= FALL_SETTLE_STEPS) {
          duck.recovery = { state: "recovering", steps: 0, uprightSteps: 0 };
          duck.lastAction.fill(0);
        }
      } else {
        duck.recovery.uprightSteps = duckProjGravZ(duck) < -0.85 ? duck.recovery.uprightSteps + 1 : 0;
        if (duck.recovery.uprightSteps >= RECOVER_UPRIGHT_STEPS) {
          duck.recovery = null;
          duck.mode = "walk";
          duck.lastAction.fill(0);
        } else if (duck.recovery.steps >= RECOVER_GIVEUP_STEPS) {
          resetDuck(duck);
        }
      }
    } else if (death === "fallen") {
      if (duck.mode === "walk" && duck.postKickLock === 0) {
        duck.fallenSince = null;
        if (++duck.fallDebounce >= FALL_DEBOUNCE_STEPS) {
          duck.fallDebounce = 0;
          duck.recovery = { state: "fallen", steps: 0 };
          // Soft body thud (same Kenney thump bank as sandbox bumps).
          playSfx("thump", {
            gain: 0.28,
            rate: 0.48 + Math.random() * 0.08,
          });
          haptics.pulse("fall");
        }
      } else {
        duck.fallDebounce = 0;
        const now = performance.now();
        if (duck.fallenSince == null) {
          playSfx("thump", {
            gain: 0.28,
            rate: 0.48 + Math.random() * 0.08,
          });
          haptics.pulse("fall");
        }
        duck.fallenSince ??= now;
        if (now - duck.fallenSince > 1000) resetDuck(duck);
      }
    } else {
      duck.fallDebounce = 0;
      duck.fallenSince = null;
    }
  }

  // Cache each duck's world position + yaw from its freejoint qpos, read by
  // the AI layer (and the Phase 3 referee). Run once per control step after
  // the physics advance so decisions see fresh poses.
  function cacheDuckPoses() {
    const q = data.qpos;
    for (const duck of ducks) {
      const fj = duck.addrs.freejointQposAdr;
      duck.pos[0] = q[fj]; duck.pos[1] = q[fj + 1]; duck.pos[2] = q[fj + 2];
      // Trunk yaw from the freejoint quat (MuJoCo wxyz), Z-up.
      duck.yaw = Math.atan2(
        2 * (q[fj + 3] * q[fj + 6] + q[fj + 4] * q[fj + 5]),
        1 - 2 * (q[fj + 5] * q[fj + 5] + q[fj + 6] * q[fj + 6]),
      );
    }
  }

  // Plain-data snapshot of the match for the AI agents (no engine refs).
  // Coordinates are screened for finiteness: a diverged solver can put
  // +/-Inf or NaN into qpos, and one non-finite value reaching an agent
  // becomes a non-finite twist, then a NaN obs, then NaN ctrl - which
  // destroys the whole model for every duck. Agents see 0 instead; the
  // fall/explode recovery in updateDuckStateFootball still reads qpos
  // directly, so it owns the reset.
  function buildGameState() {
    const q = data.qpos, v = data.qvel;
    const fin = (x) => (Number.isFinite(x) ? x : 0);
    return {
      ball: {
        x: fin(q[ballQposAdr]), y: fin(q[ballQposAdr + 1]), z: fin(q[ballQposAdr + 2]),
        vx: fin(v[ballDofAdr]), vy: fin(v[ballDofAdr + 1]),
      },
      ducks: ducks.map((d) => ({
        id: d.id, team: d.team, role: d.role,
        x: fin(d.pos[0]), y: fin(d.pos[1]), yaw: fin(d.yaw),
        fallen: !!d.recovery,
      })),
      self: null,
    };
  }

  // Tactical layer at AI_HZ (10 Hz): the whole team's ducks are decided
  // together via decideAll() so chaser selection and formation slots see the
  // full picture, then each decision is written back onto its duck as a
  // locomotion twist (and an occasional kick trigger). The 50 Hz inference
  // between ticks just tracks the last command.
  function runAiDecisions() {
    const gs = buildGameState();
    // Group eligible ducks by team. Sin-binned / sent-off ducks are skipped
    // entirely; a duck mid-recovery gets a zero twist (the stand policy owns
    // it) and is kept out of decideAll so it can't be picked as chaser.
    const teams = new Map();
    for (const duck of ducks) {
      if (!duck.agent) continue;
      if (duck.penaltyTimer > 0 || duck.sentOff) continue;
      if (duck.recovery) { duck.cmd[0] = 0; duck.cmd[2] = 0; continue; }
      const arr = teams.get(duck.team);
      if (arr) arr.push(duck); else teams.set(duck.team, [duck]);
    }
    for (const teamDucks of teams.values()) processTeamDecisions(teamDucks, gs);
  }

  // Run decideAll() for one team and write the returned commands back onto the
  // live ducks, applying the same non-finite guard, IDLE_CREEP anti-stall
  // shuffle, sub-threshold vx floor and kick one-shot as the old per-duck path.
  function processTeamDecisions(teamDucks, gs) {
    if (!teamDucks.length) return;
    const fin = (x) => (Number.isFinite(x) ? x : 0);
    // Build the plain views decideAll expects: { id, pos:[x,y], yaw, role,
    // fallen, penalized, team, spawnX, spawnY, _ai }. _ai is persisted on the
    // real duck so the AIM fuse (aimTicks) survives across ticks.
    const views = teamDucks.map((d) => {
      const sp = activeSpawns[d.id] || SPAWN_POSITIONS[d.id] || {};
      if (!d._ai) d._ai = { aimTicks: 0, stallTicks: 0, escapeTicks: 0, prevX: 0, prevY: 0 };
      return {
        id: d.id,
        pos: [fin(d.pos[0]), fin(d.pos[1])],
        yaw: fin(d.yaw),
        role: d.role,
        fallen: !!d.recovery,
        penalized: false,
        team: d.team,
        spawnX: d.agent?.spawnX ?? sp.x,
        spawnY: d.agent?.spawnY ?? sp.y,
        _ai: d._ai,
      };
    });
    const team = teamDucks[0].team;
    const tuneOverlay = getTuneOverlay(strategyByTeam[team] || DEFAULT_STRATEGY);
    const cmds = decideAll(views, {
      ball: gs.ball,
      allDucks: gs.ducks,
      team,
      tuneOverlay,
    });
    for (let i = 0; i < teamDucks.length; i++) {
      const duck = teamDucks[i];
      const c = cmds[i] || { vx: 0, wz: 0, kick: false };
      // A non-finite decision would poison cmdSm -> buildObsForDuck -> ONNX ->
      // ctrl and NaN the shared model, so fall back to a stand-still command.
      const cmdVx = Number.isFinite(c.vx) ? c.vx : 0;
      const cmdWz = Number.isFinite(c.wz) ? c.wz : 0;
      // Sub-threshold floor: a tiny positive vx (e.g. 0.05 from the old
      // AIM_SPEED) sits at/below the referee's IDLE_SPEED_EPS and reads as
      // "stationary" while the duck creeps - raise it to an effective walk.
      let outVx = (cmdVx > 0 && cmdVx < MIN_EFFECTIVE_VX) ? MIN_EFFECTIVE_VX : cmdVx;
      // A commanded stand-still (parked slot / goal line) becomes the gentle
      // IDLE_CREEP shuffle; any real walk/turn command passes through.
      outVx = outVx === 0 ? IDLE_CREEP : outVx;
      duck.cmd[0] = outVx;
      duck.cmd[2] = cmdWz;
      // Keep head command slots zero — do not drive walk-policy gaze.
      duck.cmd[3] = 0; duck.cmd[4] = 0; duck.cmd[5] = 0; duck.cmd[6] = 0;
      if (c.kick && !duck.kickRun && duck.mode === "walk" && duck.postKickLock === 0) {
        // Alternate feet so consecutive kicks don't favour one leg.
        duck.mode = duck._lastKick === "kickL" ? "kickR" : "kickL";
        duck._lastKick = duck.mode;
        duck.kickRun = { steps: 0 };
        // Kick / ball / duck-bump thumps silenced — commentary danmaku cues
        // carry the match energy instead (see playDanmakuCue).
        haptics.pulse("kick");
        // Only goal-aimed strikes (at feet + facing opp goal + attacking half).
        if (matchStats?.tryNoteShot(duck.team, gs.ball, {
          x: Number.isFinite(duck.pos?.[0]) ? duck.pos[0] : 0,
          y: Number.isFinite(duck.pos?.[1]) ? duck.pos[1] : 0,
          yaw: Number.isFinite(duck.yaw) ? duck.yaw : 0,
        })) {
          // Soft event for danmaku commentary (not a referee FSM transition).
          setStore({
            matchEvents: [...useGame.getState().matchEvents.slice(-4),
              { type: "shot", team: duck.team, time: referee?.getMatchTime() ?? 0 }],
          });
        }
      }
    }
  }

  // Position-stagnation watchdog (runs at AI_HZ alongside runAiDecisions).
  // decideAll's cos dead-zone and IDLE_CREEP can still leave a duck physically
  // wedged (e.g. two forwards trapping the ball, or trunk jammed on geometry):
  // the command is non-zero but the pose never changes. Detect the real
  // displacement over consecutive AI ticks and, once stalled long enough,
  // override the twist with a short reverse-and-turn escape manoeuvre.
  function antiStuckCheck() {
    const STALL_EPS = 0.005;     // displacement threshold per AI tick (m) = 0.05 m/s
                                 // at 10Hz, below every AI cruise speed (IDLE_CREEP
                                 // 0.22 / MIN_EFFECTIVE_VX 0.22 / RETURN_SPEED 0.25)
                                 // so a slow-but-moving duck is never misjudged as stuck.
    const STALL_LIMIT = 15;      // consecutive stalled AI ticks -> escape
    const ESCAPE_DURATION = 10;  // escape manoeuvre length in AI ticks
    for (const duck of ducks) {
      // Never fight the recovery / sin-bin / send-off owners, or non-AI ducks.
      if (!duck.agent || duck.recovery || duck.penaltyTimer > 0 || duck.sentOff) continue;
      const px = Number.isFinite(duck.pos[0]) ? duck.pos[0] : 0;
      const py = Number.isFinite(duck.pos[1]) ? duck.pos[1] : 0;
      if (!duck._lastPos) {
        duck._lastPos = { x: px, y: py };
        duck._stallTicks = 0;
        duck._escapeTicks = 0;
        continue;
      }
      // Escape mode: override the AI twist until the manoeuvre budget runs out.
      if (duck._escapeTicks > 0) {
        duck.cmd[0] = -0.25;                             // reverse, above walk dead-zone
        duck.cmd[2] = (duck.id % 2 === 0) ? 0.6 : -0.6;  // alternating turn
        duck._escapeTicks--;
        duck._lastPos = { x: px, y: py };
        continue;
      }
      const dx = px - duck._lastPos.x;
      const dy = py - duck._lastPos.y;
      duck._stallTicks = Math.hypot(dx, dy) < STALL_EPS ? duck._stallTicks + 1 : 0;
      duck._lastPos = { x: px, y: py };
      if (duck._stallTicks >= STALL_LIMIT) {
        duck._escapeTicks = ESCAPE_DURATION;
        // Per-id negative seed de-synchronises the flock: ducks start together and
        // accumulate stallTicks in lock-step, so without this they would all fire the
        // escape manoeuvre on the same tick and fall over as a group. id=0 can re-trigger
        // immediately, id=1 waits ~0.5s more, id=2 ~1s more, etc.
        duck._stallTicks = -(duck.id * 5);
      }
    }
  }

  // Place the ball at the centre spot and pop its visual. Football has no
  // "in front of the duck" spawn; the Phase 3 referee owns placement later.
  function spawnBallFootball() {
    if (!ball) return;
    const q = data.qpos, v = data.qvel;
    q[ballQposAdr] = BALL_SPAWN[0];
    q[ballQposAdr + 1] = BALL_SPAWN[1];
    q[ballQposAdr + 2] = BALL_SPAWN[2];
    q[ballQposAdr + 3] = 1; q[ballQposAdr + 4] = 0; q[ballQposAdr + 5] = 0; q[ballQposAdr + 6] = 0;
    for (let i = 0; i < 6; i++) v[ballDofAdr + i] = 0;
    mujoco.mj_forward(model, data);
    ballActive = true;
    ball.poseFromQpos(q, ballQposAdr);
    ball.appear();
  }

  // ── Football: referee integration ──────────────────────────────────────
  // Transform buildGameState() into the format referee.step() expects:
  // { ball: { pos: [x,y,z] }, ducks: [{ id, team, pos: [x,y,z], fallen }] }
  function buildRefereeState() {
    const q = data.qpos;
    return {
      ball: { pos: [q[ballQposAdr], q[ballQposAdr + 1], q[ballQposAdr + 2]] },
      ducks: ducks
        // Sin-binned / sent-off ducks are parked off-field with their motors
        // frozen, so they inevitably topple. Reporting that topple as `fallen`
        // makes the referee re-violate them every FALLEN_TIMEOUT_S: the sin-bin
        // is renewed (so penalty_returned never fires) and warnings stack into
        // a red card - the cascade that leaves a whole team as permanent black
        // ducks (Bug D). They are off the pitch, so hide them from the referee.
        .filter((d) => !(d.penaltyTimer > 0) && !d.sentOff)
        .map((d) => ({
          id: d.id, team: d.team,
          pos: [d.pos[0], d.pos[1], d.pos[2]],
          fallen: !!d.recovery,
        })),
    };
  }

  function placeBall(pos) {
    const q = data.qpos, v = data.qvel;
    q[ballQposAdr] = pos[0];
    q[ballQposAdr + 1] = pos[1];
    q[ballQposAdr + 2] = pos[2];
    q[ballQposAdr + 3] = 1; q[ballQposAdr + 4] = 0; q[ballQposAdr + 5] = 0; q[ballQposAdr + 6] = 0;
    for (let i = 0; i < 6; i++) v[ballDofAdr + i] = 0;
    mujoco.mj_forward(model, data);
    ballActive = true;
    if (ball) { ball.poseFromQpos(q, ballQposAdr); ball.appear(); }
  }

  function placeDuck(duck, pos, yaw = 0) {
    const q = data.qpos, v = data.qvel;
    const fj = duck.addrs.freejointQposAdr;
    q[fj] = pos[0]; q[fj + 1] = pos[1]; q[fj + 2] = pos[2];
    q[fj + 3] = Math.cos(yaw / 2);
    q[fj + 4] = 0;
    q[fj + 5] = 0;
    q[fj + 6] = Math.sin(yaw / 2);
    for (let j = 0; j < NUM_JOINTS; j++) {
      q[duck.addrs.qposAdr[j]] = DEFAULT_POSE[j];
    }
    const fd = duck.addrs.freejointDofAdr;
    for (let i = 0; i < 6; i++) v[fd + i] = 0;
    for (let j = 0; j < NUM_JOINTS; j++) v[duck.addrs.dofAdr[j]] = 0;
    mujoco.mj_forward(model, data);
  }

  function placeDuckOffField(duck) {
    placeDuck(duck, [duck.pos[0], FIELD_HALF_W + 0.5, 0.12], 0);
    applyVariant(duck.rig, "charcoal");
    // Hide the rig entirely: a charcoal duck parked off-field still looked
    // like a "mystery substitute" standing on the touchline. The physics body
    // stays (so it can be restored), but nothing renders while it is off.
    if (duck.rig) duck.rig.placer.visible = false;
  }

  function returnDuckFromPenalty(duck) {
    const sp = activeSpawns[duck.id] || SPAWN_POSITIONS[duck.id];
    placeDuck(duck, [sp.x, sp.y, 0.12], sp.yaw ?? 0);
    // Full per-duck state reset (mirrors executeKickoff) so the duck
    // doesn't re-enter play with stale recovery/action state that would
    // cause immediate collapse.
    duck.recovery = null;
    duck.fallDebounce = 0;
    duck.fallenSince = null;
    duck.mode = "walk";
    duck.kickRun = null;
    duck.postKickLock = 0;
    duck.lastAction.fill(0);
    duck.cmd.fill(0);
    duck.cmdSm.fill(0);
    applyVariant(duck.rig, duck.team === "red" ? "team_red" : "team_blue");
    // Coming back from the sin-bin: make the rig visible again.
    if (duck.rig) duck.rig.placer.visible = true;
  }

  function executeKickoff() {
    placeBall(BALL_SPAWN);
    // Apply formation roles/spawns at each kickoff so pre-match coach choices
    // (and a fresh match restart) stick; mid-match style/press already live.
    applyFormationFromStrategies();
    for (const duck of ducks) {
      // Sent-off ducks stay off for good; sin-binned ducks keep their spot
      // (and their ticking timer) until penalty_returned brings them back.
      if (duck.sentOff || duck.penaltyTimer > 0) continue;
      const sp = activeSpawns[duck.id] || SPAWN_POSITIONS[duck.id];
      placeDuck(duck, [sp.x, sp.y, 0.12], sp.yaw ?? 0);
      duck.recovery = null;
      duck.fallDebounce = 0;
      duck.kickRun = null;
      duck.mode = "walk";
      duck.postKickLock = 0;
      duck.lastAction.fill(0);
      duck.cmd.fill(0);
      duck.cmdSm.fill(0);
      // Restore the team colourway: a duck placed for the kick-off must never
      // keep the charcoal sin-bin/off-field skin from a previous spell (Bug C).
      applyVariant(duck.rig, duck.team === "red" ? "team_red" : "team_blue");
      // A duck returning to the pitch for the kick-off must be visible again
      // (sent-off ducks were skipped above and stay hidden).
      if (duck.rig) duck.rig.placer.visible = true;
    }
    prevBallX = BALL_SPAWN[0];
    prevBallY = BALL_SPAWN[1];
    setStore({ matchState: "KICKOFF", setPieceType: null });
  }

  function executeSetPiece(payload) {
    if (payload.pos) placeBall(payload.pos);
    prevBallX = payload.pos ? payload.pos[0] : prevBallX;
    prevBallY = payload.pos ? payload.pos[1] : prevBallY;
  }

  /** Rebuild activeSpawns + duck roles/agents from strategyByTeam. */
  function applyFormationFromStrategies() {
    if (!isFootball) return;
    activeSpawns = buildSpawnTable(strategyByTeam);
    for (const duck of ducks) {
      const sp = activeSpawns[duck.id];
      if (!sp) continue;
      duck.role = sp.role;
      duck.agent = createAgent(duck, {
        team: duck.team, role: duck.role, spawnX: sp.x, spawnY: sp.y,
      });
    }
  }

  /**
   * Coach panel → game. Knobs take effect next AI tick.
   * Formation changes only apply when not locked (pre-kickoff / fresh match).
   * opts.team selects which side's card to patch (user or rival).
   */
  function setTeamStrategy(partial = {}, opts = {}) {
    if (!isFootball) return store().userStrategy;
    const userTeam = store().userTeam || "red";
    const team = opts.team === "red" || opts.team === "blue" ? opts.team : userTeam;
    const allowFormation = !formationLocked || opts.forceFormation;
    const prev = normalizeStrategy(strategyByTeam[team] || DEFAULT_STRATEGY);
    const merged = mergeStrategy(prev, {
      ...partial,
      formation: allowFormation
        ? (partial.formation ?? prev.formation)
        : prev.formation,
    });
    const next = normalizeStrategy(merged);
    strategyByTeam = { ...strategyByTeam, [team]: next };

    const rivalTeam = userTeam === "red" ? "blue" : "red";
    if (team === userTeam) {
      setStore({
        userTeam,
        userStrategy: next,
        opponentStrategy: normalizeStrategy(strategyByTeam[rivalTeam]),
      });
    } else {
      setStore({
        userTeam,
        opponentStrategy: next,
        userStrategy: normalizeStrategy(strategyByTeam[userTeam]),
      });
    }

    if (allowFormation && next.formation !== prev.formation) {
      applyFormationFromStrategies();
    }
    return next;
  }

  function setUserTeam(team) {
    if (team !== "red" && team !== "blue") return store().userTeam;
    const prevUser = store().userTeam || "red";
    if (team === prevUser) return team;
    // Swap which card is "mine" vs rival so editing stays attached to sides.
    const redCard = normalizeStrategy(strategyByTeam.red);
    const blueCard = normalizeStrategy(strategyByTeam.blue);
    setStore({
      userTeam: team,
      userStrategy: team === "red" ? redCard : blueCard,
      opponentStrategy: team === "red" ? blueCard : redCard,
    });
    strategyByTeam = { red: redCard, blue: blueCard };
    if (!formationLocked) applyFormationFromStrategies();
    return team;
  }

  function handleRefereeEvent(type, payload) {
    switch (type) {
      case "goal": {
        setStore({
          matchState: "GOAL",
          score: referee.getScore(),
          matchEvents: [...useGame.getState().matchEvents.slice(-4),
            { type: "goal", team: payload.team, time: referee.getMatchTime() }],
        });
        // Trigger celebration animation
        const ballQ = data.qpos;
        celebration?.play(payload.team, {
          x: ballQ[ballQposAdr], y: ballQ[ballQposAdr + 1], z: ballQ[ballQposAdr + 2],
        });
        stickers?.pop("kick");
        break;
      }
      case "goal_disallowed": {
        setStore({
          matchEvents: [...useGame.getState().matchEvents.slice(-4),
            { type: "goal_disallowed", team: payload.team, time: referee.getMatchTime() }],
        });
        break;
      }
      case "kickoff": {
        // A fresh kick-off clears any stale winner from the previous match so
        // the UI never shows an outdated result during open play.
        setStore({ matchResult: null, tacticsCard: null });
        executeKickoff();
        break;
      }
      case "playing": {
        // Arm the perf-gate grace period on the first transition to PLAYING.
        if (perfGraceEnd === Infinity) perfGraceEnd = performance.now() + PERF_GRACE_MS;
        setStore({ matchState: "PLAYING", setPieceType: null });
        break;
      }
      case "throw_in":
      case "goal_kick":
      case "corner_red":
      case "corner_blue": {
        setStore({
          matchState: "SET_PIECE",
          setPieceType: type,
          matchEvents: [...useGame.getState().matchEvents.slice(-4),
            { type, team: payload.team, time: referee.getMatchTime() }],
        });
        executeSetPiece(payload);
        break;
      }
      case "penalty": {
        const duck = ducks[payload.duckId];
        if (duck) {
          duck.penaltyTimer = PENALTY_DURATION_S;
          setStore({
            matchEvents: [...useGame.getState().matchEvents.slice(-4),
              { type: "penalty", team: duck.team, time: referee.getMatchTime(), payload }],
          });
          placeDuckOffField(duck);
        }
        break;
      }
      case "penalty_returned": {
        const duck = ducks[payload.duckId];
        if (duck) {
          duck.penaltyTimer = 0;
          returnDuckFromPenalty(duck);
        }
        break;
      }
      case "penalty_reset": {
        // Violation during sin-bin: referee refills its foul timer, so the
        // local countdown must be refilled too or the two diverge.
        const duck = ducks[payload.duckId];
        if (duck) {
          duck.penaltyTimer = PENALTY_DURATION_S;
          setStore({
            matchEvents: [...useGame.getState().matchEvents.slice(-4),
              { type: "penalty_reset", team: duck.team, time: referee.getMatchTime(), payload }],
          });
        }
        break;
      }
      case "yellow_card": {
        const duck = ducks[payload.duckId];
        if (duck) duck.cards.yellow++;
        setStore({
          matchEvents: [...useGame.getState().matchEvents.slice(-4),
            { type: "yellow_card", team: duck?.team, time: referee.getMatchTime(), payload }],
        });
        break;
      }
      case "red_card": {
        const duck = ducks[payload.duckId];
        if (duck) { duck.cards.red++; duck.sentOff = true; }
        setStore({
          matchEvents: [...useGame.getState().matchEvents.slice(-4),
            { type: "red_card", team: duck?.team, time: referee.getMatchTime(), payload }],
        });
        if (duck) placeDuckOffField(duck);
        break;
      }
      case "extra_time": {
        setStore({
          matchState: "PLAYING",
          matchEvents: [...useGame.getState().matchEvents.slice(-4),
            { type: "extra_time", team: null, time: referee.getMatchTime() }],
        });
        break;
      }
      case "fulltime": {
        // Persist the winner ('red' | 'blue' | 'draw') so the UI can show the
        // result; the referee owns the verdict, the event payload is a fallback.
        const result = referee?.getResult?.() ?? payload?.result ?? null;
        const scoreNow = referee.getScore();
        const card = matchStats
          ? buildTacticsBoard({
            stats: matchStats,
            strategyByTeam,
            score: scoreNow,
          })
          : null;
        setStore({
          matchState: "FULLTIME",
          score: scoreNow,
          matchResult: result,
          tacticsBoard: card,
          tacticsCard: card,
          matchEvents: [...useGame.getState().matchEvents.slice(-4),
            { type: "fulltime", team: result === "draw" ? null : result, time: referee.getMatchTime() }],
        });
        celebration?.cancel();
        break;
      }
    }
  }

  // Football control step (50 Hz): AI at 10 Hz -> per-duck ONNX inference +
  // ctrl write -> one mj_step batch (advances ALL entities) -> per-duck state
  // machines -> ball watchdog. Inference is sequential over the shared pool.
  let aiTick = 0;
  // ── Football locomotion smoothing / idle anti-stall ──────────────────
  // Parked formation ducks (hold-slot / hold-line) command vx = 0. Two
  // problems with a hard zero: (1) the referee's INACTIVE rule sin-bins any
  // duck that stays within 3 m of the ball without moving for 10 s, so a
  // legitimately marking duck gets whistled off (Problem 1); (2) snapping
  // between 0 and a walk speed at 10 Hz reads as a robotic move-stop-move
  // (Bug B). IDLE_CREEP replaces a commanded stand-still with a gentle
  // forward shuffle - comfortably above the referee's IDLE_SPEED_EPS (0.05
  // m/s) so the duck registers as "moving", but well below a chase.
  const IDLE_CREEP = 0.22;
  // Sub-threshold vx floor: decideAll's cos-scaling can emit a tiny positive
  // vx (e.g. a near-perpendicular approach) that sits at/below the referee's
  // IDLE_SPEED_EPS and reads as "stationary". Anything in (0, MIN_EFFECTIVE_VX)
  // is raised to a real walking speed before the IDLE_CREEP stand-still rule.
  const MIN_EFFECTIVE_VX = 0.22;
  // First-order low-pass on the twist: cmdSm eases toward cmd each 50 Hz
  // step. alpha = 0.25 => ~0.08 s time constant, enough to round off the
  // 10 Hz decision steps without adding perceptible lag.
  const CMD_SMOOTH_ALPHA = 0.25;
  // ── Performance auto-degradation (Spec "性能门禁") ──────────────────
  // AI cadence divider, mutable so the perf gate can halve the tactical
  // rate (10 Hz -> 5 Hz) without mutating the shared matchConfig object.
  let aiDivider = matchConfig.ai?.divider ?? 1;
  // Per-controlStep ONNX inference cost, refreshed every step; bench()
  // integrates it into its onnxMs breakdown.
  let lastOnnxMs = 0;
  // One-shot degradation latch plus a 2 s sliding window of step-completion
  // timestamps used to measure the realised ctrlHz.
  let degraded = false;
  const perfWindow = [];
  const PERF_WINDOW_MS = 2000;
  const PERF_CTRL_HZ_FLOOR = 45;
  // Grace period: don't evaluate perf until 5 s after the referee enters
  // PLAYING for the first time. Boot-time ONNX session creation causes
  // extremely slow steps that would immediately trip the gate.
  const PERF_GRACE_MS = 5000;
  let perfGraceEnd = Infinity; // set on first PLAYING transition
  function maybeDegradePerf(now) {
    if (degraded) return;
    // Hold off until the grace period expires; also discard stale samples.
    if (now < perfGraceEnd) { perfWindow.length = 0; return; }
    perfWindow.push(now);
    while (perfWindow.length && now - perfWindow[0] > PERF_WINDOW_MS) perfWindow.shift();
    if (perfWindow.length < 2) return;
    const span = now - perfWindow[0];
    // Only judge once the window is (nearly) full so the first steps after
    // boot - and any brief hitch - can't trip the gate on a partial sample.
    if (span < PERF_WINDOW_MS * 0.95) return;
    const hz = ((perfWindow.length - 1) * 1000) / span;
    if (hz < PERF_CTRL_HZ_FLOOR) {
      degraded = true;
      aiDivider = (matchConfig.ai?.divider ?? 1) * 2; // 10 Hz -> 5 Hz
      if (renderer?.setPixelRatio) {
        renderer.setPixelRatio(Math.max(1, renderer.getPixelRatio() * 0.5));
      }
      console.warn(
        `[football] perf gate: ctrlHz ${hz.toFixed(1)} < ${PERF_CTRL_HZ_FLOOR} for`
        + ` ${PERF_WINDOW_MS}ms -> aiDivider ${aiDivider} (5 Hz), dpr halved`,
      );
    }
  }
  async function controlStepFootball() {
    if (matchConfig.ai) {
      aiTick = (aiTick + 1) % aiDivider;
      if (aiTick === 0) { runAiDecisions(); antiStuckCheck(); }
    }
    // Ease the smoothed twist toward the AI target every 50 Hz step, so the
    // 10 Hz tactical decisions never produce a step change in the commanded
    // velocity (the move-stop-move jerk of Bug B). buildObsForDuck reads this.
    for (const duck of ducks) {
      const cs = duck.cmdSm, c = duck.cmd;
      cs[0] += (c[0] - cs[0]) * CMD_SMOOTH_ALPHA;
      cs[2] += (c[2] - cs[2]) * CMD_SMOOTH_ALPHA;
      // Head slots unused in football — keep smoothed head at zero.
      cs[3] = 0; cs[4] = 0; cs[5] = 0; cs[6] = 0;
    }
    const ctrl = data.ctrl;
    // ONNX inference (per-duck, sequential over the shared pool) timed on its
    // own so bench() can report the onnxMs slice of every control step.
    const onnxT0 = performance.now();
    for (const duck of ducks) {
      // Sin-bin, sent-off or fall-settle: motors frozen on the last pose, no inference.
      if (duck.penaltyTimer > 0 || duck.sentOff || duck.recovery?.state === "fallen") continue;
      const feeds = { obs: new ort.Tensor("float32", buildObsForDuck(duck), [1, OBS_SIZE]) };
      const out = await sessionFor(duck).run(feeds);
      const act = out.actions.data;
      duck.lastAction.set(act);
      const off = duck.addrs.ctrlOffset;
      for (let j = 0; j < NUM_JOINTS; j++) ctrl[off + j] = DEFAULT_POSE[j] + act[j] * ACTION_SCALE;
    }
    lastOnnxMs = performance.now() - onnxT0;
    // A single mj_step batch advances every duck and the ball together.
    for (let s = 0; s < DECIMATION; s++) mujoco.mj_step(model, data);
    cacheDuckPoses();
    // Referee step (football mode): reads fresh ball/duck poses, emits events.
    if (referee) {
      const gs = buildRefereeState();
      referee.step(CTRL_DT, gs);
      prevBallX = gs.ball.pos[0];
      prevBallY = gs.ball.pos[1];
      matchStats?.tick(CTRL_DT, {
        matchState: referee.getState(),
        lastTouchTeam: referee.getLastTouchTeam(),
      });
    }
    for (const duck of ducks) updateDuckStateFootball(duck);
    // Ball watchdog: a solver glitch that tunnels the ball out of the pitch
    // brings it back to the centre spot. Suppressed while the referee owns
    // ball placement (GOAL / DEAD_BALL / SET_PIECE states).
    const refState = referee?.getState();
    if (ballActive && (!refState || refState === "PLAYING" || refState === "KICKOFF")) {
      const q = data.qpos;
      const limX = matchConfig.field.halfX + 0.1;
      const limY = matchConfig.field.halfY + 0.1;
      if (Math.abs(q[ballQposAdr]) > limX || Math.abs(q[ballQposAdr + 1]) > limY) spawnBallFootball();
    }
    // Perf gate: measures realised ctrlHz over a 2 s window, degrades once.
    maybeDegradePerf(performance.now());
    // Football SFX: ball impacts, duck–duck bumps (teammate vs opponent).
    stepAudioFootball();
  }

  // ── Football-only audio (multi-duck) ─────────────────────────────────
  // Kick / ball / duck-bump thumps are off — match energy comes from
  // danmaku commentary cues. Fall thuds still fire at recovery transitions.
  function stepAudioFootball() {
    haptics.tick();
  }

  // Sync one duck's render rig from qpos (per-duck version of syncRig).
  function syncOneRig(duck) {
    const q = data.qpos;
    const fj = duck.addrs.freejointQposAdr;
    const tg = duck.rig.bodies.get("trunk_base");
    tg.position.set(q[fj], q[fj + 1], q[fj + 2]);
    tg.quaternion.set(q[fj + 4], q[fj + 5], q[fj + 6], q[fj + 3]);
    for (let j = 0; j < NUM_JOINTS; j++) setJoint(duck.rig, JOINT_NAMES[j], q[duck.addrs.qposAdr[j]]);
  }

  // Football per-frame render drive: sync every rig, follow the ball, keep
  // the orbit camera alive, drive celebration, throttle match state to store.
  function frameFootball(dt) {
    for (const duck of ducks) syncOneRig(duck);
    if (ball) ball.sync(data.qpos, ballQposAdr, ballActive);
    // Spatial audio: listener on camera, ball emitter for thumps.
    updateListener(camera);
    if (ballActive) {
      const q = data.qpos;
      ballEmitter.setPosition(q[ballQposAdr], q[ballQposAdr + 2], -q[ballQposAdr + 1]);
    }
    // Celebration camera override (goal replay swing)
    if (celebration?.isActive()) {
      celebration.drive(dt);
      const override = celebration.getCameraOverride();
      if (override) {
        camera.position.copy(override.position);
        camera.lookAt(override.lookAt);
        controls.target.copy(override.lookAt);
      }
    } else {
      controls.update();
    }
    if (ball) ball.drive(() => spawnBallFootball());
    renderTelemetry();
    // ── Football: 4 Hz store throttle (matchTime + ducksState) ──
    matchStoreTick += dt;
    if (matchStoreTick > 0.25 && referee) {
      matchStoreTick = 0;
      const fin = (x) => (Number.isFinite(x) ? x : 0);
      const duckSnap = ducks.map((d) => ({
        id: d.id,
        team: d.team,
        role: d.role,
        x: fin(d.pos[0]),
        y: fin(d.pos[1]),
        yaw: fin(d.yaw),
        fallen: !!d.recovery,
        penalized: d.penaltyTimer > 0,
        sentOff: !!d.sentOff,
      }));
      const q = data.qpos;
      const lastTouch = referee.getLastTouchTeam();
      const stateNow = referee.getState();
      const patch = {
        matchTime: referee.getMatchTime(),
        matchState: stateNow,
        lastTouchTeam: lastTouch,
        ducksState: duckSnap,
        ballState: { x: fin(q[ballQposAdr]), y: fin(q[ballQposAdr + 1]) },
      };
      // Freeze the live board once fulltime — tacticsCard owns the final view.
      if (matchStats && stateNow !== "FULLTIME") {
        patch.tacticsBoard = buildTacticsBoard({
          stats: matchStats,
          strategyByTeam,
          score: referee.getScore(),
        });
      }
      setStore(patch);
    }
  }

  // Control-step dispatcher: sandbox keeps the original single-duck path
  // byte-for-byte (controlStepSandbox); football runs the multi-duck path.
  async function controlStep() {
    if (isFootball) await controlStepFootball();
    else await controlStepSandbox();
  }

  async function controlStepSandbox() {
    driveRelief(CTRL_DT); // kinematic terrain, written before the physics steps
    // Settle phase: ctrl frozen on the pose held at the fall (approximates
    // the runtime's limp beat), physics keeps stepping, no inference.
    if (recovery?.state !== "fallen") {
      const feeds = { obs: new ort.Tensor("float32", buildObs(), [1, OBS_SIZE]) };
      const out = await activeSession().run(feeds);
      const act = out.actions.data;
      lastAction.set(act);
      const ctrl = data.ctrl;
      for (let j = 0; j < NUM_JOINTS; j++) ctrl[j] = DEFAULT_POSE[j] + act[j] * ACTION_SCALE;
    }
    for (let s = 0; s < DECIMATION; s++) {
      applyGrabForce(); // mouse perturbation, fresh velocity every substep
      mujoco.mj_step(model, data);
    }
    stepAudioSim(); // footsteps / rumble / ball thumps off the fresh state

    const death = poseIsDead();
    if (death === "exploded") {
      haptics.pulse("explode");
      resetSim();
    } else if (recovery) {
      // Recovery state machine owns the duck: settle -> stand policy ->
      // hysteresis exit (upright for a full second) or 6 s give-up reset.
      recovery.steps++;
      if (recovery.state === "fallen") {
        if (recovery.steps >= FALL_SETTLE_STEPS) {
          recovery = { state: "recovering", steps: 0, uprightSteps: 0 };
          lastAction.fill(0);
          syncButtons();
        }
      } else {
        recovery.uprightSteps = projGravZ() < -0.85 ? recovery.uprightSteps + 1 : 0;
        if (recovery.uprightSteps >= RECOVER_UPRIGHT_STEPS) {
          recovery = null;
          mode = "walk";
          lastAction.fill(0);
          haptics.pulse("recover"); // back on its feet: light double tap
          syncButtons();
        } else if (recovery.steps >= RECOVER_GIVEUP_STEPS) {
          resetSim();
        }
      }
    } else if (death === "fallen") {
      const recoverable = loco === "legs" && mode === "walk" &&
        !inputLocked && postKickLock === 0 && !standTimer;
      if (recoverable) {
        fallenSince = null;
        if (++fallDebounce >= FALL_DEBOUNCE_STEPS) {
          fallDebounce = 0;
          exitHeadMode();
          recovery = { state: "fallen", steps: 0 };
          // Haptic thud on the confirmed fall (one-shot: this transition
          // fires once per fall, the recovery machine owns the duck after).
          haptics.pulse("fall");
          syncButtons();
        }
      } else {
        fallDebounce = 0;
        const now = performance.now();
        const graceMs = mode === "roll" ? 5000 : 1000;
        // First frame of a non-recoverable fall (rollers, sit, one-shots):
        // same haptic thud, once - fallenSince latches until reset/upright.
        if (fallenSince == null) haptics.pulse("fall");
        fallenSince ??= now;
        if (now - fallenSince > graceMs) resetSim();
      }
    } else {
      fallDebounce = 0;
      fallenSince = null;
    }

    // Ball respawn watchdog: outside the arena bounds means "escaped
    // through a solver glitch", bring it back near the duck.
    if (ballActive) {
      const q = data.qpos;
      const escaped =
        Math.abs(q[ballQposAdr]) > ARENA_HALF + 0.1 ||
        Math.abs(q[ballQposAdr + 1]) > ARENA_HALF + 0.1;
      if (escaped) spawnBall();
    }

    if (postKickLock > 0 && mode === "walk") postKickLock--;

    // One-shot kick: fixed 0.5 s window like the robot runtime, then
    // straight back to walking. lastAction is NOT zeroed on either swap.
    if (isKick() && kickRun) {
      kickRun.steps++;
      if (kickRun.steps >= KICK_STEPS) {
        kickRun = null;
        mode = "walk";
        postKickLock = POST_KICK_LOCK_STEPS;
        syncButtons();
      }
    }

    // Crouch-glide one-shot: advance the trained phase clock and hand back
    // to the drive policy at the runtime's cycle end.
    if (mode === "crouch" && crouchRun) {
      crouchRun.phase += CTRL_DT / CROUCH_PERIOD_S;
      if (crouchRun.phase >= CROUCH_END_PHASE) {
        crouchRun = null;
        mode = "walk";
        syncButtons();
      }
    }

    // Ground-pick one-shot: same phase-clock pattern as the crouch, ending
    // at the runtime's cycle end (phase 0.7 of a 4 s period, ~2.8 s).
    if (mode === "groundpick" && pickRun) {
      pickRun.phase += CTRL_DT / GROUND_PICK_PERIOD_S;
      if (pickRun.phase >= GROUND_PICK_END_PHASE) {
        pickRun = null;
        mode = "walk";
        syncButtons();
      }
    }

    // One-shot roll, step-counted like the robot runtime: hand back to
    // walking once the trunk has tipped over and is upright again, or
    // after a hard window if the roll never initiated.
    if (mode === "roll" && rollRun) {
      rollRun.steps++;
      if (obs[5] > -0.3) rollRun.tipped = true;
      const upright = obs[5] < -0.85;
      const done = rollRun.tipped && upright && rollRun.steps >= 40;
      const expired = rollRun.steps >= 150; // 3 s, roll should long be over
      if (done || expired) {
        rollRun = null;
        mode = "walk";
        lastAction.fill(0);
        // Timed out mid-roll: don't hand a tipped duck to the walking
        // policy (it has no get-up skill).
        if (!upright) resetSim();
        else haptics.pulse("land"); // rolled through and stuck the landing
        syncButtons();
      }
    }
  }

  // ── Relief (prototype: the level itself gains gentle slopes) ────────
  // One analytic height function (cosine bumps, RELIEF_BUMPS) drives both
  // surfaces: the MuJoCo heightfield gets it sampled into hfield_data
  // once per compiled model, and the grid floor shader displaces its
  // vertices with the same function (uTopoScale uniform). Raising or
  // sinking the terrain = ramping one scalar that scales the hfield
  // z-size and the shader uniform together, so physics and visuals stay
  // the same surface at every moment of the transition. Trigger for now:
  // window.rl.setRelief(bool) (prototype - no UI yet).
  let reliefOn = false;
  let reliefScale = 0;
  let reliefGridMat = null; // assigned at scene wiring (grid built below)
  const reliefFilled = new WeakSet();
  function topoH(x, y) {
    let H = 0;
    for (const [cx, cy, h, r] of RELIEF_BUMPS) {
      const u = Math.hypot(x - cx, y - cy) / r;
      if (u < 1) H += h * (0.5 + 0.5 * Math.cos(Math.PI * u));
    }
    return H;
  }
  function fillHfield(m) {
    if (reliefFilled.has(m)) return;
    // Re-read the view on every fill: heap growth detaches TypedArrays.
    const n = RELIEF_GRID, hdata = m.hfield_data;
    for (let r = 0; r < n; r++) {
      const y = -ARENA_HALF + (2 * ARENA_HALF * r) / (n - 1);
      for (let c = 0; c < n; c++) {
        const x = -ARENA_HALF + (2 * ARENA_HALF * c) / (n - 1);
        hdata[r * n + c] = topoH(x, y) / RELIEF_HMAX;
      }
    }
    reliefFilled.add(m);
  }
  function driveRelief(dt) {
    fillHfield(model); // no-op once per compiled model (legs / rollers)
    const target = reliefOn ? 1 : 0;
    if (reliefScale !== target) {
      const d = Math.max(-RELIEF_RATE * dt, Math.min(RELIEF_RATE * dt, target - reliefScale));
      reliefScale += d;
    }
    // z-size scales every bump; the floor keeps it strictly positive and,
    // combined with the geom's RELIEF_SINK offset, fully buried when off.
    model.hfield_size[2] = Math.max(reliefScale * RELIEF_HMAX, 1e-4);
    if (reliefGridMat) reliefGridMat.uniforms.uTopoScale.value = reliefScale;
  }
  let running = true;
  // Registered for the module-level HMR dispose so this instance's loop is
  // stopped when the module is thrown away.
  liveControlLoops.add(() => { running = false; });
  (async function controlLoop() {
    let next = performance.now();
    let count = 0, hzT0 = next;
    while (running) {
      await controlStep();
      count++;
      const now = performance.now();
      if (now - hzT0 > 500) {
        ctrlHz = (count * 1000) / (now - hzT0);
        count = 0; hzT0 = now;
      }
      next += CTRL_DT * 1000;
      const wait = next - performance.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      else next = performance.now(); // fell behind: don't spiral
    }
  })();

  // ── Scene wiring (grid, walls, rig, ball, arcade row) ────────────────
  // The grid/walls carry ceremony-driven uReveal uniforms and per-frame
  // focus updates, so the game owns them; lights and environment live in
  // the R3F layer. Football swaps the sandbox arena for the pitch (field
  // markings + goal-mouth walls + goal cages) and clones six duck rigs.
  let grid, wallMats, wallMeshes, rig, trunkGroup;

  // ── Goalkeeper visual identifier (Spec Task 4.2) ──────────────────────
  // Attaches a small bright cap mesh to the head body of a goalkeeper so the
  // two keepers read instantly against their outfield team-mates. The cap is
  // parented to the head body group ("jaw_soft", which carries the head_roll
  // joint), so syncOneRig's per-joint updates carry it along for free. The
  // crown position is measured from the head's live world-space bounds and
  // converted back into the head's local frame, so it stays put regardless of
  // the MJCF Z-up -> three.js Y-up convention fix applied by the rig root.
  const GK_MARK_COLOR = { red: 0xffd700, blue: 0x00ffff }; // yellow / cyan caps
  function addGoalkeeperMark(duck) {
    const head = duck.rig.bodies.get("jaw_soft");
    if (!head) return;
    const color = GK_MARK_COLOR[duck.team] ?? 0xffffff;
    duck.rig.placer.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(head);
    if (box.isEmpty()) return;
    // Crown of the head in world space (three.js is Y-up after the root fix).
    const crown = new THREE.Vector3(
      (box.min.x + box.max.x) / 2,
      box.max.y,
      (box.min.z + box.max.z) / 2,
    );
    const mark = new THREE.Mesh(
      new THREE.SphereGeometry(0.022, 16, 12),
      new THREE.MeshStandardMaterial({
        color, emissive: color, emissiveIntensity: 0.5, roughness: 0.35, metalness: 0.1,
      }),
    );
    mark.name = "gk_mark";
    mark.position.copy(head.worldToLocal(crown.clone()));
    head.add(mark);
  }

  if (isFootball) {
    // ── Football mode: pitch visuals + six duck rigs ──
    const { makeFootballGrid, makeFootballWalls } = await import("./football/field.js");
    grid = makeFootballGrid(matchConfig.field);
    scene.add(grid);
    const fw = makeFootballWalls(matchConfig.field);
    wallMats = fw.wallMats;
    wallMeshes = fw.wallMeshes;
    for (const m of wallMeshes) scene.add(m);
    scene.add(createGoalMesh("red"));
    scene.add(createGoalMesh("blue"));
    // Prototype rig (classic colourway) for duck 0, clones for the rest.
    // Team colours are applied BEFORE scene.add so applyVariant takes the
    // instant (no-parent) path and never touches the shared driveFades loop.
    rig = await rigPromise;
    ducks[0].rig = rig;
    for (let i = 1; i < ducks.length; i++) ducks[i].rig = cloneRig(rig);
    for (const duck of ducks) {
      applyVariant(duck.rig, duck.team === "red" ? "team_red" : "team_blue");
      scene.add(duck.rig.placer);
      if (duck.role === "goalkeeper") addGoalkeeperMark(duck);
    }
    trunkGroup = rig.bodies.get("trunk_base");
  } else {
    // ── Sandbox mode: infinite grid + closed arena walls + one rig ──
    grid = makeInfiniteGrid();
    scene.add(grid);
    reliefGridMat = grid.material; // relief drive mirrors uTopoScale into it
    const aw = makeArenaWalls();
    wallMats = aw.wallMats;
    wallMeshes = aw.wallMeshes;
    for (const m of wallMeshes) scene.add(m);
    rig = await rigPromise;
    scene.add(rig.placer);
    trunkGroup = rig.bodies.get("trunk_base");
  }
  locos.legs = {
    model, data, rig, trunkGroup,
    qposAdr, dofAdr, gyroAdr, trunkId, standKeyId, ballQposAdr, ballDofAdr, extraJoints,
  };

  // ── Locomotion variant switching (legs <-> rollers) ──────────────────
  // The roller stack (XML + 5 extra meshes + kinematics + 2 ONNX policies)
  // is lazy-loaded on the first switch, then kept resident.
  let rollersLoading = null;
  function ensureRollers() {
    rollersLoading ??= (async () => {
      const [{ xml: rXml, meshFiles: rMeshFiles }, rk] = await Promise.all([
        buildPhysicsXml("robot_allcollisions_rollers.xml"),
        loadKinematics(`${MODEL_DIR}/kinematics_rollers.json`),
      ]);
      const [rRig, sDrive, sCrouch] = await Promise.all([
        buildRig(rk, { materialForMesh: materialHookFor(VARIANTS[currentVariant]) }),
        ort.InferenceSession.create(signed(POLICIES.drive), sessionOpts),
        ort.InferenceSession.create(signed(POLICIES.crouch), sessionOpts),
        addMeshesToVfs(rMeshFiles),
      ]);
      sessions.drive = sDrive;
      sessions.crouch = sCrouch;
      const rModel = mujoco.MjModel.from_xml_string(rXml, vfs);
      const rData = new mujoco.MjData(rModel);
      locos.rollers = {
        model: rModel, data: rData, rig: rRig, trunkGroup: rRig.bodies.get("trunk_base"),
        ...resolveAddrs(rModel, rk),
      };
    })();
    return rollersLoading;
  }

  // Ghost-only roller rig: kinematics + THREE meshes, no physics model and
  // no ONNX sessions - just enough to render roller-mode PEERS correctly
  // for a visitor who never leaves legs mode (ensureRollers' full stack
  // stays lazy). Kept resident once built; if the player later switches
  // for real, getRigFor prefers the live locos.rollers rig and this one
  // quietly remains as a clone source.
  let ghostRollerRig = null;
  let ghostRollerRigLoading = null;
  function ensureGhostRollerRig() {
    if (locos.rollers || ghostRollerRig || rollersLoading) return;
    ghostRollerRigLoading ??= (async () => {
      const rk = await loadKinematics(`${MODEL_DIR}/kinematics_rollers.json`);
      ghostRollerRig = await buildRig(rk, {
        materialForMesh: materialHookFor(VARIANTS[currentVariant]),
      });
    })().catch((e) => {
      ghostRollerRigLoading = null; // next roller peer retries the load
      console.warn("[ghosts] roller ghost rig load failed", e);
    });
  }

  function activateLoco(name) {
    const L = locos[name];
    loco = name;
    scene.remove(rig.placer);
    ({ model, data, rig, trunkGroup, qposAdr, dofAdr, gyroAdr, trunkId,
       standKeyId, ballQposAdr, ballDofAdr, extraJoints, ankleIds } = L);
    // The rig may have been built (or last shown) under another colourway.
    applyVariant(rig, currentVariant);
    scene.add(rig.placer);
    setStore({ loco: name });
    resetSim();
  }

  let locoSwitching = false;
  async function setLoco(name, { force = false } = {}) {
    if (name !== "legs" && name !== "rollers") return;
    if (loco === name || locoSwitching) return;
    if (!force && (inputLocked || rollRun || kickRun || crouchRun || pickRun ||
        standTimer || recovery)) return;
    locoSwitching = true;
    setStore({ locoSwitching: true });
    try {
      if (name === "rollers" && !locos.rollers) {
        setStore({ rollersLoading: true });
        await ensureRollers();
      }
      activateLoco(name);
    } catch (e) {
      rollersLoading = null;
      console.error("[game] roller switch failed", e);
    } finally {
      setStore({ rollersLoading: false, locoSwitching: false });
      locoSwitching = false;
    }
  }

  async function toggleLoco() {
    const next = loco === "legs" ? "rollers" : "legs";
    setStore({ locoWant: next });
    await setLoco(next);
  }

  // Quickbar loco intent: reconcile locoWant -> actual, retrying until the
  // game allows the switch (mid-roll, respawn ceremony, ...). Replaces the
  // old index.html reconciler that polled window.rl.
  let locoReconciler = null;
  function reconcileLoco() {
    const want = store().locoWant;
    if (want === loco) {
      if (locoReconciler) { clearInterval(locoReconciler); locoReconciler = null; }
      return;
    }
    if (want === "rollers") ensureRollers().catch(() => {});
    if (!locoSwitching) setLoco(want);
    locoReconciler ??= setInterval(reconcileLoco, 250);
  }
  useGame.subscribe((s) => s.locoWant, reconcileLoco);

  // ── Cutscenes (entrance + respawn) ──────────────────────────────────
  // Football skips the ceremony entirely: the entrance cutscene is welded
  // to the single sandbox rig (scan FX, uReveal grid sweep, prop staggers)
  // and the AI drives the ducks from the first tick, so the match starts
  // with input unlocked and no cutscene.
  if (!isFootball) {
    ceremony = createCeremony({
      THREE, scene, camera, renderer, fx,
      getRig: () => rig,
      grid, wallMats,
      syncRig, startCameraReset,
      setLocked: (v) => {
        inputLocked = v;
        controller.setLocked(v);
        // A ball is always in play: pop one the moment the entrance or a
        // respawn ceremony hands control back.
        if (!v && ball && !ballActive) spawnBall({ fromQueue: true });
      },
      flashReset: () => {},
      // Audio twins of the wireframe materialize FX (entrance and respawns):
      // the duck's hero sweep spans the FX's exact duration and follows its
      // ease-out; each prop's scan gets its own smaller, size-pitched sweep
      // the frame it starts; each arena line drawing in gets a tiny blip.
      onScanCue: (durS) => playEntranceSweep(durS),
      onPropCue: (durS) => playPropSweep(durS),
      onLineCue: (u) => playLineBlip(u),
    });
  } else {
    inputLocked = false;
  }

  // ── Ambient bed lifecycle ─────────────────────────────────────────────
  // The Waddle-in click latches `entered` and doubles as the unlock
  // gesture; the hum starts there and ducks whenever the pause/title
  // overlay comes back up. fireImmediately covers ?boot=1 (already
  // entered by the time the game boots).
  useGame.subscribe((s) => s.entered, (entered) => {
    if (!entered) return;
    audioCtx();
    preloadSfx();
    startAmbient();
  }, { fireImmediately: true });
  useGame.subscribe((s) => s.menuOpen, (open) => setAmbientDucked(open),
    { fireImmediately: true });

  const { group: ballGroup, mesh: ballMesh } = createBallVisual(renderer);
  scene.add(ballGroup);
  ball = createBallActor({
    THREE, scene, camera, renderer, fxModule: fx, mesh: ballMesh, group: ballGroup,
  });
  // ── Football mode: referee + celebration + kickoff ──
  // Initialize the match subsystems and start the referee (which emits
  // 'kickoff' → executeKickoff() places ball + ducks at spawn positions).
  if (isFootball) {
    referee = createReferee({
      onEvent: (type, payload) => handleRefereeEvent(type, payload),
    });
    celebration = createCelebration({
      camera,
      scene,
      getScoringTeamRigs: (team) => ducks.filter((d) => d.team === team).map((d) => d.rig),
      createFx: () => fx.createWireframeFx(),
    });
    stickers = initStickers({ signed, isLocked: () => inputLocked });
    cacheDuckPoses();
    referee.startMatch();
  }

  // ── Prop library (wall/corner dressing + entrance FX) ────────────────
  // Every enabled def in props.js: loaded, real-size scaled, floor
  // snapped, wireframe-materialized with the ceremony (staggered after
  // the duck's scan cue). Physics-side, buildPhysicsXml planted one
  // static box per declared collider.
  // Football skips the prop library entirely (field.props = false: no
  // wall/corner dressing and no physics colliders on the pitch).
  const propGroups = isFootball ? null : await loadProps({
    THREE, GLTFLoader, signed, scene, camera, renderer, fx, ceremony,
  });

  // ── Camera: orbit controls + chase cam + reset glide ─────────────────
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(SPAWN_X, 0, -SPAWN_Y); // orbit around the spawn cell
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 0.25;
  controls.maxDistance = 3;
  controls.maxPolarAngle = Math.PI / 2 - 0.03;
  if (isFootball) {
    // ── Football mode: broadcast framing ──
    // Orbit the pitch centre instead of the single spawn cell, and lift the
    // distance cap so the whole field stays visible (FootballCanvas parks
    // the camera ~6.4 units out; the sandbox cap of 3 would yank it in).
    controls.target.set(0, 0, 0);
    controls.maxDistance = 12;
  }

  // Chase cam (default ON): each frame the camera eases toward a point
  // behind the duck's heading at the current orbit distance, while the
  // orbit target keeps easing to the trunk in syncRig. Implemented by
  // overwriting camera.position AFTER controls.update() so we never fight
  // OrbitControls' own spherical bookkeeping.
  let chaseCam = true;
  const CHASE_PITCH = 0.42; // rad above horizontal, keeps the floor in view
  const CHASE_EASE = 0.05;
  const _chasePos = new THREE.Vector3();
  const _chaseDir = new THREE.Vector3();
  // During one-shot rolls and kicks the trunk tumbles: hold the last
  // healthy yaw for the whole one-shot.
  let chaseHeldYaw = 0;
  // Heading hysteresis (Schmitt trigger): the walking gait wiggles the
  // trunk yaw ~±14 deg per step; two-layer EMA + engage/release thresholds
  // keep the camera steady while walking straight but responsive on turns.
  let chaseYawSmooth = 0;
  let chaseYawFollow = 0;
  let chaseYawTracking = false;
  const CHASE_YAW_SMOOTH_EASE = 0.04;
  const CHASE_YAW_ENGAGE = 0.17;
  const CHASE_YAW_RELEASE = 0.03;
  const CHASE_YAW_EASE = 0.10;
  const CHASE_YAW_EASE_TURN = 0.5;
  const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  function updateChaseCam() {
    // Reset glide: one clean tween from wherever the camera is back to the
    // home framing. Runs instead of the chase logic and hands control back
    // to it on landing.
    if (camResetT0 !== null) {
      if (!chaseCam) { camResetT0 = null; return; }
      const t = (performance.now() - camResetT0) / 1000 / CAM_RESET_S;
      const e = t >= 1 ? 1 : t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      camera.position.lerpVectors(_camFrom, _camTo, e);
      controls.target.lerpVectors(_tgtFrom, _tgtTo, e);
      camera.lookAt(controls.target);
      if (t >= 1) camResetT0 = null;
      return;
    }
    // Head mode: the camera freezes where it is. It keeps looking at the
    // duck for free - syncRig translates camera and target by the same
    // delta, and the duck isn't walking anyway (twist zeroed).
    if (headMode) return;
    if (!chaseCam) return;
    const qpos = data.qpos;
    let rawYaw;
    if (mode === "roll" || isKick()) {
      rawYaw = chaseHeldYaw;
    } else {
      rawYaw = duckYaw(qpos);
      chaseHeldYaw = rawYaw;
    }
    // "turning" reads the raw per-source wz commands (not the locked/merged
    // view) so an intentional turn engages on the first frame.
    const turning = controller.sources.some((s) => Math.abs(s.command[2]) > 0.05);
    chaseYawSmooth = wrapPi(
      chaseYawSmooth +
        wrapPi(rawYaw - chaseYawSmooth) * (turning ? CHASE_YAW_EASE_TURN : CHASE_YAW_SMOOTH_EASE),
    );
    const yawErr = wrapPi(chaseYawSmooth - chaseYawFollow);
    if (turning || Math.abs(yawErr) > CHASE_YAW_ENGAGE) chaseYawTracking = true;
    if (chaseYawTracking) {
      chaseYawFollow = wrapPi(
        chaseYawFollow + yawErr * (turning ? CHASE_YAW_EASE_TURN : CHASE_YAW_EASE),
      );
      if (!turning && Math.abs(yawErr) < CHASE_YAW_RELEASE) chaseYawTracking = false;
    }
    const yaw = chaseYawFollow;
    const dist = camera.position.distanceTo(controls.target);
    const horiz = dist * Math.cos(CHASE_PITCH);
    const vert = dist * Math.sin(CHASE_PITCH);
    // Duck forward in MJCF is (cos yaw, sin yaw, 0); Z-up -> Y-up maps it
    // to three-space (cos yaw, 0, -sin yaw). Behind = minus that.
    _chasePos.set(
      controls.target.x - Math.cos(yaw) * horiz,
      controls.target.y + vert,
      controls.target.z + Math.sin(yaw) * horiz,
    );
    camera.position.lerp(_chasePos, CHASE_EASE);
    // Re-project onto the orbit sphere: lerping between two points at the
    // same radius cuts the chord, which would slowly zoom the camera in
    // during large swings.
    _chaseDir.copy(camera.position).sub(controls.target);
    const len = _chaseDir.length();
    if (len > 1e-6) camera.position.copy(controls.target).addScaledVector(_chaseDir, dist / len);
    camera.lookAt(controls.target);
  }
  renderer.domElement.addEventListener("pointerdown", () => { chaseCam = false; });

  // Camera reset glide (owned by the respawn ceremony): back to the
  // page-load framing - the chase cam's ideal point behind the duck's
  // spawn heading, at the boot orbit distance.
  const CAM_HOME_DIST = camera.position.distanceTo(controls.target);
  let camResetT0 = null;
  const _camFrom = new THREE.Vector3(), _camTo = new THREE.Vector3();
  const _tgtFrom = new THREE.Vector3(), _tgtTo = new THREE.Vector3();
  function startCameraReset() {
    const qpos = data.qpos;
    const yaw = duckYaw(qpos);
    chaseHeldYaw = yaw;
    chaseYawSmooth = yaw;
    chaseYawFollow = yaw;
    chaseYawTracking = false;
    _tgtTo.set(qpos[0], qpos[2], -qpos[1]); // trunk at spawn, MJCF -> three
    const horiz = CAM_HOME_DIST * Math.cos(CHASE_PITCH);
    const vert = CAM_HOME_DIST * Math.sin(CHASE_PITCH);
    _camTo.set(
      _tgtTo.x - Math.cos(yaw) * horiz,
      _tgtTo.y + vert,
      _tgtTo.z + Math.sin(yaw) * horiz,
    );
    _camFrom.copy(camera.position);
    _tgtFrom.copy(controls.target);
    camResetT0 = performance.now();
    chaseCam = true; // reset always re-attaches the chase cam
  }

  // ── Mouse grab, pointer side (pick + drag target + cursor) ────────────
  // Pointer-down on the duck (or the live ball) grabs it; anywhere else
  // falls through to OrbitControls untouched. The pick is a three.js
  // raycast against the render rig (the WASM bindings expose no
  // mjv_select, and the rig IS the duck's collision-accurate silhouette
  // for mouse purposes). While dragging, the cursor is projected on a
  // camera-facing plane through the grab point - horizontal AND vertical
  // drags both work, so the duck can be lifted - and the target is
  // clamped inside the arena walls and to a sane height band. Desktop
  // mouse only: the touch overlay keeps its own controls.
  const GRAB_TARGET_ZMIN = 0.02, GRAB_TARGET_ZMAX = 0.45;
  const _grabRaycaster = new THREE.Raycaster();
  const _grabNdc = new THREE.Vector2();
  const _grabPlane = new THREE.Plane();
  const _grabHit = new THREE.Vector3();
  const _grabCamDir = new THREE.Vector3();
  function grabRayFrom(e) {
    const r = renderer.domElement.getBoundingClientRect();
    _grabNdc.set(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      -((e.clientY - r.top) / r.height) * 2 + 1,
    );
    _grabRaycaster.setFromCamera(_grabNdc, camera);
  }
  function grabPick() {
    const duckHit = _grabRaycaster.intersectObject(rig.placer, true)[0];
    const ballHit = ballActive ? _grabRaycaster.intersectObject(ballMesh, true)[0] : undefined;
    if (duckHit && (!ballHit || duckHit.distance <= ballHit.distance)) {
      return { kind: "duck", point: duckHit.point };
    }
    return ballHit ? { kind: "ball", point: ballHit.point } : null;
  }
  function updateGrabTarget() {
    if (!_grabRaycaster.ray.intersectPlane(_grabPlane, _grabHit)) return;
    const lim = ARENA_HALF - 0.05;
    // three (x, y, z) -> MJCF (x, -z, y), Z-up.
    grab.target[0] = Math.min(lim, Math.max(-lim, _grabHit.x));
    grab.target[1] = Math.min(lim, Math.max(-lim, -_grabHit.z));
    grab.target[2] = Math.min(GRAB_TARGET_ZMAX, Math.max(GRAB_TARGET_ZMIN, _grabHit.y));
  }
  function endGrab() {
    if (!grab) return;
    releaseGrabForce();
    controls.enabled = true;
    renderer.domElement.style.cursor = "";
  }
  endGrabHook = endGrab;
  // Capture phase on window: runs before OrbitControls' pointerdown on the
  // canvas, so the orbit can be disabled for the whole drag. The canvas's
  // own chase-detach listener still fires afterward (grabbing detaches the
  // chase cam exactly like an orbit drag does).
  window.addEventListener("pointerdown", (e) => {
    if (e.target !== renderer.domElement || e.pointerType !== "mouse" || e.button !== 0) return;
    if (grab || inputLocked) return;
    grabRayFrom(e);
    const pick = grabPick();
    if (!pick) return;
    // Any duck mesh grabs the trunk: the freejoint root carries the whole
    // body, and pulling the CoM is what the viewer perturbation feels like.
    const g = pick.kind === "duck"
      ? { bodyId: trunkId, qAdr: 0, dofAdr: 0, mass: model.body(trunkId).subtreemass }
      : {
          bodyId: mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY.value, "ball"),
          qAdr: ballQposAdr, dofAdr: ballDofAdr,
          mass: model.body(mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY.value, "ball")).mass,
        };
    camera.getWorldDirection(_grabCamDir);
    _grabPlane.setFromNormalAndCoplanarPoint(_grabCamDir.negate(), pick.point);
    grab = { ...g, target: [0, 0, 0] };
    updateGrabTarget();
    controls.enabled = false;
    renderer.domElement.style.cursor = "grabbing";
    try { renderer.domElement.setPointerCapture(e.pointerId); } catch { /* capture unsupported */ }
  }, true);
  let grabHoverAt = 0;
  window.addEventListener("pointermove", (e) => {
    if (grab) {
      grabRayFrom(e);
      updateGrabTarget();
      return;
    }
    // Hover affordance: grab cursor over anything grabbable. Throttled -
    // a full-rig raycast per mousemove event would be wasteful - and
    // skipped mid-orbit (buttons held) so the cursor doesn't flicker.
    if (e.target !== renderer.domElement || e.pointerType !== "mouse" || e.buttons || inputLocked) return;
    const now = performance.now();
    if (now - grabHoverAt < 80) return;
    grabHoverAt = now;
    grabRayFrom(e);
    const clickable = mode === "walk" && !headMode;
    renderer.domElement.style.cursor = grabPick() ? "grab" : (clickable ? "crosshair" : "");
  });
  window.addEventListener("pointerup", endGrab);
  window.addEventListener("pointercancel", endGrab);

  // Waypoint marker: pulsing ring at the clicked floor point, hidden while
  // idle. Positioned each frame in frame() from waypointSource.target.
  const waypointMarker = new THREE.Mesh(
    new THREE.RingGeometry(0.05, 0.065, 32),
    new THREE.MeshBasicMaterial({ color: 0xff7a2f, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
  );
  waypointMarker.rotation.x = -Math.PI / 2; // flat on the floor, three y-up
  waypointMarker.visible = false;
  scene.add(waypointMarker);

  // Pause: while the menu is up over a live game, keys belong to the menu.
  const setInputLock = (v) => { inputLocked = v; controller.setLocked(v); };
  useGame.subscribe(
    (s) => s.menuOpen,
    (open) => {
      // ceremony is null in football mode: no entrance/respawn gating.
      if (!ceremony?.entranceDone) return;
      if (open) setInputLock(true);
      else if (!ceremony?.respawnActive) setInputLock(false);
    },
  );

  // The rig's root already applies the MJCF Z-up -> three Y-up fix, so the
  // trunk group can take the freejoint pose in raw MJCF coordinates.
  const _target = new THREE.Vector3();
  const _follow = new THREE.Vector3();
  function syncRig() {
    const qpos = data.qpos;
    trunkGroup.position.set(qpos[0], qpos[1], qpos[2]);
    trunkGroup.quaternion.set(qpos[4], qpos[5], qpos[6], qpos[3]);
    for (let j = 0; j < NUM_JOINTS; j++) setJoint(rig, JOINT_NAMES[j], qpos[qposAdr[j]]);
    // Passive hinges (roller wheels): purely visual, driven straight from qpos.
    for (const ej of extraJoints) setJoint(rig, ej.name, qpos[ej.adr]);
    // Ball: live follows qpos; ghost freeze is owned by the ball actor.
    if (ball) ball.sync(qpos, ballQposAdr, ballActive);
    // Follow cam: ease the orbit target toward the trunk and translate the
    // camera by the same delta, so the camera-to-duck distance and viewing
    // angle stay constant while the duck walks. Paused while the reset
    // glide owns the camera.
    if (camResetT0 === null) {
      _target.set(qpos[0], qpos[2], -qpos[1]);
      _follow.copy(_target).sub(controls.target);
      // Horizontal follow at the usual rate; vertical much slower so the
      // per-step gait bob doesn't nod the frame.
      _follow.x *= 0.06;
      _follow.z *= 0.06;
      _follow.y *= 0.015;
      controls.target.add(_follow);
      camera.position.add(_follow);
    }
    // Keep the grid plane (and its fade center) under the action; the wall
    // grids share the same radial fade focus.
    grid.position.set(controls.target.x, 0, controls.target.z);
    grid.material.uniforms.uFocus.value.copy(controls.target);
    for (const m of wallMats) m.uniforms.uFocus.value.copy(controls.target);
  }

  // ── Quack: jaw + chirp ────────────────────────────────────────────────
  // The jaw isn't a MuJoCo joint (duck.js re-creates the hinge in JS), so
  // this is purely cosmetic and can't upset the policy. Voice banks from
  // the robot runtime: each colourway gets its own bank and every quack
  // draws a random chirp take from it.
  const QUACK_MS = 480;
  let quackAt = -Infinity;
  let padJaw = 0;
  const CHIRP_TAKES = "abcdefghijkl";
  const VOICE_BANK = { classic: "duck1", charcoal: "duck2", purple: "duck3", blue: "duck4" };
  function playChirp() {
    const bank = VOICE_BANK[currentVariant] ?? "duck1";
    const take = CHIRP_TAKES[(Math.random() * CHIRP_TAKES.length) | 0];
    // Decoded through the shared context on the voice bus (used to be a
    // bare HTMLAudio element outside the master gain).
    playUrl(signed(`./assets/voices/${bank}/chirp_${take}.wav`), { gain: 0.7 });
  }
  const quackLoud = () => {
    quackAt = performance.now();
    playChirp();
    stickers?.pop("quack");
  };
  // Ground-pick jaw: on the robot the pick policy drives the mouth itself
  // (mouth is part of its action space); the sim's ONNX exports have no
  // mouth channel (all heads are 14 actions), so the peck is re-created
  // here on the same phase clock. Keyed to the measured cycle: the beak
  // reaches the ground ~phase 0.16-0.42 and the head scoops back up
  // 0.40-0.50 - open on approach, snap shut on the scoop (the grab).
  const PICK_JAW_KEYS = [[0.10, 0], [0.20, 1], [0.40, 1], [0.50, 0]];
  function pickJawNow() {
    const phase = mode === "groundpick" ? pickRun?.phase : null;
    if (phase == null) return 0;
    const K = PICK_JAW_KEYS;
    if (phase <= K[0][0] || phase >= K[K.length - 1][0]) return 0;
    for (let i = 1; i < K.length; i++) {
      if (phase > K[i][0]) continue;
      const [p0, v0] = K[i - 1];
      const [p1, v1] = K[i];
      const t = (phase - p0) / (p1 - p0);
      return v0 + (v1 - v0) * (1 - Math.cos(Math.PI * t)) / 2; // eased
    }
    return 0;
  }
  function jawOpenNow() {
    const t = (performance.now() - quackAt) / QUACK_MS;
    const flap = t >= 0 && t < 1 ? Math.sin(Math.PI * t) : 0;
    // Runtime mouth-mode rule (main.rs: motor_targets[MOUTH] += offset):
    // the policy's jaw is the BASE and the trigger/quack opening is an
    // additive offset on top, clamped - it never fights the pick motion.
    return Math.min(1, pickJawNow() + Math.max(flap, padJaw));
  }
  function syncJaw() {
    setJawOpen(rig, jawOpenNow());
  }

  // ── Wheee: LT-held playable note (sim behavior) ───────────────────────
  // The ride plays the voice bank's LOOP segment only (crossfade-authored
  // to wrap sample-exactly), faded in over ~20 ms, and the LT analog
  // pressure PICKS ITS NOTE: major-pentatonic steps over one octave via
  // playbackRate, glided with setTargetAtTime so per-frame updates and
  // step changes never zipper or click. The runtime has no pitch feature
  // (raw PCM through aplay) - this is the sim's own instrument.
  //
  // The authored start segment is deliberately NOT played: it is 0.8-0.9 s
  // long and cannot be pitch-modulated without breaking the sample-accurate
  // start→loop handoff, so with it the first second of every squeeze was
  // stuck at base pitch - pressure read as a volume change (the attack's
  // own crescendo), not as notes.
  //
  // Release CUTS the ride and plays nothing else - the runtime kills the
  // streaming aplay on the LT falling edge (its end segment never plays on
  // the gamepad path), and the sim's old end-segment playback re-attacked
  // a note on release, which read as a retriggered sound. A short gain
  // ramp stands in for the process kill so Web Audio doesn't click. The
  // gain is otherwise CONSTANT - pressure must never track loudness.
  const WHEEE_TAKES = "ab";
  // Major pentatonic anchored one octave BELOW the sample's natural pitch:
  // full squeeze reaches the natural note, casual play sits clearly lower
  // (the natural pitch alone read as too shrill). -12 st = playbackRate 0.5.
  const WHEEE_SCALE = [-12, -10, -8, -5, -3, 0]; // semitones vs natural pitch
  const WHEEE_DEADZONE = 0.05; // squeeze below this is stick noise, maps to the root
  const WHEEE_GAIN = 0.7;
  let wheeeCtx = null;
  const wheeeBufCache = new Map();
  let wheeeRide = null; // current ride, null while the trigger is up
  function wheeeBuffer(url) {
    let p = wheeeBufCache.get(url);
    if (!p) {
      p = fetch(url)
        .then((r) => r.arrayBuffer())
        .then((ab) => wheeeCtx.decodeAudioData(ab));
      wheeeBufCache.set(url, p);
    }
    return p;
  }
  async function startWheee() {
    stopWheee({ silent: true }); // a re-press replaces the current ride
    wheeeCtx ??= audioCtx(); // shared game context, ride lands on the voice bus
    if (wheeeCtx.state === "suspended") wheeeCtx.resume().catch(() => {});
    const bank = VOICE_BANK[currentVariant] ?? "duck1";
    const take = WHEEE_TAKES[(Math.random() * WHEEE_TAKES.length) | 0];
    const ride = { loopSrc: null, gain: null };
    wheeeRide = ride;
    let loopBuf;
    try {
      loopBuf = await wheeeBuffer(signed(`./assets/voices/${bank}/wheee_loop_${take}.wav`));
    } catch {
      return; // asset missing / fetch failed: ride silently never starts
    }
    if (wheeeRide !== ride) return; // released (or replaced) during decode
    const gain = wheeeCtx.createGain();
    gain.connect(busNode("voice"));
    const t0 = wheeeCtx.currentTime + 0.02;
    // The loop is steady-state audio (no authored attack): a ~20 ms fade-in
    // makes a clean note onset instead of a click. Constant gain after that.
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(WHEEE_GAIN, t0 + 0.02);
    const loopSrc = wheeeCtx.createBufferSource();
    loopSrc.buffer = loopBuf;
    loopSrc.loop = true;
    loopSrc.connect(gain);
    loopSrc.start(t0);
    Object.assign(ride, { loopSrc, gain });
  }
  function stopWheee({ silent = false } = {}) {
    const ride = wheeeRide;
    if (!ride) return;
    wheeeRide = null;
    // Nothing audible yet (released mid-decode) or replaced by a re-press:
    // hard stop is inaudible and frees the nodes immediately.
    if (silent || !ride.gain) {
      try { ride.loopSrc?.stop(); } catch { /* already ended */ }
      ride.gain?.disconnect();
      return;
    }
    // Release: cut the ride, retrigger nothing (runtime kills its player
    // here). ~50 ms fade instead of a hard stop so the cut doesn't click.
    const t = wheeeCtx.currentTime;
    ride.gain.gain.setTargetAtTime(0, t, 0.05);
    const stopAt = t + 0.3; // > 5 time constants: fully silent by then
    try { ride.loopSrc?.stop(stopAt); } catch { /* already ended */ }
    const gain = ride.gain;
    setTimeout(() => gain.disconnect(), 400);
  }

  // Per-frame note picking: the full LT travel (above a small deadzone)
  // spans the pentatonic scale, one octave below natural pitch at rest up
  // to the natural pitch at full squeeze. Quantized to scale steps so
  // squeezing plays NOTES, not a siren; the ~40 ms setTargetAtTime glide
  // smooths both the per-frame updates and the step jumps (portamento
  // instead of clicks). Digital 0/1 triggers simply play the top note
  // (the natural pitch). Gain never tracks pressure.
  function driveWheeePitch(pressure) {
    const ride = wheeeRide;
    if (!ride?.loopSrc) return;
    const u = Math.min(1, Math.max(0, (pressure - WHEEE_DEADZONE) / (1 - WHEEE_DEADZONE)));
    const semis = WHEEE_SCALE[Math.round(u * (WHEEE_SCALE.length - 1))];
    ride.loopSrc.playbackRate.setTargetAtTime(2 ** (semis / 12), wheeeCtx.currentTime, 0.04);
  }

  // ── Telemetry (throttled into the store) ─────────────────────────────
  // FPS EMA is per-frame; the store write is 4 Hz so React re-renders
  // stay far away from frame rate. Odometer integrates horizontal trunk
  // travel; teleport-sized jumps (resets, loco swaps) don't count.
  let fpsEma = 60;
  let fpsLastT = performance.now();
  let odoM = 0;
  let odoX = null, odoY = null;
  let telemetryLastPush = 0;
  function renderTelemetry() {
    const now = performance.now();
    const dtF = (now - fpsLastT) / 1000;
    fpsLastT = now;
    if (dtF > 0 && dtF < 0.5) fpsEma += (1 / dtF - fpsEma) * 0.05;
    const stepD = (odoX === null) ? 0 : Math.hypot(data.qpos[0] - odoX, data.qpos[1] - odoY);
    if (stepD < 0.05) odoM += stepD; // plausible per-frame travel only
    odoX = data.qpos[0];
    odoY = data.qpos[1];
    if (now - telemetryLastPush < 250) return;
    telemetryLastPush = now;
    setStore({
      telemetry: {
        fps: Math.round(fpsEma),
        ctrlHz: Math.round(ctrlHz),
        speed: Math.hypot(data.qvel[0], data.qvel[1]),
        odo: odoM,
        peers: ghosts?.peerCount() ?? 0,
      },
    });
  }

  // ── Right-stick camera orbit (inertia downstream of the controller) ──
  // The stick steers an angular VELOCITY that eases toward the stick's
  // target rate, so pushing ramps up gently and releasing coasts to a stop
  // over ~0.3 s. Vertical is flight-style inverted.
  const PAD_ORBIT_SPEED = 2.4; // rad/s at full deflection
  const PAD_ORBIT_SMOOTH = 8; // 1/s response rate (~95% in 0.37 s)
  const padOrbitVel = { az: 0, el: 0 };
  const _padSph = new THREE.Spherical();
  const _padOff = new THREE.Vector3();
  function padOrbitStep(rx, ry, dt) {
    padOrbitLive = rx !== 0 || ry !== 0;
    if (padOrbitLive) chaseCam = false; // detach, same as a mouse grab
    const k = 1 - Math.exp(-PAD_ORBIT_SMOOTH * dt);
    padOrbitVel.az += (rx * PAD_ORBIT_SPEED - padOrbitVel.az) * k;
    padOrbitVel.el += (-ry * PAD_ORBIT_SPEED * 0.75 - padOrbitVel.el) * k;
    if (chaseCam) { padOrbitVel.az = 0; padOrbitVel.el = 0; return; }
    if (Math.abs(padOrbitVel.az) < 1e-3 && Math.abs(padOrbitVel.el) < 1e-3) return;
    _padOff.copy(camera.position).sub(controls.target);
    _padSph.setFromVector3(_padOff);
    _padSph.theta -= padOrbitVel.az * dt;
    _padSph.phi += padOrbitVel.el * dt;
    _padSph.phi = Math.min(controls.maxPolarAngle, Math.max(0.08, _padSph.phi));
    _padSph.makeSafe();
    camera.position.setFromSpherical(_padSph).add(controls.target);
    camera.lookAt(controls.target);
  }

  // Multiplayer ghosts, initialised asynchronously at the end of the boot.
  let ghosts = null;

  // ── Per-frame drive, called by R3F's useFrame ────────────────────────
  let padWasConnected = null;
  let touchWasConnected = null;
  function frame(dt) {
    controller.update(dt);
    padJaw = controller.getAxes().jaw;
    driveWheeePitch(controller.getAxes().ride); // no-op while no ride is open
    if (padSource.connected !== padWasConnected) {
      padWasConnected = padSource.connected;
      setStore({ padConnected: padSource.connected });
    }
    if (touchSource.connected !== touchWasConnected) {
      touchWasConnected = touchSource.connected;
      setStore({ touchMode: touchSource.connected });
    }
    // Head mode: sticks steer the head targets (stick * HEAD_MAX, signed
    // per joint); the EMA toward them runs in buildObs at 50 Hz. Without
    // a pad the targets stay put (and are debug-writable via window.rl).
    if (headMode && padSource.connected) {
      const h = padSource.head;
      headTarget[0] = HEAD_SIGNS[0] * h.neckPitch * HEAD_MAX;
      headTarget[1] = HEAD_SIGNS[1] * h.pitch * HEAD_MAX;
      headTarget[2] = HEAD_SIGNS[2] * h.yaw * HEAD_MAX;
      headTarget[3] = HEAD_SIGNS[3] * h.roll * HEAD_MAX;
    }
    // Camera orbit runs every frame while a pad is present (the coasting
    // needs the zero-deflection frames too); without a pad, park the
    // state. Head mode parks it too: the right stick belongs to the head
    // and the camera must freeze in place (no leftover coasting).
    if (padSource.connected && !headMode) {
      padOrbitStep(controller.getAxes().orbitX, controller.getAxes().orbitY, dt);
    } else {
      padOrbitLive = false;
      padOrbitVel.az = 0;
      padOrbitVel.el = 0;
    }
    syncRig();
    syncJaw();
    ghosts?.update();
    // Spatial audio follows the movers: listener on the camera, emitters
    // on the duck trunk and the ball (MJCF Z-up -> three Y-up).
    updateListener(camera);
    duckEmitter.setPosition(data.qpos[0], data.qpos[2], -data.qpos[1]);
    if (ballActive) {
      const q = data.qpos;
      ballEmitter.setPosition(q[ballQposAdr], q[ballQposAdr + 2], -q[ballQposAdr + 1]);
    }
    controls.update();
    updateChaseCam();
    ceremony.drive();
    ball.drive(() => spawnBall({ fromQueue: true }));
    const wpTarget = waypointSource.target;
    waypointMarker.visible = !!wpTarget;
    if (wpTarget) {
      waypointMarker.position.set(wpTarget[0], 0.012, -wpTarget[1]); // MJCF -> three
      waypointMarker.scale.setScalar(1 + 0.15 * Math.sin(performance.now() * 0.006));
    }
    renderTelemetry();
  }

  // ── Input wiring: arm the controller sources, bind actions ───────────
  controller.init();

  // Keyboard F alternates kicking feet; only advance the alternation on
  // kicks that actually launched (triggerKick reports that).
  let kbKickFoot = "left";
  const srcTag = (source) => (source === "gamepad" ? "pad" : "kb");

  controller.on("reset", () => resetSim());
  controller.on("reset", () => waypointSource.cancel());
  controller.on("spawnBall", () => spawnBall());
  controller.on("headToggle", () => toggleHeadMode());
  controller.on("chaseToggle", () => { chaseCam = !chaseCam; });
  controller.on("locoToggle", () => toggleLoco());
  controller.on("roll", ({ source }) => triggerRoll(srcTag(source)));
  controller.on("groundPick", ({ source }) => triggerGroundPick(srcTag(source)));
  controller.on("kickL", ({ source }) => triggerKick("left", srcTag(source)));
  controller.on("kickR", ({ source }) => triggerKick("right", srcTag(source)));
  controller.on("alternateKick", ({ source }) => {
    if (triggerKick(kbKickFoot, srcTag(source))) {
      kbKickFoot = kbKickFoot === "left" ? "right" : "left";
    }
  });
  // Sit is the legs-only skill; on rollers the same button hands over to
  // the crouch-glide, exactly as the (now unbound) roll action did.
  controller.on("sitToggle", ({ source } = {}) => {
    if (loco !== "legs") return triggerCrouch(srcTag(source));
    const sitting = mode === "sitstand" && sitFlag === 1;
    setMode(sitting ? "walk" : "sit");
  });
  // Pad DpadUp short press: straight back to running (ignored mid-roll /
  // mid-crouch: those hand back to walk on their own).
  controller.on("walk", () => {
    if (mode !== "walk" && mode !== "roll" && mode !== "crouch") setMode("walk");
  });
  controller.on("quack", () => quackLoud());
  controller.on("wheeeStart", () => startWheee());
  controller.on("wheeeStop", () => stopWheee());

  // Leaving head mode keeps the head offsets (runtime behavior): only
  // resetSim zeroes headTarget/headSmooth.
  function exitHeadMode() {
    if (!headMode) return;
    headMode = false;
    padSource.headMode = false;
    syncButtons();
  }

  function toggleHeadMode() {
    if (headMode) return exitHeadMode();
    // Enterable from walk or sit only - never during one-shots (roll /
    // kick / crouch), the post-kick grace, a stand-up hand-back, a fall
    // recovery, or while the entrance/respawn lock holds the inputs.
    if (inputLocked || (mode !== "walk" && mode !== "sitstand") || postKickLock > 0 ||
        standTimer || recovery)
      return;
    headMode = true;
    padSource.headMode = true;
    syncButtons();
  }

  function setMode(next, { force = false } = {}) {
    if (!force && inputLocked) return;
    // No policy switching mid-roll or mid-kick: both end on their own and
    // return to walk - switching now would floor the duck. Same while the
    // fall-recovery state machine owns the duck.
    if (recovery) return;
    if ((mode === "roll" && rollRun) || (isKick() && kickRun) ||
        (mode === "crouch" && crouchRun) || (mode === "groundpick" && pickRun)) return;
    if (next === "sit" && loco === "rollers") return;
    exitHeadMode(); // posture changes exit head mode (offsets kept)
    clearModeTimers();
    rollRun = null;
    crouchRun = null;
    pickRun = null;
    if (next !== "sit") {
      // Leaving a sit: let the sitstand policy stand the duck back up first.
      if (mode === "sitstand" && sitFlag === 1) {
        sitFlag = 0;
        standTimer = setTimeout(() => {
          standTimer = null;
          mode = next;
          lastAction.fill(0);
          syncButtons();
        }, 2000);
        syncButtons();
        return;
      }
      mode = next;
      lastAction.fill(0);
    } else {
      // Hand over gently: hold the stand under the sitstand policy for a
      // moment before commanding the sit, or the abrupt session switch
      // knocks the duck over.
      mode = "sitstand";
      sitFlag = 0;
      lastAction.fill(0);
      sitTimer = setTimeout(() => {
        sitTimer = null;
        if (mode === "sitstand") { sitFlag = 1; syncButtons(); }
      }, 800);
    }
    syncButtons();
  }

  // One roll, then straight back to running. lastAction is deliberately
  // NOT zeroed: the runtime keeps one continuous action history across
  // policy switches, and the roll initiates more reliably mid-gait.
  function triggerRoll(source = "kb") {
    if (loco === "rollers") return triggerCrouch(source);
    if (inputLocked || mode !== "walk" || standTimer || recovery) return;
    exitHeadMode();
    clearModeTimers();
    mode = "roll";
    sitFlag = 0;
    rollRun = { steps: 0, tipped: false };
    syncButtons();
    stickers?.pop("roll");
  }

  // Roller-only one-shot: crouch, glide low, stand back up (phase-driven).
  function triggerCrouch(source = "kb") {
    if (inputLocked || mode !== "walk" || locoSwitching || recovery) return;
    exitHeadMode();
    clearModeTimers();
    mode = "crouch";
    crouchRun = { phase: 0 };
    syncButtons();
    stickers?.pop("roll");
  }

  // One-shot ground pick (runtime A button): peck the ground and stand
  // back up, phase-driven like the roller crouch (same cos/sin encoding in
  // the command vel slots). Legs-only, from walk, and never during another
  // one-shot / a stand-up hand-back / the entrance lock.
  function triggerGroundPick(source = "kb") {
    if (loco !== "legs") return;
    if (inputLocked || mode !== "walk" || standTimer || recovery) return;
    exitHeadMode();
    clearModeTimers();
    mode = "groundpick";
    sitFlag = 0;
    pickRun = { phase: 0 };
    syncButtons();
  }

  // One blind kick (the duck can't see any ball - it's a scripted boot).
  // Returns whether the kick actually launched so the keyboard's foot
  // alternation only advances on real kicks.
  function triggerKick(foot, source = "kb") {
    if (loco === "rollers") return false;
    if (inputLocked || mode !== "walk" || standTimer || recovery) return false;
    exitHeadMode();
    clearModeTimers();
    mode = foot === "left" ? "kickL" : "kickR";
    sitFlag = 0;
    kickRun = { steps: 0 };
    haptics.pulse("kick"); // swing launch; ball contact adds ballHit
    syncButtons();
    stickers?.pop("kick");
    return true;
  }

  // ── Dual team FPV (chaser eye-cams → HUD <canvas> via RenderTarget) ─
  // Scissor-into-main-canvas failed (transparent holes just showed the
  // overview cam, and Back/GitHub sat in the windows). Opaque canvases +
  // RT blit are reliable.
  let fpvSlots = null; // { red: HTMLCanvasElement, blue: HTMLCanvasElement }
  const FPV_RT_W = 320;
  const FPV_RT_H = 200;
  const fpvCamRed = new THREE.PerspectiveCamera(78, FPV_RT_W / FPV_RT_H, 0.04, 24);
  const fpvCamBlue = new THREE.PerspectiveCamera(78, FPV_RT_W / FPV_RT_H, 0.04, 24);
  const fpvRt = new THREE.WebGLRenderTarget(FPV_RT_W, FPV_RT_H, {
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    depthBuffer: true,
    stencilBuffer: false,
  });
  const fpvPixelBuf = new Uint8Array(FPV_RT_W * FPV_RT_H * 4);
  const fpvFlipBuf = new Uint8ClampedArray(FPV_RT_W * FPV_RT_H * 4);
  const _fpvEye = new THREE.Vector3();
  const _fpvLook = new THREE.Vector3();
  const _fpvBall = new THREE.Vector3();
  const FPV_LOOK_AHEAD = 1.6;
  const FPV_LOOK_DOWN = 0.02;
  const FPV_FWD_BIAS = 0.07;   // sit in front of the skull so we don't clip self
  let fpvAcc = 0;
  const FPV_PERIOD = 1 / 18; // ~18 Hz is enough for PiP

  function setFpvSlots(slots) {
    fpvSlots = slots;
  }

  function pickTeamChaser(team) {
    if (!isFootball || !ducks.length) return null;
    const q = data.qpos;
    const ball = {
      x: Number.isFinite(q[ballQposAdr]) ? q[ballQposAdr] : 0,
      y: Number.isFinite(q[ballQposAdr + 1]) ? q[ballQposAdr + 1] : 0,
    };
    const teamDucks = ducks
      .filter((d) => d.team === team && !(d.penaltyTimer > 0) && !d.sentOff)
      .map((d) => ({
        id: d.id,
        role: d.role,
        yaw: Number.isFinite(d.yaw) ? d.yaw : 0,
        fallen: !!d.recovery,
        penalized: false,
        sentOff: false,
        pos: [
          Number.isFinite(d.pos[0]) ? d.pos[0] : 0,
          Number.isFinite(d.pos[1]) ? d.pos[1] : 0,
        ],
      }));
    const id = assignChaserId(teamDucks, ball);
    if (id < 0) {
      // Fallback: any standing field duck, else any teammate with a rig
      return ducks.find((d) => d.team === team && d.role !== "goalkeeper" && !d.recovery)
        || ducks.find((d) => d.team === team) || null;
    }
    return ducks.find((d) => d.id === id) || null;
  }

  /**
   * True eye-cam from the chaser head: mostly follow body yaw, with a light
   * ball bias. Heavy look-at-ball + FOV crush made both PiPs look like the
   * same ground-stare "ball cam" (opponent cropped, own legs in frame).
   */
  function placeFpvCam(cam, duck) {
    if (!duck?.rig) return false;
    const head = duck.rig.bodies.get("jaw_soft")
      || duck.rig.bodies.get("trunk_base");
    if (!head) return false;
    // Parents must be current — football sync writes local trunk poses only.
    duck.rig.placer.updateWorldMatrix(true, true);
    head.getWorldPosition(_fpvEye);
    const yaw = Number.isFinite(duck.yaw) ? duck.yaw : 0;
    // Forward in three.js XZ (MJCF yaw → cos on X, −sin on Z).
    const fx = Math.cos(yaw);
    const fz = -Math.sin(yaw);
    _fpvEye.x += fx * FPV_FWD_BIAS;
    _fpvEye.y += 0.02;
    _fpvEye.z += fz * FPV_FWD_BIAS;
    // Heading look — keep the horizon / opponents in frame.
    _fpvLook.set(
      _fpvEye.x + fx * FPV_LOOK_AHEAD,
      _fpvEye.y - FPV_LOOK_DOWN,
      _fpvEye.z + fz * FPV_LOOK_AHEAD,
    );
    const q = data.qpos;
    const bx = Number.isFinite(q[ballQposAdr]) ? q[ballQposAdr] : 0;
    const by = Number.isFinite(q[ballQposAdr + 1]) ? q[ballQposAdr + 1] : 0;
    const bz = Number.isFinite(q[ballQposAdr + 2]) ? q[ballQposAdr + 2] : 0.05;
    // Aim slightly above the ball so look-at doesn't pitch into the turf.
    _fpvBall.set(bx, Math.max(bz, 0.05) + 0.14, -by);
    const dx = bx - (Number.isFinite(duck.pos[0]) ? duck.pos[0] : 0);
    const dy = by - (Number.isFinite(duck.pos[1]) ? duck.pos[1] : 0);
    const bd = Math.hypot(dx, dy);
    const track = Math.max(0, Math.min(1, 1 - bd / 2.4));
    // Cap ball pull — heading stays dominant even at feet.
    _fpvLook.lerp(_fpvBall, 0.1 + 0.32 * track);
    cam.fov = 82 - 8 * track;
    cam.near = 0.05;
    cam.updateProjectionMatrix();
    cam.position.copy(_fpvEye);
    cam.up.set(0, 1, 0);
    cam.lookAt(_fpvLook);
    cam.updateMatrixWorld();
    return true;
  }

  function blitRtToCanvas(canvas) {
    if (!canvas?.getContext) return;
    renderer.readRenderTargetPixels(fpvRt, 0, 0, FPV_RT_W, FPV_RT_H, fpvPixelBuf);
    // WebGL is bottom-up; canvas ImageData is top-down — flip rows.
    const row = FPV_RT_W * 4;
    for (let y = 0; y < FPV_RT_H; y++) {
      const src = (FPV_RT_H - 1 - y) * row;
      fpvFlipBuf.set(fpvPixelBuf.subarray(src, src + row), y * row);
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (canvas.width !== FPV_RT_W) canvas.width = FPV_RT_W;
    if (canvas.height !== FPV_RT_H) canvas.height = FPV_RT_H;
    ctx.putImageData(new ImageData(fpvFlipBuf, FPV_RT_W, FPV_RT_H), 0, 0);
  }

  function renderOneFpv(team, cam, canvas) {
    if (!canvas) return;
    const duck = pickTeamChaser(team);
    if (!placeFpvCam(cam, duck)) {
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "#050508";
        ctx.fillRect(0, 0, canvas.width || FPV_RT_W, canvas.height || FPV_RT_H);
      }
      return;
    }
    // Hide the whole chaser rig so the eye-cam never sees its own mesh.
    const hid = duck?.rig?.placer;
    const wasVis = hid ? hid.visible : true;
    if (hid) hid.visible = false;
    const prev = renderer.getRenderTarget();
    const prevColor = new THREE.Color();
    renderer.getClearColor(prevColor);
    const prevAlpha = renderer.getClearAlpha();
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = true;
    renderer.setClearColor(0x08080c, 1);
    renderer.setRenderTarget(fpvRt);
    renderer.clear();
    renderer.render(scene, cam);
    renderer.setRenderTarget(prev);
    renderer.setClearColor(prevColor, prevAlpha);
    renderer.autoClear = prevAutoClear;
    if (hid) hid.visible = wasVis;
    blitRtToCanvas(canvas);
  }

  function renderTeamFpv(dt = FPV_PERIOD) {
    if (!isFootball || !fpvSlots || !renderer) return;
    fpvAcc += dt;
    if (fpvAcc < FPV_PERIOD) return;
    fpvAcc = 0;
    // Prefer live DOM query so late boot / remount still finds canvases.
    const red = fpvSlots.red
      || document.querySelector("canvas[data-fpv='red']");
    const blue = fpvSlots.blue
      || document.querySelector("canvas[data-fpv='blue']");
    if (!red && !blue) return;
    // Never blit the same canvas twice if refs somehow alias.
    if (red && blue && red === blue) {
      renderOneFpv("red", fpvCamRed, red);
      return;
    }
    renderOneFpv("red", fpvCamRed, red);
    renderOneFpv("blue", fpvCamBlue, blue);
  }

  function syncButtons() {
    const sitting = mode === "sitstand" && sitFlag === 1;
    const label =
      recovery ? "Recovery"
      : mode === "roll" ? "Roll"
      : mode === "crouch" ? "Crouch"
      : mode === "groundpick" ? "Pick"
      : isKick() ? "Kick"
      : headMode ? "Head"
      : sitting ? "Sit"
      : loco === "rollers" ? "Drive"
      : "Run";
    if (store().modeLabel !== label) setStore({ modeLabel: label });
    if (store().ballActive !== ballActive) setStore({ ballActive });
  }

  // ── Public surface for the React UI ──────────────────────────────────
  Object.assign(gameApi, {
    // Frame dispatch: football runs the broadcast drive (six rigs, no
    // chase cam / ceremony); sandbox keeps the original path.
    frame: (dt) => (isFootball ? frameFootball(dt) : frame(dt)),
    setVariant: (name) => {
      if (!VARIANTS[name] || name === currentVariant) return;
      currentVariant = name;
      applyVariant(rig, name);
      setStore({ variant: name });
    },
    requestLoco: (name) => {
      if (name !== "legs" && name !== "rollers") return;
      setStore({ locoWant: name });
      reconcileLoco();
    },
    resetSim,
    spawnBall: () => spawnBall(),
    startEntrance: () => ceremony?.startEntrance(),
    // Coach tactics (football only)
    setTeamStrategy: (partial, opts) => setTeamStrategy(partial, opts),
    setUserTeam: (team) => setUserTeam(team),
    setFpvSlots,
    renderTeamFpv,
    getStrategy: () => ({
      userTeam: store().userTeam,
      userStrategy: store().userStrategy,
      opponentStrategy: store().opponentStrategy,
      strategyByTeam: { ...strategyByTeam },
      fingerprints: {
        red: strategyFingerprint(strategyByTeam.red),
        blue: strategyFingerprint(strategyByTeam.blue),
      },
      formationLocked,
      activeSpawns: activeSpawns.map((s) => ({ ...s })),
    }),
  });

  // Deterministic hooks for automated verification (rAF pauses in
  // background tabs, and the control loop is async).
  window.rl = {
    get model() { return model; },
    get data() { return data; },
    mujoco, camera, controls,
    get mode() { return mode; },
    get sitFlag() { return sitFlag; },
    buildObs, cmd,
    velCmd: kbSource.command, lastAction, resetSim,
    controller, kbSource, padSource,
    spawnBall, triggerKick, triggerRoll, sessions, ort,
    get loco() { return loco; },
    get locoSwitching() { return locoSwitching; },
    toggleLoco, setLoco, ensureRollers,
    triggerCrouch,
    get crouchPhase() { return crouchRun?.phase ?? null; },
    triggerGroundPick,
    get groundPickPhase() { return pickRun?.phase ?? null; },
    get kickSteps() { return KICK_STEPS; },
    set kickSteps(v) { KICK_STEPS = v; },
    get recovery() { return recovery?.state ?? null; },
    // Debug shove for fall-recovery testing: an instantaneous trunk
    // velocity kick (free-joint dofs are qvel[0..5]).
    debugPush: (vx = 0, vy = 0, vz = 0, wx = 0, wy = 0, wz = 0) => {
      const qvel = data.qvel;
      qvel[0] += vx; qvel[1] += vy; qvel[2] += vz;
      qvel[3] += wx; qvel[4] += wy; qvel[5] += wz;
    },
    get headMode() { return headMode; },
    toggleHeadMode, headTarget, headSmooth,
    get ballActive() { return ballActive; },
    get ballQposAdr() { return ballQposAdr; },
    get chaseCam() { return chaseCam; },
    set chaseCam(v) { chaseCam = !!v; },
    get props() { return propGroups; },
    get relief() { return reliefOn; },
    setRelief: (v) => { reliefOn = !!v; },
    get camResetActive() { return camResetT0 !== null; },
    get respawnActive() { return ceremony?.respawnActive ?? false; },
    get camPose() {
      return {
        pos: camera.position.toArray(),
        target: controls.target.toArray(),
      };
    },
    get chaseYaw() { return { follow: chaseYawFollow, smooth: chaseYawSmooth, held: chaseHeldYaw, tracking: chaseYawTracking }; },
    padOrbitStep,
    jawOpenNow,
    step: async (n = 1) => { for (let i = 0; i < n; i++) await controlStep(); },
    render: () => { syncRig(); renderer.render(scene, camera); },
    frame: (dt = 1 / 60) => (isFootball ? frameFootball(dt) : frame(dt)),
    get ghosts() { return ghosts; },
    get inputLocked() { return inputLocked; },
    entrance: {
      // ceremony is null in football mode: entrance hooks are sandbox-only.
      start: () => ceremony?.startEntrance(),
      setReveal: (floor, wall) => ceremony?.setReveal(floor, wall),
      setFx: (p) => ceremony?.setFx(p),
    },
  };

  // ── Football mode: debug / verification surface ───────────────────
  // Deterministic hooks mirroring window.rl for the 3v3 match: duck and
  // ball state, model dims (nq must be 6x21+7, nu 6x14) and manual
  // stepping / benchmarking of the multi-duck control loop.
  if (isFootball) {
    window.football = {
      ducks: () => ducks.map((d) => ({
        id: d.id, team: d.team, role: d.role,
        pos: [...d.pos], yaw: d.yaw, mode: d.mode,
        penalized: d.penaltyTimer > 0, sentOff: d.sentOff,
      })),
      ball: () => ({
        pos: [data.qpos[ballQposAdr], data.qpos[ballQposAdr + 1], data.qpos[ballQposAdr + 2]],
        vel: [data.qvel[ballDofAdr], data.qvel[ballDofAdr + 1], data.qvel[ballDofAdr + 2]],
        speed: Math.hypot(
          data.qvel[ballDofAdr], data.qvel[ballDofAdr + 1], data.qvel[ballDofAdr + 2],
        ),
        active: ballActive,
      }),
      model: { nq: model.nq, nu: model.nu, nbody: model.nbody, ngeom: model.ngeom },
      step: async (n = 1) => { for (let i = 0; i < n; i++) await controlStep(); },
      bench: async (n = 100) => {
        const t0 = performance.now();
        let onnxSum = 0;
        for (let i = 0; i < n; i++) { await controlStep(); onnxSum += lastOnnxMs; }
        const ms = performance.now() - t0;
        const perStep = ms / n;
        return {
          steps: n, totalMs: ms, perStep, ctrlHz: 1000 / perStep,
          onnxMs: onnxSum, onnxPerStep: onnxSum / n,
        };
      },
      degraded: () => degraded,
      aiDivider: () => aiDivider,
      config: matchConfig,
      // Top-level match control (called by FootballTitle "Kick Off" button)
      startMatch: () => {
        celebration?.cancel();
        // Fresh match: clear discipline carried over from a previous game so
        // sent-off / sin-binned ducks (and their charcoal skin) don't persist
        // into the restart. The referee's kickoff event then runs executeKickoff,
        // which re-places every duck and restores the team colourways (Bug C/D).
        for (const duck of ducks) {
          duck.penaltyTimer = 0;
          duck.sentOff = false;
          duck.cards.yellow = 0;
          duck.cards.red = 0;
        }
        // Sync coach choices (both cards), then lock formation for the match.
        strategyByTeam = strategiesForUser(
          store().userTeam || "red",
          store().userStrategy || DEFAULT_STRATEGY,
          store().opponentStrategy || DEFAULT_STRATEGY,
        );
        applyFormationFromStrategies();
        formationLocked = true;
        matchStats?.reset();
        setStore({ tacticsCard: null, tacticsBoard: null, matchResult: null });
        if (referee) referee.startMatch();
        else { cacheDuckPoses(); spawnBallFootball(); }
      },
      // Referee debug surface
      referee: referee ? {
        getState: () => referee.getState(),
        getScore: () => referee.getScore(),
        getMatchTime: () => referee.getMatchTime(),
        getSetPiece: () => referee.getSetPiece(),
        getCards: () => referee.getCards(),
        startMatch: () => referee.startMatch(),
      } : null,
      celebration: celebration ? {
        isActive: () => celebration.isActive(),
        cancel: () => celebration.cancel(),
      } : null,
    };
  }

  // Boot complete: the sim/HUD go live immediately. The BIOS readout (if
  // the user already waddled in, or when they do) sees bootDone and closes
  // with READY. + fade on its own.
  setStore({ bootDone: true });

  // ── Multiplayer ghosts (WebRTC, serverless signaling) ────────────────
  // Broadcast this duck's pose and render up to 3 other visitors live as
  // translucent ducks. Fire-and-forget: any failure just means no ghosts.
  const r3 = (x) => Math.round(x * 1000) / 1000;
  // Football skips multiplayer ghosts entirely: the session gates on
  // ceremony.entranceFinished (null in football) and would broadcast a
  // single-duck sandbox state that doesn't exist here.
  if (!isFootball) {
    try {
      // Ghosts only join once the entrance has fully played: the world (and
      // this duck) must stay hidden until then, translucent peers included.
      await ceremony.entranceFinished;
      ghosts = await initGhosts({
        scene, rig, cloneRig, setJoint, setJawOpen, applyVariant,
        jointNames: JOINT_NAMES,
        // Payload sanitizing: ghosts.js coerces unknown peer variants to the
        // default instead of letting applyVariant throw on a bad key.
        variantNames: Object.keys(VARIANTS),
        defaultVariant: DEFAULT_VARIANT,
        // Ghost rig per locomotion flag: roller peers clone the live roller
        // rig when this tab has it, else the lightweight ghost-only roller
        // rig. hasRigFor/prepareRigFor let ghosts.js render legs as a
        // stopgap while lazily loading the real thing, then rebuild.
        getRigFor: (l) =>
          (l ? (locos.rollers?.rig ?? ghostRollerRig ?? locos.legs.rig) : locos.legs.rig),
        hasRigFor: (l) => !l || !!(locos.rollers || ghostRollerRig),
        prepareRigFor: (l) => { if (l) ensureGhostRollerRig(); },
        // Ghost ball visual: shares the local ball's geometry and clones its
        // material (ghosts.js makes it translucent). Same Z-up group trick
        // as createBallVisual - the mesh takes the raw MJCF free-joint pose.
        makeGhostBall: () => {
          const group = new THREE.Group();
          group.rotation.x = -Math.PI / 2;
          const mesh = new THREE.Mesh(ballMesh.geometry, ballMesh.material.clone());
          group.add(mesh);
          return { group, mesh };
        },
        getLocalState: () => {
          const qpos = data.qpos;
          const j = new Array(NUM_JOINTS);
          for (let i = 0; i < NUM_JOINTS; i++) j[i] = r3(qpos[qposAdr[i]]);
          const st = {
            p: [r3(qpos[0]), r3(qpos[1]), r3(qpos[2]), r3(qpos[3]), r3(qpos[4]), r3(qpos[5]), r3(qpos[6])],
            j,
            w: r3(jawOpenNow()),
            v: currentVariant,
            l: loco === "rollers" ? 1 : 0,
          };
          // Ball free-joint pose, only while a ball is in play (old clients
          // ignore the extra field; absent = no ball on this peer's field).
          if (ballActive) {
            const a = ballQposAdr;
            st.b = [r3(qpos[a]), r3(qpos[a + 1]), r3(qpos[a + 2]), r3(qpos[a + 3]), r3(qpos[a + 4]), r3(qpos[a + 5]), r3(qpos[a + 6])];
          }
          return st;
        },
      });
      liveGhostSessions.add(ghosts);
      if (ghosts.room) ghosts.room.onPeerJoin = () => stickers?.pop("hi");
    } catch (e) {
      window.__ghostErr = String((e && e.stack) || e);
      console.warn("ghosts disabled:", e);
    }
  }
}
