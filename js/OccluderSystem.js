/**
 * OccluderSystem.js — 光束遮挡板系统
 *
 * 在点光源前方生成带随机噪点的半透明平面，
 * 投射图案化阴影到场景中，让 godrays 产生可见的光束效果。
 *
 * 技术方案：
 * - 使用 THREE.ShadowMaterial（只写入 shadow map，主渲染中不可见）
 * - Canvas 生成程序化噪点纹理作为 alphaMap
 * - 平面始终朝向光源→场景中心方向
 * - 支持调节尺寸、噪点密度、与光源的距离、偏移
 */

import * as THREE from 'three';

/** @type {object} */
const DEFAULT_PARAMS = {
  size: 24,                  // ★ 大遮挡板覆盖更多立体角
  patternType: 'stripes',    // 图案类型: 'noise' | 'stripes' | 'radial' | 'grid'
  patternCount: 6,           // 光束数量 (2-20, 用于 stripes/radial)
  patternAngle: 45,          // 条纹角度 (0-180, 用于 stripes)
  noiseDensity: 0.7,         // 噪点填充比例 (0=全透明, 1=全遮挡, 用于 noise)
  noiseScale: 4,             // 噪点细节级别 (1=粗糙, 8=细腻, 用于 noise)
  noiseSpotSize: 1.0,        // 噪点斑块基础大小 (0.2-5.0, 用于 noise)
  noiseEdgeSoftness: 0.08,   // 边缘过渡柔和度 (0=硬边)
  noiseOctaves: 4,           // 细节叠加层数 (2-6, 用于 noise)
  noiseStretchX: 1.0,        // 水平拉伸 (0.2-5.0, 用于 noise)
  noiseStretchY: 1.0,        // 垂直拉伸 (0.2-5.0, 用于 noise)
  noiseContrast: 1.0,        // 对比度增强 (0.5-3.0, 用于 noise)
  distance: 3,               // ★ 距光源更近 → 覆盖 152° 立体角 (之前 67°)
  offsetX: 0,
  offsetY: 0,
  rotX: 0,
  rotY: 0,
  rotZ: 0,
  seed: Math.random(),
};

export class OccluderSystem {
  /**
   * @param {THREE.Scene} scene
   */
  constructor(scene) {
    this._scene = scene;

    /** @type {THREE.Mesh|null} */
    this._mesh = null;

    /** @type {THREE.CanvasTexture|null} */
    this._texture = null;

    /** @type {THREE.MeshDistanceMaterial|null} */
    this._distanceMaterial = null;

    /** @type {THREE.Line|null} 3D 空间中的可视辅助线框 */
    this._helper = null;

    /** @type {THREE.PointLight|null} */
    this._light = null;

    /** @type {boolean} */
    this._enabled = false;

    /** @type {boolean} 是否自动朝向光源（false=手动旋转） */
    this._useAutoOrient = true;

    /** @type {THREE.Vector3} 遮挡板朝向的目标点 */
    this._target = new THREE.Vector3(0, 0, 0);

    /** @type {THREE.Group|null} 父级组（SceneManager.objectsGroup），用于场景对象列表 */
    this._parentGroup = null;

    this._params = { ...DEFAULT_PARAMS };

    // 绑定方法，用于动画循环
    this._onAnimate = this._onAnimate.bind(this);
  }

  // ── 参数 ──────────────────────────────────────────

