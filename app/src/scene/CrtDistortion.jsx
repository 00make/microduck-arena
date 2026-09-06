// CRT barrel distortion post-process: the one part of the old-TV treatment
// that CSS can't fake (Overlays.jsx owns the scanlines / noise / vignette,
// which stay flat on the glass - this warps the picture tube behind them).
//
// Hand-rolled RTT pass, no postprocessing dep: the scene is rendered into a
// multisampled target, then blitted to the canvas through one fullscreen-
// triangle shader that applies barrel warp, a per-channel chromatic fringe
// at the far edges and a touch of corner darkening.
//
// Wiring: mounting this component registers a useFrame subscriber with
// priority 1, which switches R3F to manual rendering - the game update
// subscriber (priority 0, in GameCanvas) still runs first each frame.
//
// Color fidelity: three r152+ skips tone mapping + sRGB output when
// rendering into a render target, so a naive linear RT visibly brightens
// every alpha/additive-blended element (the arena grid) because blending
// then happens in linear space instead of on display-encoded values like
// the canvas. Fix: flag the target as isXRRenderTarget (the WebXR path),
// which makes materials tone-map + sRGB-encode straight into the RT, while
// internalFormat RGBA8 keeps the storage linear so the hardware never
// double-encodes. The RT then holds the exact canvas image and this pass
// only moves pixels around - zero color shift (verified against a live
// direct-render bypass).
//
// Entrance FX (wireframe materialization, glitch, grid draw-in) live in
// scene materials and are captured by the RTT pass untouched. HUD / DOM
// overlays sit above the canvas and are never distorted.
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { useThree, useFrame } from "@react-three/fiber";

// ── Tuning ───────────────────────────────────────────────────────────────
export const CRT_DISTORTION_ENABLED = true;
const BARREL = 0.055; // curvature strength (0 = flat, ~0.1 = heavy fishbowl)
const ABERRATION = 0.05; // RGB fringe, fraction of the barrel shift (~1-2px at edges)
const CORNER_DARKEN = 0.12; // shader-side corner falloff (CSS vignette adds more)
const EDGE_FEATHER = 0.0025; // anti-aliased feather on the curved border, in uv
const MSAA_SAMPLES = 4; // multisampling on the scene target (matches canvas AA)

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform sampler2D tScene;
uniform float uBarrel, uAberration, uDarken, uFeather;
varying vec2 vUv;

vec2 warp(vec2 uv, float k) {
  vec2 cc = uv - 0.5;
  return 0.5 + cc * (1.0 + k * dot(cc, cc));
}

void main() {
  vec2 uvG = warp(vUv, uBarrel);
  vec2 uvR = warp(vUv, uBarrel * (1.0 + uAberration));
  vec2 uvB = warp(vUv, uBarrel * (1.0 - uAberration));
  vec3 col = vec3(
    texture2D(tScene, uvR).r,
    texture2D(tScene, uvG).g,
    texture2D(tScene, uvB).b
  );
  // Outside the warped frame = beyond the tube, fade to black with a thin
  // feather so the curved border stays anti-aliased.
  vec2 d = min(uvG, 1.0 - uvG);
  col *= smoothstep(0.0, uFeather, min(d.x, d.y));
  // Gentle corner falloff, like light dying on curved glass.
  vec2 cc = vUv - 0.5;
  col *= 1.0 - uDarken * 2.0 * dot(cc, cc);
  // tScene already holds tone-mapped, sRGB-encoded values (see header):
  // write them through untouched.
  gl_FragColor = vec4(col, 1.0);
}
`;

export default function CrtDistortion() {
  const { size, viewport } = useThree();

  const { target, quadScene, quadCamera, material, geometry } = useMemo(() => {
    const target = new THREE.WebGLRenderTarget(1, 1, { samples: MSAA_SAMPLES });
    // WebXR-path flag: tone mapping + output color space apply when
    // rendering into this target (see header comment).
    target.isXRRenderTarget = true;
    target.texture.colorSpace = THREE.SRGBColorSpace;
    // Linear storage: the shader already encodes, the hardware must not.
    target.texture.internalFormat = "RGBA8";
    // Fullscreen triangle (one primitive, no diagonal seam).
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3),
    );
    geometry.setAttribute(
      "uv",
      new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2),
    );
    const material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        tScene: { value: target.texture },
        uBarrel: { value: BARREL },
        uAberration: { value: ABERRATION },
        uDarken: { value: CORNER_DARKEN },
        uFeather: { value: EDGE_FEATHER },
      },
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(geometry, material);
    quad.frustumCulled = false;
    const quadScene = new THREE.Scene();
    quadScene.add(quad);
    const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    // Dev-only tuning hook: tweak uniforms live from the console, e.g.
    // __crtDistortion.uBarrel.value = 0.08
    if (import.meta.env.DEV) window.__crtDistortion = material.uniforms;
    return { target, quadScene, quadCamera, material, geometry };
  }, []);

  // Track canvas size and DPR (R3F clamps dpr to [1, 2]).
  useEffect(() => {
    const dpr = viewport.dpr;
    target.setSize(Math.round(size.width * dpr), Math.round(size.height * dpr));
  }, [target, size.width, size.height, viewport.dpr]);

  useEffect(() => {
    return () => {
      target.dispose();
      material.dispose();
      geometry.dispose();
    };
  }, [target, material, geometry]);

  // Priority 1: takes over rendering from R3F (runs after the priority-0
  // game update). Scene -> RT, then RT -> canvas through the warp shader.
  useFrame(({ gl: renderer, scene, camera }) => {
    if (import.meta.env.DEV && window.__crtBypass) {
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
      return;
    }
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    renderer.render(quadScene, quadCamera);
  }, 1);

  return null;
}
