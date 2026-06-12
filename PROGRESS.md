# AtmosphereFX — 项目方案与进度

## 项目概述

纯静态 HTML 3D 场景特效工具。导入 FBX 模型，添加实时光源、视觉特效（粒子、烟雾、丁达尔光），支持视频背景与导出。

- **技术栈**：Vanilla JS + Three.js 0.168.0，ES Modules，Import Map CDN
- **渲染**：WebGLRenderer（0.168.0 不含 WebGPU）
- **构建**：esbuild → IIFE bundle（`dist/app.bundle.js`）

---

## 架构设计

```
index.html          → 入口页面 + import map
js/
├── main.js         → 核心调度（渲染器、场景、相机、动画循环、全局接口）
├── SceneManager.js → 场景管理（灯光组、物体组、视频背景、选中/删除/隐藏）
├── OrbitController.js → 视角控制（OrbitControls + 动态距离/自适应）
├── FBXHandler.js   → FBX 处理（加载、解析、摄像机提取、动画、归一化）
└── UIHandler.js    → UI 事件桥梁（按钮绑定、面板切换、列表渲染、滑块）
css/
└── style.css       → 玻璃拟态面板、工具栏、状态栏
```

### 全局接口 `window.__atmosphereFX`

```js
{ renderer, scene, camera, sceneManager, orbitController, fbxHandler, uiHandler,
  _selectLightForTransform(light), _deselectForTransform() }
```

---

## 模块进度

### ✅ P0 — 核心框架（已完成）

| 模块 | 文件 | 状态 |
|------|------|------|
| WebGL 渲染器 | `main.js` | ✅ |
| 场景 + 相机 | `main.js` | ✅ |
| 轨道控制器 | `OrbitController.js` | ✅ 动态 maxDistance、自适应 panSpeed、fitToBounds |
| FBX 导入 | `FBXHandler.js` | ✅ 含摄像机提取、动画播放、**模型归一化** |
| UI 桥梁 | `UIHandler.js` | ✅ 按钮绑定、面板折叠、Tab 切换 |
| 基础光照 | `main.js` | ✅ 环境光 0.6 + 方向光 1.0（无阴影） |
| 状态栏 | `UIHandler.js` | ✅ |
| 加载蒙层 | `index.html` + `FBXHandler.js` | ✅ |

### ✅ P1 — 交互与控制（已完成）

| 功能 | 实现位置 | 状态 |
|------|----------|------|
| 摄像机列表 | `UIHandler._renderCameraList()` | ✅ 名称/FOV/位置 |
| 视角切换 | `OrbitController.setFromCamera()` | ✅ lookAt 模型中心 |
| 重置视角 | `OrbitController.resetView()` | ✅ 回到 fitToBounds |
| FBX 内嵌灯光关闭 | `FBXHandler.loadFBX()` | ✅ intensity=0, visible=false |
| 线框模式 | `FBXHandler.toggleWireframe()` | ✅ 工具栏按钮 |
| 视频背景 | `SceneManager.toggleVideoBackground()` | ✅ |

### ✅ P2 — 点光源系统（已完成）

| 功能 | 实现位置 | 状态 |
|------|----------|------|
| 添加点光源 | `SceneManager.addPointLight()` | ✅ 模型上方 / 相机前方 |
| Sprite 发光指示器 | `SceneManager._createLightIndicator()` | ✅ Canvas 径向渐变 + AdditiveBlending |
| TransformControls 拖拽 | `main.js` | ✅ gizmo size 1.2, world space |
| 射线选中 | `main.js` pointer 事件 | ✅ 点击 Sprite 选中光源 |
| 参数滑块 | `index.html` + `UIHandler` | ✅ 位置 X/Y/Z、强度、颜色 |
| 动态滑块范围 | `UIHandler._updateSliderRanges()` | ✅ 按模型大小自适应 |
| 场景对象列表 | `UIHandler._renderObjectsList()` | ✅ 含选中高亮 |
| 隐藏/显示 | `SceneManager.toggleObjectVisibility()` | ✅ 列表中 👁/🔦 按钮 |
| 删除对象 | `SceneManager.removeObjectById()` | ✅ 列表中 🗑 按钮 |
| 灯光总开关 | `SceneManager.toggleAllLights()` | ✅ 一键关闭全部用户灯光 |

### ⬜ P3 — 粒子系统（未实现）

- 文件：`js/ParticleSystem.js`
- 功能：灰尘粒子、粒子发射器
- HTML：`#tab-particles` 参数面板
- 依赖：需后处理管线配合

### ⬜ P4 — 真实烟雾（未实现）

- 文件：`js/NativeSmoke.js`
- 功能：体积烟雾模拟
- HTML：`#tab-smoke` 参数面板
- 依赖：粒子系统基础

### ⬜ P5 — 丁达尔光 / God Rays（未实现）

- 文件：`js/GodRaysEffect.js`
- 功能：以点光源为发射源的体积光束
- HTML：`#tab-godrays` 参数面板
- 依赖：后处理管线（postprocessing 库已在 import map）

### ⬜ P6 — 视频导出（未实现）

- 文件：`js/VideoExporter.js`
- 功能：录制动画循环输出 MP4
- 依赖：`preserveDrawingBuffer: true`（已在 main.js 设置）

---

## 关键设计决策

### 模型归一化
导入时自动缩放到对角线 ~10 单位，确保所有灯光、距离在合理物理尺度工作。

```js
// FBXHandler.js
const targetSize = 10;
group.scale.setScalar(targetSize / size);
group.position.set(-center.x * scale, -center.y * scale, -center.z * scale);
```

### 光照策略
- **默认**：环境光 0.6 + 无阴影方向光 1.0 → flat diffuse 外观
- **用户添加光源后**：点光源 intensity 20，带阴影，叠加在 flat 基础之上
- **灯光总开关关闭**：所有用户灯光不可见/不照明 → 恢复 flat diffuse
- **FBX 内嵌灯光**：导入时自动关闭（intensity=0）

### 交互层级
```
3D 点击 → Raycaster → Sprite 指示器 → 选中光源 → TransformControls gizmo
列表点击 → selectObject() → 高亮 + gizmo attach + 滑块更新
删除/隐藏 → 列表按钮 → SceneManager 方法 → 自动清理选中状态
```

---

## 待完成工作

1. **粒子系统** (`ParticleSystem.js`) — 灰尘/火花粒子
2. **烟雾模拟** (`NativeSmoke.js`) — 体积烟雾
3. **丁达尔光束** (`GodRaysEffect.js`) — 后处理体积光
4. **视频导出** (`VideoExporter.js`) — 录制 + MP4 输出
5. **参数面板** — 粒子/烟雾/光束的滑块配置
