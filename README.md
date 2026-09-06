---
title: Microduck Arena
emoji: 🐤
colorFrom: yellow
colorTo: gray
sdk: docker
app_port: 8080
pinned: false
---

🌐 English | [中文](README_zh.md)

# Microduck Arena

> 3v3 reinforcement-learning football, fully in your browser.

[![License](https://img.shields.io/github/license/00make/microduck-arena)](LICENSE)
[![MuJoCo](https://img.shields.io/badge/physics-MuJoCo_WASM-blue)](https://mujoco.org/)
[![ONNX Runtime](https://img.shields.io/badge/inference-onnxruntime--web-green)](https://onnxruntime.ai/)
[![HF Space](https://img.shields.io/badge/%F0%9F%A4%97_Space-Microduck_Arena-yellow)](https://huggingface.co/spaces/00make/microduck-arena)

<!-- TODO: Add screenshot/GIF -->

**[▶ Live Demo](https://huggingface.co/spaces/00make/microduck-arena)**

---

## Features

- 🦆 **Browser-native physics** — MuJoCo compiled to WebAssembly, full rigid-body simulation at 50 Hz
- 🧠 **9 neural network policies** — ONNX Runtime (wasm-simd-threaded) drives locomotion, kicks, rolls, and more
- ⚽ **3v3 football mode** — Role-based AI with goalkeepers, defenders, and forwards; full referee system
- 🌐 **WebRTC multiplayer ghosts** — Peer-to-peer duck synchronization at 15 Hz via Trystero (no server needed)
- 🎨 **Cyberpunk Tron arena** — Custom GLSL shader effects, neon grid floor, CRT post-processing
- 📦 **Zero backend** — Pure static site, deployable to any CDN or container host
- 🎮 **Full input support** — Keyboard, touch overlay, and gamepad with analog triggers

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Vite + React 18 |
| 3D Rendering | React Three Fiber + Three.js |
| UI Components | MUI (Material UI) |
| State Management | Zustand |
| Physics Engine | [@mujoco/mujoco](https://www.npmjs.com/package/@mujoco/mujoco) (WebAssembly) |
| ML Inference | [onnxruntime-web](https://www.npmjs.com/package/onnxruntime-web) (wasm-simd-threaded) |
| Multiplayer | [Trystero](https://github.com/dmotz/trystero) (WebRTC P2P over Nostr relays) |
| Testing | node:test + headless end-to-end probe |
| Deployment | Docker (nginx) / Cloudflare Pages / Hugging Face Spaces |

---

## Quick Start

### Prerequisites

- Node.js ≥ 18
- [Git LFS](https://git-lfs.com/) installed

### Clone & Run

```bash
git clone https://github.com/00make/microduck-arena.git
cd microduck-arena/app
npm install
npm run dev
```

The dev server starts at `http://localhost:5173`.

### URL Modes

| Mode | URL |
|------|-----|
| 🏟️ Football (3v3) | `http://localhost:5173/?mode=football&boot=1` |
| 🦆 Sandbox (single duck) | `http://localhost:5173/?boot=1` |

> **Note:** `?boot=1` skips the welcome modal and shows the live BIOS loading console.

### Git LFS

Large binary assets (STL meshes, GLB models, ONNX policies) are stored with Git LFS:

```bash
git lfs install   # once per machine
git lfs pull      # fetch actual binaries in an existing clone
```

---

## Architecture

```
app/src/
├── game/                  # Imperative game core (framework-agnostic)
│   ├── game.js            # Main loop: MuJoCo physics + ONNX inference @ 50 Hz
│   ├── duck.js            # Robot rig: kinematics JSON → Three.js bones
│   ├── arena.js           # Tron-style arena with GLSL shaders
│   ├── constants.js       # Shared physics/game constants
│   ├── ghosts.js          # WebRTC multiplayer (Trystero, 15 Hz broadcast)
│   ├── variants.js        # Legs / rollers locomotion switching
│   ├── football/          # Football domain logic
│   │   ├── referee.js     # Rule engine (goals, fouls, penalties, kickoffs)
│   │   ├── ai/            # Role-based AI (goalkeeper, defender, forward)
│   │   ├── goal.js        # Goal mesh & collision geometry
│   │   └── match-config.js # Team composition & match parameters
│   ├── controls/          # Input controllers (keyboard, gamepad, touch)
│   └── fx/                # Visual effects (particles, camera shake, CRT)
├── football/              # Football mode React components
├── scene/                 # R3F canvas & post-processing
├── ui/                    # React UI (HUD, menus, overlays)
└── store.js               # Zustand bridge (game ↔ UI)
```

**Design philosophy:** React handles UI chrome; the game core is imperative and engine-agnostic. A Zustand store bridges the two — game state flows out, UI intents flow in.

---

## Deployment

### Cloudflare Pages

```bash
cd app
npm run build
# Deploy app/dist/ to Cloudflare Pages
```

### Docker

```bash
docker build -t microduck-arena .
docker run -p 8080:8080 microduck-arena
```

Multi-stage build: Vite compiles the bundle → nginx-unprivileged serves it on port 8080.

### Hugging Face Spaces

The Dockerfile frontmatter (`sdk: docker`, `app_port: 8080`) makes the repo directly deployable as a HF Space. Push to your Space's `main` branch and it auto-builds.

---

## Testing

```bash
cd app

# Fast unit tests (node:test, ~100 ms, no WASM)
npm test

# End-to-end headless 3v3 match probe (~16 s)
npm run test:headless
```

| Suite | Coverage | Runtime |
|-------|----------|---------|
| `npm test` | Referee rules, AI logic, HUD state, MJCF/XML assertions, constants | ~100 ms |
| `npm run test:headless` | Full 300 s six-duck match — MuJoCo WASM + ONNX inference in Node | ~16 s |

The headless probe is deterministic and exits with meaningful codes:

- `0` — success
- `1` — ball never moved
- `2` — collective sin-bin (4+ ducks off field)
- `3` — physics explosion or crash

---

## Controls

| Key | Action |
|-----|--------|
| WASD / Arrows | Move (forward, back, turn) |
| M | Switch legs ↔ rollers |
| Q / E | Kick left / right (legs only) |
| R | Sit / stand (legs) · Crouch-glide (rollers) |
| G | Ground pick (legs only) |
| C | Toggle chase camera |
| Space | Reset |
| Drag / Scroll | Orbit camera / Zoom |

Gamepad fully supported — mirrors the real robot runtime mapping.

---

## Credits & Acknowledgments

- 🦆 **Microduck robot** — Original design by [Pollen Robotics](https://github.com/pollen-robotics/microduck)
- 🧪 **RL policies** — Trained with [microduck_rl](https://github.com/pollen-robotics/microduck_rl)
- ⚙️ **MuJoCo** — Physics engine by [Google DeepMind](https://deepmind.google/technologies/mujoco/)
- 🔮 **ONNX Runtime Web** — Inference engine by [Microsoft](https://onnxruntime.ai/)
- 📡 **Trystero** — WebRTC P2P library by [Dan Motzenbecker](https://github.com/dmotz/trystero)

**Author:** [00make](https://github.com/00make)

---

## License

MIT © 00make. See [LICENSE](LICENSE) for details.
