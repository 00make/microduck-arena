// Goal celebration: camera swing onto the goal + wireframe flash over the
// scoring team's ducks, on a fixed 2.5 s timeline.
//
// Timeline (seconds from play()):
//   0.00 - 0.30  camera glides from its current frame to the goal view
//   0.20 - 1.20  scoring-team rigs flash (wireframe scan-up when the FX
//                factory is injected, emissive pulse otherwise)
//   0.30 - 1.80  hold on the goal
//   1.80 - 2.50  camera glides back; at 2.50 the override drops and the
//                caller's chase cam takes over again
//
// Same contract as ceremony.js: this file never touches MuJoCo and never
// writes to the camera directly - game.js owns the camera and consumes
// getCameraOverride() once per frame while isActive(). All world objects
// (camera, rigs) arrive through the injected deps.
//
// Coordinates: goalPos is raw MJCF {x, y, z} (Z up); three.js world is
// (x, z, -y), matching goal.js's convention.

import * as THREE from 'three';

export const DURATION = 2.5;        // seconds total
const CAM_PAN_TIME = 0.3;           // phase 1: swing onto the goal
const FLASH_START = 0.2;            // phase 2: team flash window
const FLASH_END = 1.2;
const FLASH_STAGGER = 0.12;         // per-rig delay inside the window
const CAM_RETURN_START = 1.8;       // phase 3: glide home
const CAM_RETURN_END = DURATION;

// Goal framing: stand the camera off the goal line toward the field
// centre, above and behind the mouth, looking at the net.
const CAM_PULLBACK = 1.6;           // metres toward the field centre
const CAM_HEIGHT = 1.1;             // metres above the goal centre

const clamp01 = (x) => Math.min(Math.max(x, 0), 1);
const easeInOut = (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);

// MJCF {x,y,z} -> three.js Vector3 (Y up).
const toWorld = (p) => new THREE.Vector3(p.x, p.z, -p.y);

// Emissive fallback tuning: two quick team-coloured pulses across the
// flash window. Materials are cloned per celebration (never mutate the
// shared variants.js matCache instances) and restored byte-exact at the
// end, so variant fades / ghostify keep working untouched.
const PULSE_HZ = 2;
const EMISSIVE_STRENGTH = 0.9;
const TEAM_EMISSIVE = {
  red: new THREE.Color(0xff2244),
  blue: new THREE.Color(0x2266ff),
};

/**
 * @param {object} deps
 *   camera            THREE camera (read-only: its current frame seeds the
 *                     swing; the override is handed back for game.js to apply)
 *   scene             THREE scene (passed through to wireframe FX init)
 *   getScoringTeamRigs (team) => Array<rig>  rigs of the scoring side, each
 *                     a duck.js-style rig ({ root, placer })
 *   createFx          optional () => wireframe-FX instance (inject
 *                     fx-wireframe.js's createWireframeFx for the scan-up
 *                     flash; without it the emissive pulse runs instead)
 * @returns {{ play(team: 'red'|'blue', goalPos: {x,y,z}): void,
 *             drive(dt: number): void,
 *             getCameraOverride(): {position: THREE.Vector3, lookAt: THREE.Vector3}|null,
 *             isActive(): boolean,
 *             cancel(): void }}
 */
