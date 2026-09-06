// R3F shell around the imperative game core. The Canvas owns the renderer,
// default camera and the rAF loop; <Game> boots the core once and drives it
// from useFrame. Lights and environment are declarative; the grid, walls,
// duck rig, ball and props are added to the scene by the core (they carry
// ceremony-driven shader state).
import { useEffect } from "react";
import * as THREE from "three";
import { Canvas, useThree, useFrame } from "@react-three/fiber";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { bootGame } from "../game/game.js";
import { gameApi } from "../store.js";
import { SPAWN_X, SPAWN_Y } from "../game/constants.js";
import CrtDistortion, { CRT_DISTORTION_ENABLED } from "./CrtDistortion.jsx";

function Game() {
  const { scene, camera, gl } = useThree();

  useEffect(() => {
    scene.background = new THREE.Color(0x08080c);
    gl.setClearColor(0x08080c, 1);
    const pmrem = new THREE.PMREMGenerator(gl);
    scene.environment = pmrem.fromScene(new RoomEnvironment()).texture;
    scene.environmentIntensity = 0.45;
    bootGame({ scene, camera, renderer: gl });
  }, [scene, camera, gl]);

  // dt clamped so a background-tab stall can't slingshot the camera orbit.
  useFrame((_, dt) => {
    gameApi.frame?.(Math.min(dt, 0.05));
  });

  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[2, 4, 2]} intensity={1.6} />
      <directionalLight position={[-2, 2, 1.5]} intensity={0.4} />
      <directionalLight color={0xffb366} position={[0, 3, -2]} intensity={0.7} />
    </>
  );
}

export default function GameCanvas() {
  return (
    <Canvas
      style={{ position: "fixed", inset: 0, zIndex: 1 }}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true }}
      // Boot framing translated onto the spawn cell (the orbit target
      // follows), so the follow-cam has nothing to drift toward during boot.
      camera={{
        fov: 40,
        near: 0.02,
        far: 30,
        position: [SPAWN_X + 0.55, 0.35, -SPAWN_Y + 0.7],
      }}
    >
      <Game />
      {CRT_DISTORTION_ENABLED && <CrtDistortion />}
    </Canvas>
  );
}
