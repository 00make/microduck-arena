// football-sim.mjs — MuJoCo WASM 3v3 sim core for RL env (+ optional headless).
// No DOM/THREE. createFootballSim() → reset / controlStep / applyTeamActions.

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

// ── src/ 纯模块（无 DOM / 无引擎依赖，可在 Node 直接 import）──────────────
import {
  POLICIES, JOINT_NAMES, DEFAULT_POSE, NUM_JOINTS, OBS_SIZE, CMD_SIZE,
  ACTION_SCALE, TIMESTEP, DECIMATION, CTRL_DT, BALL_RADIUS,
} from '../../src/game/constants.js';
import { FOOTBALL_CONFIG } from '../../src/game/football/match-config.js';
import {
  SPAWN_POSITIONS, BALL_SPAWN, AI_DIVIDER, MATCH_DURATION_S, PENALTY_DURATION_S,
  FIELD_HALF_W, GOAL_WIDTH,
} from '../../src/game/football/constants.js';
import { getGoalCollisionGeoms } from '../../src/game/football/goal.js';
import { createReferee } from '../../src/game/football/referee.js';
import { createAgent, decideAll } from '../../src/game/football/ai/index.js';
import { createDuckInstance } from '../../src/game/football/duck-instance.js';

// ── 路径 ──────────────────────────────────────────────────────────────────
const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(HERE, '../..');
const PUBLIC = path.join(APP_ROOT, 'public');
const MODEL_DIR = path.join(PUBLIC, 'robot', 'mjlab');
const MESH_DIR = path.join(MODEL_DIR, 'meshes');
const POLICY_DIR = path.join(PUBLIC, 'policies');
const MUJOCO_WASM = path.join(APP_ROOT, 'node_modules', '@mujoco', 'mujoco', 'mujoco.wasm');
const ORT_WASM_DIR = path.join(APP_ROOT, 'node_modules', 'onnxruntime-web', 'dist') + path.sep;

const info = (...a) => { if (optsQuiet()) return; process.stderr.write(`[football-sim] ${a.join(" ")}\n`); };
function optsQuiet() { return !!globalThis.__FOOTBALL_SIM_QUIET; }

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

