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
- 🧠 **9 neural network policies** — ONNX Runtime (wasm-simd, single-threaded execution) drives locomotion, kicks, rolls, and more
- ⚽ **3v3 football mode** — Role-based AI with goalkeepers, defenders, and forwards; full referee system
- 🌐 **WebRTC multiplayer ghosts** — Peer-to-peer duck synchronization at 15 Hz via Trystero (no server needed)
- 🎨 **Cyberpunk Tron arena** — Custom GLSL shader effects, neon grid floor, CRT post-processing
- 📦 **Zero backend** — Pure static site, deployable to any CDN or container host
- 🎮 **Full input support** — Keyboard, touch overlay, and gamepad with analog triggers

> Two locomotion forms — **legs** (walking) and **rollers** (skating) — switch instantly with `M`.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Vite + React 19 |
| 3D Rendering | React Three Fiber + Three.js |
| UI Components | MUI (Material UI) |
| State Management | Zustand |
| Physics Engine | [@mujoco/mujoco](https://www.npmjs.com/package/@mujoco/mujoco) (WebAssembly) |
| ML Inference | [onnxruntime-web](https://www.npmjs.com/package/onnxruntime-web) (wasm-simd, single-threaded execution) |
| Multiplayer | [Trystero](https://github.com/dmotz/trystero) (WebRTC P2P over Nostr relays) |
| Testing | node:test + headless end-to-end probe |
| Deployment | Docker (nginx) / Cloudflare Pages / Hugging Face Spaces |

---

## Quick Start

### Prerequisites

- Node.js ≥ 22.12
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
| 🏟️ Football (3v3, default) | `http://localhost:5173/` |
| 🦆 Sandbox (single duck) | `http://localhost:5173/?mode=sandbox` |
| 🔊 Soundboard | `http://localhost:5173/?soundboard=1` |

> **Note:** Football is the default entry — the bare `/` loads it. Append `&boot=1` (i.e. `?mode=sandbox&boot=1`) to skip the title and show the live BIOS loading console; this flag applies to the sandbox mode only. Football always presents its "Kick Off" title gate. If loading fails (missing assets, policy fetch errors, etc.), the screen freezes on `SYSTEM HALTED` with error details for debugging.

### Git LFS

Large binary assets (STL meshes, GLB models, ONNX policies) are stored with Git LFS:

```bash
git lfs install   # once per machine
git lfs pull      # fetch actual binaries in an existing clone
```

If you skip the LFS pull, the app boots against text pointer files and throws something like
`SyntaxError: Unexpected token 'v', "version ht"... is not valid JSON`
(that string is the head of the LFS pointer, not your model).

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
│   │   ├── ai/index.js    # Role-based AI (goalkeeper, defender, forward)
│   │   ├── field.js       # Pitch geometry & physical boundary
│   │   ├── goal.js        # Goal mesh & collision geometry
│   │   ├── match-config.js # Team composition & match parameters
│   │   ├── celebration.js # Goal celebration choreography
│   │   ├── constants.js   # Football-specific tuning constants
│   │   └── duck-instance.js # Per-duck football instance wrapper
│   ├── controls/          # Input controllers (keyboard, gamepad, touch)
│   └── fx/                # Visual effects (particles, camera shake, CRT)
├── football/              # Football mode React components
├── scene/                 # R3F canvas & post-processing
├── ui/                    # React UI (HUD, menus, overlays)
└── store.js               # Zustand bridge (game ↔ UI)
```

**Design philosophy:** React handles UI chrome; the game core is imperative and engine-agnostic. A Zustand store bridges the two — game state flows out, UI intents flow in.

**Policy contract:** legs and rollers share one interface — a 61-dim observation (gyroscope, projected gravity, 14 joint positions/velocities, previous action, 13-dim command) and a 14-dim position-target output, matching [`microduck_rl/scripts/infer_policy.py`](https://github.com/pollen-robotics/microduck_rl/blob/main/scripts/infer_policy.py).

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

Unit tests run on Node's built-in test runner — no browser, GPU, or WASM required — so they always respond in under a second.

The headless probe ([`app/tools/headless-match.mjs`](app/tools/headless-match.mjs)) reuses the exact same referee / ai / constants / match-config modules as the browser build, giving an end-to-end guarantee that the multi-duck MJCF compiles and the physics stays stable. It is deterministic and exits with meaningful codes:

- `0` — success
- `1` — ball never moved
- `2` — collective sin-bin (4+ ducks off field)
- `3` — physics explosion or crash

Because it loads the WASM runtime and takes ~16 s, it is split into its own script rather than folded into `npm test` — wire it into CI as a separate step.

---

## Controls

| Key | Action |
|-----|--------|
| WASD / Arrows | Move (forward, back, turn) |
| M | Switch legs ↔ rollers |
| Q / E | Kick left / right (legs only) |
| F | Alternate Kick — alternating left/right kick (legs only) |
| R | Sit / stand (legs) · Crouch-glide (rollers) |
| G | Ground pick (legs only) |
| C | Toggle chase camera |
| Space | Reset |
| Drag / Scroll | Orbit camera / Zoom |

Gamepad fully supported — mirrors the real robot runtime mapping (right stick controls the camera, R3 restores the chase camera, triggers control jaw open and quack).

In roller mode the legs-only actions (kick, sit) are disabled and their hints fade out; you play by driving into the ball instead.

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
