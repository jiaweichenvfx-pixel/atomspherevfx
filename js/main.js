/**
 * main.js — 核心调度模块（WebGL 路径）
 * 依赖：SceneManager, OrbitController, FBXHandler, UIHandler
 *
 * 注：Three.js 0.168.0 不含 WebGPURenderer（需 0.170+）。
 *     当需要后处理管线（GodRays）时，GLSL 着色器本身也要求 WebGL。
 *     后续如需 WebGPU，升级 Three.js 并将 GLSL 用 TSL 转译。
 */

import * as THREE from 'three';
import { SceneManager } from './SceneManager.js';
import { OrbitController } from './OrbitController.js';
import { FBXHandler } from './FBXHandler.js';
import { UIHandler } from './UIHandler.js';
import { ParticleSystem } from './ParticleSystem.js';
import { SmokeSystem } from './SmokeSystem.js';
import { GodRaysSystem } from './GodRaysSystem.js';
import { LightBeamSystem } from './LightBeamSystem.js';
import { OccluderSystem } from './OccluderSystem.js';
import { TimelineSystem } from './TimelineSystem.js';
import { ExportHandler } from './ExportHandler.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

// ── 渲染器初始化 ──────────────────────────────────
const container = document.getElementById('canvas-container');

// 移除 HTML 中预设的 canvas，由渲染器自行创建
const existingCanvas = document.getElementById('render-canvas');
if (existingCanvas) existingCanvas.remove();

const rendererBackend = 'WebGL';
const renderer = new THREE.WebGLRenderer({
  alpha: true,
  antialias: true,
  preserveDrawingBuffer: true  // 视频导出需要
});
console.log('✅ 使用 WebGL 渲染器');

renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x000000, 0);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

// 将 renderer 的 canvas 挂到容器中
const canvas = renderer.domElement;
canvas.id = 'render-canvas';
container.appendChild(canvas);

// ── 场景与相机 ────────────────────────────────────
const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
  50,
  window.innerWidth / window.innerHeight,
  0.01,
  10000
);
camera.position.set(8, 5, 10);
camera.lookAt(0, 0, 0);

// ── 基础灯光 ──────────────────────────────────────
const ambientLight = new THREE.AmbientLight(0x404060, 0.6);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 1.0);
directionalLight.position.set(5, 10, 5);
// 默认不投射阴影 — 保持 flat diffuse 外观，用户点光源负责阴影
directionalLight.castShadow = false;
scene.add(directionalLight);

// ── 网格辅助线 ────────────────────────────────────
const gridHelper = new THREE.GridHelper(20, 20, 0x444466, 0x222244);
scene.add(gridHelper);

// ── 轴辅助线 ──────────────────────────────────────
const axesHelper = new THREE.AxesHelper(5);
scene.add(axesHelper);

// ── 光源选择与拖拽控制 ────────────────────────────

const transformControls = new TransformControls(camera, renderer.domElement);
transformControls.setSize(1.2);
transformControls.space = 'world';
transformControls.addEventListener('dragging-changed', (event) => {
  orbitController.setEnabled(!event.value);
  // 用户拖拽遮挡板时自动切换为手动模式
  if (transformControls.object === occluderSystem._mesh) {
    if (event.value) {
      // 开始拖拽：关闭自动跟随
      const followChk = document.getElementById('occluder-follow-camera');
      if (followChk) followChk.checked = false;
      occluderSystem.useAutoOrient = false;
      const autoChk = document.getElementById('occluder-auto-orient');
      if (autoChk) autoChk.checked = false;
    } else {
      // 拖拽结束：同步 slider
      uiHandler._updateOccluderSliders();
    }
  }
});
transformControls.addEventListener('objectChange', () => {
  const sel = sceneManager.selectedObject;
  if (sel?.isLight) {
    uiHandler._updateLightSliders(sel);
    uiHandler.updateStatus('光源位置已更新');
  }
  // 遮挡板通过 TransformControls 调整后同步 slider
  if (sel === occluderSystem._mesh || transformControls.object === occluderSystem._mesh) {
    uiHandler._updateOccluderSliders();
    uiHandler.updateStatus('遮挡板位置/旋转已更新');
  }
});
scene.add(transformControls);

// 射线检测：点击选中 / 取消场景对象
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let pointerMoved = false;

canvas.addEventListener('pointerdown', (e) => {
  pointerMoved = false;
  mouse.set(
    (e.clientX / window.innerWidth) * 2 - 1,
    -(e.clientY / window.innerHeight) * 2 + 1
  );
});
canvas.addEventListener('pointermove', () => { pointerMoved = true; });
canvas.addEventListener('pointerup', () => {
  if (pointerMoved || transformControls.dragging) return;
  raycaster.setFromCamera(mouse, camera);

  // 检测遮挡板：同时检测 mesh 和辅助线框，确保大面积也能点击选中
  const occTargets = [];
  if (occluderSystem._mesh && occluderSystem._mesh.visible) {
    occTargets.push(occluderSystem._mesh);
  }
  if (occluderSystem.helper && occluderSystem.helper.visible) {
    occTargets.push(occluderSystem.helper);
  }
  const occHits = raycaster.intersectObjects(occTargets, false);
  if (occHits.length > 0) {
    sceneManager.selectObject(occluderSystem._mesh);
    transformControls.attach(occluderSystem._mesh);
    uiHandler._onOccluderSelected();
    return;
  }

  // 再检测光源指示球
  const targets = sceneManager.getSelectableIndicators();
  const hits = raycaster.intersectObjects(targets, false);
  if (hits.length > 0) {
    const light = sceneManager.getLightByIndicator(hits[0].object);
    if (light) {
      sceneManager.selectObject(light);
      transformControls.attach(light);
    }
  } else {
    sceneManager.selectObject(null);
    transformControls.detach();
  }
});