export async function createFootballSim(opts = {}) {
  if (opts.quiet) globalThis.__FOOTBALL_SIM_QUIET = true;
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

  
  const events = [];
  function pushEvent(obj) { events.push(obj); }
  function drainEvents() { return events.splice(0, events.length); }

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
          pushEvent({ event: 'goal', team: payload.team, t });
          break;
        case 'goal_disallowed': pushEvent({ event: 'goal_disallowed', team: payload.team, t }); break;
        case 'throw_in': case 'goal_kick': case 'corner_red': case 'corner_blue':
          if (payload.pos) placeBall(payload.pos);
          pushEvent({ event: 'set_piece', type, team: payload.team, t });
          break;
        case 'penalty': {
          penalties++;
          const duck = ducks[payload.duckId];
          if (duck) { duck.penaltyTimer = PENALTY_DURATION_S; placeDuckOffField(duck); }
          pushEvent({ event: 'penalty', duckId: payload.duckId, team: duck?.team, reason: payload.reason, t });
          break;
        }
        case 'penalty_returned': {
          const duck = ducks[payload.duckId];
          if (duck) { duck.penaltyTimer = 0; returnDuckFromPenalty(duck); }
          pushEvent({ event: 'penalty_returned', duckId: payload.duckId, t });
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
          pushEvent({ event: 'red_card', duckId: payload.duckId, team: d?.team, t });
          break;
        }
        case 'fulltime': pushEvent({ event: 'fulltime', result: payload.result, score: payload.score, t }); break;
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

  let aiPhase = 0;

  // Initial keyframe + kickoff already done above.
  // Expose RL / control API.

  function applyCmdToDuck(duck, c, { idleCreep = true } = {}) {
    if (!duck || duck.penaltyTimer > 0 || duck.sentOff || duck.recovery) {
      if (duck) { duck.cmd[0] = 0; duck.cmd[2] = 0; }
      return;
    }
    const cmdVx = Number.isFinite(c.vx) ? c.vx : 0;
    const cmdWz = Number.isFinite(c.wz) ? c.wz : 0;
    let outVx = (cmdVx > 0 && cmdVx < MIN_EFFECTIVE_VX) ? MIN_EFFECTIVE_VX : cmdVx;
    if (idleCreep && outVx === 0) outVx = IDLE_CREEP;
    duck.cmd[0] = outVx;
    duck.cmd[2] = cmdWz;
    if (c.kick && !duck.kickRun && duck.mode === 'walk' && duck.postKickLock === 0) {
      duck.mode = duck._lastKick === 'kickL' ? 'kickR' : 'kickL';
      duck._lastKick = duck.mode;
      duck.kickRun = { steps: 0 };
    }
  }

  function applyTeamActions(team, actions, { idleCreep = false } = {}) {
    const teamDucks = ducks.filter((d) => d.team === team && d.agent && !(d.penaltyTimer > 0) && !d.sentOff && !d.recovery);
    for (let i = 0; i < teamDucks.length; i++) {
      const a = actions[i] || { vx: 0, wz: 0, kick: false };
      applyCmdToDuck(teamDucks[i], a, { idleCreep });
    }
  }

  function runOpponentDecideAll(team, tuneOverlay) {
    const gs = buildGameState();
    const teamDucks = ducks.filter((d) => {
      if (!d.agent || d.team !== team) return false;
      if (d.penaltyTimer > 0 || d.sentOff) return false;
      if (d.recovery) { d.cmd[0] = 0; d.cmd[2] = 0; return false; }
      return true;
    });
    if (!teamDucks.length) return;
    const fin = (x) => (Number.isFinite(x) ? x : 0);
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
    const cmds = decideAll(views, {
      ball: gs.ball,
      allDucks: gs.ducks,
      team,
      tuneOverlay: tuneOverlay || undefined,
    });
    for (let i = 0; i < teamDucks.length; i++) {
      applyCmdToDuck(teamDucks[i], cmds[i] || { vx: 0, wz: 0, kick: false }, { idleCreep: true });
    }
  }

  async function controlStep() {
    // 50Hz: smooth + onnx + mj_step + referee
    for (const duck of ducks) {
      const cs = duck.cmdSm, c = duck.cmd;
      cs[0] += (c[0] - cs[0]) * CMD_SMOOTH_ALPHA;
      cs[2] += (c[2] - cs[2]) * CMD_SMOOTH_ALPHA;
    }
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
    ballTeleported = false;
    for (let s = 0; s < DECIMATION; s++) mujoco.mj_step(model, data);
    cacheDuckPoses();
    referee.step(CTRL_DT, buildRefereeState());
    for (const duck of ducks) updateDuckStateFootball(duck, step * CTRL_DT * 1000);
    const refState = referee.getState();
    if (!refState || refState === 'PLAYING' || refState === 'KICKOFF') {
      const q = data.qpos;
      const limX = FOOTBALL_CONFIG.field.halfX + 0.1;
      const limY = FOOTBALL_CONFIG.field.halfY + 0.1;
      if (Math.abs(q[ballQposAdr]) > limX || Math.abs(q[ballQposAdr + 1]) > limY) spawnBallFootball();
    }
    const q = data.qpos;
    const bx = q[ballQposAdr], by = q[ballQposAdr + 1], bz = q[ballQposAdr + 2];
    if (!Number.isFinite(bx) || !Number.isFinite(by) || !Number.isFinite(bz)
        || ducks.some((d) => !Number.isFinite(d.pos[0]) || !Number.isFinite(d.pos[1]))) {
      exploded = true;
    }
    step += 1;
    return { state: refState, exploded };
  }

  function reset() {
    events.length = 0;
    goals = 0;
    penalties = 0;
    exploded = false;
    step = 0;
    aiPhase = 0;
    everFallen.clear();
    for (const d of ducks) {
      d.penaltyTimer = 0;
      d.sentOff = false;
      d.cards.yellow = 0;
      d.cards.red = 0;
      resetDuckState(d);
      d._ai = undefined;
      d._lastPos = undefined;
      d._stallTicks = 0;
      d._escapeTicks = 0;
    }
    mujoco.mj_resetDataKeyframe(model, data, standKeyId);
    mujoco.mj_forward(model, data);
    for (const d of ducks) d.lastAction.fill(0);
    cacheDuckPoses();
    // Recreate referee for clean FSM
    // NOTE: referee is const — call startMatch after executeKickoff path
    referee.startMatch();
    return getObs();
  }

  function getObs() {
    cacheDuckPoses();
    const gs = buildGameState();
    const score = referee.getScore();
    return {
      ball: gs.ball,
      ducks: gs.ducks,
      score: { red: score.red, blue: score.blue },
      matchState: referee.getState(),
      matchTime: referee.getMatchTime?.() ?? step * CTRL_DT,
      step,
    };
  }

  function teamDuckIds(team) {
    return ducks.filter((d) => d.team === team).map((d) => d.id);
  }

  info('football-sim ready');

  return {
    CTRL_DT,
    AI_DIVIDER,
    ducks,
    learnerTeam: opts.learnerTeam === 'blue' ? 'blue' : 'red',
    reset,
    getObs,
    drainEvents,
    applyTeamActions,
    runOpponentDecideAll,
    runAiDecisions,
    antiStuckCheck,
    controlStep,
    teamDuckIds,
    getScore: () => referee.getScore(),
    getState: () => referee.getState(),
    isExploded: () => exploded,
  };
}

export const VEL_LIMITS = { vxMin: -0.2, vxMax: 0.25, wzMax: 1.0 };
export { CTRL_DT, AI_DIVIDER };

