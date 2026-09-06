// Prop library: every decorative GLB the arena can dress itself with.
//
// Each entry is fully declarative; adding a prop = dropping a GLB in
// public/assets/props/ and appending a def here, removing one from the
// scene = enabled: false (the asset stays in the repo - that's the
// library). The scene loads every enabled prop, snaps it to the floor,
// gives it a wireframe materialization FX and registers it with the
// entrance/respawn ceremony.
//
// Def shape:
//   id          unique key (also the group key in the loaded map)
//   glb         file under ./assets/props/ (cache-bust with ?v=N)
//   enabled     false = stays in the library, never touches the scene
//   size        { axis: "x"|"y"|"z"|"max", m } - the NATURAL bbox extent
//               along that axis is scaled to m meters (three.js axes:
//               y up). Robust to re-exported assets of any raw size.
//   rotation    [rx, ry, rz] euler (rad) applied to the model
//   rotationOrder  optional three.js euler order (default "XYZ")
//   position    [x, z] floor coords; y is auto-snapped so the posed
//               bbox rests on the floor
//   lift        optional extra y (m) on top of the floor snap, for
//               props staged on top of another prop (boombox on the
//               skateboard deck)
//   fxDelay     seconds after the duck's scan cue (see ceremony.addPropFx)
//   wireNode    optional mesh name inside the GLB used as a coarser
//               stand-in for the hologram pass (fxWireGeometry escape
//               hatch, see fx-wireframe.js)
//   instances   optional [{ position, rotation?, fxDelay? }] to place
//               several clones sharing geometry/materials (arcade row)
//   collider    optional static MJCF box(es) so the duck/ball can't
//               clip through: { pos: [x,y,z], size: [hx,hy,hz],
//               euler?: [rx,ry,rz] } in MJCF coords (z up, radians;
//               three.js z = -mjcf y, three.js yaw = mjcf z-yaw) or
//               an array
//
// World context for placements (see constants.js): 3 x 3 m arena,
// walls at +-1.5 m and only 0.25 m tall, duck spawns at (-0.6, 0)
// facing +X, relief bumps at MJCF (0.3,-0.9) (-0.9,0.75) (0.6,0.9)
// r ~0.55. Props are REAL-WORLD size on purpose: the 0.25 m duck lives
// in a 90s kid's room among human-scale objects.
//
// NOTE: skateboard/crt-tv/boombox/lavalamp/sneakers/segaconsole GLBs
// were remodeled in Blender to the arcade cabinet's quality bar
// (~3-9k tris each, chunky bevels, same orange/mint/cream palette;
// Tripo still had no credits - scripts in microduck-props/scripts/).
// Each GLB embeds a coarse <name>_wire mesh (~500 tris) used via
// wireNode for the hologram pass, like arcade_wire. The walkman was
// remodeled separately (low-poly, palette-matched).

import { ARCADE_H, ARCADE_W, ARCADE_D } from "./constants.js";

// Master switch: false = the whole library stays benched (no prop in the
// scene, no prop collider), regardless of per-def `enabled` flags.
export const PROPS_ENABLED = false;

// ── Vignette anchors ──────────────────────────────────────────────────
// "Someone parked their music ride": skateboard flat on its wheels in
// the back-left pocket (three.js [-1.08, 1.02], clear of the duck spawn
// at [-0.6, 0] and of every relief bump), yawed ~26 deg off the back
// wall, with the boombox resting on the deck facing the arena center.
const BOARD_POS = [-1.08, 1.02]; // three.js [x, z]
const BOARD_YAW = Math.PI / 2 + 0.45; // ~26 deg off the -X wall axis
const BOOMBOX_YAW = BOARD_YAW + 0.05; // slightly askew, still on the deck
// Deck surface height measured from the GLB (flat between the kicktails
// for |x| < 0.28 m scaled - the 0.55 m boombox fits exactly) after the
// 0.79 m size normalization: wheels on the floor, deck top at 0.118 m.
const DECK_TOP = 0.118;
// CRT corner-ish on the front wall, screen swivelled toward the center.
const TV_YAW = -Math.PI / 2 + 0.28; // GLB fronts +Z; -PI/2 faces -X
// Arcade cabinet anchoring the front-south corner at 45 deg, jukebox
// style (no jukebox GLB in the library; the cabinet plays that role).
const ARCADE_YAW = -3 * (Math.PI / 4); // front +Z toward the arena center

