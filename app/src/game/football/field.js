// Football pitch visuals: the flat field-marking shader (boundary, centre
// line/circle, penalty + goal areas, corner arcs, goal cages) and the Tron
// enclosure walls with a goal mouth cut into each end. Both are authored in
// three.js world coordinates (Y up) and reuse the arena's warm Tron palette
// and uReveal entrance convention.
//
// Field axes: three.js X = field length (MJCF X), three.js Z = -MJCF Y (field
// width). All markings are symmetric about both axes, so the Z sign flip is
// irrelevant and the shader works directly in vec2(worldX, worldZ).

import * as THREE from 'three';
import {
  FIELD_HALF_L, FIELD_HALF_W, GOAL_WIDTH, GOAL_DEPTH, GOAL_HEIGHT,
  CENTER_CIRCLE_RADIUS, PENALTY_AREA_L, PENALTY_AREA_W, CORNER_ARC_RADIUS,
  WALL_HEIGHT, WALL_THICKNESS,
} from './constants.js';

// Shared palette (mirrors arena.js: warm Tron orange over a muted tan core).
const CELL_COLOR = 0x8e8371;
const SECTION_COLOR = 0xffb366;
const BASE_COLOR = 0x0b0d12;   // near-black pitch surface tint
const CENTER_COLOR = 0xffd9a0; // hotter accent for the centre features

// ── Field markings ────────────────────────────────────────────────────────

/**
 * Build the flat football pitch: a single 30 x 30 m plane whose fragment
 * shader strokes every field marking from world XZ. relief is disabled on the
 * pitch, so no vertex subdivision is needed (unlike the arena's bump grid).
 *
 * @param {object} [fieldConfig]
 * @param {number} [fieldConfig.halfX=FIELD_HALF_L] - half length (world X).
 * @param {number} [fieldConfig.halfY=FIELD_HALF_W] - half width (world Z).
 * @param {number} [fieldConfig.reveal=1.0] - initial uReveal (ceremony hook).
 * @returns {THREE.Mesh}
 */
