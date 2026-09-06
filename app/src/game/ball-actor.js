// Ball actor: physics stays in rl.js, this owns the mesh + wireframe FX.
//
// visual:
//   hidden  parked, mesh off
//   live    following qpos, optional appear scan playing
//   ghost   physics already parked; mesh frozen at last pose while the
//           reverse scan peels it away
//
// spawn while live/ghost queues a pop: despawn finishes, then the caller
// places physics and appear()s.

// Appear/disappear speed. The shared wireframe FX timeline lasts
// fx.TOTAL_S (0.9 s, tuned for the duck's ceremony); the ball plays the
// same timeline time-scaled to these snappier durations.
const BALL_APPEAR_S = 0.35; // spawn pop-in (scan up)
const BALL_DISAPPEAR_S = 0.25; // despawn/park peel-away (reverse scan)

export function createBallActor({ THREE, scene, camera, renderer, fxModule, mesh, group }) {
  const fx = fxModule.createWireframeFx();
  fx.init({ THREE, scene, root: group, camera, renderer, hidden: false });

  let visual = "hidden"; // hidden | live | ghost
  let ghost = null;
  let pendingSpawn = false;
  let fxPrev = null;

  function appear() {
    visual = "live";
    ghost = null;
    mesh.visible = true;
    fx.start();
    fxPrev = performance.now();
  }

  function despawn({ cancelQueued = false, parkPhysics }) {
    if (cancelQueued) pendingSpawn = false;
    if (visual === "hidden") return;
    if (visual === "live") {
      ghost = {
        pos: mesh.position.clone(),
        quat: mesh.quaternion.clone(),
      };
      visual = "ghost";
    }
    parkPhysics();
    fx.startReverse();
    fxPrev = performance.now();
  }

  function queueRespawn() {
    pendingSpawn = true;
  }

  function poseFromQpos(qpos, adr) {
    mesh.position.set(qpos[adr], qpos[adr + 1], qpos[adr + 2]);
    mesh.quaternion.set(qpos[adr + 4], qpos[adr + 5], qpos[adr + 6], qpos[adr + 3]);
  }

  function sync(qpos, adr, physicsLive) {
    if (visual === "ghost" && ghost) {
      mesh.visible = true;
      mesh.position.copy(ghost.pos);
      mesh.quaternion.copy(ghost.quat);
    } else if (physicsLive) {
      mesh.visible = true;
      poseFromQpos(qpos, adr);
    } else {
      mesh.visible = false;
    }
  }

  function drive(onQueuedSpawn) {
    if (fx.playing) {
      const now = performance.now();
      if (fxPrev === null) fxPrev = now;
      const dt = Math.min((now - fxPrev) / 1000, 0.25);
      fxPrev = now;
      // Time-scale the FX so the ball pops in/out at its own speed.
      const speed = fx.TOTAL_S / (fx.reversing ? BALL_DISAPPEAR_S : BALL_APPEAR_S);
      fx.update(dt * speed);
    }
    if (visual === "ghost" && fx.isDone()) {
      mesh.visible = false;
      visual = "hidden";
      ghost = null;
      fx.restore();
      const queued = pendingSpawn;
      pendingSpawn = false;
      if (queued) onQueuedSpawn();
    }
  }

  return {
    appear,
    despawn,
    queueRespawn,
    poseFromQpos,
    sync,
    drive,
    get visual() { return visual; },
  };
}
