// Football-mode R3F shell. Mirrors scene/GameCanvas.jsx but tuned for the
// 3v3 pitch: lower dpr cap and no CRT post-processing, so six ducks plus
// the ball stay smooth. Lights and environment are declarative; the field,
// goals, duck rigs and ball are added to the scene by the game core.
import { useEffect } from "react";
import * as THREE from "three";
import { Canvas, useThree, useFrame } from "@react-three/fiber";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { bootGame } from "../game/game.js";
import { gameApi } from "../store.js";
// FOOTBALL_CONFIG drives the 3v3 match: six prefixed ducks, goal-openings
// walls, no relief/props, 10 Hz AI. Passed to bootGame as the matchConfig.
import { FOOTBALL_CONFIG } from "../game/football/match-config.js";

function FootballGame() {
  const { scene, camera, gl } = useThree();

  useEffect(() => {
    scene.background = new THREE.Color(0x08080c);
    gl.setClearColor(0x08080c, 1);
    const pmrem = new THREE.PMREMGenerator(gl);
    scene.environment = pmrem.fromScene(new RoomEnvironment()).texture;
    scene.environmentIntensity = 0.45;
    // Phase 2: the core boots the multi-duck match from matchConfig.
    bootGame({ scene, camera, renderer: gl, matchConfig: FOOTBALL_CONFIG });
  }, [scene, camera, gl]);

  // dt clamped so a background-tab stall can't slingshot the camera orbit.
  useFrame((_, dt) => {
    gameApi.frame?.(Math.min(dt, 0.05));
  });
  // After the main R3F pass: blit team FPV into HUD canvases. Must restore
  // the full CSS viewport afterward or the *next* main pass paints black.
  useFrame((_, dt) => {
    gameApi.renderTeamFpv?.(Math.min(dt, 0.05));
  }, -1);

  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[2, 4, 2]} intensity={1.6} />
      <directionalLight position={[-2, 2, 1.5]} intensity={0.4} />
      <directionalLight color={0xffb366} position={[0, 3, -2]} intensity={0.7} />
    </>
  );
}

export default function FootballCanvas() {
  return (
    <Canvas
      style={{ position: "fixed", inset: 0, zIndex: 1 }}
      dpr={[1, 1.5]}
      gl={{ antialias: true, alpha: false }}
      // Overview framing of the 6 x 4 m pitch from centre; the game core
      // takes over the follow-cam once it boots.
      camera={{
        fov: 40,
        near: 0.02,
        far: 30,
        position: [0, 4, 5],
      }}
    >
      <FootballGame />
      {/* No CrtDistortion in football mode: post-processing is disabled for
          headroom with six ducks on screen. */}
    </Canvas>
  );
}
