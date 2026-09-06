# 技术栈与引擎框架对比

> 调研时间 2026-09-05

## 一、Booster Studio 技术栈

### 核心组件

#### 1. Booster Studio（IDE）
- **定位**：专为具身智能打造的集成开发环境
- **功能**：
  - 可视化仿真
  - 代码编辑（内置 Vibe Coding AI 助手）
  - 物理调试
  - 真机部署
  - ROS 数据可视化
- **平台**：macOS (Apple Silicon 12.0+) / Windows 10-11 / Linux (Ubuntu 22, 24)
- **特点**：
  - 像素级物理引擎（高保真模拟重力、摩擦力、传感器噪声）
  - 仿真与真机共享通信架构和控制接口
  - Sim2Real 无缝衔接

#### 2. BoosterAgent（开发框架）
- **语言**：Python
- **架构**：分层设计
  ```
  感知层 → 球/敌方/球门识别
  定位层 → 坐标转换
  决策战术层 → 传球、射门、防守、多机协同
  运动执行层 → 步态控制
  ```
- **官方 Demo**：自带传球、射门、防守、门将、多机协同基础逻辑
- **通信**：进程间通信 / ROS

#### 3. Booster Gym（RL 训练框架）
- **基础**：NVIDIA Isaac Lab
- **能力**：
  - 并行多环境快速训练
  - 支持 PPO、SAC 等强化学习算法
  - 训练踢球、避障、团队配合 AI 模型
- **论文**：arXiv:2506.15132（Booster Gym: An End-to-End Reinforcement Learning Framework for Humanoid Robot Locomotion）

#### 4. 物理引擎
- **训练端**：NVIDIA Isaac Lab（GPU 加速）
- **仿真端**：MuJoCo（高精度）
- **RoboCup 仿真 3D 组**：已正式采用 Booster T1 + MuJoCo 作为标准平台

### 机器人模型
- **Booster K1**：小型人形机器人（不到 1 米高）
- **Booster T1**：中型人形机器人
- **Booster T2**：旗舰平台，搭载 NVIDIA Thor 芯片（2070 TFLOPS）

### 开源资源
- GitHub：3v3 RoboCup 完整 Demo、机器人 URDF 模型、球场环境配置
- Docker 镜像：agent-dev、virtual-robot 仿真镜像
- 文档：感知视觉、坐标转换、多智能体协同、步态控制 API 手册

---

## 二、Microduck Arena 技术栈

### 核心架构

#### 前端框架
- **Vite + React**：构建工具 + UI 框架
- **MUI**：UI 组件库
- **three.js + react-three-fiber**：3D 渲染
- **zustand**：状态管理

#### 物理仿真
- **MuJoCo WebAssembly**：浏览器内物理仿真
- **控制频率**：50 Hz（timestep 0.005s, decimation 4）
- **模型**：Microduck 鸭子（14 关节）

#### 推理引擎
- **onnxruntime-web**：浏览器内 ONNX 推理
- **策略**：预训练 ONNX 检查点
  - 行走（walking）
  - 坐起/站立（sitstand / stand）
  - 翻滚（roll）
  - 踢球（kickL / kickR）
  - 捡球（groundpick）
  - 轮式驱动（drive / crouch）

#### 多人系统
- **Trystero**：WebRTC over Nostr
- **幽灵系统**：P2P 实时位置同步

#### 控制系统
- 键盘
- 手柄（Gamepad）
- 触屏
- 路径点（Waypoint）

### 关键文件结构
```
app/src/
├── game/
│   ├── controls/       # 输入控制
│   ├── fx/             # 视觉特效
│   ├── vendor/         # 第三方库
│   ├── arena.js        # 场地渲染（Tron grid + 墙壁）
│   ├── audio.js        # 音效系统
│   ├── ball-actor.js   # 球物理 + 视觉
│   ├── ball-visual.js  # 球视觉辅助
│   ├── ceremony.js     # 入场动画
│   ├── constants.js    # 常量定义
│   ├── duck.js         # 鸭子模型加载
│   ├── game.js         # 游戏主循环（2127 行）
│   ├── ghosts.js       # 多人幽灵系统
│   ├── props.js        # 道具系统
│   ├── variants.js     # 鸭子皮肤变体
│   └── ...
├── scene/
│   ├── CrtDistortion.jsx  # CRT 失真效果
│   └── GameCanvas.jsx     # R3F Canvas
├── ui/
│   ├── BiosOverlay.jsx    # BIOS 启动动画
│   ├── Hud.jsx            # HUD 界面
│   ├── MenuDuck.jsx       # 菜单鸭子
│   ├── TitleMenu.jsx      # 标题菜单
│   └── ...
├── App.jsx
├── main.jsx
├── store.js            # Zustand 状态
└── theme.js
```

