# Microduck Arena · 中文推广文案

> 每个平台一版，独立适配、非互相复制。直接整段复制粘贴即可。
> 链接汇总与配图说明见 [README.md](./README.md)。

---

## 一、知乎 / 掘金版（技术长文）

### 标题（三选一）

- 我在浏览器里跑了一支强化学习足球队，还让它们自己踢起来了
- 没有服务器、没有后端：我把 MuJoCo 物理仿真 + ONNX 神经网络塞进了浏览器
- 6 只 AI 机器鸭在浏览器里踢 3v3 足球，全程零后端

### 正文

事情的起点很离谱：我想在浏览器里，让六只强化学习机器鸭自己踢一场 3v3 足球——不要服务器，不要后端，打开一个网址就能看。

最后真做出来了。它叫 **Microduck Arena**，是一个完全跑在浏览器里的 3v3 强化学习足球竞技场。你可以直接点开玩：

🎮 **Live Demo**：https://microduck-arena.com/
🐙 **GitHub（MIT 开源）**：https://github.com/00make/microduck-arena

打开就是足球模式，六只鸭子分成红蓝两队自动对打，有门将、有后卫、有前锋，还有完整的裁判系统管开球、越位、进球、角球。想单独撸一只鸭子玩物理玩具？加个参数进沙盒：https://microduck-arena.com/?mode=sandbox

【配图：3v3 足球对战截图，红蓝两队 + 霓虹球场】

> 📸 [插入截图: screenshots/football-title.png] — 足球模式标题页（KICK OFF），放段首展示"打开即足球"
> 📸 [插入截图: screenshots/football-match-1.png] — 对战全景（主力首图）

---

#### 一、这些鸭子是哪来的

机器人本体不是我从零造的，它来自法国机器人团队 **Pollen Robotics** 的开源项目 microduck——一只 25cm 高的双足机器鸭（https://github.com/pollen-robotics/microduck）。

而鸭子会走路、会踢球、会翻滚的这些"本事"，是用他们的强化学习训练环境 **microduck_rl**（https://github.com/pollen-robotics/microduck_rl）基于 MuJoCo 训出来的 PPO 策略，导出成 ONNX 文件。我做的，是把这套"训练好的大脑 + 物理身体"完整地搬进浏览器，让它们在没有服务器的情况下实时跑起来，还组了个足球队。

---

#### 二、真正的硬骨头：在浏览器里跑物理 + 神经网络

大多数人第一反应是：这不得开个后端跑仿真？还真不用。整个技术栈是这样的：

**React + Vite + Three.js + MuJoCo WASM + ONNX Runtime + Trystero (WebRTC) + Zustand**

拆开讲三个关键点：

**1）MuJoCo 编译成 WebAssembly，物理跑在浏览器里**

我把 MuJoCo 物理引擎编译成了 WASM，直接在浏览器里做完整的刚体仿真。这里有两个频率要分清：

- **物理步 200Hz**：底层 `timestep = 0.005s`，每秒钟解算 200 次物理。
- **控制循环 50Hz**：每 4 个物理步（`decimation = 4`）才做一次策略推理和动作下发，也就是 `CTRL_DT = 0.02s`，正好 50Hz。

这个 50Hz 不是随便定的——它和真实 microduck 机器人机载运行时的实时控制频率一模一样。所以你在浏览器里看到的鸭子步态，就是它在现实世界里走路的样子。

**2）9 个 ONNX 神经网络策略，浏览器里实时推理**

鸭子的每一个动作背后都是一个神经网络。整个项目带了 **9 个 ONNX 策略**：行走、坐/站、翻滚、左右踢球、地面啄拾、摔倒爬起，还有轮足变体的滑行和下蹲。

- 每个策略吃 **61 维观测**（关节角、角速度、重力投影、指令速度等），吐 **14 维动作**（对应 14 个关节）。
- 推理引擎用的是 **onnxruntime-web**，实测单步推理 **<2ms**——这意味着 6 只鸭子同时跑策略，帧预算依然绰绰有余。

【配图：策略切换示意 / 鸭子踢球瞬间】

> 📸 [插入截图: screenshots/football-match-2.png] — 另一机位的对战瞬间（进球/踢球高光 GIF 待补）

**3）WebRTC P2P 多人同步，零后端**

多人这块我没有架任何服务器。用的是 **Trystero** 这个库，走 WebRTC P2P，通过 Nostr 中继做信令，玩家之间的鸭子状态直接点对点广播（15Hz）。所以整个站点本质上就是一堆静态文件，扔到任何 CDN 或容器里就能上线，没有数据库、没有 API、没有运维。

---

#### 三、架构上的一点心得