export function makeFootballGrid(fieldConfig = {}) {
  const halfX = fieldConfig.halfX ?? FIELD_HALF_L;
  const halfY = fieldConfig.halfY ?? FIELD_HALF_W;
  const reveal = fieldConfig.reveal ?? 1.0;

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uFieldHalfL: { value: halfX },
      uFieldHalfW: { value: halfY },
      uGoalHalfW: { value: GOAL_WIDTH / 2 },
      uGoalDepth: { value: GOAL_DEPTH },
      uCenterR: { value: CENTER_CIRCLE_RADIUS },
      uPenaltyL: { value: PENALTY_AREA_L },
      uPenaltyW: { value: PENALTY_AREA_W },
      uCornerR: { value: CORNER_ARC_RADIUS },
      uLineW: { value: 0.035 },          // line half-thickness, metres
      uBaseColor: { value: new THREE.Color(BASE_COLOR) },
      uLineColor: { value: new THREE.Color(SECTION_COLOR) },
      uCenterColor: { value: new THREE.Color(CENTER_COLOR) },
      uBaseAlpha: { value: 0.55 },
      // Entrance draw-in; 1 = steady state (fully visible). Ceremony can
      // drive it from 0 to wipe the pitch in from the centre outward.
      uReveal: { value: reveal },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vWorld;
      uniform float uFieldHalfL, uFieldHalfW, uGoalHalfW, uGoalDepth;
      uniform float uCenterR, uPenaltyL, uPenaltyW, uCornerR, uLineW;
      uniform float uBaseAlpha, uReveal;
      uniform vec3 uBaseColor, uLineColor, uCenterColor;

      // Antialiased line stroke from a signed distance, plus a faint Tron
      // halo (same spirit as arena.js lineProf: tight core + squared glow).
      float strokeGlow(float sd, float halfW) {
        float aa = fwidth(sd) + 1e-5;
        float core = 1.0 - smoothstep(halfW - aa, halfW + aa, abs(sd));
        float halo = 1.0 - smoothstep(halfW, halfW * 5.0, abs(sd));
        return core + halo * halo * 0.35;
      }
      // Filled disc (centre/penalty spots).
      float fillDot(float d, float r) {
        float aa = fwidth(d) + 1e-5;
        return 1.0 - smoothstep(r - aa, r + aa, d);
      }
      // Signed distances.
      float sdRect(vec2 p, vec2 hs) {
        vec2 d = abs(p) - hs;
        return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
      }
      float sdCircle(vec2 p, float r) { return length(p) - r; }
      float sdSegment(vec2 p, vec2 a, vec2 b) {
        vec2 pa = p - a, ba = b - a;
        float t = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
        return length(pa - ba * t);
      }

      // Per-end features (penalty box, 6-yard box, penalty spot, goal cage
      // footprint), mirrored by sx = +-1.
      float endFeatures(vec2 p, float sx) {
        float lw = uLineW;
        float m = 0.0;
        // Penalty area: from the goal line inward by uPenaltyL.
        m = max(m, strokeGlow(
          sdRect(p - vec2(sx * (uFieldHalfL - uPenaltyL * 0.5), 0.0),
                 vec2(uPenaltyL * 0.5, uPenaltyW)), lw));
        // Goal area (6-yard box), derived smaller from the penalty area.
        float gaL = uPenaltyL * 0.4, gaW = uPenaltyW * 0.5;
        m = max(m, strokeGlow(
          sdRect(p - vec2(sx * (uFieldHalfL - gaL * 0.5), 0.0),
                 vec2(gaL * 0.5, gaW)), lw));
        // Penalty spot.
        m = max(m, fillDot(
          length(p - vec2(sx * (uFieldHalfL - uPenaltyL * 0.65), 0.0)), lw * 1.5));
        // Goal cage footprint painted behind the goal line.
        m = max(m, strokeGlow(
          sdRect(p - vec2(sx * (uFieldHalfL + uGoalDepth * 0.5), 0.0),
                 vec2(uGoalDepth * 0.5, uGoalHalfW)), lw));
        return m;
      }
      // Quarter arc tucked into one corner, opening into the field.
      float cornerArc(vec2 p, vec2 corner, float r, float lw) {
        vec2 d = p - corner;
        float inward = step(d.x * sign(corner.x), 0.0) * step(d.y * sign(corner.y), 0.0);
        return strokeGlow(length(d) - r, lw) * inward;
      }

      void main() {
        vec2 p = vec2(vWorld.x, vWorld.z);
        float lw = uLineW;
        float mark = 0.0;

        // Boundary: two touchlines (z = +-halfW) + two goal lines (x = +-halfL).
        mark = max(mark, strokeGlow(sdRect(p, vec2(uFieldHalfL, uFieldHalfW)), lw));
        // Centre line across the width.
        mark = max(mark, strokeGlow(
          sdSegment(p, vec2(0.0, -uFieldHalfW), vec2(0.0, uFieldHalfW)), lw));
        // Both ends + all four corners.
        mark = max(mark, endFeatures(p, 1.0));
        mark = max(mark, endFeatures(p, -1.0));
        mark = max(mark, cornerArc(p, vec2( uFieldHalfL,  uFieldHalfW), uCornerR, lw));
        mark = max(mark, cornerArc(p, vec2( uFieldHalfL, -uFieldHalfW), uCornerR, lw));
        mark = max(mark, cornerArc(p, vec2(-uFieldHalfL,  uFieldHalfW), uCornerR, lw));
        mark = max(mark, cornerArc(p, vec2(-uFieldHalfL, -uFieldHalfW), uCornerR, lw));

        // Centre circle + spot get the hotter accent colour.
        float centerMark = strokeGlow(sdCircle(p, uCenterR), lw);
        centerMark = max(centerMark, fillDot(length(p), lw * 1.8));

        float markAll = max(mark, centerMark);
        // Dark surface tint inside the boundary so the pitch reads as a field.
        float inside = 1.0 - smoothstep(-0.02, 0.02,
          max(abs(p.x) - uFieldHalfL, abs(p.y) - uFieldHalfW));

        vec3 lineCol = mix(uLineColor, uCenterColor, clamp(centerMark - mark, 0.0, 1.0));
        vec3 col = mix(uBaseColor, lineCol, clamp(markAll, 0.0, 1.0));
        float alpha = max(inside * uBaseAlpha, min(markAll, 1.0));

        // Entrance reveal: wipe the pitch in from the centre outward.
        float maxR = length(vec2(uFieldHalfL, uFieldHalfW));
        float rr = length(p) / maxR;
        alpha *= clamp(uReveal * 1.25 - rr * 0.25, 0.0, 1.0);

        if (alpha < 0.004) discard;
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(30, 30, 1, 1), material);
  mesh.rotation.x = -Math.PI / 2;   // lay the XY plane flat on XZ (Y up)
  mesh.name = 'football_grid';
  return mesh;
}

// ── Enclosure walls ───────────────────────────────────────────────────────

