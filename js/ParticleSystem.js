/**
 * ParticleSystem.js — 灰尘粒子模块
 * 浮动粒子效果，支持随机大小/透明度/旋转、飘动方向、湍流扰动
 * 使用 ShaderMaterial 实现 per-vertex 属性
 * 粒子样式：光晕(glow)、雪花(snowflake 4×4 图集)、雨点(raindrop)
 * 依赖：Three.js
 */

import * as THREE from 'three';

const STYLES = ['glow', 'snowflake', 'raindrop'];

const STYLE_PRESETS = {
  glow: {
    count: 300, size: 0.08, speed: 0.3, spread: 5,
    color: '#ffeedd', opacity: 0.5,
    driftX: 0, driftY: 0, driftZ: 0,
    sizeVar: 0.5, opacityVar: 0.5, turbulence: 1.0
  },
  snowflake: {
    count: 200, size: 0.30, speed: 0.2, spread: 8,
    color: '#ffffff', opacity: 0.8,
    driftX: 0, driftY: 0, driftZ: 0,
    sizeVar: 0.6, opacityVar: 0.3, turbulence: 1.2
  },
  raindrop: {
    count: 500, size: 0.15, speed: 1.5, spread: 4,
    color: '#aaccff', opacity: 0.6,
    driftX: 0, driftY: -5, driftZ: 0,
    sizeVar: 0.4, opacityVar: 0.3, turbulence: 0.15
  }
};

// ── 着色器（支持旋转 + 4×4 图集 + 生命周期淡入淡出）──────────

const VERTEX_SHADER = /* glsl */ `
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aOpacity;
  attribute float aRotation;
  attribute float aSpriteIndex;
  attribute float aLifeRatio;
  uniform float uPointScale;
  varying vec3 vColor;
  varying float vOpacity;
  varying float vRotation;
  varying float vSpriteIndex;
  varying float vLifeRatio;

  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = aSize * (uPointScale / -mvPosition.z);
    vColor = aColor;
    vOpacity = aOpacity;
    vRotation = aRotation;
    vSpriteIndex = aSpriteIndex;
    vLifeRatio = aLifeRatio;
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uTexture;
  varying vec3 vColor;
  varying float vOpacity;
  varying float vRotation;
  varying float vSpriteIndex;
  varying float vLifeRatio;

  void main() {
    // 旋转 UV（绕中心点旋转）
    vec2 uv = gl_PointCoord - 0.5;
    float c = cos(vRotation);
    float s = sin(vRotation);
    uv = vec2(uv.x * c - uv.y * s, uv.x * s + uv.y * c);
    uv += 0.5;

    // 映射到 4×4 图集
    float col = mod(vSpriteIndex, 4.0);
    float row = floor(vSpriteIndex / 4.0);
    vec2 atlasUV = (uv + vec2(col, row)) / 4.0;

    vec4 texColor = texture2D(uTexture, atlasUV);

    // 生命周期淡入淡出：前 10% 淡入，后 20% 淡出
    float fade = smoothstep(0.0, 0.1, vLifeRatio)
               * (1.0 - smoothstep(0.75, 1.0, vLifeRatio));

    float alpha = texColor.a * vOpacity * fade;
    // premultiplied alpha（与 WebGL 上下文 premultipliedAlpha=true 一致）
    gl_FragColor = vec4(vColor * texColor.rgb * alpha, alpha);
  }
`;

function varianceFactor(v) {
  return Math.max(0.05, 1.0 - v + Math.random() * v * 2);
}

// ── 粒子系统类 ──────────────────────────────────────

