#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────
// headless-match.mjs — 无头 3v3 足球比赛测试探针
//
// 在纯 Node.js 环境（无浏览器 / 无 GPU）里跑一整场 Microduck 3v3 足球比赛：
//   · @mujoco/mujoco (WASM) 提供物理
//   · onnxruntime-web (WASM) 提供策略推理
//   · 复用 src/ 下的纯模块：referee / ai / constants / match-config / goal
//
// 与线上 game.js 的差异只有一处：不受 50Hz 实时门控约束，循环里直接
// mj_step × DECIMATION + ONNX 推理，不 sleep，因此可以远快于实时跑完。
//
// **不 import game.js**（它是浏览器闭包，依赖 THREE/DOM/fetch/audio）。
// MJCF 构建逻辑（buildPhysicsXml 的 football 分支）在此独立复刻。
//
// 用法：
//   cd app && node tools/headless-match.mjs
//   node tools/headless-match.mjs --duration=60 --log-interval=25
//   npm run test:headless        # 同上，作为独立的端到端 CI 步骤（非 npm test）
//
// 完整 300s 比赛约 16s wall clock、确定性、正常退出码 0；因需加载 WASM
// 运行时且远慢于单测套件，故独立成 script，不并入 `npm test`。
//
// 退出码：0 正常 / 1 球从未移动 / 2 集体罚下(≥4 只同时离场) / 3 爆炸或崩溃
// ─────────────────────────────────────────────────────────────────────────

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

// ── src/ 纯模块（无 DOM / 无引擎依赖，可在 Node 直接 import）──────────────
import {
  POLICIES, JOINT_NAMES, DEFAULT_POSE, NUM_JOINTS, OBS_SIZE, CMD_SIZE,
  ACTION_SCALE, TIMESTEP, DECIMATION, CTRL_DT, BALL_RADIUS,
} from '../src/game/constants.js';
import { FOOTBALL_CONFIG } from '../src/game/football/match-config.js';
import {
  SPAWN_POSITIONS, BALL_SPAWN, AI_DIVIDER, MATCH_DURATION_S, PENALTY_DURATION_S,
  FIELD_HALF_W, GOAL_WIDTH,
} from '../src/game/football/constants.js';
import { getGoalCollisionGeoms } from '../src/game/football/goal.js';
import { createReferee } from '../src/game/football/referee.js';
import { createAgent, decideAll } from '../src/game/football/ai/index.js';
import { createDuckInstance } from '../src/game/football/duck-instance.js';

// ── 路径 ──────────────────────────────────────────────────────────────────
const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(HERE, '..');
const PUBLIC = path.join(APP_ROOT, 'public');
const MODEL_DIR = path.join(PUBLIC, 'robot', 'mjlab');
const MESH_DIR = path.join(MODEL_DIR, 'meshes');
const POLICY_DIR = path.join(PUBLIC, 'policies');
const MUJOCO_WASM = path.join(APP_ROOT, 'node_modules', '@mujoco', 'mujoco', 'mujoco.wasm');
const ORT_WASM_DIR = path.join(APP_ROOT, 'node_modules', 'onnxruntime-web', 'dist') + path.sep;

// ── CLI 参数 ──────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    const m = /^--([^=]+)=(.*)$/.exec(a);
    if (m) out[m[1]] = m[2];
    else if (a.startsWith('--')) out[a.slice(2)] = 'true';
  }
  return out;
}
const ARGS = parseArgs(process.argv.slice(2));
// duration = 比赛仿真时长（秒），换算成控制步：steps = duration / CTRL_DT。
const DURATION_S = Number(ARGS.duration ?? MATCH_DURATION_S);
// log-interval = 每隔多少控制步输出一行状态（50 步 = 1s 比赛时间）。
const LOG_INTERVAL = Math.max(1, Number(ARGS['log-interval'] ?? 50));
const TOTAL_STEPS = Math.round(DURATION_S / CTRL_DT);

// 诊断信息走 stderr，stdout 只保留可机读的 JSON（逐行状态 + 事件 + 摘要）。
const info = (...a) => process.stderr.write(`[headless] ${a.join(' ')}\n`);
const emit = (obj) => process.stdout.write(JSON.stringify(obj) + '\n');

// game.js 闭包内的足球相关常量（未导出），在此按同值复刻。
const IDLE_CREEP = 0.22;            // 命令静止时的轻微前移，避开 INACTIVE 判罚（高于 walk 死区）
// 亚阈值兜底：decideAll 的 cos 缩放可能返回一个极小正 vx（如近垂直接球），
// 恰好落在 referee 的 IDLE_SPEED_EPS 附近被读作"静止"。任何 (0, MIN_EFFECTIVE_VX)
// 区间的 vx 都会被抬到一个真正的步行速度，再进入 IDLE_CREEP 静止规则。
const MIN_EFFECTIVE_VX = 0.22;
const CMD_SMOOTH_ALPHA = 0.25;      // 50Hz 一阶低通，抹平 10Hz 决策跳变
const KICK_STEPS = 25;              // 踢球 one-shot 窗口（控制步）
const POST_KICK_LOCK_STEPS = 20;    // 踢球后命令归零的宽限步数
const FALL_DEBOUNCE_STEPS = 10;     // gz>-0.5 持续 0.2s 才判定摔倒
const FALL_SETTLE_STEPS = 15;       // 摔倒后 ctrl 冻结的 settle 步数
const RECOVER_UPRIGHT_STEPS = 50;   // gz<-0.85 持续 1s 判定起身成功
const RECOVER_GIVEUP_STEPS = 300;   // 6s 起身失败则复位

