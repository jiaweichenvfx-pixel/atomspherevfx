/**
 * GodRaysSystem.js — 光束后处理系统
 *
 * 封装 three-good-godrays 的 GodraysPass + postprocessing 管线。
 * 通过选中场景中的点光源作为光束发射源，利用其 shadow map
 * 计算屏幕空间散射光。
 *
 * 与现有渲染流程的集成：
 * - godrays 关闭时：render() 直接调用 renderer.render(scene, camera)
 * - godrays 开启时：render() 走 EffectComposer → RenderPass → GodraysPass
 * - captureStream() 仍然有效（composer 输出到同一 canvas）
 *
 * 依赖：three-good-godrays@0.11.2, postprocessing
 */

import * as THREE from 'three';
import { EffectComposer, RenderPass } from 'postprocessing';
import { GodraysPass } from 'three-good-godrays';

/**
 * GodraysPass 实际 API 参数（来源：three-good-godrays@0.11.2 源码）
 * - density (默认 1/128 ≈ 0.0078)
 * - maxDensity (默认 0.5)
 * - distanceAttenuation (默认 2)
 * - color (THREE.Color, 默认 0xffffff)
 * - raymarchSteps (默认 60)
 * - blur (boolean, 默认 true)
 * - gammaCorrection (boolean, 默认 true)
 * - resolutionScale (0~1, 默认 0.5)
 * - upsampleQuality (0|1, 默认 1)
 */

/** @type {object} */
const DEFAULT_PARAMS = {
  density: 0.08,              // ★ 提高默认密度 — 光束更明显
  maxDensity: 0.8,
  distanceAttenuation: 8,     // ★ 增强距离衰减 — 光源处更亮，传播渐淡
  color: '#ffffff',
  raymarchSteps: 64,
  blur: true,
  gammaCorrection: true,
  resolutionScale: 0.5,
  upsampleQuality: 1
};