### 关键常量（constants.js）
```javascript
// 物理
TIMESTEP = 0.005        // 仿真步长
DECIMATION = 4          // 控制步长倍率
CTRL_DT = 0.02          // 控制周期 20ms (50Hz)

// 速度限制
VEL_FWD = 0.25          // 前进最大速度
VEL_BACK = -0.2         // 后退最大速度
VEL_ANG = 1.0           // 旋转最大角速度

// 场地
ARENA_HALF = 1.5        // 场地半宽 3m x 3m
ARENA_WALL_H = 0.25     // 墙壁高度

// 球
BALL_RADIUS = 0.05      // 球半径 5cm

// 关节
NUM_JOINTS = 14         // 关节数
OBS_SIZE = 61           // 观察维度
CMD_SIZE = 13           // 命令维度
```

---

## 三、对比分析

| 维度 | Booster Studio | Microduck Arena |
|---|---|---|
| **运行环境** | 桌面客户端 | 纯浏览器 |
| **物理引擎** | MuJoCo（桌面）/ Isaac Lab（训练） | MuJoCo WASM（浏览器） |
| **训练框架** | Booster Gym（Isaac Lab + PPO/SAC） | 无（仅推理） |
| **推理引擎** | ONNX Runtime（Python） | onnxruntime-web（WASM） |
| **渲染** | OpenGL（桌面） | three.js + R3F（WebGL） |
| **机器人模型** | K1/T1/T2 人形 URDF | Microduck 鸭子（14 关节） |
| **多 Agent** | 3 台独立 Agent + ROS 通信 | 单鸭子 + WebRTC 幽灵 |
| **Sim2Real** | 完整链路（仿真→真机一键部署） | 无（纯演示） |
| **AI 决策** | Python Agent（感知→决策→执行） | 人工控制（键盘/手柄） |
| **比赛系统** | 完整赛事规则 + 自动裁判 | 无 |
| **开发语言** | Python | JavaScript |

---

## 四、相关开源项目

### MARLadona（Isaac Lab 多 Agent 足球）
- **仓库**：https://github.com/leggedrobotics/marladona-isaac-lab
- **基础**：Isaac Lab + rsl_rl
- **能力**：多 Agent 强化学习足球环境
- **特点**：
  - 支持 3v3 等任意队伍配置
  - 单一策略适应任意队伍规模
  - 基于 Isaac Lab 扩展模板

### Isaac Lab
- **论文**：arXiv:2511.04831（Isaac Lab: A GPU-Accelerated Simulation Framework for Multi-Modal Robot Learning）
- **定位**：Isaac Gym 的继任者
- **特点**：
  - GPU 加速并行仿真
  - 支持多模态机器人学习
  - 开源（GitHub）

---

## 五、技术选型建议

### 如果要做浏览器端 3v3 足球演示
- **继续使用 Microduck 架构**
- 复用 MuJoCo WASM + onnxruntime-web
- 扩展多鸭子实例 + AI 决策层
- 添加足球规则引擎

### 如果要做完整的 RL 训练 + 比赛系统
- **参考 Booster Studio 方案**
- 使用 Isaac Lab / MuJoCo（Python）做训练
- 导出 ONNX 策略部署到浏览器
- 或参考 MARLadona 开源方案

### 混合方案
- 浏览器端做演示 + 轻量对战
- 服务器端做 RL 训练（可选）
- 训练好的策略导出给浏览器使用

---

## 参考链接

- Booster Studio 官网：https://booster-robotics.com/
- Booster Gym 论文：https://arxiv.org/abs/2506.15132
- Isaac Lab 论文：https://arxiv.org/abs/2511.04831
- MARLadona 仓库：https://github.com/leggedrobotics/marladona-isaac-lab
- Isaac Lab 仓库：https://github.com/isaac-sim/IsaacLab
- MuJoCo WASM：https://github.com/google-deepmind/mujoco