// ═════════════════════════════════════════════════════════════════════════
// 极简 XML DOM —— Node 无 DOMParser，且仓库无 xml 依赖，故自建。
// 只需 element/attribute 级别的操作：MJCF 由 onshape-to-robot 生成，规整无
// CDATA / 命名空间，注释与文本（空白）可直接丢弃。
// ═════════════════════════════════════════════════════════════════════════
function mkEl(tag, attrs = {}) {
  return { tag, attrs: { ...attrs }, children: [], parent: null };
}

function findTagEnd(str, start) {
  let q = null;
  for (let i = start + 1; i < str.length; i++) {
    const ch = str[i];
    if (q) { if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; continue; }
    if (ch === '>') return i;
  }
  return -1;
}

function parseAttrs(content) {
  const m = /^\s*([^\s]+)([\s\S]*)$/.exec(content);
  if (!m) return { tag: content.trim(), attrs: {} };
  const tag = m[1];
  const rest = m[2];
  const attrs = {};
  const re = /([^\s=]+)\s*=\s*"([^"]*)"/g;
  let a;
  while ((a = re.exec(rest))) attrs[a[1]] = a[2];
  return { tag, attrs };
}

function parseXml(str) {
  const doc = mkEl('#document');
  const stack = [doc];
  let i = 0;
  while (i < str.length) {
    const lt = str.indexOf('<', i);
    if (lt === -1) break;
    if (str.startsWith('<!--', lt)) { i = str.indexOf('-->', lt) + 3; continue; }
    if (str.startsWith('<?', lt)) { i = str.indexOf('?>', lt) + 2; continue; }
    if (str.startsWith('<!', lt)) { i = str.indexOf('>', lt) + 1; continue; }
    if (str[lt + 1] === '/') { i = str.indexOf('>', lt) + 1; stack.pop(); continue; }
    const tagEnd = findTagEnd(str, lt);
    if (tagEnd === -1) break;
    const inner = str.slice(lt + 1, tagEnd);
    const selfClose = inner.endsWith('/');
    const { tag, attrs } = parseAttrs(selfClose ? inner.slice(0, -1) : inner);
    const node = mkEl(tag, attrs);
    node.parent = stack[stack.length - 1];
    node.parent.children.push(node);
    if (!selfClose) stack.push(node);
    i = tagEnd + 1;
  }
  return doc.children[0]; // <mujoco>
}

