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
| [screenshots/](./screenshots/) | 实际游戏截图（6 张 PNG） | 各平台配图、封面底图、OG 卡片素材 |

---

## 🖼️ 截图清单（`screenshots/`）

> 全部为真实游戏截图，相对路径引用 `screenshots/xxx.png`。下表标注每张的用途建议，各文案里的 `【配图：...】` / `[插入截图: ...]` 标记均已对应到具体文件。

| 文件 | 画面内容 | 用途建议 |
|------|----------|----------|
| [screenshots/football-title.png](./screenshots/football-title.png) | 足球模式标题页（MICRODUCK FOOTBALL 3V3 + KICK OFF 按钮） | 足球模式入口介绍、"打开即足球"说明、模式切换演示 |
| [screenshots/football-match-1.png](./screenshots/football-match-1.png) | 足球比赛进行中（RED 0-0 BLUE · 04:51 · 6 只鸭子在 Tron 球场） | **主力配图/封面**：长文首图、B站动态封面、Twitter 首推、OG 卡片底图 |
| [screenshots/football-match-2.png](./screenshots/football-match-2.png) | 足球比赛进行中（RED 0-0 BLUE · 04:42 · 另一机位/站位） | 第二张对战配图：长文中段、九宫格、避免与 match-1 重复时使用 |
| [screenshots/sandbox-title.png](./screenshots/sandbox-title.png) | 沙盒模式标题页（MICRODUCK ARENA + WADDLE IN + 3D 鸭子模型） | 沙盒模式介绍、"两种玩法"段落、单鸭 3D 展示 |
| [screenshots/sandbox-boot.png](./screenshots/sandbox-boot.png) | 沙盒实际场景（鸭子 + 足球 + HUD：FEET/ROLLERS 切换、颜色选择器、FPS/CTRL 50Hz） | 沙盒实机演示、HUD/控制说明、步态与 50Hz 控制频率佐证 |
| [screenshots/football-boot.png](./screenshots/football-boot.png) | 与 football-title 相同（`?boot=1` 对足球模式无效，属预期行为） | 备用；如需说明 boot 参数仅在沙盒生效时的对照参考 |

**选用速记：**

- 只放一张 → `football-match-1.png`（信息量最大、最有冲击力）。
- 讲足球 → `football-title.png` + `football-match-1.png` / `football-match-2.png`。
- 讲沙盒 → `sandbox-title.png` + `sandbox-boot.png`。
- 讲"两种玩法"对比 → `football-match-1.png` 配 `sandbox-boot.png`。

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
2. **配图**：文案中标注了 `【配图：...】` / `[插入截图: ...]` 的位置，已给出具体文件名，直接从 [screenshots/](./screenshots/) 取对应截图插入即可（见上方「截图清单」）；封面/OG 图制作见 [social-card.md](./social-card.md)。
3. **链接**：所有链接均为完整 URL，无需替换。若自定义域名有变动，请全局替换 `https://microduck-arena.com/`。
4. **本地化**：中英文文案为独立创作，非互相翻译，可分别投放对应语区。
5. **不影响构建**：本目录（`docs/promo/`）已被 `.dockerignore` 排除，不会进入 Docker 镜像。

---

## ✅ 分发前检查清单

- [x] 截图已就绪（见 `screenshots/`：足球标题/对战 ×2、沙盒标题/实机、football-boot 备用）
- [ ] 进球高光 GIF / 漫画过场分镜待补（现有截图暂无动态素材）
- [ ] OG 卡片已生成并上传（见 social-card.md）
- [ ] Live Demo 可正常访问、无控制台报错
- [ ] GitHub 仓库为 public、README 徽章正常显示
- [ ] 各平台标签/话题已选好（#WebAssembly #强化学习 #机器人 #opensource）

---

MIT © [00make](https://github.com/00make) · Microduck Arena
