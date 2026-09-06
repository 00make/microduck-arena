# Microduck 3v3 足球赛 - 调研文档

> 调研时间：2026-09-05
> 目标：参考加速进化 Booster Champion 3v3 仿真赛，将 Microduck Arena 升级为 3v3 足球对战系统

## 文档索引

| 文件 | 内容 | 适用场景 |
|---|---|---|
| [01-rules.md](./01-rules.md) | Booster 3v3 完整比赛规则 | 了解赛事规则、判罚机制 |
| [02-tech-stack.md](./02-tech-stack.md) | 技术栈对比 + 引擎框架分析 | 技术选型、架构设计 |
| [03-upgrade-plan.md](./03-upgrade-plan.md) | 分阶段升级规划 + 任务分解 | 执行实施、任务分配 |
| [04-code-snippets.md](./04-code-snippets.md) | 代码参考片段 + 结构示例 | 编码参考、接口结构 |

> **⚠️ 历史文档提示**：`03-upgrade-plan.md` 与 `04-code-snippets.md` 记录的是初始升级规划，实际实现已偏离其中的文件路径、函数签名和数据结构。请以代码为准。最后全面审查日期：2026-09-07。

## 快速开始

### 如果你是执行智能体，准备实施升级：

1. **先读规则**：`01-rules.md` - 了解 3v3 足球赛怎么玩
2. **再看技术**：`02-tech-stack.md` - 了解 Booster 和 Microduck 的技术差异
3. **最后看计划**：`03-upgrade-plan.md` - 按 Phase 顺序执行任务

### 推荐执行顺序

```
Phase 1（场地改造）→ Phase 2（多鸭子 + AI）→ Phase 3（规则引擎）→ Phase 4（UI）
```

### MVP（最小可行产品）

完成 Phase 1 + Phase 2 即可实现：
- 6 只鸭子在足球场自主踢球
- 红蓝两队对战
- 预计工期：5-8 天

## 关键信息

### Booster 3v3 核心规则
- 每队 3 台机器人（1 门将 + 2 前锋/后卫）
- 全程 AI 自主运行，禁止人工遥控
- 自动裁判系统（Python）
- 积分规则：胜 3 / 平 1 / 负 0

### Microduck 现有能力
- ✅ 浏览器内 MuJoCo WASM 物理仿真
- ✅ ONNX 策略推理（行走、踢球等）
- ✅ 可踢足球（已有球物理）
- ✅ 3D 渲染 + 音效系统
- ❌ 多鸭子实例（需扩展）
- ❌ AI 决策层（需新增）
- ❌ 足球规则系统（需新增）
- ❌ 球门 + 场地标线（需新增）

### 技术栈
- **物理**：MuJoCo WASM
- **渲染**：three.js + react-three-fiber
- **推理**：onnxruntime-web
- **状态**：zustand
- **框架**：Vite + React

## 参考链接

### 官方资源
- 加速进化官网：https://booster-robotics.com/
- Booster Studio 下载：官网"开发者"板块
- Booster Learn 学习社区：官网入口

### 开源项目
- MARLadona（Isaac Lab 多 Agent 足球）：https://github.com/leggedrobotics/marladona-isaac-lab
- Isaac Lab：https://github.com/isaac-sim/IsaacLab
- MuJoCo：https://github.com/google-deepmind/mujoco

### 论文
- Booster Gym：https://arxiv.org/abs/2506.15132
- Isaac Lab：https://arxiv.org/abs/2511.04831

### 开发者社群
- 微信：扫码加入（官网二维码）
- 飞书：点击加入（官网链接）
- Discord：点击加入（官网链接）

## 备注

- 本文档基于 2026-09-05 的调研
- Booster 赛事规则可能更新，以官网为准
- Microduck 当前版本基于 commit hash（待补充）
- 执行时可根据实际情况调整方案