export const PROP_DEFS = [
  {
    // Back from the bench: a single cabinet anchoring the front-south
    // corner like a jukebox (the 3-cabinet row stays retired).
    id: "arcade",
    glb: "arcade.glb?v=1",
    enabled: true,
    size: { axis: "y", m: ARCADE_H },
    wireNode: "arcade_wire",
    rotation: [0, ARCADE_YAW, 0],
    position: [1.13, 1.13],
    fxDelay: 0.85,
    collider: {
      pos: [1.13, -1.13, ARCADE_H / 2],
      size: [ARCADE_W / 2, ARCADE_D / 2, ARCADE_H / 2],
      euler: [0, 0, ARCADE_YAW],
    },
  },
  {
    // Real-size board (~0.79 m) flat on its wheels in the back-left
    // pocket, casually yawed off the wall grid - the boombox's ride.
    id: "skateboard",
    glb: "skateboard.glb?v=3",
    enabled: true,
    size: { axis: "x", m: 0.79 },
    wireNode: "skateboard_wire",
    rotation: [0, BOARD_YAW, 0],
    position: BOARD_POS,
    fxDelay: 0.25,
    // Main box tops out at the flat deck (0.118 m); the kicktails rise
    // to ~0.16 m over local |x| 0.32-0.395, so each tail gets its own
    // small box. The boombox stack is untouched: its visual lift and
    // its own static collider both key off DECK_TOP, not these boxes.
    collider: [
      {
        pos: [BOARD_POS[0], -BOARD_POS[1], 0.059],
        size: [0.395, 0.166, 0.059],
        euler: [0, 0, BOARD_YAW],
      },
      ...[1, -1].map((side) => ({
        pos: [
          BOARD_POS[0] + side * 0.357 * Math.cos(BOARD_YAW),
          -BOARD_POS[1] + side * 0.357 * Math.sin(BOARD_YAW),
          0.138,
        ],
        size: [0.038, 0.15, 0.022],
        euler: [0, 0, BOARD_YAW],
      })),
    ],
  },
  {
    // Benched to the library (scene declutter): parked ON the skateboard
    // deck (lift = deck surface height), speakers facing the arena.
    id: "boombox",
    glb: "boombox.glb?v=2",
    enabled: false,
    size: { axis: "x", m: 0.55 },
    wireNode: "boombox_wire",
    rotation: [0, BOOMBOX_YAW, 0], // GLB fronts +Z; face the center
    position: BOARD_POS,
    lift: DECK_TOP,
    fxDelay: 0.55,
    collider: {
      pos: [BOARD_POS[0], -BOARD_POS[1], DECK_TOP + 0.17],
      size: [0.275, 0.098, 0.17],
      euler: [0, 0, BOOMBOX_YAW],
    },
  },
  {
    // Benched to the library (scene declutter): 90s CRT near the front
    // wall, swivelled toward the center like it's watching the duck.
    id: "crt-tv",
    glb: "crt-tv.glb?v=3",
    enabled: false,
    size: { axis: "x", m: 0.45 },
    wireNode: "crt_tv_wire",
    rotation: [0, TV_YAW, 0],
    position: [1.23, -0.42],
    fxDelay: 0.7,
    // Body top measured at 0.426 m world (0.416 raw x 0.45/0.44 scale);
    // the antenna (up to 0.61 m) stays out on purpose - decorative.
    collider: {
      pos: [1.23, 0.42, 0.213],
      size: [0.225, 0.211, 0.213],
      euler: [0, 0, TV_YAW],
    },
  },
  {
    // Casually dropped on its back next to the lava lamp in the
    // front-left corner, window facing the ceiling. YXZ order: lie
    // flat (x +90 deg) first, then yaw in the floor plane. Natural
    // bbox 0.096 x 0.124 x 0.054 -> lying footprint ~0.10 x 0.135,
    // 0.059 m thick once normalized to 0.135 m tall.
    id: "walkman",
    glb: "walkman.glb?v=4",
    enabled: true,
    size: { axis: "y", m: 0.135 },
    rotation: [Math.PI / 2, 0.6, 0],
    rotationOrder: "YXZ",
    position: [1.22, -1.0],
    fxDelay: 0.4,
    collider: {
      pos: [1.22, 1.0, 0.03],
      size: [0.055, 0.07, 0.03],
      euler: [0, 0, 0.6],
    },
  },
  {
    // Classic 45 cm board, palette-remapped sectors (dark/cream
    // singles, orange/mint rings), 3 darts stuck in. Not hung yet:
    // resting on the floor, leaning against the left (-Z) wall in the
    // FRONT corner. That's the only pose the boot chase-cam can see:
    // it pitches 24 deg down at the duck with a 20 deg vertical
    // half-FOV, so wall points above ~0.37 m are always clipped -
    // a duck-height mount can never be in the boot frame. Visible
    // left-wall window at boot: x in [1.03, 1.5], y < 0.37 m. GLB
    // fronts +Z; x-tilt -0.12 leans the top into the wall, floor
    // snap keeps the bottom rim grounded. On the floor the ball can
    // reach it, so it gets a thin box collider (upright: the 7 deg
    // lean offset is ~1 cm at ball height, not worth an euler).
    id: "dartboard",
    glb: "dartboard.glb?v=1",
    enabled: true,
    size: { axis: "x", m: 0.47 },
    wireNode: "dartboard_wire",
    rotation: [-0.12, 0, 0],
    position: [1.2, -1.42],
    fxDelay: 0.6,
    collider: {
      pos: [1.2, 1.42, 0.235],
      size: [0.235, 0.06, 0.235],
    },
  },
  {
    // Mood light in the FRONT-LEFT corner of the arena: mint hourglass
    // base and dome cap, translucent orange vessel with baked emissive
    // lava blobs (concept prop-lava-lamp-concept-v2). 0.25 m off both
    // walls, clear of the (0.6, -0.9) relief bump. 0.377 m tall.
    id: "lavalamp",
    glb: "lavalamp.glb?v=2",
    enabled: true,
    size: { axis: "y", m: 0.38 },
    wireNode: "lavalamp_wire",
    rotation: [0, 0, 0],
    position: [1.25, -1.25],
    fxDelay: 0.9,
    collider: { pos: [1.25, 1.25, 0.19], size: [0.072, 0.072, 0.19] },
  },
  {
    // Benched to the library (scene declutter): orange canvas high-top
    // pair, one upright, one tipped on its side (poses baked in the
    // GLB). Cream laces/toe caps/sole, mint eyelets + foxing stripe,
    // generic 4-point-star ankle patch - no trademark art (concept
    // prop-sneakers-concept-v2). Each shoe ~0.28 m long.
    id: "sneakers",
    glb: "sneakers.glb?v=2",
    enabled: false,
    size: { axis: "x", m: 0.41 },
    wireNode: "sneakers_wire",
    rotation: [0, 2.35, 0],
    position: [-1.22, -0.22],
    fxDelay: 0.35,
    collider: {
      pos: [-1.22, 0.22, 0.09],
      size: [0.205, 0.15, 0.09],
      euler: [0, 0, 2.35],
    },
  },
  {
    // Benched to the library (scene declutter, like its CRT): Genesis
    // -like 16-bit console with two wired mint pads (concept
    // prop-console-concept-v2b, no logos). Collider covers the 0.30 m
    // body slab only - pads, cables and plinth stay decorative.
    id: "segaconsole",
    glb: "segaconsole.glb?v=2",
    enabled: false,
    size: { axis: "x", m: 0.3 },
    wireNode: "segaconsole_wire",
    rotation: [0, TV_YAW, 0],
    position: [0.87, -0.38],
    fxDelay: 0.5,
    collider: {
      pos: [0.87, 0.38, 0.031],
      size: [0.15, 0.105, 0.031],
      euler: [0, 0, TV_YAW],
    },
  },
];

