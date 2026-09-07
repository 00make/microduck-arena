# Microduck Arena · OG 社交卡片设计说明

> 用于生成分享缩略图（Open Graph / Twitter Card）与各平台封面图。
> 目标：一眼看出"赛博朋克霓虹球场 + 机器鸭足球"，风格与游戏内美术一致。

---

## 一、尺寸规格

| 用途 | 尺寸 | 比例 | 说明 |
|------|------|------|------|
| **OG 标准卡（推荐）** | **1200 × 630 px** | 1.91:1 | 通用，Facebook / LinkedIn / Discord / 微信外链 / Slack |
| Twitter Card | 1200 × 628 px | 1.91:1 | 与 OG 基本一致，可直接复用 |
| 微博 / B站封面 | 1146 × 717 px 或 16:10 | — | 主体居中，避免边缘裁切 |
| 知乎头图 | 1920 × 1080 px | 16:9 | 长文顶部大图 |
| 公众号封面 | 900 × 383 px（首图 2.35:1） | — | 文字要少，主体醒目 |
| 正方形备用 | 1080 × 1080 px | 1:1 | 即刻 / Instagram / 朋友圈九宫格 |

**安全区**：四边各留 **≥ 60px** 内边距；关键文字/Logo 不要贴边，多数平台会加圆角或裁切。

---

## 二、设计方向：漫画感 × 赛博朋克霓虹

整体基调 = **游戏内 Tron 霓虹球场** + **漫画分镜/贴纸**的混搭。

- 深色打底，霓虹球场网格向远处透视消失，营造纵深感。
- 六只机器鸭分红蓝两队对峙（或一只鸭子特写 + 足球）。
- 漫画贴纸元素点缀（速度线、`BOOM!`、`QUACK!` 爆炸框），呼应游戏内过场动画。
- 轻微 CRT 扫描线 / 辉光 / 颗粒噪点，强化"街机 + 赛博"质感。
- 标题压字要粗、要有冲击力，像游戏海报而非 PPT。

---

## 三、配色（取自游戏内真实调色板）

直接从代码里提取的 token，保证卡片和游戏视觉统一：

| 角色 | 色值 | 出处 / 用途 |
|------|------|-------------|
| 背景墨黑 `INK` | `#08080c` | 全局背景（theme.js） |
| 主强调橙 `ORANGE` | `#ff7a2f` | 品牌主色、标题高亮、按钮（theme.js） |
| 球场网格暖灰 | `#8e8371` | 场地 cell 线（field.js） |
| 分区琥珀 | `#ffb366` | 场地 section 线 / 霓虹辉光（field.js） |
| 中圈热奶油 | `#ffd9a0` | 中线/中圈高光（field.js） |
| 红队 | `#ff2244` | red team（celebration.js） |
| 蓝队 | `#2266ff` | blue team（celebration.js） |

**配色策略**：以墨黑为底、暖橙霓虹为主光源，红蓝两队作为对抗性点缀。避免平均用力——让橙色主导，红蓝点睛。

> 注：这不是常见的青/紫 Tron，而是**暖橙霓虹**风，更贴合本项目美术，也更容易在信息流里跳出来。

---

## 四、字体建议

- **标题（Display）**：粗重、带科技/街机感的无衬线，如 `Chakra Petch`、`Orbitron`、`Rajdhani`、`Archivo Black`（英文）；中文可用 `站酷高端黑`、`思源黑体 Heavy`、`庞门正道标题体`。
- **正文 / 数据标签**：等宽字体呼应游戏内 OSD，如 `JetBrains Mono`、`Space Mono`、`IBM Plex Mono`。
- **技术指标**：用等宽小字排 `50Hz` `200Hz` `<2ms` `9 POLICIES` `MIT` 等，做成 HUD 徽章感。

避免 Inter / Roboto / Arial 这类烂大街字体做标题。

---

## 五、可复用的现成素材

项目里已有的资产，直接拿来用（路径见 `app/public/`）：

| 素材 | 路径 | 用途 |
|------|------|------|
| 鸭头标记（闭） | `app/public/assets/duck-head-mark.webp` | 主视觉 / Logo / 角标 |
| 鸭头标记（张嘴） | `app/public/assets/duck-head-mark-open.webp` | "QUACK!" 漫画瞬间 |
| 文字标 | `app/public/assets/microduck-wordmark.svg` | 标题字样（矢量，可任意缩放） |
| 漫画贴纸 | `app/public/assets/stickers/*.webp` | 装饰点缀 |
| **真实游戏截图** | `docs/promo/screenshots/*.png`（共 6 张） | **卡片底图/主视觉**，详见第七节与 [README.md](./README.md) |

**贴纸清单**（`stickers/`）：`bang-red`、`boom`、`burst-yellow`、`quack`、`quack-quack`、`shooting-star`、`star-yellow`、`wave`、`ziouuu`。

**建议构图**：中央放 `microduck-wordmark.svg` 标题字 + `duck-head-mark.webp` 鸭头，两侧用 `boom` / `burst-yellow` / `bang-red` 贴纸做爆炸框，底部一排等宽 HUD 徽章放技术指标。

---

## 六、文案层级（卡片上要写的字）

从上到下信息层级：

1. **主标题（最大）**：`MICRODUCK ARENA`
2. **副标题（中）**：`3v3 RL Football — entirely in your browser`
   中文版：`浏览器里的 3v3 强化学习足球`
