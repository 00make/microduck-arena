# Microduck Arena · 推广材料分发索引

> 一套可以直接复制粘贴、批量分发到各平台的推广图文材料。
> 所有文案已按平台调性独立适配，链接均为完整 URL，开箱即用。

---

## 📦 材料清单

| 文件 | 内容 | 适用场景 |
|------|------|----------|
| [README.md](./README.md) | 分发索引（本文件） | 快速导航、链接汇总、使用说明 |
| [copy-zh.md](./copy-zh.md) | 中文推广文案 | 知乎 / 掘金 / B站 / V2EX / 即刻 / 微信公众号 |
| [copy-en.md](./copy-en.md) | 英文推广文案 | Dev.to / Reddit / Twitter(X) |
| [social-card.md](./social-card.md) | OG 社交卡片设计说明 | 分享缩略图、封面图制作 |

---

## 🔗 链接汇总（复制即用）

| 名称 | URL |
|------|-----|
| 🎮 Live Demo | https://microduck-arena.com/ |
| 🐙 GitHub | https://github.com/00make/microduck-arena |
| 🤗 HF Space | https://huggingface.co/spaces/00make/microduck-arena |
| 🦆 上游机器人（Pollen Robotics） | https://github.com/pollen-robotics/microduck |
| 🧪 RL 训练环境（microduck_rl） | https://github.com/pollen-robotics/microduck_rl |

**模式直达链接：**

| 模式 | URL |
|------|-----|
| ⚽ 足球模式（默认） | https://microduck-arena.com/ |
| 🦆 沙盒模式 | https://microduck-arena.com/?mode=sandbox |

---

## 📣 各平台文案入口

### 中文平台 → [copy-zh.md](./copy-zh.md)

- **知乎 / 掘金（长文）** — 技术深度长文，适合干货社区
- **B站动态（短文 + 配图引导）** — 短平快，引导看视频/截图
- **V2EX / 即刻** — 简洁技术向，Show HN 风格
- **微信公众号** — 图文并茂，分段清晰

### 英文平台 → [copy-en.md](./copy-en.md)

- **Dev.to / Blog（长文）** — 架构叙事 + 技术指标
- **Reddit** — r/robotics · r/MachineLearning · r/WebAssembly · r/gamedev 各一版
- **Twitter / X Thread** — 5–8 条推文串

---

## 🎯 核心信息（所有文案共用）

- **项目名**：Microduck Arena
- **一句话**：完全在浏览器中运行的 3v3 强化学习足球竞技场
- **基于**：Pollen Robotics 的 microduck 机器人
- **技术栈**：React + Vite + Three.js + MuJoCo WASM + ONNX Runtime + Trystero (WebRTC) + Zustand
- **核心卖点**：
  - 完全在浏览器中运行，**零后端**
  - 3v3 强化学习足球，6 只 AI 鸭子自动对打
  - MuJoCo WASM 物理仿真 **50Hz 控制 / 200Hz 物理**
  - **9 个神经网络策略**（ONNX，**<2ms/step** 推理，61 维观测 / 14 维动作）
  - WebRTC P2P 多人同步（基于 Trystero / Nostr）
  - 沙盒模式（自由漫游 + 物理玩具）
  - 漫画风格过场动画 + 赛博朋克 Tron 竞技场
  - **MIT 开源**

---

## 📝 使用说明

1. **直接复制**：打开对应平台的文案文件，整段复制到目标平台即可。
2. **配图**：文案中标注了 `【配图：...】` 的位置，请插入对应截图/GIF；封面图制作见 [social-card.md](./social-card.md)。
3. **链接**：所有链接均为完整 URL，无需替换。若自定义域名有变动，请全局替换 `https://microduck-arena.com/`。
4. **本地化**：中英文文案为独立创作，非互相翻译，可分别投放对应语区。
5. **不影响构建**：本目录（`docs/promo/`）已被 `.dockerignore` 排除，不会进入 Docker 镜像。

---

## ✅ 分发前检查清单

- [ ] 截图/GIF 已准备（足球对战、沙盒、Tron 竞技场、漫画过场）
- [ ] OG 卡片已生成并上传（见 social-card.md）
- [ ] Live Demo 可正常访问、无控制台报错
- [ ] GitHub 仓库为 public、README 徽章正常显示
- [ ] 各平台标签/话题已选好（#WebAssembly #强化学习 #机器人 #opensource）

---

MIT © [00make](https://github.com/00make) · Microduck Arena
