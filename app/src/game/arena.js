// Arena visuals: the infinite Tron grid floor and the four wall grid
// planes, ported verbatim from the pre-React rl.js. Both carry a uReveal
// uniform for the entrance draw-in (driven by ceremony.js).
import * as THREE from "three";
import {
  ARENA_HALF, ARENA_WALL_H, ARENA_WALL_T, GRID_SECTION, RELIEF_BUMPS,
} from "./constants.js";

// Infinite shader grid, ported from drei's <Grid>: anti-aliased world-space
// lines at cell/section frequencies with a radial fade around the duck.
// Lines derive from world coordinates, so re-centering the mesh under the
// camera target every frame makes the grid effectively infinite without any
// visible swimming.
export function makeInfiniteGrid() {
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uCell: { value: 0.1 },
      uSection: { value: GRID_SECTION },
      uCellColor: { value: new THREE.Color(0x8e8371) },
      uSectionColor: { value: new THREE.Color(0xffb366) },
      uFadeDist: { value: 3.0 },
      uFocus: { value: new THREE.Vector3() },
      // Entrance draw-in progress; 1 = steady state (branch skipped).
      // Starts at 0: the world stays hidden behind the welcome modal and
      // the BIOS readout until playBios cues startEntrance.
      uReveal: { value: 0.0 },
      // Relief: 0 = flat, 1 = bumps at full height. Driven by the game's
      // relief toggle, mirroring the MuJoCo heightfield's z-size so the
      // visual surface and the physics surface are the same function.
      uTopoScale: { value: 0.0 },
      // (cx, cz, height, radius) per bump, in three.js world coords
      // (MJCF y -> -z done here once).
      uBumps: {
        value: RELIEF_BUMPS.map(
          ([cx, cy, h, r]) => new THREE.Vector4(cx, -cy, h, r),
        ),
      },
    },
    vertexShader: /* glsl */ `
      #define NBUMPS ${RELIEF_BUMPS.length}
      varying vec3 vWorld;
      uniform float uTopoScale;
      uniform vec4 uBumps[NBUMPS];
      // Same analytic relief as the physics heightfield (game.js topoH):
      // a sum of cosine bumps, displacing the grid surface itself so the
      // floor genuinely deforms - lines flow up the slopes for free since
      // the fragment shader draws them from world xz.
      float topoH(vec2 p) {
        float H = 0.0;
        for (int i = 0; i < NBUMPS; i++) {
          float u = distance(p, uBumps[i].xy) / uBumps[i].w;
          if (u < 1.0) H += uBumps[i].z * (0.5 + 0.5 * cos(3.14159265 * u));
        }
        return H;
      }
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        if (uTopoScale > 0.0) w.y += topoH(w.xz) * uTopoScale;
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vWorld;
      uniform float uCell, uSection, uFadeDist, uReveal;
      uniform vec3 uCellColor, uSectionColor, uFocus;
      // Tron-style line: a thicker antialiased core plus a faint, much
      // wider halo added on top (squared falloff keeps it a whisper of a
      // glow rather than a bloom wash).
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
      // Entrance draw-in: one family of parallel lines, drawn line by line.
      // id picks the line, "along" runs down its length. Each line waits
      // out its own hashed delay, then extends from the origin outward with
      // a hard front. Returns (mask, head): head marks the bright segment
      // right behind the draw front while the line is still growing.
      vec2 drawLine(float id, float along, float t0, float spread, float dur, float maxLen) {
        float jit = fract(sin(id * 127.1) * 43758.5453);
        float grow = clamp((uReveal - t0 - jit * spread) / dur, 0.0, 1.0);
        float len = grow * maxLen;
        float a = abs(along);
        float mask = 1.0 - smoothstep(len - 0.05, len, a);
        float head = (1.0 - smoothstep(0.0, 0.6, len - a)) * mask
                   * step(0.001, grow) * (1.0 - step(0.999, grow));
        return vec2(mask, head);
      }
      void main() {
        float cell = gridLine(vWorld.xz, uCell);
        // Section lattice shifted half a cell: with 5 sections across the
        // 3 m arena (odd count) this centers a CELL on the origin and puts
        // section lines exactly on the walls at +-1.5.
        vec2 pSec = vWorld.xz + 0.5 * uSection;
        float section = gridLine(pSec, uSection);
        float d = distance(vWorld.xz, uFocus.xz);
        float fade = pow(clamp(1.0 - d / uFadeDist, 0.0, 1.0), 1.6);
        vec3 col = mix(uCellColor, uSectionColor, clamp(section, 0.0, 1.0));
        float alpha = min(max(section * 0.6, cell * 0.4) * fade, 1.0);
        // Entrance: only the bright section lines get the line-by-line draw
        // (staggered, with a hot draw head); the fine cells just fade in
        // over the reveal's second half - drawing every small line reads as
        // visual noise. lineProf(min(gx, gy)) == max of per-axis profiles
        // (profile is monotonic) and the cell fade lands on exactly the
        // steady-state cell term, so at uReveal 1 this branch equals the
        // formula above exactly (and is skipped).
        if (uReveal < 1.0) {
          vec2 rs = pSec / uSection;
          vec2 gs = abs(fract(rs - 0.5) - 0.5) / fwidth(rs);
          // Const-x lines run along z and vice versa; the offset
          // decorrelates the two families' hashed delays.
          vec2 sx = drawLine(floor(rs.x + 0.5), vWorld.z, 0.00, 0.30, 0.35, 8.0);
          vec2 sz = drawLine(floor(rs.y + 0.5) + 57.0, vWorld.x, 0.05, 0.30, 0.35, 8.0);
          float secR = max(lineProf(gs.x) * sx.x, lineProf(gs.y) * sz.x);
          float cellR = cell * smoothstep(0.5, 1.0, uReveal);
          float headGlow = max(lineProf(gs.x) * sx.y, lineProf(gs.y) * sz.y);
          col = mix(uCellColor, uSectionColor, clamp(secR, 0.0, 1.0));
          alpha = min(max(secR * 0.6, cellR * 0.4) * fade, 1.0);
          // Bright draw head: a short white-hot tip sells the "drawing" read.
          headGlow = clamp(headGlow, 0.0, 1.0);
          col = mix(col, vec3(1.0, 0.86, 0.55), headGlow * 0.8);
          alpha = min(alpha + headGlow * fade * 0.5, 1.0);
        }
        if (alpha < 0.004) discard;
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });
  // Subdivided so the relief displacement has vertices to push: ~12 cm
  // steps, plenty for the gentle bump radii (>= 0.5 m). The displacement
  // is computed in world space, so the per-frame recentering under the
  // camera target doesn't move the bumps.
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(30, 30, 256, 256), material);
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}

// Arena walls, drawn in the same grid language as the floor: identical
// cell/section lines from world coordinates, same radial fade around the
// duck, plus a vertical fade toward the top edge so the walls read as a
// light enclosure instead of solid slabs.
function makeWallGridMaterial(alongX) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: {
      uCell: { value: 0.1 },
      uSection: { value: GRID_SECTION },
      uCellColor: { value: new THREE.Color(0x8e8371) },
      uSectionColor: { value: new THREE.Color(0xffb366) },
      // Gentler radial fade than the floor: the walls sit 1.5+ m from the
      // duck by construction and would vanish with the floor's 3 m fade.
      uFadeDist: { value: 5.0 },
      uFocus: { value: new THREE.Vector3() },
      uWallH: { value: ARENA_WALL_H },
      uAlongX: { value: alongX ? 1.0 : 0.0 },
      // Entrance draw-in progress; 1 = steady state (branch skipped).
      // Starts at 0, same as the floor grid: hidden until startEntrance.
      uReveal: { value: 0.0 },
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
      uniform float uCell, uSection, uFadeDist, uWallH, uAlongX, uReveal;
      uniform vec3 uCellColor, uSectionColor, uFocus;
      // Same Tron-style core + faint halo as the floor grid.
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
      // Same line-by-line draw as the floor grid (see its comments).
      vec2 drawLine(float id, float along, float t0, float spread, float dur, float maxLen) {
        float jit = fract(sin(id * 127.1) * 43758.5453);
        float grow = clamp((uReveal - t0 - jit * spread) / dur, 0.0, 1.0);
        float len = grow * maxLen;
        float a = abs(along);
        float mask = 1.0 - smoothstep(len - 0.05, len, a);
        float head = (1.0 - smoothstep(0.0, 0.35, len - a)) * mask
                   * step(0.001, grow) * (1.0 - step(0.999, grow));
        return vec2(mask, head);
      }
      void main() {
        // Wall surface coords: the in-plane horizontal world axis + height.
        float h = mix(vWorld.z, vWorld.x, uAlongX);
        vec2 p = vec2(h, vWorld.y);
        float cell = gridLine(p, uCell);
        // Horizontal axis shifted half a section to match the floor's odd
        // lattice (vertical section lines meet the floor's at the base);
        // the height axis keeps its base line at y = 0.
        vec2 pSec = vec2(p.x + 0.5 * uSection, p.y);
        float section = gridLine(pSec, uSection);
        float d = distance(vWorld.xz, uFocus.xz);
        float fade = pow(clamp(1.0 - d / uFadeDist, 0.0, 1.0), 1.6);
        float vert = 1.0 - clamp(vWorld.y / uWallH, 0.0, 1.0);
        vec3 col = mix(uCellColor, uSectionColor, clamp(section, 0.0, 1.0));
        float alpha = min(max(section * 0.9, cell * 0.6) * fade * (0.3 + 0.7 * vert), 1.0);
        // Entrance: section lines only - horizontals zip out from the
        // wall's center, verticals rise from the ground, each with a
        // hashed delay; the fine cells fade in over the reveal's second
        // half. Same steady-state equivalence argument as the floor grid.
        if (uReveal < 1.0) {
          vec2 rs = pSec / uSection;
          vec2 gs = abs(fract(rs - 0.5) - 0.5) / fwidth(rs);
          // Const-height lines run along h (grow from center outward);
          // const-h lines run along y (grow up from the ground).
          vec2 sh = drawLine(floor(rs.y + 0.5), p.x, 0.00, 0.30, 0.40, 2.0);
          vec2 sv = drawLine(floor(rs.x + 0.5) + 31.0, p.y, 0.30, 0.30, 0.30, uWallH);
          float secR = max(lineProf(gs.y) * sh.x, lineProf(gs.x) * sv.x);
          float cellR = cell * smoothstep(0.5, 1.0, uReveal);
          float headGlow = max(lineProf(gs.y) * sh.y, lineProf(gs.x) * sv.y);
          col = mix(uCellColor, uSectionColor, clamp(secR, 0.0, 1.0));
          alpha = min(max(secR * 0.9, cellR * 0.6) * fade * (0.3 + 0.7 * vert), 1.0);
          headGlow = clamp(headGlow, 0.0, 1.0);
          col = mix(col, vec3(1.0, 0.86, 0.55), headGlow * 0.8);
          alpha = min(alpha + headGlow * fade * 0.5, 1.0);
        }
        if (alpha < 0.004) discard;
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });
}

// Entrance draw-in cue schedule, for the ceremony's per-line audio blips.
// Replicates the shaders' hashed stagger EXACTLY (same hash, same t0 /
// spread constants, same line ids as drawLine's floor(rs + 0.5)), so each
// blip lands the instant its line starts drawing. Times are normalized to
// the respective reveal (0..1); the ceremony maps them to seconds with its
// own grid/wall reveal durations. `u` is the line's jitter, reused by the
// audio side for per-line pitch variation. The four walls share one id
// space, so their lines draw (and blip) in unison - one cue each.
const jitHash = (x) => {
  const s = Math.sin(x * 127.1) * 43758.5453;
  return s - Math.floor(s);
};
export function entranceLineCues() {
  const grid = [];
  const walls = [];
  // Floor: 6 section lines per axis (world x in {-1.5..1.5} step 0.6 maps
  // to ids -2..3); the z family is offset by 57 in the shader.
  for (let i = -2; i <= 3; i++) {
    const jx = jitHash(i);
    const jz = jitHash(i + 57);
    grid.push({ at: 0.00 + jx * 0.30, u: jx });
    grid.push({ at: 0.05 + jz * 0.30, u: jz });
  }
  // Walls: one horizontal section line (the y = 0 base, id 0) and 6
  // verticals (ids -2..3 offset by 31), per the 0.25 m wall height.
  walls.push({ at: 0.00 + jitHash(0) * 0.30, u: jitHash(0) });
  for (let i = -2; i <= 3; i++) {
    const j = jitHash(i + 31);
    walls.push({ at: 0.30 + j * 0.30, u: j });
  }
  return { grid, walls };
}

// The four wall planes at their inner faces (three coords: MJCF x -> x,
// MJCF y -> -z). Returns the meshes plus their materials (the ceremony and
// the per-frame focus update both need the material list).
//
// Parameterised by half-extent so the football pitch can reuse the same Tron
// wall language on a rectangle. The defaults reproduce the square sandbox
// arena exactly (both axes ARENA_HALF, so lenX === lenY === the old wallLen).
export function makeArenaWalls(halfX = ARENA_HALF, halfY = ARENA_HALF) {
  const wallMats = [];
  const wallMeshes = [];
  // End walls (const-x faces) span the Y extent; side walls (const-z faces)
  // span the X extent. Each includes the 2 * ARENA_WALL_T corner overlap.
  const lenX = 2 * (halfX + ARENA_WALL_T);
  const lenY = 2 * (halfY + ARENA_WALL_T);
  const wallDefs = [
    { x: halfX, z: 0, rotY: -Math.PI / 2, alongX: false, len: lenY },
    { x: -halfX, z: 0, rotY: Math.PI / 2, alongX: false, len: lenY },
    { x: 0, z: halfY, rotY: Math.PI, alongX: true, len: lenX },
    { x: 0, z: -halfY, rotY: 0, alongX: true, len: lenX },
  ];
  for (const w of wallDefs) {
    const mat = makeWallGridMaterial(w.alongX);
    wallMats.push(mat);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w.len, ARENA_WALL_H), mat);
    mesh.position.set(w.x, ARENA_WALL_H / 2, w.z);
    mesh.rotation.y = w.rotY;
    wallMeshes.push(mesh);
  }
  return { wallMats, wallMeshes };
}