// Tron wall material in the arena's language (cell + section lattice, vertical
// fade toward the top). uAlongX picks the in-plane horizontal world axis, and
// uReveal rises the wall from the ground for the entrance.
function makeFootballWallMaterial(alongX, reveal) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uCell: { value: 0.1 },
      uSection: { value: 0.5 },
      uCellColor: { value: new THREE.Color(CELL_COLOR) },
      uSectionColor: { value: new THREE.Color(SECTION_COLOR) },
      uWallH: { value: WALL_HEIGHT },
      uAlongX: { value: alongX ? 1.0 : 0.0 },
      uReveal: { value: reveal },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vWorld;
      uniform float uCell, uSection, uWallH, uAlongX, uReveal;
      uniform vec3 uCellColor, uSectionColor;
      float lineProf(float g) {
        float core = 1.0 - smoothstep(0.0, 1.8, g);
        float halo = 1.0 - smoothstep(0.0, 7.0, g);
        return core + halo * halo * 0.22;
      }
      float gridLine(vec2 p, float size) {
        vec2 r = p / size;
        vec2 g = abs(fract(r - 0.5) - 0.5) / fwidth(r);
        return lineProf(min(g.x, g.y));
      }
      void main() {
        float h = mix(vWorld.z, vWorld.x, uAlongX);
        vec2 p = vec2(h, vWorld.y);
        float cell = gridLine(p, uCell);
        float section = gridLine(p, uSection);
        float vert = 1.0 - clamp(vWorld.y / uWallH, 0.0, 1.0);
        vec3 col = mix(uCellColor, uSectionColor, clamp(section, 0.0, 1.0));
        float alpha = min(max(section * 0.9, cell * 0.6) * (0.3 + 0.7 * vert), 1.0);
        // Entrance: walls rise from the ground as uReveal sweeps 0 -> 1.
        float rise = clamp(uReveal * 1.2 - (vWorld.y / uWallH) * 0.2, 0.0, 1.0);
        alpha *= rise;
        if (alpha < 0.004) discard;
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });
}

/**
 * Build the football enclosure: two full-length side walls (world +-Z) and two
 * end walls (world +-X) each split into a pair of segments that leave the
 * GOAL_WIDTH mouth open. Because GOAL_HEIGHT (0.4) exceeds WALL_HEIGHT (0.25),
 * the mouth is open for the full wall height - no lintel is emitted (the guard
 * below adds one automatically should the constants ever invert).
 *
 * @param {object} [fieldConfig]
 * @param {number} [fieldConfig.halfX=FIELD_HALF_L]
 * @param {number} [fieldConfig.halfY=FIELD_HALF_W]
 * @param {number} [fieldConfig.reveal=1.0]
 * @returns {{ wallMats: THREE.ShaderMaterial[], wallMeshes: THREE.Mesh[] }}
 */
export function makeFootballWalls(fieldConfig = {}) {
  const halfX = fieldConfig.halfX ?? FIELD_HALF_L;
  const halfY = fieldConfig.halfY ?? FIELD_HALF_W;
  const reveal = fieldConfig.reveal ?? 1.0;
  const wallH = WALL_HEIGHT;
  const goalHalf = GOAL_WIDTH / 2;

  const wallMats = [];
  const wallMeshes = [];
  const addWall = (len, height, x, y, z, rotY, alongX) => {
    const mat = makeFootballWallMaterial(alongX, reveal);
    wallMats.push(mat);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(len, height), mat);
    mesh.position.set(x, y, z);
    mesh.rotation.y = rotY;
    mesh.name = 'football_wall';
    wallMeshes.push(mesh);
  };

  // Side walls (span the X extent): in-plane horizontal axis = world X.
  const sideLen = 2 * (halfX + WALL_THICKNESS);
  addWall(sideLen, wallH, 0, wallH / 2, halfY, Math.PI, true);
  addWall(sideLen, wallH, 0, wallH / 2, -halfY, 0, true);

  // End walls (span the Z extent): in-plane horizontal axis = world Z. Each
  // side of the mouth runs from +-goalHalf out to the corner (with a small
  // overlap so the seam meets the side wall).
  const segOuter = halfY + WALL_THICKNESS;
  const segLen = segOuter - goalHalf;
  const segC = (goalHalf + segOuter) / 2;
  for (const sx of [1, -1]) {
    const rotY = sx > 0 ? -Math.PI / 2 : Math.PI / 2;
    for (const sz of [1, -1]) {
      addWall(segLen, wallH, sx * halfX, wallH / 2, sz * segC, rotY, false);
    }
    // Lintel above the mouth, only if the wall towers over the crossbar.
    if (wallH > GOAL_HEIGHT) {
      const lintelH = wallH - GOAL_HEIGHT;
      addWall(2 * goalHalf, lintelH, sx * halfX, GOAL_HEIGHT + lintelH / 2, 0, rotY, false);
    }
  }

  return { wallMats, wallMeshes };
}
