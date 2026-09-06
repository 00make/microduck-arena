🌐 [English](README.md) | 中文

# 🐤 Microduck Arena

> 浏览器里的 3v3 强化学习足球赛。MuJoCo 物理仿真 + ONNX 神经网络策略，50Hz 实时推理。

![License](https://img.shields.io/badge/license-MIT-blue)
![MuJoCo](https://img.shields.io/badge/physics-MuJoCo_WASM-blue)
![ONNX Runtime](https://img.shields.io/badge/inference-onnxruntime--web-green)
[![HF Space](https://img.shields.io/badge/%F0%9F%A4%97_Space-Microduck_Arena-yellow)](https://huggingface.co/spaces/00make/microduck-arena)

<!-- TODO: 补充实际截图 / GIF -->

**[▶ 在线试玩](https://huggingface.co/spaces/00make/microduck-arena)**

---

## ✨ 特性亮点

- 🦆 **浏览器原生物理仿真** — MuJoCo 编译为 WebAssembly，完整刚体动力学以 50Hz 运行
- 🧠 **9 个神经网络策略** — onnxruntime-web（wasm-simd-threaded）驱动行走、踢球、翻滚等动作
- ⚽ **3v3 足球模式** — 基于角色的 AI（守门员、后卫、前锋），配套完整裁判系统
- 🌐 **WebRTC 多人幽灵** — 通过 Trystero 实现 P2P 鸭子同步，15Hz 广播，无需服务器
- 🎨 **赛博朋克 Tron 竞技场** — 自定义 GLSL 着色器、霓虹网格地板、CRT 后处理
- 📦 **零后端** — 纯静态站点，可部署到任意 CDN 或容器平台
- 🎮 **全输入设备支持** — 键盘、触屏虚拟按键、带模拟扳机的手柄

> 另有 **legs（步行）** 与 **rollers（轮滑）** 两种运动形态，按 `M` 即时切换。

---

## 🛠 技术栈

| 层级 | 技术 |
|------|------|
| 前端框架 | Vite + React 19 |
| 3D 渲染 | React Three Fiber + Three.js |
| UI 组件 | MUI (Material UI) |
| 状态管理 | Zustand |
| 物理引擎 | [@mujoco/mujoco](https://www.npmjs.com/package/@mujoco/mujoco)（WebAssembly） |
| 模型推理 | [onnxruntime-web](https://www.npmjs.com/package/onnxruntime-web)（wasm-simd-threaded） |
| 多人联机 | [Trystero](https://github.com/dmotz/trystero)（WebRTC P2P，Nostr 中继信令） |
| 测试 | node:test + 无头端到端探针 |
| 部署 | Docker (nginx) / Cloudflare Pages / Hugging Face Spaces |

---

## 🚀 快速开始

### 环境要求

- Node.js ≥ 22.12
- 已安装 [Git LFS](https://git-lfs.com/)

### 克隆并运行

```bash
git clone https://github.com/00make/microduck-arena.git
cd microduck-arena/app
npm install
npm run dev
```

开发服务器启动在 `http://localhost:5173`。

### URL 模式

| 模式 | URL |
|------|-----|
| 🏟️ 足球模式（3v3） | `http://localhost:5173/?mode=football&boot=1` |
| 🦆 沙盒模式（单鸭） | `http://localhost:5173/?boot=1` |

> **说明：** `?boot=1` 会跳过欢迎弹窗，直接展示实时 BIOS 加载控制台。加载失败（资产缺失、策略拉取出错等）会冻结在 `SYSTEM HALTED` 画面并显示错误详情，便于排查。

### Git LFS

大体积二进制资产（STL 网格、GLB 模型、ONNX 策略）通过 Git LFS 存储：

```bash
git lfs install   # 每台机器执行一次
git lfs pull      # 在已有克隆中拉取真实二进制文件
```

若未拉取 LFS 文件，应用会对着文本指针文件启动并报类似
`SyntaxError: Unexpected token 'v', "version ht"... is not valid JSON` 的错误
（那串字符是 LFS 指针的开头，不是你的模型）。

---

## 🏗 架构概览

```
app/src/
├── game/                  # 命令式游戏核心（框架无关）
│   ├── game.js            # 主循环：MuJoCo 物理 + ONNX 推理 @ 50Hz
│   ├── duck.js            # 机器人 rig：kinematics JSON → Three.js 骨骼
│   ├── arena.js           # Tron 风格竞技场（GLSL 着色器）
│   ├── constants.js       # 共享物理 / 游戏常量
│   ├── ghosts.js          # WebRTC 多人同步（Trystero，15Hz 广播）
│   ├── variants.js        # legs / rollers 运动形态切换
│   ├── football/          # 足球领域逻辑
│   │   ├── referee.js     # 规则引擎（进球、犯规、罚时、开球）
│   │   ├── ai/            # 角色 AI（守门员、后卫、前锋）
│   │   ├── field.js       # 球场与物理围栏
│   │   ├── goal.js        # 球门网格与碰撞几何
│   │   └── match-config.js # 队伍编成与比赛参数
│   ├── controls/          # 输入控制器（键盘、手柄、触屏）
│   └── fx/                # 视觉特效（粒子、镜头震动、CRT）
├── football/              # 足球模式 React 组件
├── scene/                 # R3F 画布与后处理
├── ui/                    # React UI（HUD、菜单、遮罩层）
└── store.js               # Zustand 桥梁（游戏 ↔ UI）
```

**设计理念：** React 只负责 UI 外壳；游戏核心是命令式、与引擎解耦的。Zustand store 作为两者的桥梁——游戏状态向外流出，UI 意图向内流入。

**策略契约：** legs 与 rollers 共享同一套接口——61 维观测（陀螺仪、投影重力、14 个关节位置/速度、上一步动作、13 维命令）与 14 维位置目标输出，与 [`microduck_rl/scripts/infer_policy.py`](https://github.com/pollen-robotics/microduck_rl/blob/main/scripts/infer_policy.py) 保持一致。

---

## 📦 部署

### Cloudflare Pages

```bash
cd app
npm run build
# 将 app/dist/ 部署到 Cloudflare Pages
```

### Docker

```bash
docker build -t microduck-arena .
docker run -p 8080:8080 microduck-arena
```

多阶段构建：Vite 打包产物 → nginx-unprivileged 在 8080 端口托管。

### Hugging Face Spaces

README 的 front matter（`sdk: docker`、`app_port: 8080`）让仓库可直接作为 HF Space 部署。推送到 Space 的 `main` 分支即自动构建。

---

## 🧪 测试

```bash
cd app

# 快速单元测试（node:test，约 100ms，不加载 WASM）
npm test

# 端到端无头 3v3 比赛探针（约 16s）
npm run test:headless
```

| 测试套件 | 覆盖范围 | 耗时 |
|---------|---------|------|
| `npm test` | 裁判规则、AI 逻辑、HUD 状态、MJCF/XML 断言、常量校验 | ~100ms |
| `npm run test:headless` | 完整 300 秒六鸭比赛——在 Node 中跑 MuJoCo WASM + ONNX 推理 | ~16s |

单元测试运行在 Node 内置 test runner 上，不需要浏览器、GPU 或 WASM，因此始终保持秒级响应。

无头探针（[`app/tools/headless-match.mjs`](app/tools/headless-match.mjs)）复用了与浏览器构建完全相同的 referee / ai / constants / match-config 模块，是"多鸭 MJCF 能编译且物理保持稳定"的端到端保证。运行结果确定，退出码含义明确：

- `0` — 成功
- `1` — 球从未移动
- `2` — 集体罚时（4 只以上鸭子同时离场）
- `3` — 物理爆炸或崩溃

因需加载 WASM 运行时、耗时约 16 秒，它被拆为独立脚本而非并入 `npm test`——在 CI 中应作为单独步骤接入。

---

## 🎮 操控说明

| 按键 | 功能 |
|------|------|
| WASD / 方向键 | 移动（前进、后退、转向） |
| M | 切换 legs ↔ rollers |
| Q / E | 左 / 右踢球（仅 legs） |
| F | 左右脚交替踢球（仅 legs） |
| R | 坐下 / 站起（legs）· 下蹲滑行（rollers） |
| G | 地面拾取（仅 legs） |
| C | 切换追踪摄像机 |
| Space | 重置 |
| 拖拽 / 滚轮 | 旋转视角 / 缩放 |

完整支持手柄——按键映射与真实机器人运行时一致（右摇杆控制视角，R3 恢复追踪摄像机，扳机控制张嘴与叫声）。

在 roller 模式下，legs 专属动作（踢球、坐下）会被禁用且提示淡出；此时靠驾驶撞球来玩。

---

## 🙏 致谢

- 🦆 **Microduck 机器人** — 原始设计来自 [Pollen Robotics](https://github.com/pollen-robotics/microduck)
- 🧪 **强化学习策略** — 使用 [microduck_rl](https://github.com/pollen-robotics/microduck_rl) 训练
- ⚙️ **MuJoCo** — [Google DeepMind](https://deepmind.google/technologies/mujoco/) 开发的物理引擎
- 🔮 **ONNX Runtime Web** — [Microsoft](https://onnxruntime.ai/) 提供的推理引擎
- 📡 **Trystero** — [Dan Motzenbecker](https://github.com/dmotz/trystero) 编写的 WebRTC P2P 库

**作者：** [00make](https://github.com/00make)

---

## 📄 开源协议

MIT © 00make。详见 [LICENSE](LICENSE)。
