🌐 English | [中文](README_zh.md)

# Microduck Arena

> 3v3 reinforcement-learning football, fully in your browser.

[![License](https://img.shields.io/github/license/00make/microduck-arena)](LICENSE)
[![MuJoCo](https://img.shields.io/badge/physics-MuJoCo_WASM-blue)](https://mujoco.org/)
[![ONNX Runtime](https://img.shields.io/badge/inference-onnxruntime--web-green)](https://onnxruntime.ai/)
[![HF Space](https://img.shields.io/badge/%F0%9F%A4%97_Space-Microduck_Arena-yellow)](https://huggingface.co/spaces/00make/microduck-arena)

<p align="center">
  <img src="docs/promo/screenshots/football-match-1.png" alt="Six AI ducks battling it out in a neon Tron arena" width="100%">
</p>

<p align="center">
  <b>⭐ If you like this project, please give it a star — it means the world!</b>
</p>

---

## 🎮 Live Demo

**[▶ Play Now](https://microduck-arena.com/)** — zero install, zero backend, just open and watch the ducks go.

<p align="center">
  <a href="https://microduck-arena.com/">
    <img src="docs/promo/screenshots/football-title.png" alt="MICRODUCK FOOTBALL 3V3 — Kick Off title screen" width="70%">
  </a>
</p>

---

## ✨ What is this?

Six robot ducks. One neon arena. A ball. **All the physics and AI run natively in your browser** — MuJoCo compiled to WebAssembly simulates every joint at 50 Hz, while 9 ONNX neural-network policies (trained with reinforcement learning) make each duck walk, kick, and score on its own.

<p align="center">
  <img src="docs/promo/screenshots/sandbox-title.png" alt="3D Microduck model on the title screen" width="70%">
</p>

No servers. No pre-rendered video. Your browser *is* the game engine.

---

## 🌟 Why Star this repo?

- 🆓 **Fully open source** — MIT license, fork it, learn from it, ship it
- 📦 **Zero backend** — pure static site, deployable to any CDN or container host
- 🦆 **Browser-native physics** — MuJoCo WASM rigid-body simulation at 50 Hz
- 🧠 **Real RL policies** — 9 neural networks running via ONNX Runtime Web
- 🌐 **WebRTC multiplayer ghosts** — P2P duck sync with no server in between
- 🎓 **A learning goldmine** — reinforcement learning, WebAssembly, 3D game dev, P2P networking, all in one small codebase

<p align="center">
  <img src="docs/promo/screenshots/sandbox-boot.png" alt="Sandbox mode — duck, ball and HUD in the Tron arena" width="70%">
</p>

---

## 💬 Join the Community

**WeChat Developer Group** — scan the QR code to join the MicroDuck-Arena developer group. Share ideas, ask questions, or just watch the ducks together!

<p align="center">
  <img src="docs/promo/screenshots/wechat-group.png" alt="WeChat group QR code — MicroDuck-Arena Developer Group" width="300">
</p>

<p align="center">
  <i>QR code valid until <b>Sep 14</b>. Expired? Open an issue and we'll refresh it.</i>
</p>

---

## 📸 Screenshots

<table>
  <tr>
    <td align="center">
      <img src="docs/promo/screenshots/football-match-2.png" alt="3v3 football match in progress" width="100%">
      <br><sub>🏟️ 3v3 Football — RED vs BLUE</sub>
    </td>
    <td align="center">
      <img src="docs/promo/screenshots/sandbox-boot.png" alt="Sandbox mode scene" width="100%">
      <br><sub>🦆 Sandbox — free-roam a single duck</sub>
    </td>
  </tr>
</table>

---

## 🚀 Quick Start

```bash
git clone https://github.com/00make/microduck-arena.git
cd microduck-arena/app
npm install
npm run dev
```

Dev server: `http://localhost:5173`

| Mode | URL |
|------|-----|
| 🏟️ Football (3v3, default) | `/` |
| 🦆 Sandbox (single duck) | `?mode=sandbox` |

> **Requires [Git LFS](https://git-lfs.com/)** — models, meshes, and policies are stored as LFS binaries. Run `git lfs install && git lfs pull` if the app complains about invalid JSON.

---

## 🛠 Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Vite + React 19 |
| 3D | React Three Fiber + Three.js |
| Physics | MuJoCo WASM (50 Hz) |
| AI | ONNX Runtime Web (9 policies) |
| Multiplayer | WebRTC P2P (Trystero) |

More details: [architecture & deployment notes](docs/3v3-football/02-tech-stack.md).

---

## 🙏 Credits

- 🦆 [Microduck robot](https://github.com/pollen-robotics/microduck) by Pollen Robotics — RL policies trained with [microduck_rl](https://github.com/pollen-robotics/microduck_rl)
- ⚙️ [MuJoCo](https://deepmind.google/technologies/mujoco/) by Google DeepMind · 🔮 [ONNX Runtime Web](https://onnxruntime.ai/) by Microsoft · 📡 [Trystero](https://github.com/dmotz/trystero) by Dan Motzenbecker

---

## 📄 License

MIT © [00make](https://github.com/00make). See [LICENSE](LICENSE).

<p align="center">
  <b>Enjoying Microduck Arena? <a href="https://github.com/00make/microduck-arena/stargazers">Drop a ⭐</a> and share it with a friend!</b>
</p>