function escAttr(v) {
  return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function serialize(node, indent = 0) {
  const pad = '  '.repeat(indent);
  const attr = Object.entries(node.attrs).map(([k, v]) => ` ${k}="${escAttr(v)}"`).join('');
  if (node.children.length === 0) return `${pad}<${node.tag}${attr}/>`;
  const kids = node.children.map((c) => serialize(c, indent + 1)).join('\n');
  return `${pad}<${node.tag}${attr}>\n${kids}\n${pad}</${node.tag}>`;
}

function* walk(node) { yield node; for (const c of node.children) yield* walk(c); }
function findAll(root, tag) { return [...walk(root)].filter((n) => n.tag === tag); }
function findFirst(root, tag) { return [...walk(root)].find((n) => n.tag === tag) ?? null; }
function removeNode(node) {
  if (!node || !node.parent) return;
  const i = node.parent.children.indexOf(node);
  if (i >= 0) node.parent.children.splice(i, 1);
  node.parent = null;
}
function cloneNode(node) {
  const c = mkEl(node.tag, node.attrs);
  for (const ch of node.children) { const cc = cloneNode(ch); cc.parent = c; c.children.push(cc); }
  return c;
}
function appendChild(parent, child) { child.parent = parent; parent.children.push(child); return child; }
function insertBefore(parent, child, ref) {
  child.parent = parent;
  const i = parent.children.indexOf(ref);
  if (i < 0) parent.children.push(child);
  else parent.children.splice(i, 0, child);
}

// ═════════════════════════════════════════════════════════════════════════
// buildFootballXml —— 复刻 game.js:buildPhysicsXml 的 football 分支。
// 产出六只前缀化鸭子 + 球场 + 球门的单一 MJCF 字符串，以及需要装进 VFS 的
// mesh 文件名列表。
// ═════════════════════════════════════════════════════════════════════════
const PREFIX_ATTRS = ['name', 'site', 'body', 'objname', 'joint', 'body1', 'body2',
  'target', 'tendon', 'refsite'];

function prefixSubtree(node, prefix) {
  for (const attr of PREFIX_ATTRS) {
    const val = node.attrs[attr];
    // 用 '/' 守卫，避免给已带前缀的名字二次加前缀。
    if (val && !val.includes('/')) node.attrs[attr] = prefix + val;
  }
  for (const child of node.children) prefixSubtree(child, prefix);
}

function buildFootballXml() {
  const field = FOOTBALL_CONFIG.field;
  const duckConfigs = FOOTBALL_CONFIG.ducks;
  const ballPark = FOOTBALL_CONFIG.ball.parkPos;

  const src = fs.readFileSync(path.join(MODEL_DIR, 'robot_allcollisions.xml'), 'utf8');
  const root = parseXml(src);

  // 1) 去掉 visual geoms（contype=0，对动力学无意义），再删掉不再被引用的 mesh。
  for (const g of findAll(root, 'geom')) {
    if (g.attrs.class === 'visual') removeNode(g);
  }
  const usedMeshes = new Set(
    findAll(root, 'geom').map((g) => g.attrs.mesh).filter(Boolean),
  );
  const asset = findFirst(root, 'asset');
  for (const m of findAll(root, 'mesh')) {
    const name = m.attrs.name ?? (m.attrs.file || '').replace(/\.stl$/i, '');
    if (!usedMeshes.has(name)) removeNode(m);
  }

  // 2) timestep option。
  appendChild(root, mkEl('option', { timestep: String(TIMESTEP) }));

  const worldbody = findFirst(root, 'worldbody');
  // 3) 地板。
  appendChild(worldbody, mkEl('geom', {
    name: 'floor', type: 'plane', size: '0 0 0.05', pos: '0 0 0',
  }));

  // 4) 围墙（goal-openings 模式）：±X 端墙各留一个 GOAL_WIDTH 的球门口。
  const halfX = field.halfX, halfY = field.halfY;
  const ht = 0.05 / 2, hh = 0.25 / 2;
  const offX = halfX + ht, offY = halfY + ht;
  const spanX = halfX + 0.05, spanY = halfY + 0.05;
  const goalHalf = GOAL_WIDTH / 2;
  const segHalf = (spanY - goalHalf) / 2;
  const segC = goalHalf + segHalf;
  const wallDefs = [];
  for (const sx of [1, -1]) {
    for (const sy of [1, -1]) {
      wallDefs.push({
        name: `wall_${sx > 0 ? 'p' : 'n'}x_${sy > 0 ? 'p' : 'n'}y`,
        pos: `${sx * offX} ${sy * segC} ${hh}`, size: `${ht} ${segHalf} ${hh}`,
      });
    }
  }
  wallDefs.push(
    { name: 'wall_py', pos: `0 ${offY} ${hh}`, size: `${spanX} ${ht} ${hh}` },
    { name: 'wall_ny', pos: `0 ${-offY} ${hh}`, size: `${spanX} ${ht} ${hh}` },
  );
  for (const w of wallDefs) {
    appendChild(worldbody, mkEl('geom', { name: w.name, type: 'box', pos: w.pos, size: w.size }));
  }

  // 5) 球门碰撞体（实心门柱/横梁/球网，只朝球场留开口）。euler 用弧度
  //    （<compiler angle="radian">）——getGoalCollisionGeoms 已按此产出。
  for (const g of [...getGoalCollisionGeoms('red'), ...getGoalCollisionGeoms('blue')]) {
    const attrs = { name: g.name, type: g.type, pos: g.pos, size: g.size };
    if (g.euler) attrs.euler = g.euler;
    appendChild(worldbody, mkEl('geom', attrs));
  }

  // 6) 球：轻质自由球体，追加在机器人 body 之后（trunk freejoint 保持在 qpos 首位）。
  const ballBody = mkEl('body', { name: 'ball', pos: ballPark });
  appendChild(ballBody, mkEl('freejoint', { name: 'ball_freejoint' }));
  appendChild(ballBody, mkEl('geom', {
    name: 'ball_geom', type: 'sphere', size: String(BALL_RADIUS),
    mass: '0.03', friction: '0.4 0.01 0.003', solref: '0.03 0.4', condim: '6',
  }));
  appendChild(worldbody, ballBody);

  // 7) 多鸭注入：克隆已 strip 的 trunk_base 子树 6 次并前缀化，传感器/执行器
  //    按鸭序重注入，使 qpos/ctrl/sensordata 布局为 duck0..duck5, ball。
  const origBody = findFirst(worldbody, 'body'); // <body name="trunk_base">
  const origClone = cloneNode(origBody);
  removeNode(origBody);
  const sensorParent = findFirst(root, 'sensor');
  const actuatorParent = findFirst(root, 'actuator');
  const origSensors = sensorParent ? sensorParent.children.map(cloneNode) : [];
  const origActuators = actuatorParent ? actuatorParent.children.map(cloneNode) : [];
  if (sensorParent) sensorParent.children = [];
  if (actuatorParent) actuatorParent.children = [];
  for (const dc of duckConfigs) {
    const bodyClone = cloneNode(origClone);
    prefixSubtree(bodyClone, dc.prefix);
    insertBefore(worldbody, bodyClone, ballBody);
    if (sensorParent) for (const s of origSensors) {
      const sc = cloneNode(s); prefixSubtree(sc, dc.prefix); appendChild(sensorParent, sc);
    }
    if (actuatorParent) for (const a of origActuators) {
      const ac = cloneNode(a); prefixSubtree(ac, dc.prefix); appendChild(actuatorParent, ac);
    }
  }

  // 8) STAND keyframe：每鸭 freejoint(7) + 14 hinge，最后球 freejoint(7)；
  //    ctrl 为六段 DEFAULT_POSE。
  const poseByName = new Map(JOINT_NAMES.map((n, i) => [n, DEFAULT_POSE[i]]));
  const pose14 = Array.from(DEFAULT_POSE).join(' ');
  const qposParts = [];
  const ctrlParts = [];
  for (const dc of duckConfigs) {
    const [sx, sy, sz] = dc.spawn;
    const yaw = dc.yaw ?? 0;
    const qw = Math.cos(yaw / 2), qz = Math.sin(yaw / 2);
    qposParts.push(`${sx} ${sy} ${sz} ${qw} 0 0 ${qz}`);
    const duckBody = findAll(worldbody, 'body')
      .find((b) => b.attrs.name === `${dc.prefix}trunk_base`);
    const hinges = findAll(duckBody, 'joint')
      .map((j) => poseByName.get((j.attrs.name || '').split('/').pop()) ?? 0)
      .join(' ');
    qposParts.push(hinges);
    ctrlParts.push(pose14);
  }
  qposParts.push(`${ballPark} 1 0 0 0`);
  const kf = mkEl('keyframe');
  appendChild(kf, mkEl('key', {
    name: 'STAND', qpos: qposParts.join(' '), ctrl: ctrlParts.join(' '),
  }));
  appendChild(root, kf);

  const meshFiles = findAll(root, 'mesh').map((m) => m.attrs.file).filter(Boolean);
  return { xml: serialize(root), meshFiles };
}

// ═════════════════════════════════════════════════════════════════════════
// 运行时加载：MuJoCo WASM + VFS meshes + ONNX 会话。
// ═════════════════════════════════════════════════════════════════════════
async function loadRuntimes() {
  const loadMujocoFactory = (await import('@mujoco/mujoco')).default;
  const mujoco = await loadMujocoFactory({
    locateFile: (p) => (p.endsWith('.wasm') ? MUJOCO_WASM : p),
  });
  // onnxruntime-web 的 Node 入口用 fs 加载 wasm，仅需把 wasmPaths 指向 dist 目录。
  const ort = await import('onnxruntime-web');
  ort.env.wasm.wasmPaths = ORT_WASM_DIR;
  ort.env.wasm.numThreads = 1;
  return { mujoco, ort };
}

async function loadSessions(ort) {
  // 足球鸭子只会用到 walk / kickL / kickR / stand（起身）四个策略。
  // POLICIES.* 是浏览器相对路径（"./policies/x.onnx"），映射到磁盘 public/policies。
  const load = (rel) => ort.InferenceSession.create(
    new Uint8Array(fs.readFileSync(path.join(POLICY_DIR, path.basename(rel)))),
    { executionProviders: ['wasm'] },
  );
  const [walk, kickL, kickR, stand] = await Promise.all([
    load(POLICIES.walk), load(POLICIES.kickL), load(POLICIES.kickR), load(POLICIES.stand),
  ]);
  return { walk, kickL, kickR, stand };
}

function buildVfs(mujoco, meshFiles) {
  const vfs = new mujoco.MjVFS();
  for (const f of meshFiles) {
    const buf = fs.readFileSync(path.join(MESH_DIR, f));
    // meshdir="assets"，编译器按 "assets/<f>" 查找。
    vfs.addBuffer(`assets/${f}`, new Uint8Array(buf));
  }
  return vfs;
}

// ═════════════════════════════════════════════════════════════════════════
// 地址解析（复刻 resolveAddrs，去掉只服务于渲染的 kinematics/extraJoints）。
// ═════════════════════════════════════════════════════════════════════════
function resolveAddrs(mujoco, model, prefix) {
  return {
    qposAdr: JOINT_NAMES.map((n) => model.jnt(prefix + n).qposadr),
    dofAdr: JOINT_NAMES.map((n) => model.jnt(prefix + n).dofadr),
    freejointQposAdr: model.jnt(prefix + 'trunk_base_freejoint').qposadr,
    freejointDofAdr: model.jnt(prefix + 'trunk_base_freejoint').dofadr,
    gyroAdr: model.sensor(prefix + 'imu_ang_vel').adr,
    trunkId: mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_BODY.value, prefix + 'trunk_base'),
  };
}