  get enabled() { return this._enabled; }
  get size() { return this._params.size; }
  set size(v) { this._params.size = v; this._updateGeometry(); }
  get patternType() { return this._params.patternType; }
  set patternType(v) { this._params.patternType = v; this._regenerateTexture(); }
  get patternCount() { return this._params.patternCount; }
  set patternCount(v) { this._params.patternCount = Math.round(v); this._regenerateTexture(); }
  get patternAngle() { return this._params.patternAngle; }
  set patternAngle(v) { this._params.patternAngle = v; this._regenerateTexture(); }
  get noiseDensity() { return this._params.noiseDensity; }
  set noiseDensity(v) { this._params.noiseDensity = v; this._regenerateTexture(); }
  get noiseScale() { return this._params.noiseScale; }
  set noiseScale(v) { this._params.noiseScale = v; this._regenerateTexture(); }
  get noiseSpotSize() { return this._params.noiseSpotSize; }
  set noiseSpotSize(v) { this._params.noiseSpotSize = v; this._regenerateTexture(); }
  get noiseEdgeSoftness() { return this._params.noiseEdgeSoftness; }
  set noiseEdgeSoftness(v) { this._params.noiseEdgeSoftness = v; this._regenerateTexture(); }
  get noiseOctaves() { return this._params.noiseOctaves; }
  set noiseOctaves(v) { this._params.noiseOctaves = Math.round(v); this._regenerateTexture(); }
  get noiseStretchX() { return this._params.noiseStretchX; }
  set noiseStretchX(v) { this._params.noiseStretchX = v; this._regenerateTexture(); }
  get noiseStretchY() { return this._params.noiseStretchY; }
  set noiseStretchY(v) { this._params.noiseStretchY = v; this._regenerateTexture(); }
  get noiseContrast() { return this._params.noiseContrast; }
  set noiseContrast(v) { this._params.noiseContrast = v; this._regenerateTexture(); }
  get distance() { return this._params.distance; }
  set distance(v) { this._params.distance = v; this._updatePosition(); }
  get offsetX() { return this._params.offsetX; }
  set offsetX(v) { this._params.offsetX = v; this._updatePosition(); }
  get offsetY() { return this._params.offsetY; }
  set offsetY(v) { this._params.offsetY = v; this._updatePosition(); }
  get seed() { return this._params.seed; }

  get rotX() { return this._params.rotX; }
  set rotX(v) { this._params.rotX = v; this._updateRotation(); }
  get rotY() { return this._params.rotY; }
  set rotY(v) { this._params.rotY = v; this._updateRotation(); }
  get rotZ() { return this._params.rotZ; }
  set rotZ(v) { this._params.rotZ = v; this._updateRotation(); }

  get useAutoOrient() { return this._useAutoOrient; }
  set useAutoOrient(v) { this._useAutoOrient = v; this._updatePosition(); }

  get target() { return this._target; }
  set target(v) { this._target.copy(v); this._updatePosition(); }

  /** 3D 空间中的辅助线框，用于选择/拖拽 */
  get helper() { return this._helper; }

  /**
   * 设置父级组，用于场景对象列表集成
   * @param {THREE.Group} group - SceneManager.objectsGroup
   */
  setParentGroup(group) {
    this._parentGroup = group;
  }

  // ── 生命周期 ──────────────────────────────────────

  /**
   * 绑定光源并生成遮挡板
   * @param {THREE.PointLight} light
   */
  setLight(light) {
    this._light = light;
    if (this._mesh) {
      this._updatePosition();
    }
  }

  /**
   * 生成/显示遮挡板
   */
  enable() {
    if (!this._light) {
      console.warn('OccluderSystem: 请先设置光源');
      return false;
    }
    if (!this._mesh) {
      this._generate();
    }
    if (this._mesh) {
      this._mesh.visible = true;
      this._enabled = true;
    }
    return true;
  }

  /**
   * 隐藏遮挡板（保留数据，可重新显示）
   */
  disable() {
    if (this._mesh) {
      this._mesh.visible = false;
    }
    this._enabled = false;
  }

  toggle() {
    if (this._enabled) {
      this.disable();
    } else {
      this.enable();
    }
    return this._enabled;
  }

  /**
   * 重新生成噪点（随机化种子）
   */
  randomizeSeed() {
    this._params.seed = Math.random();
    this._regenerateTexture();
  }

  /**
   * 完全销毁遮挡板
   */
  dispose() {
    if (this._mesh) {
      // 从父级组移除（兼容 parentGroup 和 direct scene）
      if (this._mesh.parent) {
        this._mesh.parent.remove(this._mesh);
      }
      if (this._mesh.geometry) this._mesh.geometry.dispose();
      if (this._mesh.material) this._mesh.material.dispose();
      this._mesh = null;
    }
    if (this._helper) {
      if (this._helper.geometry) this._helper.geometry.dispose();
      if (this._helper.material) this._helper.material.dispose();
      this._helper = null;
    }
    if (this._distanceMaterial) {
      this._distanceMaterial.dispose();
      this._distanceMaterial = null;
    }
    this._alphaMapUniform = null;
    this._alphaTestUniform = null;
    if (this._texture) {
      this._texture.dispose();
      this._texture = null;
    }
    this._enabled = false;
  }

  // ── 内部：生成 ────────────────────────────────────

