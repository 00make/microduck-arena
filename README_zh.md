🌐 [English](README.md) | 中文

# 🐤 Microduck Arena

> 浏览器里的 3v3 强化学习足球赛。MuJoCo 物理仿真 + ONNX 神经网络策略，50Hz 实时推理。

<!-- badges -->
[![Demo](https://img.shields.io/badge/🎮_Live_Demo-HuggingFace-yellow)](https://huggingface.co/spaces/00make/microduck-arena)
[![Node](https://img.shields.io/badge/node-%3E%3D22.12-brightgreen)](https://nodejs.org)
![License](https://img.shields.io/badge/license-TBD-blue)

<!--
  TODO: 替换为实际演示素材（截图或 GIF）
  <p align="center">
    <img src="docs/assets/demo.gif" alt="Microduck Arena 3v3 足球赛演示" width="720" />
  </p>
-->

---

## ✨ 特性亮点

- **🧠 真实 RL 策略推理** — 9 个 ONNX checkpoint 在浏览器端实时运行，不是预录动画，是真正的神经网络决策
- **⚙️ MuJoCo WebAssembly 物理** — 工业级物理引擎编译为 WASM，50Hz 控制循环，完全客户端运行
- **⚽ 3v3 足球模式** — 六只鸭子同场竞技，含裁判系统、AI 策略切换、进球庆祝、犯规罚时
- **🕹️ 双运动形态** — legs（步行）和 rollers（轮滑）两种机器人变体，按 `M` 一键切换
- **👻 多人幽灵同步** — Trystero WebRTC P2P，15Hz 状态广播，无需后端服务器
- **📱 零部署依赖** — 纯静态站点，无后端、无数据库、无 API Key
- **🎮 手柄支持** — 接入游戏手柄即可操控，映射与真实机器人运行时一致

---

## 🛠 技术栈

| 层级 | 技术 |
|------|------|
| 前端框架 | Vite + React 19 + React Three Fiber |
| 3D 渲染 | Three.js + 自定义 GLSL ShaderMaterial |
| UI 组件 | MUI (Material UI) |
| 状态管理 | Zustand |
| 物理引擎 | @mujoco/mujoco WebAssembly |
| 策略推理 | onnxruntime-web (wasm-simd-threaded) |
| 多人通信 | Trystero (WebRTC P2P, Nostr 信令) |
| 部署 | Docker (nginx) / Cloudflare Pages / Hugging Face Spaces |

---

## 🚀 快速开始

### 前置要求

- Node.js >= 22.12
- [Git LFS](https://git-lfs.com/)（大文件：机器人网格、ONNX 模型、GLB）

### 安装与运行

```bash
# 克隆仓库（确保已安装 Git LFS）
git clone https://github.com/00make/microduck-arena.git
cd microduck-arena

# 如果克隆时未自动拉取 LFS 文件
git lfs pull

# 安装依赖并启动开发服务器
cd app
npm install
npm run dev
```

开发服务器默认运行在 `http://localhost:5173`。

### 模式切换

| 模式 | URL |
|------|-----|
| ⚽ 足球模式（3v3） | `http://localhost:5173/?mode=football&boot=1` |
| 🦆 沙盒模式（单鸭） | `http://localhost:5173/?boot=1` |

> `boot=1` 跳过欢迎弹窗，直接进入 BIOS 加载界面，显示真实加载进度。

---

## 🏗 架构概览

```
app/src/
├── game/                  # 命令式游戏核心（框架无关）
│   ├── game.js            # MuJoCo 物理循环 + MJCF 编译
│   ├── duck.js            # 鸭子渲染 rig（kinematics.json 驱动）
│   ├── ghosts.js          # 多人幽灵同步（Trystero, 15Hz）
│   ├── football/          # 3v3 足球逻辑
│   │   ├── referee.js     # 裁判系统（犯规/罚时/进球判定）
│   │   ├── ai/            # 每只鸭子的 AI 策略调度
│   │   ├── field.js       # 球场与物理围栏
│   │   ├── goal.js        # 球门碰撞检测
│   │   └── constants.js   # 足球模式常量
│   ├── controls/          # 键盘/手柄/触控输入
│   ├── fx/                # 视觉特效（Tron 网格地板等）
│   └── audio.js           # 音效系统
├── football/              # 足球模式 React 组件
├── ui/                    # 通用 UI（HUD、标题菜单、BIOS）
├── scene/                 # R3F 画布与后处理
└── store.js               # Zustand 全局状态
```

**核心设计**：React/MUI 负责 UI 层，react-three-fiber 管理渲染上下文，物理/策略/rig 循环完全在框架无关的 `game/` 模块中运行。Zustand store 作为桥梁——游戏状态向外输出，UI 意图向内传递。

**策略接口**：所有变体共享统一的 61D 观测空间（陀螺仪、投影重力、14 关节位置/速度、上一步动作、13D 命令）和 14D 位置目标输出。

---

## 📦 部署

项目构建产物为纯静态文件，支持多种部署方式：

### Docker (nginx)

```bash
docker build -t microduck-arena .
docker run -p 8080:8080 microduck-arena
```

使用多阶段构建：Vite 打包 → nginx-unprivileged 托管，监听 8080 端口。

### Cloudflare Pages

连接 GitHub 仓库，设置：
- 构建命令：`cd app && npm ci && npm run build`
- 输出目录：`app/dist`

### Hugging Face Spaces

仓库已包含 HF Spaces 配置（Docker SDK），直接推送即可部署。

---

## 🧪 测试

```bash
cd app

# 单元测试（纯逻辑，~100ms，无需 WASM）
npm test

# 端到端测试：完整 3v3 比赛模拟（~16s）
npm run test:headless
```

- **`npm test`** — Node 内置 test runner，覆盖裁判逻辑、AI、HUD、MJCF/XML 断言、常量校验。无浏览器、无 GPU、无 WASM，秒级完成。
- **`npm run test:headless`** — 在 Node 中运行完整 300 秒六鸭 3v3 比赛（MuJoCo WASM 物理 + onnxruntime-web 策略推理），复用浏览器构建的同一套 referee/ai/constants 模块。退出码：`0` 成功，`1` 球从未移动，`2` 集体罚时（4+ 鸭同时离场），`3` 物理爆炸或崩溃。

---

## 🎮 操控说明

| 按键 | 功能 |
|------|------|
| WASD / 方向键 | 前进/后退 + 转向 |
| M | 切换 legs ↔ rollers |
| Q / E | 左/右踢球（仅 legs） |
| F | 交替左右踢球（仅 legs） |
| R | 坐下/站起（legs）/ 下蹲滑行（rollers） |
| G | 地面拾取（仅 legs） |
| C | 切换追踪摄像机 |
| Space | 重置 |
| 鼠标拖拽 | 旋转视角 |
| 滚轮 | 缩放 |

---

## 🙏 致谢

- 原始 Microduck 机器人设计与 RL 训练由 [pollen-robotics](https://github.com/pollen-robotics/microduck) 完成
- [MuJoCo](https://mujoco.org/) 物理引擎由 Google DeepMind 开发并开源
- [Trystero](https://github.com/dmotz/trystero) 提供无服务器 WebRTC 信令
- [onnxruntime-web](https://github.com/microsoft/onnxruntime) 实现浏览器端神经网络推理
- 项目作者：**[00make](https://github.com/00make)**

---

## 📄 开源协议

<!-- TODO: 确定协议后补充 -->

TBD