// 把世界 -Z 旋进 trunk 坐标系（= game.js 的 projected gravity）。
// 返回 [gx, gy, gz]；直立时 gz ≈ -1。
function projGravity(xq) {
  const w = xq[0], x = xq[1], y = xq[2], z = xq[3];
  return [
    2 * w * y - 2 * x * z,
    -2 * w * x - 2 * y * z,
    -1 + 2 * x * x + 2 * y * y,
  ];
}

// ═════════════════════════════════════════════════════════════════════════
// 主程序
// ═════════════════════════════════════════════════════════════════════════
async function main() {
  const t0 = Date.now();
  info(`duration=${DURATION_S}s steps=${TOTAL_STEPS} logInterval=${LOG_INTERVAL}`);

  const { xml, meshFiles } = buildFootballXml();
  info(`MJCF built: ${meshFiles.length} collision meshes`);

  const { mujoco, ort } = await loadRuntimes();
  info('runtimes loaded (mujoco wasm + onnxruntime wasm)');

  const vfs = buildVfs(mujoco, meshFiles);
  const model = mujoco.MjModel.from_xml_string(xml, vfs);
  const data = new mujoco.MjData(model);
  const nDucks = FOOTBALL_CONFIG.ducks.length;
  if (model.nq !== nDucks * 21 + 7 || model.nu !== nDucks * NUM_JOINTS) {
    throw new Error(`model shape mismatch: nq=${model.nq} (want ${nDucks * 21 + 7}), nu=${model.nu} (want ${nDucks * NUM_JOINTS})`);
  }
  info(`compiled: nq=${model.nq} nu=${model.nu}`);

  const sessions = await loadSessions(ort);
  info('ONNX sessions ready: walk/kickL/kickR/stand');

  const standKeyId = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_KEY.value, 'STAND');
  const ballQposAdr = model.jnt('ball_freejoint').qposadr;
  const ballDofAdr = model.jnt('ball_freejoint').dofadr;

  // ── 鸭子实例 + 地址 + AI agent ──
  const ducks = FOOTBALL_CONFIG.ducks.map((dc, i) => {
    const addrs = resolveAddrs(mujoco, model, dc.prefix);
    addrs.ctrlOffset = i * NUM_JOINTS;
    const d = createDuckInstance(i, dc, addrs, null);
    const s = SPAWN_POSITIONS[i];
    d.agent = createAgent(d, { team: d.team, role: d.role, spawnX: s.x, spawnY: s.y });
    return d;
  });

  // ── 观测 / 状态构建（复刻 game.js 的 per-duck 逻辑）──
  function buildObsForDuck(duck) {
    const { qposAdr: qa, dofAdr: da, gyroAdr: ga, trunkId: ti } = duck.addrs;
    const buf = duck.obsBuf;
    const q = data.qpos, v = data.qvel, s = data.sensordata;
    let i = 0;
    for (let a = 0; a < 3; a++) buf[i++] = s[ga + a];
    const g = projGravity(data.body(ti).xquat);
    buf[i++] = g[0]; buf[i++] = g[1]; buf[i++] = g[2];
    for (let j = 0; j < NUM_JOINTS; j++) buf[i++] = q[qa[j]] - DEFAULT_POSE[j];
    for (let j = 0; j < NUM_JOINTS; j++) buf[i++] = v[da[j]];
    for (let j = 0; j < NUM_JOINTS; j++) buf[i++] = duck.lastAction[j];
    const kicking = duck.mode === 'kickL' || duck.mode === 'kickR';
    const cs = duck.cmdSm;
    buf[i++] = kicking ? 0 : cs[0]; // vx
    buf[i++] = 0;                   // 无横移
    buf[i++] = kicking ? 0 : cs[2]; // wz
    for (let k = 3; k < CMD_SIZE; k++) buf[i++] = 0;
    return buf;
  }

  function duckProjGravZ(duck) { return projGravity(data.body(duck.addrs.trunkId).xquat)[2]; }
  function duckPoseIsDead(duck) {
    const z = data.qpos[duck.addrs.freejointQposAdr + 2];
    const gz = duckProjGravZ(duck);
    if (!Number.isFinite(z) || !Number.isFinite(gz)) return 'exploded';
    if (gz > -0.5 || z < 0.02) return 'fallen';
    return null;
  }

  function cacheDuckPoses() {
    const q = data.qpos;
    for (const duck of ducks) {
      const fj = duck.addrs.freejointQposAdr;
      duck.pos[0] = q[fj]; duck.pos[1] = q[fj + 1]; duck.pos[2] = q[fj + 2];
      duck.yaw = Math.atan2(
        2 * (q[fj + 3] * q[fj + 6] + q[fj + 4] * q[fj + 5]),
        1 - 2 * (q[fj + 5] * q[fj + 5] + q[fj + 6] * q[fj + 6]),
      );
    }
  }

  function buildGameState() {
    const q = data.qpos, v = data.qvel;
    return {
      ball: {
        x: q[ballQposAdr], y: q[ballQposAdr + 1], z: q[ballQposAdr + 2],
        vx: v[ballDofAdr], vy: v[ballDofAdr + 1],
      },
      ducks: ducks.map((d) => ({
        id: d.id, team: d.team, role: d.role,
        x: d.pos[0], y: d.pos[1], yaw: d.yaw, fallen: !!d.recovery,
      })),
      self: null,
    };
  }

  function buildRefereeState() {
    const q = data.qpos;
    return {
      ball: { pos: [q[ballQposAdr], q[ballQposAdr + 1], q[ballQposAdr + 2]] },
      ducks: ducks
        .filter((d) => !(d.penaltyTimer > 0) && !d.sentOff)
        .map((d) => ({
          id: d.id, team: d.team, pos: [d.pos[0], d.pos[1], d.pos[2]], fallen: !!d.recovery,
        })),
    };
  }

  // ── 放置 / 复位（去掉渲染层的 applyVariant / celebration / store）──
  function placeBall(pos) {
    const q = data.qpos, v = data.qvel;
    q[ballQposAdr] = pos[0]; q[ballQposAdr + 1] = pos[1]; q[ballQposAdr + 2] = pos[2];
    q[ballQposAdr + 3] = 1; q[ballQposAdr + 4] = 0; q[ballQposAdr + 5] = 0; q[ballQposAdr + 6] = 0;
    for (let i = 0; i < 6; i++) v[ballDofAdr + i] = 0;
    mujoco.mj_forward(model, data);
    ballTeleported = true;
  }

  function placeDuck(duck, pos, yaw = 0) {
    const q = data.qpos, v = data.qvel;
    const fj = duck.addrs.freejointQposAdr;
    q[fj] = pos[0]; q[fj + 1] = pos[1]; q[fj + 2] = pos[2];
    q[fj + 3] = Math.cos(yaw / 2); q[fj + 4] = 0; q[fj + 5] = 0; q[fj + 6] = Math.sin(yaw / 2);
    for (let j = 0; j < NUM_JOINTS; j++) q[duck.addrs.qposAdr[j]] = DEFAULT_POSE[j];
    const fd = duck.addrs.freejointDofAdr;
    for (let i = 0; i < 6; i++) v[fd + i] = 0;
    for (let j = 0; j < NUM_JOINTS; j++) v[duck.addrs.dofAdr[j]] = 0;
    mujoco.mj_forward(model, data);
  }

  function resetDuckState(duck) {
    duck.recovery = null; duck.fallDebounce = 0; duck.fallenSince = null;
    duck.mode = 'walk'; duck.kickRun = null; duck.postKickLock = 0;
    duck.lastAction.fill(0); duck.cmd.fill(0); duck.cmdSm.fill(0);
  }

  function resetDuck(duck) {
    const dc = FOOTBALL_CONFIG.ducks[duck.id];
    placeDuck(duck, dc.spawn, dc.yaw ?? 0);
    resetDuckState(duck);
  }

  function placeDuckOffField(duck) { placeDuck(duck, [duck.pos[0], FIELD_HALF_W + 0.5, 0.12], 0); }

  function returnDuckFromPenalty(duck) {
    const sp = SPAWN_POSITIONS[duck.id];
    placeDuck(duck, [sp.x, sp.y, 0.12], sp.yaw ?? 0);
    resetDuckState(duck);
  }

  function executeKickoff() {
    placeBall(BALL_SPAWN);
    for (const duck of ducks) {
      if (duck.sentOff || duck.penaltyTimer > 0) continue;
      const sp = SPAWN_POSITIONS[duck.id];
      placeDuck(duck, [sp.x, sp.y, 0.12], sp.yaw ?? 0);
      resetDuckState(duck);
    }
  }

  function spawnBallFootball() { placeBall(BALL_SPAWN); }

  // ── AI 决策（10Hz）──
  // 与 game.js 一致：整队鸭子通过 decideAll() 一起决策，chaser 选择与阵型槽
  // 能看到全队全貌；sin-bin / sent-off 鸭子整体跳过，recovery 鸭子发零 twist
  // （stand 策略接管）且不进入 decideAll，避免被选为 chaser。
  function runAiDecisions() {
    const gs = buildGameState();
    const teams = new Map();
    for (const duck of ducks) {
      if (!duck.agent) continue;
      if (duck.penaltyTimer > 0 || duck.sentOff) continue;
      if (duck.recovery) { duck.cmd[0] = 0; duck.cmd[2] = 0; continue; }
      const arr = teams.get(duck.team);
      if (arr) arr.push(duck); else teams.set(duck.team, [duck]);
    }
    for (const teamDucks of teams.values()) processTeamDecisions(teamDucks, gs);
  }

  // 对一队运行 decideAll() 并把返回命令写回真鸭子，套用与 game.js 相同的
  // non-finite 守卫、亚阈值 vx 兜底、IDLE_CREEP 静止兜底与踢球 one-shot。
  function processTeamDecisions(teamDucks, gs) {
    if (!teamDucks.length) return;
    const fin = (x) => (Number.isFinite(x) ? x : 0);
    // 构造 decideAll 期望的纯视图。_ai 持久化在真鸭子身上，使 AIM 保险丝
    // （aimTicks）与踢球冷却 / 侧向偏置接近的跨帧状态（kickCooldown /
    // kickHoldTicks）跨 tick 存活。chaserDecide 也会对缺字段惰性补齐，此处
    // 显式初始化以保持与真实鸭子状态结构一致。
    const views = teamDucks.map((d) => {
      const sp = SPAWN_POSITIONS[d.id] || {};
      if (!d._ai) d._ai = { aimTicks: 0, stallTicks: 0, escapeTicks: 0, prevX: 0, prevY: 0, kickCooldown: 0, kickHoldTicks: 0 };
      return {
        id: d.id,
        pos: [fin(d.pos[0]), fin(d.pos[1])],
        yaw: fin(d.yaw),
        role: d.role,
        fallen: !!d.recovery,
        penalized: false,
        team: d.team,
        spawnX: d.agent?.spawnX ?? sp.x,
        spawnY: d.agent?.spawnY ?? sp.y,
        _ai: d._ai,
      };
    });
    const cmds = decideAll(views, { ball: gs.ball, allDucks: gs.ducks, team: teamDucks[0].team });
    for (let i = 0; i < teamDucks.length; i++) {
      const duck = teamDucks[i];
      const c = cmds[i] || { vx: 0, wz: 0, kick: false };
      const cmdVx = Number.isFinite(c.vx) ? c.vx : 0;
      const cmdWz = Number.isFinite(c.wz) ? c.wz : 0;
      // 亚阈值兜底：把极小正 vx 抬到有效步行速度，避免贴球蠕动被判静止。
      let outVx = (cmdVx > 0 && cmdVx < MIN_EFFECTIVE_VX) ? MIN_EFFECTIVE_VX : cmdVx;
      // 命令静止（停车槽 / 门线）→ 温和的 IDLE_CREEP shuffle。
      outVx = outVx === 0 ? IDLE_CREEP : outVx;
      duck.cmd[0] = outVx;
      duck.cmd[2] = cmdWz;
      if (c.kick && !duck.kickRun && duck.mode === 'walk' && duck.postKickLock === 0) {
        duck.mode = duck._lastKick === 'kickL' ? 'kickR' : 'kickL';
        duck._lastKick = duck.mode;
        duck.kickRun = { steps: 0 };
      }
    }
  }

  // 位置停滞看门狗（与 runAiDecisions 同在 AI_HZ 运行）。decideAll 的 cos 死区
  // 与 IDLE_CREEP 仍可能让鸭子物理上卡死（如两只前锋夹球、躯干卡进几何）：
  // 命令非零但位姿永不变化。检测连续 AI tick 上的实际位移，卡死足够久则用
  // 一段短暂的后退+转向逃逸动作覆盖 twist。
  function antiStuckCheck() {
    const STALL_EPS = 0.005;     // 每 AI tick 位移阈值 (m) = 10Hz 下 0.05 m/s，
                                 // 低于所有 AI 巡航速度（IDLE_CREEP 0.22 /
                                 // MIN_EFFECTIVE_VX 0.22 / RETURN_SPEED 0.25），
                                 // 保证慢行但仍在动的鸭子不被误判为卡死。
    const STALL_LIMIT = 15;      // 连续卡死 AI tick 数 → 逃逸
    const ESCAPE_DURATION = 10;  // 逃逸动作长度（AI tick）
    for (const duck of ducks) {
      // 不与 recovery / sin-bin / send-off 的拥有者争抢，也跳过非 AI 鸭子。
      if (!duck.agent || duck.recovery || duck.penaltyTimer > 0 || duck.sentOff) continue;
      const px = Number.isFinite(duck.pos[0]) ? duck.pos[0] : 0;
      const py = Number.isFinite(duck.pos[1]) ? duck.pos[1] : 0;
      if (!duck._lastPos) {
        duck._lastPos = { x: px, y: py };
        duck._stallTicks = 0;
        duck._escapeTicks = 0;
        continue;
      }
      // 逃逸模式：覆盖 AI twist 直到动作预算耗尽。
      if (duck._escapeTicks > 0) {
        duck.cmd[0] = -0.25;                             // 后退，高于 walk 死区
        duck.cmd[2] = (duck.id % 2 === 0) ? 0.6 : -0.6;  // 交替转向
        duck._escapeTicks--;
        duck._lastPos = { x: px, y: py };
        continue;
      }
      const dx = px - duck._lastPos.x;
      const dy = py - duck._lastPos.y;
      duck._stallTicks = Math.hypot(dx, dy) < STALL_EPS ? duck._stallTicks + 1 : 0;
      duck._lastPos = { x: px, y: py };
      if (duck._stallTicks >= STALL_LIMIT) {
        duck._escapeTicks = ESCAPE_DURATION;
        // 按 id 的负初始值给全队去同步：鸭子同步起步、同步累积 stallTicks，
        // 否则会在同一 tick 一起触发逃逸并集体失衡摔倒。id=0 可立即再次触发，
        // id=1 需多等 ~0.5s，id=2 需多等 ~1s，依此类推。
        duck._stallTicks = -(duck.id * 5);
      }
    }
  }

  function sessionFor(duck) {
    if (duck.recovery?.state === 'recovering') return sessions.stand;
    return sessions[duck.mode] ?? sessions.walk;
  }

  function updateDuckStateFootball(duck, simTimeMs) {
    if (duck.penaltyTimer > 0) duck.penaltyTimer = Math.max(0, duck.penaltyTimer - CTRL_DT);
    if ((duck.mode === 'kickL' || duck.mode === 'kickR') && duck.kickRun) {
      duck.kickRun.steps++;
      if (duck.kickRun.steps >= KICK_STEPS) {
        duck.kickRun = null; duck.mode = 'walk'; duck.postKickLock = POST_KICK_LOCK_STEPS;
      }
    }
    if (duck.postKickLock > 0 && duck.mode === 'walk') duck.postKickLock--;
    const death = duckPoseIsDead(duck);
    if (death === 'exploded') {
      resetDuck(duck);
    } else if (duck.recovery) {
      duck.recovery.steps++;
      if (duck.recovery.state === 'fallen') {
        if (duck.recovery.steps >= FALL_SETTLE_STEPS) {
          duck.recovery = { state: 'recovering', steps: 0, uprightSteps: 0 };
          duck.lastAction.fill(0);
        }
      } else {
        duck.recovery.uprightSteps = duckProjGravZ(duck) < -0.85 ? duck.recovery.uprightSteps + 1 : 0;
        if (duck.recovery.uprightSteps >= RECOVER_UPRIGHT_STEPS) {
          duck.recovery = null; duck.mode = 'walk'; duck.lastAction.fill(0);
        } else if (duck.recovery.steps >= RECOVER_GIVEUP_STEPS) {
          resetDuck(duck);
        }
      }
    } else if (death === 'fallen') {
      if (duck.mode === 'walk' && duck.postKickLock === 0) {
        duck.fallenSince = null;
        if (++duck.fallDebounce >= FALL_DEBOUNCE_STEPS) {
          duck.fallDebounce = 0;
          duck.recovery = { state: 'fallen', steps: 0 };
          everFallen.add(duck.id);
        }
      } else {
        duck.fallDebounce = 0;
        duck.fallenSince ??= simTimeMs;
        if (simTimeMs - duck.fallenSince > 1000) resetDuck(duck);
      }
    } else {
      duck.fallDebounce = 0; duck.fallenSince = null;
    }
  }

  // ── 指标 / 日志状态 ──
  let ballTeleported = false;
  const everFallen = new Set();
  let goals = 0, penalties = 0, maxBallSpeed = 0, ballTotalDistance = 0;
  let collectivePenalty = false, exploded = false, ballMoved = false;
  let prevBall = null, prevState = 'IDLE';
  const BALL_JUMP_EPS = 0.3;   // 单步位移超过此值视为放置 teleport，不计入距离
  const BALL_MOVE_EPS = 0.05;  // 累计位移超过此值视为"球被踢动"

  // ── referee ──
  const referee = createReferee({
    onEvent: (type, payload) => {
      const t = simTime();
      switch (type) {
        case 'kickoff': executeKickoff(); break;
        case 'playing': break;
        case 'goal':
          goals++;
          emit({ event: 'goal', team: payload.team, t });
          break;
        case 'goal_disallowed': emit({ event: 'goal_disallowed', team: payload.team, t }); break;
        case 'throw_in': case 'goal_kick': case 'corner_red': case 'corner_blue':
          if (payload.pos) placeBall(payload.pos);
          emit({ event: 'set_piece', type, team: payload.team, t });
          break;
        case 'penalty': {
          penalties++;
          const duck = ducks[payload.duckId];
          if (duck) { duck.penaltyTimer = PENALTY_DURATION_S; placeDuckOffField(duck); }
          emit({ event: 'penalty', duckId: payload.duckId, team: duck?.team, reason: payload.reason, t });
          break;
        }
        case 'penalty_returned': {
          const duck = ducks[payload.duckId];
          if (duck) { duck.penaltyTimer = 0; returnDuckFromPenalty(duck); }
          emit({ event: 'penalty_returned', duckId: payload.duckId, t });
          break;
        }
        case 'penalty_reset': {
          const duck = ducks[payload.duckId];
          if (duck) duck.penaltyTimer = PENALTY_DURATION_S;
          break;
        }
        case 'yellow_card': { const d = ducks[payload.duckId]; if (d) d.cards.yellow++; break; }
        case 'red_card': {
          const d = ducks[payload.duckId];
          if (d) { d.cards.red++; d.sentOff = true; placeDuckOffField(d); }
          emit({ event: 'red_card', duckId: payload.duckId, team: d?.team, t });
          break;
        }
        case 'fulltime': emit({ event: 'fulltime', result: payload.result, score: payload.score, t }); break;
        default: break;
      }
    },
  });

  let step = 0;
  const simTime = () => Number((step * CTRL_DT).toFixed(2));

  // ── 复位到 STAND keyframe 并开球 ──
  mujoco.mj_resetDataKeyframe(model, data, standKeyId);
  mujoco.mj_forward(model, data);
  for (const d of ducks) d.lastAction.fill(0);
  cacheDuckPoses();
  referee.startMatch();

  info('match start — stepping');

  // ── 主循环：加速执行，无 sleep ──
  let aiTick = 0;
  for (; step < TOTAL_STEPS; step++) {
    // AI 每 AI_DIVIDER 步（=5，与线上一致）决策一次。
    aiTick = (aiTick + 1) % AI_DIVIDER;
    if (aiTick === 0) { runAiDecisions(); antiStuckCheck(); }

    // 50Hz 命令低通平滑。
    for (const duck of ducks) {
      const cs = duck.cmdSm, c = duck.cmd;
      cs[0] += (c[0] - cs[0]) * CMD_SMOOTH_ALPHA;
      cs[2] += (c[2] - cs[2]) * CMD_SMOOTH_ALPHA;
    }

    // per-duck ONNX 推理 → 写 ctrl（sin-bin / sent-off / fall-settle 冻结电机）。
    const ctrl = data.ctrl;
    for (const duck of ducks) {
      if (duck.penaltyTimer > 0 || duck.sentOff || duck.recovery?.state === 'fallen') continue;
      const feeds = { obs: new ort.Tensor('float32', buildObsForDuck(duck), [1, OBS_SIZE]) };
      const out = await sessionFor(duck).run(feeds);
      const act = out.actions.data;
      duck.lastAction.set(act);
      const off = duck.addrs.ctrlOffset;
      for (let j = 0; j < NUM_JOINTS; j++) ctrl[off + j] = DEFAULT_POSE[j] + act[j] * ACTION_SCALE;
    }

    // 一次 mj_step 批处理推进所有实体（不受实时门控，直接连跑 DECIMATION 次）。
    ballTeleported = false;
    for (let s = 0; s < DECIMATION; s++) mujoco.mj_step(model, data);
    cacheDuckPoses();

    // referee（读取最新球/鸭位姿，发事件）。
    const gs = buildRefereeState();
    referee.step(CTRL_DT, gs);
    for (const duck of ducks) updateDuckStateFootball(duck, step * CTRL_DT * 1000);

    // 球看门狗：求解器把球捅出球场就拉回中点（referee 掌控球权时跳过）。
    const refState = referee.getState();
    if (!refState || refState === 'PLAYING' || refState === 'KICKOFF') {
      const q = data.qpos;
      const limX = FOOTBALL_CONFIG.field.halfX + 0.1;
      const limY = FOOTBALL_CONFIG.field.halfY + 0.1;
      if (Math.abs(q[ballQposAdr]) > limX || Math.abs(q[ballQposAdr + 1]) > limY) spawnBallFootball();
    }

    // ── 指标：球移动 / 距离 / 速度 / NaN / 集体罚下 ──
    const q = data.qpos, v = data.qvel;
    const bx = q[ballQposAdr], by = q[ballQposAdr + 1], bz = q[ballQposAdr + 2];
    if (!Number.isFinite(bx) || !Number.isFinite(by) || !Number.isFinite(bz)
        || ducks.some((d) => !Number.isFinite(d.pos[0]) || !Number.isFinite(d.pos[1]))) {
      exploded = true;
      emit({ event: 'explode', t: simTime() });
      step++;
      break;
    }
    const speed = Math.hypot(v[ballDofAdr], v[ballDofAdr + 1], v[ballDofAdr + 2]);
    if (speed > maxBallSpeed) maxBallSpeed = speed;
    if (prevBall && !ballTeleported) {
      const d = Math.hypot(bx - prevBall[0], by - prevBall[1], bz - prevBall[2]);
      if (d < BALL_JUMP_EPS) {
        ballTotalDistance += d;
        if (ballTotalDistance > BALL_MOVE_EPS) ballMoved = true;
      }
    }
    prevBall = [bx, by, bz];

    const offField = ducks.filter((d) => d.penaltyTimer > 0 || d.sentOff).length;
    if (offField >= 4 && !collectivePenalty) {
      collectivePenalty = true;
      emit({ event: 'collective_penalty', offField, t: simTime() });
    }

    // 状态机跳变事件（统一 from/to 格式，涵盖 KICKOFF/PLAYING/DEAD_BALL/...）。
    if (refState !== prevState) {
      emit({ event: 'state', from: prevState, to: refState, t: simTime() });
      prevState = refState;
    }

    // ── 逐行状态日志 ──
    if ((step + 1) % LOG_INTERVAL === 0) {
      const score = referee.getScore();
      emit({
        t: simTime(),
        state: refState,
        score: [score.red, score.blue],
        ball: [round(bx), round(by), round(bz), round(speed)],
        ducks: ducks.map((d) => ({
          id: d.id, x: round(d.pos[0]), y: round(d.pos[1]),
          yaw: round(d.yaw), m: d.mode[0],
        })),
      });
    }

    // FULLTIME 提前结束。
    if (refState === 'FULLTIME') { step++; break; }
  }

  const wallClockS = (Date.now() - t0) / 1000;
  const score = referee.getScore();
  const ranFullDuration = step >= TOTAL_STEPS;
  const finalState = referee.getState();
  const matchCompleted = finalState === 'FULLTIME' || ranFullDuration;

  emit({
    summary: {
      duration_s: round(step * CTRL_DT),
      wall_clock_s: round(wallClockS, 1),
      steps_per_sec: Math.round(step / wallClockS),
      final_score: { red: score.red, blue: score.blue },
      ball_moved: ballMoved,
      ball_total_distance_m: round(ballTotalDistance, 1),
      max_ball_speed: round(maxBallSpeed, 2),
      goals,
      penalties,
      ducks_fallen_count: everFallen.size,
      match_completed: matchCompleted,
    },
  });

  // 退出码优先级：崩溃(3) > 集体罚下(2) > 球没动(1) > 正常(0)。
  let code = 0;
  if (exploded) code = 3;
  else if (collectivePenalty) code = 2;
  else if (!ballMoved) code = 1;
  info(`done: exit=${code} score=${score.red}-${score.blue} goals=${goals} penalties=${penalties} ballMoved=${ballMoved} wall=${wallClockS.toFixed(1)}s`);
  process.exitCode = code;
}

function round(v, p = 2) { const f = 10 ** p; return Math.round(Number(v) * f) / f; }

main().catch((err) => {
  process.stderr.write(`[headless] FATAL ${err && err.stack || err}\n`);
  emit({ event: 'crash', error: String(err && err.message || err) });
  process.exitCode = 3;
});