// ── 时钟 ──────────────────────────────────────────
const clock = new THREE.Clock();

// ── 子模块初始化 ──────────────────────────────────

// 场景管理器
const sceneManager = new SceneManager(scene);

// 视图控制器
const orbitController = new OrbitController(camera, renderer.domElement);

// FBX 处理器
const fbxHandler = new FBXHandler(scene, renderer);

// 粒子系统
const particleSystem = new ParticleSystem(scene);
particleSystem.create();
// 初始化粒子点大小缩放（匹配当前渲染器分辨率）
particleSystem.updatePointScale(renderer.domElement.height);

// 烟雾系统
const smokeSystem = new SmokeSystem(scene);
smokeSystem.setCamera(camera);
smokeSystem.create();
smokeSystem.updatePointScale(renderer.domElement.height);

// 旧式后处理光束系统（可选）
const godRaysSystem = new GodRaysSystem(renderer, scene, camera);

// 可见体积光束系统（VFX 主效果）
const lightBeamSystem = new LightBeamSystem(scene);

// 遮挡板系统（为光束提供阴影图案）
const occluderSystem = new OccluderSystem(scene);
occluderSystem.setParentGroup(sceneManager.objectsGroup);  // 场景对象列表集成
lightBeamSystem.setOccluderSystem(occluderSystem);

// 时间线系统（关键帧动画引擎）
const timelineSystem = new TimelineSystem();

// 导出处理器
const exportHandler = new ExportHandler(renderer, gridHelper, axesHelper, sceneManager);
exportHandler.setCamera(camera);
exportHandler.setParticleSystem(particleSystem);
exportHandler.setSmokeSystem(smokeSystem);
exportHandler.setGodRaysSystem(godRaysSystem);

// UI 处理器（最后初始化，因为它需要其他模块的引用）
const uiHandler = new UIHandler({
  sceneManager,
  orbitController,
  fbxHandler,
  particleSystem,
  smokeSystem,
  godRaysSystem,
  lightBeamSystem,
  occluderSystem,
  timelineSystem,
  exportHandler,
  renderer,
  camera,
  scene
});

// ── 状态栏更新 ────────────────────────────────────
const statusRenderer = document.getElementById('status-renderer');
statusRenderer.textContent = rendererBackend;

// ── 动画循环 ──────────────────────────────────────
function animate() {
  requestAnimationFrame(animate);

  if (exportHandler.isFrameSequenceExporting) return;

  const deltaTime = Math.min(clock.getDelta(), 0.1); // 防止大帧跳跃

  // 时间线动画驱动（先于其他更新，确保参数插值后立即应用到各系统）
  timelineSystem.update(deltaTime);
  fbxHandler.setAnimationPlaying(timelineSystem.isPlaying);

  orbitController.update();

  // 更新 FBX 动画
  fbxHandler.updateAnimation(deltaTime);
  if (fbxHandler.shouldFollowActiveCamera()) {
    const camInfo = fbxHandler.getActiveCameraInfo();
    if (camInfo?.camera) {
      const modelCenter = fbxHandler.shouldAimActiveCameraAtModel()
        ? fbxHandler.getModelCenter()
        : null;
      orbitController.setFromCamera(camInfo.camera, {
        copyProjection: true,
        lookTarget: modelCenter,
        targetDistance: Math.max(fbxHandler.getModelSize(), 10)
      });
    }
  }

  // 更新粒子
  particleSystem.update(deltaTime);

  // 更新烟雾
  smokeSystem.update(deltaTime);

  // 更新场景内可见光束
  lightBeamSystem.update(deltaTime);

  // 更新遮挡板目标（跟随相机或手动控制）
  const followChk = document.getElementById('occluder-follow-camera');
  if (!followChk || followChk.checked) {
    const fbxCamPos = fbxHandler.getActiveCameraWorldPosition(new THREE.Vector3());
    occluderSystem._target.copy(fbxCamPos || camera.position);
  }

  // 更新遮挡板位置——但如果 TransformControls 正在控制遮挡板则跳过自动更新
  if (transformControls.object !== occluderSystem._mesh) {
    occluderSystem.update();
  }

  // 渲染（光束系统根据开关决定走直接渲染或后处理管线）
  godRaysSystem.render();
}

// ── 启动 ──────────────────────────────────────────
animate();
uiHandler.updateStatus('就绪 — 请导入 FBX 模型');

// ── 视频尺寸适配 ──────────────────────────────────
let videoSize = null; // { width, height } | null