  /**
   * 创建完整的遮挡板（几何体 + 纹理 + 材质 + Mesh）
   */
  _generate() {
    this._createTexture();
    const geometry = new THREE.PlaneGeometry(this._params.size, this._params.size, 1, 1);

    // 主材质：colorWrite=false 阻止颜色写入（不可见），但保持非透明以确保参与阴影渲染
    const material = new THREE.MeshBasicMaterial({
      colorWrite: false,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    // ★★ 关键：alphaMap 必须设在主材质上，WebGLShadowMap 每帧从主材质复制到
    // customDistanceMaterial (见 WebGLShadowMap.js:305-306)
    material.alphaMap = this._texture;
    material.alphaTest = 0.05;

    this._mesh = new THREE.Mesh(geometry, material);
    this._mesh.castShadow = true;
    this._mesh.receiveShadow = false;
    this._mesh.frustumCulled = false;
    this._mesh.renderOrder = 999;
    this._mesh.userData._afxType = 'occluder';
    this._mesh.userData._afxName = '光束遮挡板';
    this._mesh.userData._afxId = -1;  // 固定 ID，用于场景对象列表

    // ★ 关键：PointLight 使用 cube shadow map，Three.js 对其调用的是
    // customDistanceMaterial (MeshDistanceMaterial)，而非 customDepthMaterial (MeshDepthMaterial)！
    // 后者只对 DirectionalLight / SpotLight 生效。
    // 注意：Three.js 0.168 的 MeshDistanceMaterial 构造函数不处理 alphaMap/alphaTest
    // 参数，必须在构造后显式赋值。
    this._distanceMaterial = new THREE.MeshDistanceMaterial({
      side: THREE.DoubleSide,
    });
    this._distanceMaterial.alphaMap = this._texture;
    this._distanceMaterial.alphaTest = 0.05;

    // ★ CRITICAL: Three.js r168 的 MeshDistanceMaterial 默认不输出 vUv，
    // 导致 alpha map 的 UV 采样代码因 #ifdef USE_UV 被静默跳过。
    // 只需注入 USE_UV 即可 — USE_ALPHAMAP/USE_ALPHATEST/ALPHAMAP_UV
    // 会由 WebGLShadowMap 在每帧拷贝 mainMaterial.alphaMap 时自动补齐，
    // 手动添加反而会让标准材质的 alphamap chunk 注入距离材质 shader，不兼容。
    // 注意：WebGL2 模式下 #version 300 es 必须在所有 #define 之前。
    this._distanceMaterial.onBeforeCompile = (shader) => {
      const defineUV = '#define USE_UV\n';
      const versionLine = shader.vertexShader.match(/#version \d+.*\n/);
      if (versionLine) {
        shader.vertexShader = shader.vertexShader.replace(versionLine[0], versionLine[0] + defineUV);
        shader.fragmentShader = shader.fragmentShader.replace(versionLine[0], versionLine[0] + defineUV);
      } else {
        shader.vertexShader = defineUV + shader.vertexShader;
        shader.fragmentShader = defineUV + shader.fragmentShader;
      }
      if (!this._alphaMapUniform) this._alphaMapUniform = { value: this._distanceMaterial.alphaMap };
      if (!this._alphaTestUniform) this._alphaTestUniform = { value: this._distanceMaterial.alphaTest };
      shader.uniforms.alphaMap = this._alphaMapUniform;
      shader.uniforms.alphaTest = this._alphaTestUniform;
    };

    this._distanceMaterial.needsUpdate = true;
    this._mesh.customDistanceMaterial = this._distanceMaterial;

    // ★ 3D 辅助线框：让用户在空间中看到遮挡板位置
    const edgeGeo = new THREE.EdgesGeometry(geometry);
    const edgeMat = new THREE.LineBasicMaterial({
      color: 0xffaa00,
      transparent: true,
      opacity: 0.6,
      depthTest: true,
    });
    this._helper = new THREE.Line(edgeGeo, edgeMat);
    this._helper.userData._afxType = 'occluder-helper';
    this._helper.userData._afxName = '遮挡板辅助框';
    this._helper.renderOrder = 998;
    this._mesh.add(this._helper);

    // 加入场景对象组（SceneManager.objectsGroup），使其出现在对象列表中
    const targetGroup = this._parentGroup || this._scene;
    targetGroup.add(this._mesh);
    this._updatePosition();
  }

  /**
   * 根据 patternType 分发到对应的纹理生成器
   */
  _createTexture() {
    if (this._texture) {
      this._texture.dispose();
    }

    const resolution = 1024;
    const canvas = document.createElement('canvas');
    canvas.width = resolution;
    canvas.height = resolution;
    const ctx = canvas.getContext('2d');

    const imageData = ctx.createImageData(resolution, resolution);
    const data = imageData.data;

    switch (this._params.patternType) {
      case 'stripes':
        this._generateStripes(data, resolution);
        break;
      case 'radial':
        this._generateRadial(data, resolution);
        break;
      case 'grid':
        this._generateGrid(data, resolution);
        break;
      case 'noise':
      default:
        this._generateNoise(data, resolution);
        break;
    }

    ctx.putImageData(imageData, 0, 0);

    this._texture = new THREE.CanvasTexture(canvas);
    this._texture.wrapS = THREE.ClampToEdgeWrapping;
    this._texture.wrapT = THREE.ClampToEdgeWrapping;
    this._texture.magFilter = THREE.LinearFilter;
    this._texture.minFilter = THREE.LinearMipmapLinearFilter;
    this._texture.generateMipmaps = true;
    this._texture.colorSpace = THREE.LinearSRGBColorSpace;

    if (this._distanceMaterial) {
      this._distanceMaterial.alphaMap = this._texture;
      // ★ 同步持久 uniform 引用——着色器程序复用时 uniform 值不会自动更新
      if (this._alphaMapUniform) this._alphaMapUniform.value = this._texture;
      if (this._alphaTestUniform) this._alphaTestUniform.value = this._distanceMaterial.alphaTest;
    }
    // ★★ CRITICAL: WebGLShadowMap.getDepthMaterial() copies alphaMap/alphaTest
    // from the MAIN mesh material to the customDistanceMaterial EVERY FRAME
    // (line 305-306). If we only set it on the customDistanceMaterial, it gets
    // overwritten with undefined. Must set on BOTH materials.
    if (this._mesh && this._mesh.material) {
      this._mesh.material.alphaMap = this._texture;
      this._mesh.material.alphaTest = 0.05;
      this._mesh.material.needsUpdate = true;
    }
  }

  /**
   * 条纹图案 — 产生平行光束（丁达尔效应）
   */
  _generateStripes(data, resolution) {
    const { patternCount, patternAngle, noiseEdgeSoftness, noiseDensity } = this._params;
    const angleRad = THREE.MathUtils.degToRad(patternAngle);
    const cosA = Math.cos(angleRad);
    const sinA = Math.sin(angleRad);
    const halfRes = resolution / 2;
    const stripeWidth = resolution / patternCount;
    // ★ 过渡宽度相对于条纹宽度，而非画布尺寸
    const transition = Math.max(1, stripeWidth * noiseEdgeSoftness);

    for (let y = 0; y < resolution; y++) {
      for (let x = 0; x < resolution; x++) {
        const idx = (y * resolution + x) * 4;
        const rx = (x - halfRes) * cosA - (y - halfRes) * sinA;
        const stripePos = ((rx % stripeWidth) + stripeWidth) % stripeWidth;
        const distToCenter = Math.min(stripePos, stripeWidth - stripePos);

        // 遮挡条纹的半宽：noiseDensity 控制条纹在 stripeWidth 中的占比
        const halfStripe = stripeWidth * noiseDensity * 0.5;
        // ★ edgeDist: 正值=条纹内部, 负值=条纹之间透明间隙, 零=边界
        const edgeDist = halfStripe - distToCenter;

        let finalAlpha;
        if (edgeDist > transition) {
          finalAlpha = 255;
        } else if (edgeDist < -transition) {
          finalAlpha = 0;
        } else {
          finalAlpha = Math.round(((edgeDist + transition) / (transition * 2)) * 255);
        }

        data[idx] = finalAlpha;
        data[idx + 1] = finalAlpha;
        data[idx + 2] = finalAlpha;
        data[idx + 3] = finalAlpha;
      }
    }
  }

  /**
   * 放射状图案 — 从中心辐射的光束
   */
  _generateRadial(data, resolution) {
    const { patternCount, noiseEdgeSoftness, noiseDensity } = this._params;
    const halfRes = resolution / 2;
    const anglePerBeam = (Math.PI * 2) / patternCount;
    // ★ 过渡宽度相对于光束角宽度
    const transition = Math.max(0.01, anglePerBeam * noiseEdgeSoftness);

    for (let y = 0; y < resolution; y++) {
      for (let x = 0; x < resolution; x++) {
        const idx = (y * resolution + x) * 4;
        const dx = x - halfRes;
        const dy = y - halfRes;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // 中心小孔全透
        if (dist < resolution * 0.04) {
          data[idx] = data[idx + 1] = data[idx + 2] = data[idx + 3] = 0;
          continue;
        }

        let angle = Math.atan2(dy, dx);
        if (angle < 0) angle += Math.PI * 2;

        const beamIdx = Math.round(angle / anglePerBeam);
        const beamCenter = beamIdx * anglePerBeam;
        const angleDist = Math.abs(angle - beamCenter);
        const halfBeam = anglePerBeam * noiseDensity * 0.5;
        const edgeDist = halfBeam - angleDist;

        let finalAlpha;
        if (edgeDist > transition) {
          finalAlpha = 255;
        } else if (edgeDist < -transition) {
          finalAlpha = 0;
        } else {
          finalAlpha = Math.round(((edgeDist + transition) / (transition * 2)) * 255);
        }

        data[idx] = finalAlpha;
        data[idx + 1] = finalAlpha;
        data[idx + 2] = finalAlpha;
        data[idx + 3] = finalAlpha;
      }
    }
  }

  /**
   * 网格图案 — 十字格栅
   */
  _generateGrid(data, resolution) {
    const { patternCount, noiseEdgeSoftness, noiseDensity } = this._params;
    const cellSize = resolution / patternCount;
    // ★ 过渡宽度相对于格子尺寸
    const transition = Math.max(1, cellSize * noiseEdgeSoftness);
    const barWidth = cellSize * noiseDensity * 0.5;

    for (let y = 0; y < resolution; y++) {
      for (let x = 0; x < resolution; x++) {
        const idx = (y * resolution + x) * 4;
        const gridX = ((x % cellSize) + cellSize) % cellSize;
        const gridY = ((y % cellSize) + cellSize) % cellSize;
        const distX = Math.min(gridX, cellSize - gridX);
        const distY = Math.min(gridY, cellSize - gridY);
        const distToBar = Math.max(barWidth - distX, barWidth - distY);

        let finalAlpha;
        if (distToBar > transition) {
          finalAlpha = 255;
        } else if (distToBar < -transition) {
          finalAlpha = 0;
        } else {
          finalAlpha = Math.round(((distToBar + transition) / (transition * 2)) * 255);
        }

        data[idx] = finalAlpha;
        data[idx + 1] = finalAlpha;
        data[idx + 2] = finalAlpha;
        data[idx + 3] = finalAlpha;
      }
    }
  }

  /**
   * 噪点图案 — 随机斑块（保留原有逻辑）
   */
  _generateNoise(data, resolution) {
    const {
      noiseDensity, noiseScale, noiseSpotSize, noiseEdgeSoftness,
      noiseOctaves, noiseStretchX, noiseStretchY, noiseContrast, seed
    } = this._params;

    // spotSize 作为基础缩放因子：值越大斑块越大（频率越低）
    const baseScale = noiseScale / noiseSpotSize;

    // 动态生成多 octave 的 scale 和权重
    const scales = [];
    const weights = [];
    let totalWeight = 0;
    for (let i = 0; i < noiseOctaves; i++) {
      scales.push(baseScale * Math.pow(2, i));
      const w = Math.pow(0.5, i + 1);  // 指数衰减
      weights.push(w);
      totalWeight += w;
    }
    // 归一化权重
    for (let i = 0; i < weights.length; i++) {
      weights[i] /= totalWeight;
    }

    for (let y = 0; y < resolution; y++) {
      for (let x = 0; x < resolution; x++) {
        const idx = (y * resolution + x) * 4;

        // 应用拉伸变换
        const sx = x / noiseStretchX;
        const sy = y / noiseStretchY;

        // 多层次噪点叠加
        let value = 0;
        for (let i = 0; i < scales.length; i++) {
          value += this._pseudoRandom(sx / scales[i], sy / scales[i], seed + i * 0.1) * weights[i];
        }

        // 归一化并应用对比度增强
        value = Math.max(0, Math.min(1, value));
        value = 0.5 + (value - 0.5) * noiseContrast;
        value = Math.max(0, Math.min(1, value));

        // 密度控制：value > (1 - noiseDensity) → 遮挡（白），否则透明（黑）
        const threshold = 1 - noiseDensity;
        const transition = noiseEdgeSoftness;

        // 在阈值附近添加渐变过渡
        let finalAlpha;
        if (transition <= 0.001) {
          // 硬边模式
          finalAlpha = value > threshold ? 255 : 0;
        } else if (value > threshold + transition) {
          finalAlpha = 255;
        } else if (value > threshold - transition && value <= threshold + transition) {
          finalAlpha = Math.round(((value - (threshold - transition)) / (transition * 2)) * 255);
        } else {
          finalAlpha = 0;
        }

        // 所有通道写入 alpha 值 — 兼容不同 Three.js 版本的 alpha map 通道约定
        data[idx] = finalAlpha;     // R
        data[idx + 1] = finalAlpha; // G
        data[idx + 2] = finalAlpha; // B
        data[idx + 3] = finalAlpha; // A
      }
    }
  }

  /**
   * 简单伪随机函数（基于正弦波）
   */
  _pseudoRandom(x, y, seed) {
    const n = Math.sin(x * 12.9898 + y * 78.233 + seed * 437.585) * 43758.5453;
    return n - Math.floor(n);
  }

  _regenerateTexture() {
    this._createTexture();
  }

  // ── 内部：位置/几何更新 ────────────────────────────

  _updateGeometry() {
    if (!this._mesh) return;
    this._mesh.geometry.dispose();
    const newGeo = new THREE.PlaneGeometry(
      this._params.size,
      this._params.size,
      1,
      1
    );
    this._mesh.geometry = newGeo;

    // ★ 同步更新辅助线框
    if (this._helper) {
      this._helper.geometry.dispose();
      this._helper.geometry = new THREE.EdgesGeometry(newGeo);
    }
  }

  /**
   * 将遮挡板放置在光源前方，朝向目标点（默认原点，通常设为相机位置）
   */
  _updatePosition() {
    if (!this._mesh || !this._light) return;

    // 光源指向目标点的方向
    const lightPos = this._light.position;
    const dir = new THREE.Vector3().subVectors(this._target, lightPos).normalize();

    // 遮挡板位置：光源 + 方向 * 距离
    const occluderPos = lightPos.clone().add(
      dir.clone().multiplyScalar(this._params.distance)
    );

    // 应用偏移（在垂直于光线的平面上）
    const up = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(dir, up).normalize();
    const correctedUp = new THREE.Vector3().crossVectors(right, dir).normalize();

    occluderPos.add(right.clone().multiplyScalar(this._params.offsetX));
    occluderPos.add(correctedUp.clone().multiplyScalar(this._params.offsetY));

    this._mesh.position.copy(occluderPos);

    // 重置旋转
    this._mesh.rotation.set(0, 0, 0);

    // 朝向：自动朝向光源 或 手动旋转
    if (this._useAutoOrient) {
      this._mesh.lookAt(lightPos);
    }

    // 叠加手动旋转偏移
    const rx = THREE.MathUtils.degToRad(this._params.rotX);
    const ry = THREE.MathUtils.degToRad(this._params.rotY);
    const rz = THREE.MathUtils.degToRad(this._params.rotZ);
    this._mesh.rotateX(rx);
    this._mesh.rotateY(ry);
    this._mesh.rotateZ(rz);
  }

  _updateRotation() {
    if (!this._mesh || !this._light) return;
    this._mesh.rotation.set(0, 0, 0);
    if (this._useAutoOrient) {
      this._mesh.lookAt(this._light.position);
    }
    const rx = THREE.MathUtils.degToRad(this._params.rotX);
    const ry = THREE.MathUtils.degToRad(this._params.rotY);
    const rz = THREE.MathUtils.degToRad(this._params.rotZ);
    this._mesh.rotateX(rx);
    this._mesh.rotateY(ry);
    this._mesh.rotateZ(rz);
  }

  /**
   * 在动画循环中调用，用于更新遮挡板朝向（跟随光源移动）
   */
  _onAnimate() {
    if (this._enabled && this._mesh && this._light) {
      this._updatePosition();
    }
  }

  update() {
    this._onAnimate();
  }

  // ── 获取参数（供 UI 读取） ─────────────────────────

  getParams() {
    return { ...this._params };
  }
}