export function createCelebration({ camera, scene, getScoringTeamRigs, createFx = null }) {
  let active = false;
  let elapsed = 0;
  let team = null;

  // Camera swing endpoints, captured at play() so mid-celebration chase-cam
  // writes elsewhere can't drag the timeline around.
  const camFrom = new THREE.Vector3();
  const camTo = new THREE.Vector3();
  const lookAt = new THREE.Vector3();
  const camPos = new THREE.Vector3(); // scratch, returned by the override

  // Per-rig flash state: { fx?, rig, meshes?: [{mesh, orig, clone}], cued, color }
  let flashes = [];

  function rigRoot(rig) {
    return rig?.placer ?? rig?.root ?? null;
  }

  function buildFlashes() {
    const color = TEAM_EMISSIVE[team] ?? TEAM_EMISSIVE.red;
    const rigs = getScoringTeamRigs?.(team) ?? [];
    flashes = rigs.map((rig, i) => {
      const root = rigRoot(rig);
      const f = { rig, root, cued: false, at: FLASH_START + i * FLASH_STAGGER, color };
      if (createFx && root) {
        // One FX instance per rig, lazily init'd on first celebration and
        // reused after (init rebuilds overlays; dispose happens with the rig).
        if (!rig.__celebrationFx) {
          const fx = createFx();
          fx.init({ THREE, scene, root, camera, hidden: false });
          rig.__celebrationFx = fx;
        }
        f.fx = rig.__celebrationFx;
      } else if (root) {
        // Emissive fallback: swap each mesh onto a private clone so the
        // shared material cache is never mutated.
        f.meshes = [];
        root.traverse((o) => {
          if (!o.isMesh || o.userData.fxOverlay || !o.material?.emissive) return;
          const clone = o.material.clone();
          f.meshes.push({ mesh: o, orig: o.material, clone });
          o.material = clone;
        });
      }
      return f;
    });
  }

  function cueFlash(f) {
    if (f.fx) {
      f.fx.start();
      return;
    }
    // Fallback pulses are driven straight from elapsed time in driveFlash.
  }

  function driveFlash(f, dt) {
    if (f.fx) {
      if (!f.fx.isDone()) f.fx.update(dt);
      return;
    }
    if (!f.meshes) return;
    const u = (elapsed - f.at) / (FLASH_END - f.at);
    const env = Math.max(0, Math.sin(Math.PI * clamp01(u)) * (0.5 + 0.5 * Math.sin(u * Math.PI * 2 * PULSE_HZ)));
    for (const { clone } of f.meshes) {
      clone.emissive.copy(f.color).multiplyScalar(env * EMISSIVE_STRENGTH);
    }
  }

  function restoreFlashes() {
    for (const f of flashes) {
      if (f.fx) {
        if (!f.fx.isDone()) f.fx.update(1e3); // force-finish like ceremony.js
        continue;
      }
      for (const { mesh, orig, clone } of f.meshes ?? []) {
        if (mesh.material === clone) mesh.material = orig;
        clone.dispose();
      }
    }
    flashes = [];
  }

  function finish() {
    restoreFlashes();
    active = false;
    elapsed = 0;
    team = null;
  }

  return {
    /**
     * Kick off a celebration for the team that just scored. goalPos is the
     * ball's MJCF position at the goal (used to frame the camera swing).
     * Re-firing mid-celebration restarts from the current camera frame.
     */
    play(scoringTeam, goalPos) {
      if (active) restoreFlashes();
      team = scoringTeam;
      elapsed = 0;
      active = true;

      const goal = toWorld(goalPos ?? { x: 0, y: 0, z: 0 });
      camFrom.copy(camera.position);
      lookAt.copy(goal);
      // Pull back from the goal toward the field centre, lift above it.
      const dirToCenter = new THREE.Vector3(Math.sign(goal.x) * -1 || 1, 0, 0);
      camTo.copy(goal)
        .addScaledVector(dirToCenter, CAM_PULLBACK)
        .setY(CAM_HEIGHT);

      buildFlashes();
    },

    /** Advance the timeline. Call once per frame from the game loop. */
    drive(dt) {
      if (!active) return;
      elapsed += dt;

      // Phase 2: cue + drive each rig's flash inside its stagger slot.
      for (const f of flashes) {
        if (!f.cued && elapsed >= f.at) {
          f.cued = true;
          cueFlash(f);
        }
        if (f.cued) driveFlash(f, dt);
      }

      if (elapsed >= CAM_RETURN_END) finish();
    },

    /**
     * Camera frame for this celebration, or null when inactive. game.js
     * applies {position, lookAt} in place of its chase-cam target while the
     * override is non-null; the returned vectors are stable objects updated
     * in place (do not retain them across frames).
     */
    getCameraOverride() {
      if (!active) return null;
      if (elapsed < CAM_PAN_TIME) {
        // Phase 1: swing out to the goal view.
        camPos.lerpVectors(camFrom, camTo, easeInOut(clamp01(elapsed / CAM_PAN_TIME)));
      } else if (elapsed < CAM_RETURN_START) {
        // Hold on the goal.
        camPos.copy(camTo);
      } else {
        // Phase 3: glide back toward where the swing started, so the handoff
        // to the chase cam lands close to its own frame.
        const u = easeInOut(clamp01((elapsed - CAM_RETURN_START) / (CAM_RETURN_END - CAM_RETURN_START)));
        camPos.lerpVectors(camTo, camFrom, u);
      }
      return { position: camPos, lookAt };
    },

    isActive: () => active,

    /** Abort early (match reset, mode switch): restores materials at once. */
    cancel() {
      if (active) finish();
    },
  };
}
