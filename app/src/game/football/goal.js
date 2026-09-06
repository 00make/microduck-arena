// Goal structures for the 3v3 football field: visual meshes (three.js) and
// MJCF collision geometry. Goals sit at +-FIELD_HALF_L on the X axis; the red
// team defends -X, the blue team defends +X.
//
// Coordinate conventions (see duck.js / ball-visual.js):
//   MJCF    : X = field length, Y = field width (left), Z = up.
//   three.js: X = MJCF X, Y = MJCF Z (up), Z = -MJCF Y.
// The visual mesh is authored directly in three.js (Y-up) coordinates; the
// collision geoms are authored in raw MJCF (Z-up) coordinates because they
// are injected into the MJCF worldbody by buildPhysicsXml.

import * as THREE from 'three';
import {
  FIELD_HALF_L, GOAL_WIDTH, GOAL_DEPTH, GOAL_HEIGHT, GOAL_POST_RADIUS,
} from './constants.js';

/**
 * Create the visual goal mesh: two vertical posts + a crossbar + a
 * semi-transparent net cavity that is open toward the field.
 *
 * The returned group is authored in three.js world coordinates (Y up), so it
 * can be added straight to the scene without any extra axis fix.
 *
 * @param {'red'|'blue'} team - Which team's goal (selects the +-X side).
 * @returns {THREE.Group}
 */
export function createGoalMesh(team) {
  const group = new THREE.Group();
  group.name = `goal_${team}`;

  const sign = team === 'red' ? -1 : 1;
  const x = sign * FIELD_HALF_L;      // three.js x == MJCF x (goal line)
  const halfW = GOAL_WIDTH / 2;
  const r = GOAL_POST_RADIUS;
  const h = GOAL_HEIGHT;
  const d = GOAL_DEPTH;

  // Frame: bright metal with a whisper of team-coloured emissive so the two
  // ends read apart under the Tron lighting without breaking the palette.
  const frameMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    metalness: 0.75,
    roughness: 0.22,
    emissive: new THREE.Color(team === 'red' ? 0x2a0000 : 0x00002a),
  });

  // Two vertical posts (CylinderGeometry already runs along three.js +Y).
  const postGeo = new THREE.CylinderGeometry(r, r, h, 12);
  for (const zSide of [-1, 1]) {
    const post = new THREE.Mesh(postGeo, frameMat);
    post.position.set(x, h / 2, zSide * halfW);
    group.add(post);
  }

  // Crossbar: horizontal cylinder spanning the two posts along three.js Z.
  const barGeo = new THREE.CylinderGeometry(r, r, GOAL_WIDTH, 12);
  const bar = new THREE.Mesh(barGeo, frameMat);
  bar.position.set(x, h, 0);
  bar.rotation.x = Math.PI / 2;       // align the Y-axis cylinder with Z
  group.add(bar);

  // Net: a semi-transparent cavity behind the goal line, open toward the
  // field (the -sign*X face is left empty so the ball can enter).
  const netMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.13,
    side: THREE.DoubleSide,
    depthWrite: false,
    metalness: 0.0,
    roughness: 1.0,
  });
  const netCenterX = x + sign * (d / 2);

  // Back panel: spans Z (mouth) x Y (height), sits at the net's rear.
  const back = new THREE.Mesh(new THREE.PlaneGeometry(GOAL_WIDTH, h), netMat);
  back.position.set(x + sign * d, h / 2, 0);
  back.rotation.y = Math.PI / 2;      // face the panel along X
  group.add(back);

  // Two side panels: span X (depth) x Y (height) at the mouth edges.
  for (const zSide of [-1, 1]) {
    const side = new THREE.Mesh(new THREE.PlaneGeometry(d, h), netMat);
    side.position.set(netCenterX, h / 2, zSide * halfW);
    group.add(side);
  }

  // Top panel: spans X (depth) x Z (mouth), lies flat under the crossbar.
  const top = new THREE.Mesh(new THREE.PlaneGeometry(d, GOAL_WIDTH), netMat);
  top.position.set(netCenterX, h, 0);
  top.rotation.x = -Math.PI / 2;      // lay the XY plane flat (normal +Y)
  group.add(top);

  return group;
}

/**
 * Generate MJCF collision-geom descriptors for one goal, suitable for turning
 * into DOM elements inside buildPhysicsXml (via its `el()` helper).
 *
 * Each goal is a solid cage: two vertical post cylinders (axis = MJCF Z) + one
 * horizontal crossbar cylinder (axis = MJCF Y) + back / side / top net boxes.
 * Only the field-facing mouth is left open, so a ball that enters is trapped
 * by the net geoms (they are solid colliders, not contype=0). All positions
 * and sizes are raw MJCF (Z-up); euler is in RADIANS because the model's
 * <compiler> sets angle="radian".
 *
 * @param {'red'|'blue'} team
 * @returns {Array<{name: string, type: string, pos: string, size: string, euler?: string}>}
 */
export function getGoalCollisionGeoms(team) {
  const sign = team === 'red' ? -1 : 1;
  const x = sign * FIELD_HALF_L;      // goal line (MJCF x)
  const halfW = GOAL_WIDTH / 2;
  const r = GOAL_POST_RADIUS;
  const h = GOAL_HEIGHT;
  const d = GOAL_DEPTH;
  const backX = x + sign * d;         // rear net plane
  const midX = x + sign * (d / 2);    // side / top net centre

  return [
    // Vertical posts: cylinder axis is MJCF Z by default, so no euler.
    { name: `goal_${team}_post_l`, type: 'cylinder', size: `${r} ${h / 2}`, pos: `${x} ${-halfW} ${h / 2}` },
    { name: `goal_${team}_post_r`, type: 'cylinder', size: `${r} ${h / 2}`, pos: `${x} ${halfW} ${h / 2}` },
    // Crossbar: rotate the Z-axis cylinder onto MJCF Y (radian euler).
    { name: `goal_${team}_bar`, type: 'cylinder', size: `${r} ${halfW}`, pos: `${x} 0 ${h}`, euler: `${Math.PI / 2} 0 0` },
    // Net cage (solid): back panel + two sides + top, mouth left open.
    { name: `goal_${team}_back`, type: 'box', size: `0.005 ${halfW} ${h / 2}`, pos: `${backX} 0 ${h / 2}` },
    { name: `goal_${team}_side_l`, type: 'box', size: `${d / 2} 0.005 ${h / 2}`, pos: `${midX} ${-halfW} ${h / 2}` },
    { name: `goal_${team}_side_r`, type: 'box', size: `${d / 2} 0.005 ${h / 2}`, pos: `${midX} ${halfW} ${h / 2}` },
    { name: `goal_${team}_top`, type: 'box', size: `${d / 2} ${halfW} 0.005`, pos: `${midX} 0 ${h}` },
  ];
}