// Static MJCF collision boxes for every enabled prop, consumed by
// buildPhysicsXml. Purely declarative: no GLB needs to be loaded.
export function propColliders() {
  if (!PROPS_ENABLED) return [];
  const out = [];
  for (const def of PROP_DEFS) {
    if (!def.enabled || !def.collider) continue;
    const boxes = Array.isArray(def.collider) ? def.collider : [def.collider];
    boxes.forEach((c, i) => {
      out.push({
        name: boxes.length > 1 ? `prop_${def.id}_${i}` : `prop_${def.id}`,
        pos: c.pos.join(" "),
        size: c.size.join(" "),
        euler: c.euler?.join(" "),
      });
    });
  }
  return out;
}

// Load every enabled prop into the scene and register its wireframe
// materialization with the ceremony. Returns { id: [group, ...] }.
// Props are decorative: a missing/broken GLB never halts the boot.
export async function loadProps({
  THREE, GLTFLoader, signed, scene, camera, renderer, fx, ceremony,
}) {
  if (!PROPS_ENABLED) return {};
  const loader = new GLTFLoader();
  const groups = {};
  await Promise.all(PROP_DEFS.filter((d) => d.enabled).map(async (def) => {
    try {
      const gltf = await loader.loadAsync(signed(`./assets/props/${def.glb}`));
      const proto = gltf.scene;
      const wire = def.wireNode ? proto.getObjectByName(def.wireNode) : null;
      wire?.removeFromParent();
      const nat = new THREE.Box3().setFromObject(proto);
      const natSize = nat.getSize(new THREE.Vector3());
      const extent = def.size.axis === "max"
        ? Math.max(natSize.x, natSize.y, natSize.z)
        : natSize[def.size.axis];
      proto.scale.setScalar(def.size.m / extent);
      const instances = def.instances
        ?? [{ position: def.position, rotation: def.rotation }];
      groups[def.id] = instances.map((inst, i) => {
        // clone(true) shares geometry/materials; userData doesn't
        // survive Object3D.copy, so the wire tag is applied per clone.
        const node = i === 0 ? proto : proto.clone(true);
        if (wire) {
          node.traverse((o) => {
            if (o.isMesh) o.userData.fxWireGeometry = wire.geometry;
          });
        }
        const rot = inst.rotation ?? def.rotation ?? [0, 0, 0];
        node.quaternion.setFromEuler(
          new THREE.Euler(...rot, def.rotationOrder ?? "XYZ"),
        );
        const group = new THREE.Group();
        group.add(node);
        // Floor snap: whatever the GLB's pivot, the posed bbox rests
        // on the ground at the declared floor coords; `lift` raises it
        // on top of another prop (boombox on the skateboard deck).
        const posed = new THREE.Box3().setFromObject(group);
        const lift = inst.lift ?? def.lift ?? 0;
        group.position.set(inst.position[0], -posed.min.y + lift, inst.position[1]);
        scene.add(group);
        const propFx = fx.createWireframeFx();
        propFx.init({ THREE, scene, root: group, camera, renderer, hidden: true });
        ceremony.addPropFx(propFx, inst.fxDelay ?? def.fxDelay ?? 0.3);
        return group;
      });
    } catch (err) {
      console.warn(`[props] "${def.id}" disabled:`, err);
    }
  }));
  return groups;
}