export class ParticleSystem {
  constructor(scene) {
    this.scene = scene;
    this.particles = null;

    this._style = 'glow';
    this._enabled = false;

    // 初始化为光晕预设
    const p = STYLE_PRESETS.glow;
    this._count = p.count;
    this._size = p.size;
    this._speed = p.speed;
    this._spread = p.spread;
    this._color = new THREE.Color(p.color);
    this._center = new THREE.Vector3(0, 2, 0);
    this._originOffset = new THREE.Vector3(0, 0, 0);
    this._opacity = p.opacity;
    this._drift = new THREE.Vector3(p.driftX, p.driftY, p.driftZ);
    this._sizeVariance = p.sizeVar;
    this._opacityVariance = p.opacityVar;
    this._turbulence = p.turbulence;
    this._rotationSpeed = 0.0;

    this._particleData = [];
    this._texture = null;
  }

  // ── 纹理生成 ──────────────────────────────────

  _createTexture() {
    if (this._texture) { this._texture.dispose(); }
    switch (this._style) {
      case 'snowflake': return this._createSnowflakeAtlas();
      case 'raindrop':  return this._createAtlasFromShape(this._createRaindropCell);
      default:          return this._createAtlasFromShape(this._createGlowCell);
    }
  }

  /** 用单个 cell 绘制函数填充 4×4 图集 */
  _createAtlasFromShape(drawCellFn) {
    const cellSize = 64;
    const grid = 4;
    const s = cellSize * grid;
    const canvas = document.createElement('canvas');
    canvas.width = s; canvas.height = s;
    const ctx = canvas.getContext('2d');

    for (let row = 0; row < grid; row++) {
      for (let col = 0; col < grid; col++) {
        ctx.save();
        ctx.translate(col * cellSize, row * cellSize);
        drawCellFn.call(this, ctx, cellSize);
        ctx.restore();
      }
    }
    this._texture = new THREE.CanvasTexture(canvas);
    return this._texture;
  }

  /** 光晕 cell — 非对称柔光 + 偏轴亮点 */
  _createGlowCell(ctx, s) {
    const h = s / 2;
    // 主体：略偏的径向渐变
    const g = ctx.createRadialGradient(h * 0.85, h * 0.45, 0, h, h, h);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.15, 'rgba(255,240,220,0.85)');
    g.addColorStop(0.4, 'rgba(200,180,150,0.35)');
    g.addColorStop(0.7, 'rgba(100,80,60,0.04)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);

    // 偏轴高光小点（用于显示旋转）
    const hlG = ctx.createRadialGradient(h * 0.7, h * 0.35, 0, h * 0.7, h * 0.35, h * 0.25);
    hlG.addColorStop(0, 'rgba(255,255,255,0.9)');
    hlG.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = hlG;
    ctx.beginPath();
    ctx.arc(h * 0.7, h * 0.35, h * 0.25, 0, Math.PI * 2);
    ctx.fill();
  }