前端我刻意做了分层：**React 只负责 UI 外壳**（菜单、HUD、覆盖层），真正的游戏核心是命令式的、和框架无关的一坨 JS（物理、AI、渲染循环都在里面）。两者之间用 **Zustand** 做桥——游戏状态往外流给 UI 渲染，UI 的操作意图往里流给游戏核心。

这么做的好处是：游戏循环不会被 React 的渲染节奏拖后腿，50Hz 的控制频率稳稳的；同时 UI 又能享受 React 的开发体验。3D 渲染用的是 React Three Fiber + Three.js，球场是赛博朋克 Tron 风格，霓虹网格地板 + 自定义 GLSL 着色器 + CRT 后处理，进球还有漫画风格的过场动画。

【配图：Tron 霓虹竞技场 + 漫画过场动画分镜】

> 📸 [插入截图: screenshots/football-match-1.png] — Tron 霓虹球场全景（漫画过场分镜暂无截图，待补）

---

#### 四、两种玩法

> 📸 [插入截图: screenshots/football-title.png] — 放在本段前，足球模式标题页

- **⚽ 足球模式（默认）**：3v3，六只 AI 鸭子自动对打，完整裁判系统，赛后有技术统计。打开 https://microduck-arena.com/ 直接看。
- **🦆 沙盒模式**：一只鸭子自由漫游，配了街机、滑板、walkman 一堆 90 年代物理玩具，还有小游戏。支持键盘、触屏、手柄全输入。进法：https://microduck-arena.com/?mode=sandbox

> 📸 [插入截图: screenshots/football-match-1.png] — 足球玩法实拍
> 📸 [插入截图: screenshots/sandbox-title.png] — 沙盒模式标题页（WADDLE IN + 3D 鸭子）
> 📸 [插入截图: screenshots/sandbox-boot.png] — 沙盒实机（鸭子 + 足球 + HUD：FEET/ROLLERS、FPS/CTRL 50Hz）

---

#### 五、开源信息

整个项目 **MIT 协议开源**，欢迎白嫖、fork、提 issue、发 PR：

- 🐙 GitHub：https://github.com/00make/microduck-arena
- 🤗 Hugging Face Space：https://huggingface.co/spaces/00make/microduck-arena
- 🎮 Live Demo：https://microduck-arena.com/

技术栈回顾：React + Vite + Three.js + MuJoCo WASM + ONNX Runtime + Trystero (WebRTC) + Zustand。

致谢：机器人本体设计来自 Pollen Robotics，RL 策略用 microduck_rl 训练，物理引擎 MuJoCo（Google DeepMind），推理引擎 ONNX Runtime Web（Microsoft），P2P 库 Trystero（Dan Motzenbecker）。

如果你觉得"在浏览器里跑一支强化学习足球队"这件事有点酷，点个 star 就是对我最大的鼓励 🦆⚽

---

## 二、B站动态版（短文 + 配图引导）

【配图/视频：足球对战高光 GIF，鸭子进球瞬间最佳】

> 📸 [封面: screenshots/football-match-1.png] — 动态封面首选（无 GIF 时用）；备选 [封面: screenshots/football-title.png]

我做了个离谱的东西：**六只 AI 机器鸭在浏览器里踢 3v3 足球** 🦆⚽

没有服务器，没有后端，打开网址就能看它们自己抢球、射门、还有裁判判越位。

底层是 MuJoCo 物理仿真（编译成了 WebAssembly）+ 9 个 ONNX 神经网络策略，全部实时跑在浏览器里，单步推理不到 2 毫秒。鸭子本体来自法国 Pollen Robotics 的开源机器鸭 microduck。

👉 直接玩：https://microduck-arena.com/
👉 源码（MIT 开源）：https://github.com/00make/microduck-arena

进球有漫画风过场，球场是赛博朋克霓虹风，还挺上头的。视频/截图在下面，觉得有意思的话三连支持一下，我接着更新沙盒模式和多人对战～

#独立游戏 #强化学习 #WebAssembly #机器人 #开源项目

---

## 三、V2EX / 即刻版（简洁技术向 · Show HN 风格）

**Show：我在浏览器里做了一支强化学习足球队（零后端，MIT 开源）**

Microduck Arena —— 完全跑在浏览器里的 3v3 强化学习足球竞技场，六只 AI 机器鸭自动对打。

技术要点：
- MuJoCo 编译成 WASM，浏览器里跑刚体物理：200Hz 物理步 / 50Hz 控制循环
- 9 个 ONNX 策略（onnxruntime-web 推理），61 维观测 → 14 维动作，单步 <2ms
- WebRTC P2P 多人同步（Trystero / Nostr），纯静态站点，零后端零运维
- React + Vite + Three.js(R3F) + Zustand，Tron 霓虹风 + 漫画过场

机器人本体来自 Pollen Robotics 开源 microduck，策略用 microduck_rl 训练。

