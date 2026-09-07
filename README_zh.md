[中文](README_zh.md) | 🌐 [English](README.md)

# Microduck Arena

> 浏览器里的 3v3 强化学习足球竞技场

[![License](https://img.shields.io/github/license/00make/microduck-arena)](LICENSE)
[![MuJoCo](https://img.shields.io/badge/physics-MuJoCo_WASM-blue)](https://mujoco.org/)
[![ONNX Runtime](https://img.shields.io/badge/inference-onnxruntime--web-green)](https://onnxruntime.ai/)
[![HF Space](https://img.shields.io/badge/%F0%9F%A4%97_Space-Microduck_Arena-yellow)](https://huggingface.co/spaces/00make/microduck-arena)

<p align="center">
  <img src="docs/promo/screenshots/football-match-1.png" alt="六只 AI 鸭子在霓虹 Tron 竞技场中对战" width="100%">
</p>

<p align="center">
  <b>⭐ 喜欢这个项目？请给它一个 Star！</b>
</p>

---

## 🎮 在线体验

**[▶ 立即开玩](https://microduck-arena.com/)** — 打开即玩，无需安装，零后端

<p align="center">
  <a href="https://microduck-arena.com/">
    <img src="docs/promo/screenshots/football-title.png" alt="MICRODUCK FOOTBALL 3V3 — Kick Off 标题画面" width="70%">
  </a>
</p>

---

## ✨ 这是什么？

六只机器鸭子、一个霓虹球场、一个足球。**所有物理仿真和 AI 推理都在浏览器中运行** — MuJoCo 编译为 WebAssembly 以 50Hz 模拟每个关节，9 个 ONNX 神经网络策略（强化学习训练）让每只鸭子自主行走、踢球、射门。

<p align="center">
  <img src="docs/promo/screenshots/sandbox-title.png" alt="3D Microduck 模型标题画面" width="70%">
</p>

没有服务器，没有预渲染视频。你的浏览器就是游戏引擎。

---

## 🌟 为什么要 Star 这个项目？

- 🆓 **完全开源** — MIT 协议，随便 fork、学习、部署
- 📦 **零后端** — 纯静态站点，可部署到任何 CDN 或容器
- 🦆 **浏览器原生物理** — MuJoCo WASM 刚体仿真 50Hz
- 🧠 **真实 RL 策略** — 9 个神经网络通过 ONNX Runtime Web 运行
- 🌐 **WebRTC 多人幽灵** — P2P 鸭子同步，无需服务器
- 🎓 **学习宝库** — 强化学习、WebAssembly、3D 游戏开发、P2P 网络，全在一个小项目里

<p align="center">
  <img src="docs/promo/screenshots/sandbox-boot.png" alt="沙盒模式 — 鸭子、球和 HUD 在 Tron 竞技场中" width="70%">
</p>

---

## 💬 加入社区

**微信开发者交流群** — 扫码加入 MicroDuck-Arena 开发者群，分享创意、提问交流、一起看鸭子踢球！

<p align="center">
  <img src="docs/promo/screenshots/wechat-group.png" alt="微信群二维码 — MicroDuck-Arena 开发者交流群" width="300">
</p>

<p align="center">
  <i>二维码有效期至 <b>9月14日</b>。过期了？提个 issue 我们会更新。</i>
</p>

---

## 📸 游戏截图

<table>
  <tr>
    <td align="center">
      <img src="docs/promo/screenshots/football-match-2.png" alt="3v3 足球比赛" width="100%">
      <br><sub>🏟️ 3v3 足球 — 红队 vs 蓝队</sub>
    </td>
    <td align="center">
      <img src="docs/promo/screenshots/sandbox-boot.png" alt="沙盒模式" width="100%">
      <br><sub>🦆 沙盒 — 自由操控单只鸭子</sub>
    </td>
  </tr>
</table>

---

## 🚀 快速开始

```bash
git clone https://github.com/00make/microduck-arena.git
cd microduck-arena/app
npm install
npm run dev
```

开发服务器：`http://localhost:5173`

| 模式 | URL |
|------|-----|
| 🏟️ 足球（3v3，默认） | `/` |
| 🦆 沙盒（单鸭） | `?mode=sandbox` |

> **需要 [Git LFS](https://git-lfs.com/)** — 模型、网格和策略文件以 LFS 二进制存储。如果应用报 JSON 错误，运行 `git lfs install && git lfs pull`。

---

## 🛠 技术栈

| 层级 | 技术 |
|------|------|
| 框架 | Vite + React 19 |
| 3D | React Three Fiber + Three.js |
| 物理 | MuJoCo WASM (50Hz) |
| AI | ONNX Runtime Web (9 个策略) |
| 多人 | WebRTC P2P (Trystero) |

更多细节：[架构与部署说明](docs/3v3-football/02-tech-stack.md)。

---

## 🙏 致谢

- 🦆 [Microduck 机器人](https://github.com/pollen-robotics/microduck) by Pollen Robotics — RL 策略使用 [microduck_rl](https://github.com/pollen-robotics/microduck_rl) 训练
- ⚙️ [MuJoCo](https://deepmind.google/technologies/mujoco/) by Google DeepMind · 🔮 [ONNX Runtime Web](https://onnxruntime.ai/) by Microsoft · 📡 [Trystero](https://github.com/dmotz/trystero) by Dan Motzenbecker

---

## 📄 许可证

MIT © [00make](https://github.com/00make)。详见 [LICENSE](LICENSE)。

<p align="center">
  <b>喜欢 Microduck Arena？<a href="https://github.com/00make/microduck-arena/stargazers">点个 ⭐</a>，分享给朋友！</b>
</p>