export class GodRaysSystem {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.Scene} scene
   * @param {THREE.Camera} camera
   */
  constructor(renderer, scene, camera) {
    this._renderer = renderer;
    this._scene = scene;
    this._camera = camera;

    /** @type {boolean} */
    this._enabled = false;

    /** @type {THREE.PointLight|null} */
    this._light = null;

    /** @type {EffectComposer|null} */
    this._composer = null;

    /** @type {RenderPass|null} */
    this._renderPass = null;

    /** @type {GodraysPass|null} */
    this._godraysPass = null;

    // 参数缓存
    this._params = { ...DEFAULT_PARAMS };
    this._colorObj = new THREE.Color(DEFAULT_PARAMS.color);
  }

  // ── 参数转换 ──────────────────────────────────

  /**
   * 构建传给 GodraysPass 构造 / setParams 的参数对象
   */
  _getPassParams() {
    return {
      density: this._params.density,
      maxDensity: this._params.maxDensity,
      distanceAttenuation: this._params.distanceAttenuation,
      color: this._colorObj,
      raymarchSteps: this._params.raymarchSteps,
      blur: this._params.blur,
      gammaCorrection: this._params.gammaCorrection,
      resolutionScale: this._params.resolutionScale,
      upsampleQuality: this._params.upsampleQuality
    };
  }

  // ── 管线管理 ──────────────────────────────────

  /**
   * 懒创建 EffectComposer 管线。
   * 要求 _light 已设置且有效。
   */
  _ensurePipeline() {
    if (this._composer) return;

    if (!this._light) {
      console.warn('GodRaysSystem: 没有可用的点光源，无法构建光束管线');
      return;
    }

    // 确保光源启用了阴影（GodraysPass 依赖 shadow map）
    this._light.castShadow = true;
    if (this._light.shadow.mapSize.width < 2048) {
      this._light.shadow.mapSize.set(2048, 2048);
    }
    // shadow camera far 需要足够大，否则 computeEffectiveMaxDist
    // 会把光束范围限制在一个小立方体内，产生可见的 box 边界
    this._light.shadow.camera.near = 0.05;
    this._light.shadow.camera.far = 5000;
    this._light.shadow.bias = -0.0003;

    this._composer = new EffectComposer(this._renderer, {
      frameBufferType: THREE.HalfFloatType
    });

    this._renderPass = new RenderPass(this._scene, this._camera);
    this._renderPass.renderToScreen = false;
    this._composer.addPass(this._renderPass);

    this._godraysPass = new GodraysPass(
      this._light,
      this._camera,
      this._getPassParams()
    );
    this._godraysPass.renderToScreen = true;
    this._composer.addPass(this._godraysPass);
  }

  /**
   * 销毁 EffectComposer 管线，释放 GPU 资源
   */
  _destroyPipeline() {
    if (this._composer) {
      this._composer.dispose();
      this._composer = null;
    }
    this._renderPass = null;
    this._godraysPass = null;
    // 重置渲染目标为屏幕，避免切换到直接渲染时出现残影
    this._renderer.setRenderTarget(null);
    // 重置 viewport 和 scissor，防止 EffectComposer 残留状态影响后续直接渲染
    const sz = this._renderer.getSize(new THREE.Vector2());
    this._renderer.setViewport(0, 0, sz.x, sz.y);
    this._renderer.setScissor(0, 0, sz.x, sz.y);
    this._renderer.setScissorTest(false);
    // ★ 关键：EffectComposer 会把 autoClear 设为 false，必须恢复
    // 否则直接渲染不会清缓冲，旧帧残留形成拖尾残影
    this._renderer.autoClear = true;
    // 重置整个 WebGL 状态机，防止 GodraysPass 的混合模式残留
    this._renderer.state.reset();
  }

  /**
   * 重建管线（光源变化时调用）
   */
  _rebuildPipeline() {
    this._destroyPipeline();
    if (this._enabled && this._light) {
      this._ensurePipeline();
    }
  }

  // ── 每帧渲染 ─────────────────────────────────

  /**
   * 替代 renderer.render(scene, camera) 的核心渲染方法。
   * Godrays 关闭时走直接渲染（零开销），开启时走后处理管线。
   */
  render() {
    if (this._enabled && this._composer) {
      this._composer.render();
    } else {
      this._renderer.render(this._scene, this._camera);
    }
  }

  // ── 开关 ──────────────────────────────────────

  setEnabled(v) {
    if (v === this._enabled) return;
    this._enabled = v;
    if (v) {
      this._ensurePipeline();
    } else {
      this._destroyPipeline();
    }
  }

  toggle() {
    this.setEnabled(!this._enabled);
    return this._enabled;
  }

  get enabled() { return this._enabled; }

  // ── 光源 ──────────────────────────────────────

  /**
   * 设置光束目标光源（需为 THREE.PointLight）
   * @param {THREE.PointLight|null} light
   */
  setLight(light) {
    if (light === this._light) return;
    this._light = light;
    this._rebuildPipeline();
  }

  get light() { return this._light; }

  // ── 相机 ──────────────────────────────────────

  setCamera(camera) {
    this._camera = camera;
    if (this._camera && this._light) {
      this._rebuildPipeline();
    }
  }

  // ── 尺寸 ──────────────────────────────────────

  setSize(width, height) {
    if (this._composer) {
      this._composer.setSize(width, height);
    }
  }

  /** 保留 API 兼容 */
  updatePointScale(_height) { /* no-op */ }

  // ── 参数更新（通过 setParams 应用） ────────────

  _applyParams() {
    if (this._godraysPass) {
      this._godraysPass.setParams(this._getPassParams());
    }
  }

  // ── 参数 getter/setter ────────────────────────

  get density() { return this._params.density; }
  set density(v) { this._params.density = v; this._applyParams(); }

  get maxDensity() { return this._params.maxDensity; }
  set maxDensity(v) { this._params.maxDensity = v; this._applyParams(); }

  get distanceAttenuation() { return this._params.distanceAttenuation; }
  set distanceAttenuation(v) { this._params.distanceAttenuation = v; this._applyParams(); }

  get color() { return '#' + this._colorObj.getHexString(); }
  set color(hex) {
    this._params.color = hex;
    this._colorObj.set(hex);
    this._applyParams();
  }

  get raymarchSteps() { return this._params.raymarchSteps; }
  set raymarchSteps(v) { this._params.raymarchSteps = Math.round(v); this._applyParams(); }

  get blur() { return this._params.blur; }
  set blur(v) { this._params.blur = v; this._applyParams(); }

  get gammaCorrection() { return this._params.gammaCorrection; }
  set gammaCorrection(v) { this._params.gammaCorrection = v; this._applyParams(); }

  get resolutionScale() { return this._params.resolutionScale; }
  set resolutionScale(v) { this._params.resolutionScale = v; this._applyParams(); }

  // ── 销毁 ──────────────────────────────────────

  dispose() {
    this._destroyPipeline();
    this._light = null;
    this._camera = null;
  }
}