Demo：https://microduck-arena.com/ （默认足球，`?mode=sandbox` 进沙盒）
GitHub：https://github.com/00make/microduck-arena

> 📸 [插入截图: screenshots/football-match-1.png] — 帖首配一张对战图（技术向版面，一张足矣）

好奇纯前端把物理 + NN 推理都吃下来，性能和内存边界能推到哪，欢迎拍砖交流。

---

## 四、微信公众号版（图文并茂 · 分段清晰）

【封面图：Tron 霓虹球场 + 六只鸭子对峙，标题压字"浏览器里的强化学习足球队"】

> 📸 [封面: screenshots/football-match-1.png] — 公众号首图底图（可叠加标题压字）；尺寸裁切见 social-card.md

### 引子

如果我告诉你，有一支足球队，六名球员全是 AI，比赛全程在你的手机浏览器里进行，没有一台服务器参与——你信吗？

我把它做出来了。它叫 **Microduck Arena**。

🎮 点开就能看：https://microduck-arena.com/

【配图：足球对战全景截图】

> 📸 [插入截图: screenshots/football-match-2.png]

---

### 它们是谁？六只会踢球的机器鸭

球员不是人，是六只 25cm 高的双足机器鸭。

它们的"身体"来自法国机器人团队 Pollen Robotics 的开源项目 microduck；它们会走路、踢球、翻滚的"大脑"，是用强化学习训练环境 microduck_rl 在 MuJoCo 里训练出来的神经网络。

而我做的事，是把这套身体和大脑，原封不动地搬进了浏览器。

【配图：单只鸭子特写 / 步态分解】

> 📸 [插入截图: screenshots/sandbox-title.png] — 单只鸭子 3D 模型特写

---

### 硬核在哪？物理和 AI 全跑在浏览器里

一般人会觉得，这种仿真怎么也得开个后端服务器吧？

偏不。整个项目**零后端**，靠的是三样东西：

**① MuJoCo 物理引擎，编译成 WebAssembly**
浏览器里直接解算刚体物理，每秒 200 次物理步、50 次控制循环——和真实机器人的控制频率完全一致。

**② 9 个 ONNX 神经网络策略**
行走、踢球、翻滚、爬起……每个动作背后都是一个神经网络，吃 61 维观测、吐 14 维动作，单步推理不到 2 毫秒。六只鸭子同时跑也毫无压力。

**③ WebRTC 点对点多人同步**
基于 Trystero 库，玩家之间直接 P2P 通信，不经过任何服务器。整个网站就是一堆静态文件。

【配图：技术栈示意图 / 架构分层图】

> 📸 [插入截图: screenshots/sandbox-boot.png] — HUD 可见 FPS / CTRL 50Hz、FEET/ROLLERS 切换，作控制频率与模式切换的实拍佐证

---

### 好看在哪？赛博朋克 + 漫画风

除了硬核，它还很好玩、很好看。

球场是赛博朋克 Tron 风格：霓虹网格地板、自定义着色器光效、CRT 复古后处理。每次进球，还会弹出漫画风格的过场动画，分镜感十足。

【配图：Tron 竞技场 + 漫画过场分镜】

> 📸 [插入截图: screenshots/football-match-1.png] — Tron 霓虹球场（漫画过场分镜暂无截图，待补）

---

### 两种玩法

**⚽ 足球模式（默认）**：3v3，六只 AI 鸭子自动对打，有门将、后卫、前锋，还有完整裁判系统管进球、越位、角球，赛后给你一份技术统计。
👉 https://microduck-arena.com/

> 📸 [插入截图: screenshots/football-title.png] 或 [插入截图: screenshots/football-match-1.png]

**🦆 沙盒模式**：一只鸭子自由漫游，街机、滑板、walkman 一堆 90 年代物理玩具随便玩，键盘、触屏、手柄全支持。
👉 https://microduck-arena.com/?mode=sandbox

> 📸 [插入截图: screenshots/sandbox-title.png] 或 [插入截图: screenshots/sandbox-boot.png]

---

### 最后：它完全开源

Microduck Arena 采用 **MIT 协议**开源，代码、策略、素材全部公开，欢迎 fork、学习、提建议。

- 🐙 GitHub：https://github.com/00make/microduck-arena
- 🤗 HF Space：https://huggingface.co/spaces/00make/microduck-arena
- 🎮 Live Demo：https://microduck-arena.com/

技术栈：React + Vite + Three.js + MuJoCo WASM + ONNX Runtime + Trystero (WebRTC) + Zustand。

在浏览器里跑一支强化学习足球队，听起来像天方夜谭，但 WebAssembly 时代，它真的能落地。

如果这篇让你觉得有点意思，转发给同样爱折腾的朋友吧 🦆⚽

【配图：文末二维码 + 项目 Logo】