3. **HUD 徽章行（等宽小字）**：`MuJoCo WASM · 50Hz` `ONNX · <2ms` `9 POLICIES` `WebRTC P2P` `ZERO BACKEND` `MIT`
4. **域名（角落）**：`microduck-arena.com`

> 卡片上字越少越好，靠画面说话；详细数据放正文文案里。

---

## 七、截图位（已有真实截图，直接可用）

卡片主视觉建议用**真实游戏截图**而非纯插画，更有说服力。`screenshots/` 下已备好 6 张实拍，可直接作为 OG 卡底图或参考：

| 截图位 | 推荐素材 | 说明 |
|--------|----------|------|
| 【位 A · 主图】 | `screenshots/football-match-1.png`（或 `football-match-2.png`） | 3v3 对战全景，红蓝两队 + 霓虹球场，铺满背景或作主体，**首选** |
| 【位 B · inset 小窗】 | （待补）漫画风进球过场分镜 | 现有截图暂无过场动画，可先用 `screenshots/football-title.png`（KICK OFF）代替，画中画斜贴一角 |
| 【位 C · 备用】 | `screenshots/sandbox-boot.png`（或 `sandbox-title.png`） | 沙盒单鸭 + 街机玩具场景，用于沙盒主题卡片 |

**已有截图完整清单**（用途详见 [README.md](./README.md) 的「截图清单」）：

- `screenshots/football-title.png` — 足球模式标题页（MICRODUCK FOOTBALL 3V3 + KICK OFF）
- `screenshots/football-match-1.png` — 对战进行中（RED 0-0 BLUE · 04:51）——**主力底图**
- `screenshots/football-match-2.png` — 对战进行中（RED 0-0 BLUE · 04:42 · 另一机位）
- `screenshots/sandbox-title.png` — 沙盒标题页（WADDLE IN + 3D 鸭子）
- `screenshots/sandbox-boot.png` — 沙盒实机（鸭子 + 足球 + HUD：FEET/ROLLERS、FPS/CTRL 50Hz）
- `screenshots/football-boot.png` — 与 football-title 相同（`?boot=1` 对足球模式无效，属预期），备用

> 待补的动态/分镜素材：进球高光 GIF、漫画过场动画分镜（现有均为静态截图）。

**补拍新截图的方式**（如需替换或补充）：
1. 打开 https://microduck-arena.com/ ，进入足球模式，等一次进球/精彩对抗。
2. 用系统截图（macOS `⌘⇧4` / `⌘⇧5`）或浏览器 DevTools 的 "Capture full size screenshot"。
3. 尽量截 2x/Retina 分辨率，导出后缩放到目标尺寸更清晰。
4. 可在截图上叠加轻微霓虹辉光 / CRT 扫描线，与整体风格融合。

---

## 八、可用工具 & 模板

| 工具 | 适用 | 说明 |
|------|------|------|
| **Figma** | 精细控制、批量导出 | 建 1200×630 画板，把上面色值/字体做成 style token；用组件批量出各平台尺寸 |
| **Canva** | 快速出图 | 搜 "Open Graph / Twitter Card" 模板，套本项目配色改字改图 |
| **Photopea** | 免费在线 PS | 无 Figma 时的替代，支持图层/导出 |
| **@vercel/og / Satori** | 代码生成 OG 图 | 想自动化时，用 JSX + 上述色值直接渲染成 PNG，接 CI |
| **SVG + 截图** | 轻量方案 | 用 `microduck-wordmark.svg` 拼一版 SVG，浏览器截图导出 |

**推荐流程**：Figma 建一个 master 画板 → 定义色板（上面 7 个色值）和字体样式 → 放入鸭头/wordmark/贴纸素材 + 截图 → 用 Figma 的多尺寸导出一次性生成 OG / Twitter / 微博 / 公众号 / 正方形各版本。

---

## 九、接入 OG 标签（生成后）

卡片做好上传后，在 `app/index.html` 的 `<head>` 补充（示例，域名按实际替换）：

```html
<meta property="og:title" content="Microduck Arena — 3v3 RL Football in Your Browser" />
<meta property="og:description" content="Six AI robot ducks play football. MuJoCo WASM physics, ONNX inference, WebRTC P2P — zero backend. MIT open source." />
<meta property="og:image" content="https://microduck-arena.com/og-card.png" />
<meta property="og:url" content="https://microduck-arena.com/" />
<meta property="og:type" content="website" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:image" content="https://microduck-arena.com/og-card.png" />
<meta name="twitter:title" content="Microduck Arena — 3v3 RL Football in Your Browser" />
<meta name="twitter:description" content="Six AI robot ducks play football, entirely in the browser. Zero backend. MIT open source." />
```

> 导出的卡片图建议命名 `og-card.png`，放到 `app/public/` 下随站点一起部署，`og:image` 用绝对 URL。

---

## 十、验收清单

- [ ] 主图 1200×630，四边安全区 ≥60px
- [ ] 配色与游戏一致（墨黑底 + 暖橙霓虹 + 红蓝队）
- [ ] 标题 `MICRODUCK ARENA` + 副标题清晰可读（缩到手机信息流大小仍看得清）
- [ ] HUD 徽章含关键技术指标
- [x] 含真实游戏截图（足球对战：`screenshots/football-match-1.png` 已就绪）
- [ ] 用了现成素材（wordmark / duck-head / stickers）
- [ ] 各平台尺寸已导出（OG / Twitter / 微博 / 公众号 / 正方形）
- [ ] `og:image` / `twitter:image` 已写入 `index.html` 并可访问
