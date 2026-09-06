> **⚠️ 历史规划文档**：此文档记录的是初始升级规划，实际实现已偏离文档中的文件路径、函数签名和数据结构。请以代码为准。最后全面审查日期：2026-09-07。

# 代码参考片段

> 执行智能体可参考的代码结构和片段

## 1. 多鸭子实例化（Phase 2）

### 当前单鸭子加载（game.js）
```javascript
// 当前代码（简化）
const rig = await buildRig(mjModel, mjData, scene);
const duck = rig.mesh;
```

### 扩展为多鸭子
```javascript
// 新增：鸭子配置
const DUCK_CONFIG = [
  // 红队（索引 0-2）
  { id: 0, team: 'red', role: 'forward', spawnX: -2.0, spawnY: -0.8 },
  { id: 1, team: 'red', role: 'forward', spawnX: -2.0, spawnY: 0.8 },
  { id: 2, team: 'red', role: 'goalkeeper', spawnX: -2.8, spawnY: 0 },
  // 蓝队（索引 3-5）
  { id: 3, team: 'blue', role: 'forward', spawnX: 2.0, spawnY: -0.8 },
  { id: 4, team: 'blue', role: 'forward', spawnX: 2.0, spawnY: 0.8 },
  { id: 5, team: 'blue', role: 'goalkeeper', spawnX: 2.8, spawnY: 0 },
];

// 批量创建
const ducks = [];
for (const cfg of DUCK_CONFIG) {
  const rig = await buildRig(mjModel, mjData, scene);
  // 设置初始位置
  setDuckPosition(rig, cfg.spawnX, cfg.spawnY);
  // 设置队伍颜色
  applyTeamColor(rig, cfg.team);
  // 创建 AI Agent
  const agent = createAgent(cfg.role, cfg.team);
  ducks.push({ ...cfg, rig, agent });
}
```

## 2. AI 决策层结构（Phase 2）

### Agent 基类（ai/agent.js）
```javascript
export class BaseAgent {
  constructor(role, team) {
    this.role = role;
    this.team = team;
    this.state = 'idle';
  }

  // 输入：比赛状态
  // 输出：速度命令 (vx, wz) + 踢球触发
  decide(gameState) {
    throw new Error('decide() must be implemented');
  }

  // 工具函数：计算角度
  angleTo(from, to) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    return Math.atan2(dy, dx);
  }

  // 工具函数：计算距离
  distanceTo(from, to) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    return Math.sqrt(dx * dx + dy * dy);
  }
}
```

### 前锋 AI（ai/forward.js）
```javascript
export class ForwardAgent extends BaseAgent {
  decide(state) {
    const { ball, myPos, myHeading, goalPos, teammates, opponents } = state;

    const distToBall = this.distanceTo(myPos, ball.pos);
    const angleToBall = this.angleTo(myPos, ball.pos);
    const angleDiff = Math.abs(angleToBall - myHeading);

    // 状态机
    if (distToBall > 0.5) {
      // 追球
      this.state = 'chase';
      return {
        vx: 0.25,  // 前进
        wz: angleDiff > 0.1 ? Math.sign(angleToBall - myHeading) * 0.5 : 0,
        kick: false,
      };
    } else if (angleDiff < 0.26) { // ~15°
      // 射门
      this.state = 'shoot';
      return {
        vx: 0.2,
        wz: 0,
        kick: true,
      };
    } else {
      // 对准
      this.state = 'aim';
      return {
        vx: 0.05,
        wz: Math.sign(angleToBall - myHeading) * 0.8,
        kick: false,
      };
    }
  }
}
```

### 门将 AI（ai/goalkeeper.js）
```javascript
export class GoalkeeperAgent extends BaseAgent {
  decide(state) {
    const { ball, myPos, goalPos } = state;

    const ballMovingToGoal = ball.vel.x * (this.team === 'red' ? -1 : 1) > 0.1;
    const distToBall = this.distanceTo(myPos, ball.pos);

    if (ballMovingToGoal && distToBall < 1.5) {
      // 扑救
      this.state = 'dive';
      return {
        vx: 0,
        wz: Math.sign(ball.pos.y - myPos.y) * 1.0,
        kick: true,
      };
    } else {
      // 站位：跟随球 y 坐标
      this.state = 'position';
      const targetY = Math.max(-0.5, Math.min(0.5, ball.pos.y));
      return {
        vx: 0,
        wz: Math.sign(targetY - myPos.y) * 0.5,
        kick: false,
      };
    }
  }
}
```

## 3. 足球规则引擎（Phase 3）