function resizeForVideo(width, height) {
  videoSize = { width, height };
  const container = document.getElementById('canvas-container');
  const videoBg = document.getElementById('video-background');

  // 居中缩放：保持视频比例，适配窗口
  const winW = window.innerWidth;
  const winH = window.innerHeight;
  const scale = Math.min(winW / width, winH / height, 1.0);
  const rw = Math.round(width * scale);
  const rh = Math.round(height * scale);

  renderer.setSize(rw, rh, false);
  godRaysSystem.setSize(rw, rh);
  renderer.domElement.style.width = rw + 'px';
  renderer.domElement.style.height = rh + 'px';
  renderer.domElement.style.position = 'absolute';
  renderer.domElement.style.left = Math.round((winW - rw) / 2) + 'px';
  renderer.domElement.style.top = Math.round((winH - rh) / 2) + 'px';

  camera.aspect = rw / rh;
  camera.updateProjectionMatrix();

  // 同步视频元素尺寸
  if (videoBg) {
    videoBg.style.width = rw + 'px';
    videoBg.style.height = rh + 'px';
    videoBg.style.left = Math.round((winW - rw) / 2) + 'px';
    videoBg.style.top = Math.round((winH - rh) / 2) + 'px';
    videoBg.style.objectFit = 'fill';
  }

  if (container) container.classList.add('video-sized');
  updateExportFrameBorder();
}

function restoreWindowSize() {
  videoSize = null;
  const w = window.innerWidth;
  const h = window.innerHeight;

  renderer.setSize(w, h);
  godRaysSystem.setSize(w, h);
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  renderer.domElement.style.position = '';
  renderer.domElement.style.left = '';
  renderer.domElement.style.top = '';

  camera.aspect = w / h;
  camera.updateProjectionMatrix();

  const container = document.getElementById('canvas-container');
  if (container) container.classList.remove('video-sized');

  const videoBg = document.getElementById('video-background');
  if (videoBg) {
    videoBg.style.width = '100%';
    videoBg.style.height = '100%';
    videoBg.style.left = '';
    videoBg.style.top = '';
    videoBg.style.objectFit = 'cover';
  }
  updateExportFrameBorder();
}

// 注册视频尺寸回调
sceneManager.onVideoSizeKnown((size) => {
  if (size) {
    resizeForVideo(size.width, size.height);
  } else {
    restoreWindowSize();
  }
});

// ── 输出画幅绿框 ──────────────────────────────────

function updateExportFrameBorder() {
  const border = document.getElementById('export-frame-border');
  const container = document.getElementById('canvas-container');
  if (!border || !container) return;

  const wInput = document.getElementById('frame-width');
  const hInput = document.getElementById('frame-height');
  if (!wInput || !hInput) return;

  const frameW = parseInt(wInput.value) || 1920;
  const frameH = parseInt(hInput.value) || 1080;
  if (frameW <= 0 || frameH <= 0) return;

  const rect = container.getBoundingClientRect();
  const cw = rect.width;
  const ch = rect.height;
  if (cw <= 0 || ch <= 0) return;

  const frameRatio = frameW / frameH;
  const canvasRatio = cw / ch;

  let bw, bh;
  if (canvasRatio > frameRatio) {
    // canvas 更宽 → 绿框高度撑满，宽度按比例
    bh = ch;
    bw = ch * frameRatio;
  } else {
    // canvas 更高 → 绿框宽度撑满，高度按比例
    bw = cw;
    bh = cw / frameRatio;
  }

  const left = (cw - bw) / 2;
  const top = (ch - bh) / 2;

  border.style.display = 'block';
  border.style.left = left + 'px';
  border.style.top = top + 'px';
  border.style.width = bw + 'px';
  border.style.height = bh + 'px';
}

// ── 窗口 resize ───────────────────────────────────
window.addEventListener('resize', () => {
  if (videoSize) {
    resizeForVideo(videoSize.width, videoSize.height);
  } else {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    godRaysSystem.setSize(window.innerWidth, window.innerHeight);
  }
  particleSystem.updatePointScale(renderer.domElement.height);
  smokeSystem.updatePointScale(renderer.domElement.height);
  godRaysSystem.updatePointScale(renderer.domElement.height);
  updateExportFrameBorder();
});

// ── 暴露接口到全局，方便调试 ──────────────────────
if (typeof window !== 'undefined') {
  window.__atmosphereFX = {
    renderer,
    scene,
    camera,
    sceneManager,
    orbitController,
    fbxHandler,
    particleSystem,
    smokeSystem,
    godRaysSystem,
    lightBeamSystem,
    occluderSystem,
    exportHandler,
    updateExportFrameBorder,
    uiHandler,
    timelineSystem,
    gridHelper,
    axesHelper,
    _selectLightForTransform(light) {
      transformControls.attach(light);
    },
    _selectOccluderForTransform() {
      transformControls.attach(occluderSystem._mesh);
      uiHandler._onOccluderSelected();
    },
    _deselectForTransform() {
      transformControls.detach();
    }
  };
}

// 初始绘制输出绿框
updateExportFrameBorder();
