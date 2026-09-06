// Ball visuals: procedural soccer-ball texture + the render mesh, ported
// verbatim from the pre-React rl.js.
import * as THREE from "three";
import { BALL_RADIUS } from "./constants.js";

// Soccer-ball look computed per pixel on the sphere itself, so there is
// no pole or seam special case by design. The truncated icosahedron is
// reconstructed as a spherical Voronoi diagram over 32 sites: the 12
// icosahedron vertices (black pentagon centers, one sitting at each
// pole) and its 20 face centers (white hexagon centers). A pixel is
// black when its nearest site is a pentagon center and it sits clear of
// the cell boundary by a seam margin - which yields big flat-edged black
// pentagons separated from the white hexagons by thin seams, corners
// almost touching, exactly like the real panel layout.
function makeSoccerBallTexture(renderer) {
  const W = 1024, H = 512;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d");
  // 12 icosahedron vertices: 2 poles + two staggered rings of 5 at
  // latitude +-atan(1/2) (~26.57 deg) - the pentagon centers.
  const sites = [];
  const addSite = (v, isPent) => {
    const n = Math.hypot(v[0], v[1], v[2]);
    sites.push({ x: v[0] / n, y: v[1] / n, z: v[2] / n, pent: isPent });
  };
  const verts = [[0, 0, 1], [0, 0, -1]];
  const latR = Math.atan(0.5), cr = Math.cos(latR), sr = Math.sin(latR);
  for (let i = 0; i < 5; i++) {
    const a = (i * 72 * Math.PI) / 180;
    const b = ((i * 72 + 36) * Math.PI) / 180;
    verts.push([cr * Math.cos(a), cr * Math.sin(a), sr]);
    verts.push([cr * Math.cos(b), cr * Math.sin(b), -sr]);
  }
  for (const v of verts) addSite(v, true);
  // 20 face centers (hexagon centers): normalized centroids of every
  // mutually-adjacent vertex triple (adjacent pairs have dot = 1/sqrt(5)).
  const adj = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] > 0.3;
  for (let i = 0; i < 12; i++) {
    for (let j = i + 1; j < 12; j++) {
      if (!adj(verts[i], verts[j])) continue;
      for (let k = j + 1; k < 12; k++) {
        if (adj(verts[i], verts[k]) && adj(verts[j], verts[k])) {
          addSite([
            verts[i][0] + verts[j][0] + verts[k][0],
            verts[i][1] + verts[j][1] + verts[k][1],
            verts[i][2] + verts[j][2] + verts[k][2],
          ], false);
        }
      }
    }
  }
  // Seam half-width and anti-alias band, in radians of arc.
  const SEAM = (1.6 * Math.PI) / 180;
  const AA = (0.35 * Math.PI) / 180;
  // Groove reach for the bump map: a touch wider than the painted seam so
  // the recess shoulders catch light on both sides of the line.
  const GROOVE = SEAM * 1.5;
  const BG = [233, 231, 224], INK = [23, 23, 29], STITCH = [200, 197, 188];
  const img = ctx.createImageData(W, H);
  const px = img.data;
  // Height map sharing the same panel construction: seams become recessed
  // grooves, plus a very fine leather/PVC grain over the whole surface.
  const bc = document.createElement("canvas");
  bc.width = W;
  bc.height = H;
  const bctx = bc.getContext("2d");
  const bimg = bctx.createImageData(W, H);
  const bpx = bimg.data;
  for (let row = 0; row < H; row++) {
    const lat = Math.PI / 2 - ((row + 0.5) / H) * Math.PI;
    const cl = Math.cos(lat), sl = Math.sin(lat);
    for (let col = 0; col < W; col++) {
      const lon = ((col + 0.5) / W) * 2 * Math.PI - Math.PI;
      const dx = cl * Math.cos(lon), dy = cl * Math.sin(lon), dz = sl;
      let best = -2, second = -2, bestPent = false;
      for (const s of sites) {
        const d = dx * s.x + dy * s.y + dz * s.z;
        if (d > best) { second = best; best = d; bestPent = s.pent; }
        else if (d > second) second = d;
      }
      // Signed distance to the Voronoi cell boundary along the geodesic.
      const halfGap = (Math.acos(Math.min(1, second)) - Math.acos(Math.min(1, best))) / 2;
      // Black panel: inside a pentagon cell, clear of the seam margin.
      const black = bestPent ? Math.min(1, Math.max(0, (halfGap - SEAM) / AA)) : 0;
      // Subtle stitch line on every remaining cell boundary so the white
      // hexagons read as panels too.
      const stitch = Math.min(1, Math.max(0, 1 - halfGap / (SEAM * 0.6))) * (1 - black);
      const o = (row * W + col) * 4;
      for (let ch = 0; ch < 3; ch++) {
        const base = BG[ch] + (STITCH[ch] - BG[ch]) * stitch;
        px[o + ch] = base + (INK[ch] - base) * black;
      }
      px[o + 3] = 255;
      // Bump: quadratic groove profile (soft shoulders, no golf-ball
      // embossing) + grain noise.
      const groove = Math.max(0, 1 - halfGap / GROOVE) ** 2;
      const hgt = 205 - groove * 115 + (Math.random() - 0.5) * 14;
      const h8 = Math.max(0, Math.min(255, hgt));
      bpx[o] = h8; bpx[o + 1] = h8; bpx[o + 2] = h8;
      bpx[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  bctx.putImageData(bimg, 0, 0);
  const finish = (canvas, srgb) => {
    const tex = new THREE.CanvasTexture(canvas);
    // The bump map stays linear; only the color map is sRGB.
    if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
    // Texel footprints get extremely anamorphic near the UV poles; without
    // anisotropy the cap edge visibly scallops at close range.
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return tex;
  };
  return { map: finish(c, true), bumpMap: finish(bc, false) };
}

// Same Z-up -> Y-up trick as the duck rig: the group takes the axis fix,
// the mesh inside takes the raw MJCF free-joint pose.
export function createBallVisual(renderer) {
  const group = new THREE.Group();
  group.rotation.x = -Math.PI / 2;
  const tex = makeSoccerBallTexture(renderer);
  const mesh = new THREE.Mesh(
    // 48x32 segments: the coarser default makes the UV interpolation near
    // the poles visibly scallop the round cap edge of the texture.
    new THREE.SphereGeometry(BALL_RADIUS, 48, 32),
    // Physical material for the waxed vintage-leather look: matte-ish base
    // with a whisper of clearcoat so highlights ride the seam grooves.
    new THREE.MeshPhysicalMaterial({
      map: tex.map,
      bumpMap: tex.bumpMap,
      bumpScale: 0.0012,
      metalness: 0,
      roughness: 0.55,
      clearcoat: 0.2,
      clearcoatRoughness: 0.35,
    }),
  );
  mesh.userData.meshName = "ball";
  // The 48x32 render sphere is far too dense for the wireframe scan (it
  // reads as a solid glowing blob); the FX overlay uses this geodesic
  // stand-in instead - 80 triangles, clean hologram lines.
  mesh.userData.fxWireGeometry = new THREE.IcosahedronGeometry(BALL_RADIUS, 1);
  mesh.visible = false;
  group.add(mesh);
  return { group, mesh };
}