### 比赛状态机（referee.js）
```javascript
export class Referee {
  constructor() {
    this.state = 'IDLE';
    this.score = { red: 0, blue: 0 };
    this.time = 0;
    this.lastTouchTeam = null;
  }

  update(gameState, dt) {
    this.time += dt;

    switch (this.state) {
      case 'IDLE':
        if (gameState.start) this.state = 'KICKOFF';
        break;

      case 'KICKOFF':
        if (gameState.ballMoving) this.state = 'PLAYING';
        break;

      case 'PLAYING':
        // 检查进球
        if (this.checkGoal(gameState)) {
          this.score[gameState.goalTeam]++;
          this.state = 'GOAL';
        }
        // 检查出界
        else if (this.checkOutOfBounds(gameState)) {
          this.state = 'DEAD_BALL';
        }
        break;

      case 'DEAD_BALL':
        // 判给球权
        const setPiece = this.determineSetPiece(gameState);
        this.state = setPiece;
        break;

      case 'GOAL':
        // 庆祝后重新开球
        if (gameState.celebrationDone) {
          this.state = 'KICKOFF';
        }
        break;
    }
  }

  checkGoal(state) {
    const ball = state.ball;
    // 红队球门（x < -FIELD_LENGTH/2）
    if (ball.x < -3.0 && Math.abs(ball.y) < 0.6) {
      state.goalTeam = 'blue';
      return true;
    }
    // 蓝队球门（x > FIELD_LENGTH/2）
    if (ball.x > 3.0 && Math.abs(ball.y) < 0.6) {
      state.goalTeam = 'red';
      return true;
    }
    return false;
  }

  checkOutOfBounds(state) {
    const ball = state.ball;
    // 边线
    if (Math.abs(ball.y) > 2.0) {
      return true;
    }
    // 底线（非进球情况）
    if (Math.abs(ball.x) > 3.0 && Math.abs(ball.y) >= 0.6) {
      return true;
    }
    return false;
  }

  determineSetPiece(state) {
    const ball = state.ball;
    if (Math.abs(ball.y) > 2.0) {
      // 边线球
      return 'THROW_IN';
    } else if (ball.x > 3.0) {
      // 蓝队底线
      return this.lastTouchTeam === 'blue' ? 'GOAL_KICK' : 'CORNER_RED';
    } else if (ball.x < -3.0) {
      // 红队底线
      return this.lastTouchTeam === 'red' ? 'GOAL_KICK' : 'CORNER_BLUE';
    }
    return 'PLAYING';
  }
}
```

## 4. 场地常量扩展（Phase 1）

### constants.js 新增
```javascript
// 足球场尺寸（6m x 4m）
export const FIELD_LENGTH = 6.0;  // 长边
export const FIELD_WIDTH = 4.0;   // 短边
export const FIELD_HALF_L = FIELD_LENGTH / 2;  // 3.0
export const FIELD_HALF_W = FIELD_WIDTH / 2;   // 2.0

// 球门
export const GOAL_WIDTH = 1.2;    // 球门宽度
export const GOAL_DEPTH = 0.3;    // 球门深度
export const GOAL_HEIGHT = 0.4;   // 球门高度

// 标线
export const CENTER_CIRCLE_RADIUS = 0.6;
export const PENALTY_AREA_LENGTH = 1.2;
export const PENALTY_AREA_WIDTH = 0.8;
export const CORNER_ARC_RADIUS = 0.3;

// 鸭子出生点
export const SPAWN_POSITIONS = {
  red: [
    { x: -2.0, y: -0.8, role: 'forward' },
    { x: -2.0, y: 0.8, role: 'forward' },
    { x: -2.8, y: 0, role: 'goalkeeper' },
  ],
  blue: [
    { x: 2.0, y: -0.8, role: 'forward' },
    { x: 2.0, y: 0.8, role: 'forward' },
    { x: 2.8, y: 0, role: 'goalkeeper' },
  ],
};
```

## 5. Zustand 状态扩展（Phase 3-4）

### store.js 新增
```javascript
export const useGame = create(
  subscribeWithSelector(() => ({
    // ... 现有状态 ...

    // 比赛状态（Phase 3）
    matchState: 'IDLE',  // IDLE | KICKOFF | PLAYING | DEAD_BALL | GOAL
    score: { red: 0, blue: 0 },
    matchTime: 0,
    lastTouchTeam: null,

    // 鸭子状态（Phase 2）
    ducks: [],  // [{ id, team, role, pos, state, ... }]

    // 裁判状态（Phase 3）
    fouls: [],  // [{ duckId, type, time }]
    penalties: [],  // [{ duckId, startTime, duration }]
    cards: { yellow: [], red: [] },
  })),
);
```

## 6. 球门碰撞体（Phase 1）

### goal.js
```javascript
import * as THREE from 'three';

export function createGoalMesh(position, team) {
  const group = new THREE.Group();

  // 门柱
  const postGeom = new THREE.CylinderGeometry(0.03, 0.03, 0.4, 8);
  const postMat = new THREE.MeshStandardMaterial({
    color: team === 'red' ? 0xff4444 : 0x4444ff,
    metalness: 0.5,
    roughness: 0.3,
  });

  const leftPost = new THREE.Mesh(postGeom, postMat);
  leftPost.position.set(0, 0.2, -0.6);
  group.add(leftPost);

  const rightPost = new THREE.Mesh(postGeom, postMat);
  rightPost.position.set(0, 0.2, 0.6);
  group.add(rightPost);

  // 横梁
  const crossbarGeom = new THREE.CylinderGeometry(0.03, 0.03, 1.2, 8);
  const crossbar = new THREE.Mesh(crossbarGeom, postMat);
  crossbar.rotation.x = Math.PI / 2;
  crossbar.position.set(0, 0.4, 0);
  group.add(crossbar);

  group.position.copy(position);
  return group;
}

// MuJoCo 碰撞体定义（添加到 MJCF）
export function getGoalCollisionGeoms(position, team) {
  return `
    <!-- ${team} goal posts -->
    <geom type="cylinder" fromto="${position.x} ${position.y - 0.6} 0 ${position.x} ${position.y - 0.6} 0.4" size="0.03" rgba="1 0 0 1"/>
    <geom type="cylinder" fromto="${position.x} ${position.y + 0.6} 0 ${position.x} ${position.y + 0.6} 0.4" size="0.03" rgba="1 0 0 1"/>
    <geom type="cylinder" fromto="${position.x} ${position.y - 0.6} 0.4 ${position.x} ${position.y + 0.6} 0.4" size="0.03" rgba="1 0 0 1"/>
  `;
}
```

---

## 使用指南

执行智能体在实施时：
1. 先阅读对应的 Phase 文档（`03-upgrade-plan.md`）
2. 参考本文件的代码片段
3. 根据实际代码结构调整
4. 每个任务完成后运行测试验证