  /** 雨点 cell */
  _createRaindropCell(ctx, s) {
    const h = s / 2;
    ctx.save();
    ctx.translate(h, h);
    ctx.scale(1, 2.5);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, h * 0.35);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.2, 'rgba(200,220,255,0.8)');
    g.addColorStop(0.5, 'rgba(150,180,240,0.3)');
    g.addColorStop(0.8, 'rgba(100,140,220,0.05)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-h, -h, s, s);
    ctx.restore();
    // 顶部高光
    const topG = ctx.createRadialGradient(h, h * 0.3, 0, h, h * 0.3, h * 0.12);
    topG.addColorStop(0, 'rgba(255,255,255,0.9)');
    topG.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = topG;
    ctx.fillRect(0, 0, s, s);
  }

  /** 雪花 4×4 图集 — 每格随机不规则形状 */
  _createSnowflakeAtlas() {
    const cellSize = 64;
    const grid = 4;
    const s = cellSize * grid;
    const canvas = document.createElement('canvas');
    canvas.width = s; canvas.height = s;
    const ctx = canvas.getContext('2d');

    for (let row = 0; row < grid; row++) {
      for (let col = 0; col < grid; col++) {
        this._drawRandomSnowflake(ctx, col * cellSize, row * cellSize, cellSize);
      }
    }
    this._texture = new THREE.CanvasTexture(canvas);
    return this._texture;
  }

  /** 在指定位置绘制一个随机不规则雪花（刻意不对称以便旋转可见） */
  _drawRandomSnowflake(ctx, ox, oy, s) {
    const h = s / 2;
    const cx = ox + h;
    const cy = oy + h;
    const seed = Math.random() * 1000;

    const rand = (n) => {
      const x = Math.sin(seed * 12.9898 + n * 78.233) * 43758.5453;
      return x - Math.floor(x);
    };

    ctx.save();
    ctx.beginPath();
    ctx.rect(ox, oy, s, s);
    ctx.clip();

    // 类型：0=不对称星形, 1=偏轴碎片, 2=不规则团簇+缺角
    const type = Math.floor(rand(0) * 3);

    if (type === 0) {
      // 不对称星形：不同臂使用不同长度和宽度
      const arms = 5 + Math.floor(rand(1) * 4);
      for (let i = 0; i < arms; i++) {
        const baseAngle = (Math.PI * 2 / arms) * i;
        // 每条臂不同的长度和宽度
        const len = h * (0.3 + rand(2 + i) * 0.65); // 0.3~0.95 倍
        const wid = h * (0.06 + rand(3 + i) * 0.12);
        const angleJitter = rand(4 + i) * 0.4 - 0.2;

        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(baseAngle + angleJitter);

        const g = ctx.createRadialGradient(0, 0, wid * 0.3, 0, len * 0.5, len * 0.55);
        g.addColorStop(0, 'rgba(255,255,255,0.95)');
        g.addColorStop(0.4, 'rgba(255,255,255,0.5)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.ellipse(wid * 0.3, -len * 0.35, wid, len * 0.55, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      // 偏轴高光
      const hlX = cx + (rand(10) - 0.5) * h * 0.5;
      const hlY = cy + (rand(11) - 0.5) * h * 0.5;
      const hlG = ctx.createRadialGradient(hlX, hlY, 0, hlX, hlY, h * 0.2);
      hlG.addColorStop(0, 'rgba(255,255,255,1)');
      hlG.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = hlG;
      ctx.beginPath();
      ctx.arc(hlX, hlY, h * 0.2, 0, Math.PI * 2);
      ctx.fill();

    } else if (type === 1) {
      // 偏轴碎片：2-4 个不规则碎片聚在一边
      const frags = 2 + Math.floor(rand(1) * 3);
      // 碎片簇的偏移方向（随机的偏好方向）
      const biasX = (rand(2) - 0.5) * h * 1.2;
      const biasY = (rand(3) - 0.5) * h * 1.2;

      for (let i = 0; i < frags; i++) {
        const fx = cx + biasX * (0.3 + rand(4 + i) * 0.7) + (rand(6 + i) - 0.5) * h * 0.5;
        const fy = cy + biasY * (0.3 + rand(5 + i) * 0.7) + (rand(7 + i) - 0.5) * h * 0.5;
        const fr = h * (0.15 + rand(8 + i) * 0.3);

        const g = ctx.createRadialGradient(fx, fy, 0, fx, fy, fr);
        g.addColorStop(0, 'rgba(255,255,255,0.85)');
        g.addColorStop(0.5, 'rgba(255,255,255,0.35)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(fx, fy, fr, 0, Math.PI * 2);
        ctx.fill();
      }

      // 在反方向加暗区/缺角
      const darkX = cx - biasX * 0.6;
      const darkY = cy - biasY * 0.6;
      ctx.fillStyle = 'rgba(0,0,0,0)';
      ctx.clearRect(darkX - h * 0.2, darkY - h * 0.2, h * 0.4, h * 0.4);

      // 偏轴光点
      const hlG = ctx.createRadialGradient(cx + biasX * 0.25, cy + biasY * 0.25, 0,
                                             cx + biasX * 0.25, cy + biasY * 0.25, h * 0.15);
      hlG.addColorStop(0, 'rgba(255,255,255,1)');
      hlG.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = hlG;
      ctx.beginPath();
      ctx.arc(cx + biasX * 0.25, cy + biasY * 0.25, h * 0.15, 0, Math.PI * 2);
      ctx.fill();

    } else {
      // 不规则团簇 + 缺角
      const blobs = 4 + Math.floor(rand(1) * 5);
      // 故意在某方向减少 blob（缺角）
      const gapAngle = rand(2) * Math.PI * 2;
      const gapSize = 0.5 + rand(3) * 1.0; // 缺口大小（弧度）

      for (let i = 0; i < blobs; i++) {
        const angle = (Math.PI * 2 / blobs) * i + rand(4 + i) * 0.5;
        // 如果在缺口范围内，跳过
        let angleDiff = angle - gapAngle;
        if (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
        if (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
        if (Math.abs(angleDiff) < gapSize * 0.5) continue;

        const dist = h * (0.2 + rand(5 + i) * 0.65);
        const bx = cx + Math.cos(angle) * dist;
        const by = cy + Math.sin(angle) * dist;
        const br = h * (0.12 + rand(6 + i) * 0.3);

        const g = ctx.createRadialGradient(bx, by, 0, bx, by, br);
        g.addColorStop(0, 'rgba(255,255,255,0.8)');
        g.addColorStop(0.5, 'rgba(255,255,255,0.35)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(bx, by, br, 0, Math.PI * 2);
        ctx.fill();
      }

      // 中心偏轴柔光
      const ocx = cx + (rand(10) - 0.5) * h * 0.3;
      const ocy = cy + (rand(11) - 0.5) * h * 0.3;
      const coreG = ctx.createRadialGradient(ocx, ocy, 0, ocx, ocy, h * 0.2);
      coreG.addColorStop(0, 'rgba(255,255,255,0.9)');
      coreG.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = coreG;
      ctx.beginPath();
      ctx.arc(ocx, ocy, h * 0.2, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  // ── 几何体构建 ──────────────────────────────────

  _buildGeometry() {
    const count = this._count;
    const geo = new THREE.BufferGeometry();

    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const opacities = new Float32Array(count);
    const rotations = new Float32Array(count);
    const spriteIndices = new Float32Array(count);
    const lifeRatios = new Float32Array(count);

    this._particleData = [];

    for (let i = 0; i < count; i++) {
      this._resetParticle(i, positions, colors, sizes, opacities,
        rotations, spriteIndices, lifeRatios, true);
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute('aOpacity', new THREE.BufferAttribute(opacities, 1));
    geo.setAttribute('aRotation', new THREE.BufferAttribute(rotations, 1));
    geo.setAttribute('aSpriteIndex', new THREE.BufferAttribute(spriteIndices, 1));
    geo.setAttribute('aLifeRatio', new THREE.BufferAttribute(lifeRatios, 1));

    return geo;
  }

  _resetParticle(i, positions, colors, sizes, opacities,
                 rotations, spriteIndices, lifeRatios, randomLife) {
    // 位置（均匀分布在球体/立方体范围内）
    positions[i * 3] = this._center.x + (Math.random() - 0.5) * this._spread * 2;
    positions[i * 3 + 1] = this._center.y + (Math.random() - 0.5) * this._spread * 1.5;
    positions[i * 3 + 2] = this._center.z + (Math.random() - 0.5) * this._spread * 2;

    // 颜色（带微小亮度变化）
    const v = 0.7 + Math.random() * 0.3;
    colors[i * 3] = this._color.r * v;
    colors[i * 3 + 1] = this._color.g * v;
    colors[i * 3 + 2] = this._color.b * v;

    // 大小
    const sizeVar = this._sizeVariance;
    sizes[i] = this._size * varianceFactor(sizeVar);

    // 透明度
    const opacityVar = this._opacityVariance;
    opacities[i] = this._opacity * varianceFactor(opacityVar);

    // 旋转（随机初始角度）
    rotations[i] = Math.random() * Math.PI * 2;

    // 图集索引（0-15）
    spriteIndices[i] = Math.floor(Math.random() * 16);

    // 生命周期比率
    const lifetime = 3 + Math.random() * 4;
    const life = randomLife ? Math.random() * lifetime : 0;
    lifeRatios[i] = lifetime > 0 ? life / lifetime : 0;

    // 基础速度（原地微小漂动，方向随机）
    const baseVelX = (Math.random() - 0.5) * 0.3;
    const baseVelY = (Math.random() - 0.5) * 0.3;
    const baseVelZ = (Math.random() - 0.5) * 0.3;

    this._particleData[i] = {
      baseVelX, baseVelY, baseVelZ,
      life,
      maxLife: lifetime,
      rotSpeed: (Math.random() - 0.5) * 2, // -1 ~ +1，方向随机
      phaseX: Math.random() * Math.PI * 2,
      phaseY: Math.random() * Math.PI * 2,
      phaseZ: Math.random() * Math.PI * 2,
      freq: 0.5 + Math.random() * 2.0,
      ampX: (Math.random() - 0.5) * 2,
      ampY: (Math.random() - 0.5) * 2,
      ampZ: (Math.random() - 0.5) * 2,
      originX: positions[i * 3],
      originY: positions[i * 3 + 1],
      originZ: positions[i * 3 + 2]
    };
  }

  /** 重建颜色/大小/透明度/图集属性（不重建几何体） */
  _rebuildAttributes() {
    if (!this.particles) return;
    const count = this._count;
    const colors = this.particles.geometry.attributes.aColor.array;
    const sizes = this.particles.geometry.attributes.aSize.array;
    const opacities = this.particles.geometry.attributes.aOpacity.array;
    const sprites = this.particles.geometry.attributes.aSpriteIndex.array;

    for (let i = 0; i < count; i++) {
      const v = 0.7 + Math.random() * 0.3;
      colors[i * 3] = this._color.r * v;
      colors[i * 3 + 1] = this._color.g * v;
      colors[i * 3 + 2] = this._color.b * v;

      sizes[i] = this._size * varianceFactor(this._sizeVariance);
      opacities[i] = this._opacity * varianceFactor(this._opacityVariance);
      sprites[i] = Math.floor(Math.random() * 16);
    }

    this.particles.geometry.attributes.aColor.needsUpdate = true;
    this.particles.geometry.attributes.aSize.needsUpdate = true;
    this.particles.geometry.attributes.aOpacity.needsUpdate = true;
    this.particles.geometry.attributes.aSpriteIndex.needsUpdate = true;
  }

  /** 创建粒子系统 */
  create() {
    if (this.particles) this.dispose();

    const geometry = this._buildGeometry();
    const texture = this._createTexture();
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uTexture: { value: texture },
        uPointScale: { value: 300.0 }
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.NormalBlending
    });

    this.particles = new THREE.Points(geometry, material);
    this.particles.name = 'dust-particles';
    this.particles.visible = this._enabled;
    this.particles.renderOrder = 999;
    this.particles.frustumCulled = false; // 防止粒子在视野边缘消失
    this.scene.add(this.particles);
  }

  /** 每帧更新 */
  update(deltaTime) {
    if (!this.particles || !this._enabled) return;

    const pos = this.particles.geometry.attributes.position.array;
    const rot = this.particles.geometry.attributes.aRotation.array;
    const lr = this.particles.geometry.attributes.aLifeRatio.array;
    const dt = Math.min(deltaTime, 0.1);
    const driftX = this._drift.x;
    const driftY = this._drift.y;
    const driftZ = this._drift.z;
    const turbAmount = this._turbulence;
    const rotSpeedGlobal = this._rotationSpeed;
    const now = performance.now() * 0.001;

    for (let i = 0; i < this._count; i++) {
      const d = this._particleData[i];
      d.life += dt;

      // 生命周期结束，重置
      if (d.life >= d.maxLife) {
        d.life = 0;
        d.maxLife = 3 + Math.random() * 4;
        d.rotSpeed = (Math.random() - 0.5) * 2;

        pos[i * 3] = this._center.x + (Math.random() - 0.5) * this._spread * 2;
        pos[i * 3 + 1] = this._center.y + (Math.random() - 0.5) * this._spread * 1.5;
        pos[i * 3 + 2] = this._center.z + (Math.random() - 0.5) * this._spread * 2;

        d.originX = pos[i * 3];
        d.originY = pos[i * 3 + 1];
        d.originZ = pos[i * 3 + 2];

        d.baseVelX = (Math.random() - 0.5) * 0.3;
        d.baseVelY = (Math.random() - 0.5) * 0.3;
        d.baseVelZ = (Math.random() - 0.5) * 0.3;

        d.phaseX = Math.random() * Math.PI * 2;
        d.phaseY = Math.random() * Math.PI * 2;
        d.phaseZ = Math.random() * Math.PI * 2;
        d.freq = 0.5 + Math.random() * 2.0;
        d.ampX = (Math.random() - 0.5) * 2;
        d.ampY = (Math.random() - 0.5) * 2;
        d.ampZ = (Math.random() - 0.5) * 2;
      }

      // 更新生命周期比率
      lr[i] = d.maxLife > 0 ? d.life / d.maxLife : 0;

      // 位置：漂移 + 基础速度
      pos[i * 3] += (d.baseVelX + driftX) * this._speed * dt;
      pos[i * 3 + 1] += (d.baseVelY + driftY) * this._speed * dt;
      pos[i * 3 + 2] += (d.baseVelZ + driftZ) * this._speed * dt;

      // 湍流（也受速度影响）
      if (turbAmount > 0.001 && this._speed > 0.001) {
        pos[i * 3] += d.ampX * Math.sin(now * d.freq + d.phaseX) * turbAmount * this._speed * dt;
        pos[i * 3 + 1] += d.ampY * Math.sin(now * d.freq + d.phaseY) * turbAmount * this._speed * dt;
        pos[i * 3 + 2] += d.ampZ * Math.sin(now * d.freq + d.phaseZ) * turbAmount * this._speed * dt;
      }

      // 旋转
      if (rotSpeedGlobal > 0.001) {
        rot[i] += d.rotSpeed * rotSpeedGlobal * dt;
        // 保持在 0~2π 范围
        if (rot[i] > Math.PI * 2) rot[i] -= Math.PI * 2;
        if (rot[i] < 0) rot[i] += Math.PI * 2;
      }
    }

    this.particles.geometry.attributes.position.needsUpdate = true;
    if (rotSpeedGlobal > 0.001) {
      this.particles.geometry.attributes.aRotation.needsUpdate = true;
    }
    this.particles.geometry.attributes.aLifeRatio.needsUpdate = true;
  }

  // ── 样式切换 ─────────────────────────────────

  setStyle(style) {
    if (!STYLES.includes(style) || style === this._style) return;
    this._style = style;

    const p = STYLE_PRESETS[style];
    this._count = p.count;
    this._size = p.size;
    this._speed = p.speed;
    this._spread = p.spread;
    this._color.set(p.color);
    this._opacity = p.opacity;
    this._drift.set(p.driftX, p.driftY, p.driftZ);
    this._sizeVariance = p.sizeVar;
    this._opacityVariance = p.opacityVar;
    this._turbulence = p.turbulence;

    this.create();
  }

  get style() { return this._style; }

  // ── 参数接口 ─────────────────────────────────

  setEnabled(v) {
    this._enabled = v;
    if (this.particles) this.particles.visible = v;
  }

  toggle() {
    this.setEnabled(!this._enabled);
    return this._enabled;
  }

  setCount(n) {
    this._count = Math.max(1, n);
    if (this._particleData.length !== this._count) this.create();
  }

  setSize(s) {
    this._size = s;
    if (this.particles) this._rebuildAttributes();
  }

  setSpeed(s) { this._speed = s; }

  setSpread(s) {
    this._spread = Math.max(0.5, s);
    this.create();
  }

  setOpacity(o) {
    this._opacity = o;
    if (this.particles) this._rebuildAttributes();
  }

  setColor(hex) {
    this._color.set(hex);
    if (this.particles) this._rebuildAttributes();
  }

  setCenter(x, y, z) {
    this._center.set(x, y, z);
    this._originOffset.set(x, y, z);
    this.create();
  }

  setOriginOffset(x, y, z) {
    this._originOffset.set(x, y, z);
    this.moveCenterTo(x, y, z);
  }

  moveCenterTo(x, y, z) {
    const dx = x - this._center.x;
    const dy = y - this._center.y;
    const dz = z - this._center.z;
    if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) < 1e-6) return;

    this._center.set(x, y, z);
    this._originOffset.set(x, y, z);
    if (!this.particles) return;

    const pos = this.particles.geometry.attributes.position.array;
    for (let i = 0; i < this._count; i++) {
      pos[i * 3] += dx;
      pos[i * 3 + 1] += dy;
      pos[i * 3 + 2] += dz;

      const d = this._particleData[i];
      if (d) {
        d.originX += dx;
        d.originY += dy;
        d.originZ += dz;
      }
    }
    this.particles.geometry.attributes.position.needsUpdate = true;
  }

  setDrift(dx, dy, dz) { this._drift.set(dx, dy, dz); }

  setSizeVariance(v) {
    this._sizeVariance = Math.max(0, Math.min(2, v));
    if (this.particles) this._rebuildAttributes();
  }

  setOpacityVariance(v) {
    this._opacityVariance = Math.max(0, Math.min(2, v));
    if (this.particles) this._rebuildAttributes();
  }

  setTurbulence(v) { this._turbulence = Math.max(0, Math.min(6, v)); }

  /** 设置旋转速度 0-20（0 = 不旋转） */
  setRotationSpeed(v) {
    this._rotationSpeed = Math.max(0, Math.min(20, v));
  }

  /** 重置所有粒子旋转为 0 */
  resetRotation() {
    if (!this.particles) return;
    const rot = this.particles.geometry.attributes.aRotation.array;
    for (let i = 0; i < this._count; i++) {
      rot[i] = 0;
      if (this._particleData[i]) this._particleData[i].rotSpeed = (Math.random() - 0.5) * 2;
    }
    this.particles.geometry.attributes.aRotation.needsUpdate = true;
  }

  /** 更新点大小缩放（用于导出时适配不同分辨率） */
  updatePointScale(rendererHeight) {
    if (!this.particles?.material?.uniforms?.uPointScale) return;
    const scale = Math.max(1, rendererHeight * 0.4);
    this.particles.material.uniforms.uPointScale.value = scale;
  }

  get enabled() { return this._enabled; }
  get count() { return this._count; }
  get size() { return this._size; }
  get speed() { return this._speed; }
  get spread() { return this._spread; }
  get opacity() { return this._opacity; }
  get color() { return '#' + this._color.getHexString(); }
  get driftX() { return this._drift.x; }
  get driftY() { return this._drift.y; }
  get driftZ() { return this._drift.z; }
  get originX() { return this._originOffset.x; }
  get originY() { return this._originOffset.y; }
  get originZ() { return this._originOffset.z; }
  get sizeVariance() { return this._sizeVariance; }
  get opacityVariance() { return this._opacityVariance; }
  get turbulence() { return this._turbulence; }
  get rotationSpeed() { return this._rotationSpeed; }

  dispose() {
    if (this.particles) {
      this.scene.remove(this.particles);
      this.particles.geometry.dispose();
      if (this.particles.material.uniforms?.uTexture?.value) {
        this.particles.material.uniforms.uTexture.value.dispose();
      }
      this.particles.material.dispose();
      this.particles = null;
    }
    if (this._texture) {
      this._texture.dispose();
      this._texture = null;
    }
  }
}
