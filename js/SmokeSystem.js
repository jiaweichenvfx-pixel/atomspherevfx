/**
 * SmokeSystem.js — 烟雾模块（大平面纹理方案）
 *
 * 技术路线：使用大量带烟雾纹理的 PlaneGeometry 平面交错叠加，
 * 通过速度场驱动运动 + 湍流扰动 + 视锥剔除来模拟体积烟雾。
 * 灵感来源：react-smoke (isoteriksoftware)
 *
 * 与旧版点精灵方案的区别：
 * - 每个平面本身就是一团完整的烟雾 puff，因此仅需 30-60 个平面
 *   即可呈现柔和、无颗粒感的烟雾效果
 * - 使用 MeshBasicMaterial + 程序化烟雾纹理，而非 ShaderMaterial + 点精灵
 * - 运动模型：速度 + 漂移 + 正弦湍流 + 越界回中
 *
 * 依赖：Three.js
 */

import * as THREE from 'three';

const STYLES = ['static', 'mist', 'thick', 'steam'];

/** 每个烟雾簇包含的平面数（1 个主平面 + 4 个子平面） */
const CLUSTER_SIZE = 5;

const STYLE_PRESETS = {
  static: {
    count: 60, size: 3.5, riseSpeed: 0.03, spread: 12,
    color: '#e8e8f0', opacity: 0.07,
    driftX: 0, driftY: 0.03, driftZ: 0,
    sizeVar: 0.3, opacityVar: 0.4, turbulence: 0.08,
    lifetime: 30
  },
  mist: {
    count: 50, size: 2.8, riseSpeed: 0.2, spread: 4.5,
    color: '#ddeeff', opacity: 0.10,
    driftX: 0, driftY: 0.3, driftZ: 0,
    sizeVar: 0.5, opacityVar: 0.5, turbulence: 0.4,
    lifetime: 22
  },
  thick: {
    count: 45, size: 3.2, riseSpeed: 0.25, spread: 3.5,
    color: '#aaaaaa', opacity: 0.14,
    driftX: 0, driftY: 0.55, driftZ: 0,
    sizeVar: 0.4, opacityVar: 0.4, turbulence: 0.6,
    lifetime: 16
  },
  steam: {
    count: 35, size: 2.0, riseSpeed: 0.7, spread: 2.8,
    color: '#ffffff', opacity: 0.08,
    driftX: 0, driftY: 1.2, driftZ: 0,
    sizeVar: 0.35, opacityVar: 0.35, turbulence: 1.0,
    lifetime: 9
  }
};

// ── 烟雾系统类 ──────────────────────────────────────

export class SmokeSystem {
  constructor(scene) {
    this.scene = scene;

    /** @type {THREE.Mesh[]} */
    this._planes = [];

    /** @type {THREE.PlaneGeometry|null} */
    this._sharedGeometry = null;

    /** @type {THREE.CanvasTexture|null} */
    this._texture = null;

    this._style = 'static';
    this._enabled = false;
    this._camera = null;

    const p = STYLE_PRESETS.static;
    this._count = p.count;
    this._size = p.size;
    this._riseSpeed = p.riseSpeed;
    this._spread = p.spread;
    this._color = new THREE.Color(p.color);
    this._center = new THREE.Vector3(0, 0.5, 0);
    this._originOffset = new THREE.Vector3(0, 0, 0);
    this._opacity = p.opacity;
    this._drift = new THREE.Vector3(p.driftX, p.driftY, p.driftZ);
    this._sizeVariance = p.sizeVar;
    this._opacityVariance = p.opacityVar;
    this._turbulence = p.turbulence;
    this._lifetime = p.lifetime;
    this._fadeDuration = 5.0; // 淡入淡出时长（秒）

    // 视锥剔除 & 速度转向（每帧复用，避免 GC）
    this._frustum = new THREE.Frustum();
    this._projScreenMatrix = new THREE.Matrix4();
    this._bbox = new THREE.Box3();
    this._bboxSize = new THREE.Vector3();
    this._steerVec = new THREE.Vector3();
  }

  // ── 纹理生成 ──────────────────────────────────

  /**
   * 程序化烟雾 puff 纹理（Canvas 2D）
   * 中心大而柔和的径向渐变 + 多个随机位置的小团块 → 不规则烟雾轮廓
   */
  _createTexture() {
    if (this._texture) { this._texture.dispose(); this._texture = null; }

    const s = 256;
    const h = s / 2;
    const canvas = document.createElement('canvas');
    canvas.width = s;
    canvas.height = s;
    const ctx = canvas.getContext('2d');

    ctx.clearRect(0, 0, s, s);

    ctx.save();
    ctx.filter = 'blur(8px)';

    // 多个椭圆柔团叠加，而不是一个完整圆形 puff
    for (let i = 0; i < 34; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = h * Math.pow(Math.random(), 0.75) * 0.72;
      const bx = h + Math.cos(angle) * dist;
      const by = h + Math.sin(angle) * dist;
      const rx = h * (0.12 + Math.random() * 0.34);
      const ry = h * (0.08 + Math.random() * 0.26);
      const rot = Math.random() * Math.PI;
      const alpha = 0.035 + Math.random() * 0.085;

      const bg = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      bg.addColorStop(0, `rgba(255,255,255,${alpha})`);
      bg.addColorStop(0.42, `rgba(255,255,255,${alpha * 0.42})`);
      bg.addColorStop(1, 'rgba(255,255,255,0)');

      ctx.save();
      ctx.translate(bx, by);
      ctx.rotate(rot);
      ctx.scale(rx, ry);
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.arc(0, 0, 1, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 打掉局部边缘，形成缺口，避免规则圆形轮廓
    ctx.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 18; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = h * (0.48 + Math.random() * 0.45);
      const bx = h + Math.cos(angle) * dist;
      const by = h + Math.sin(angle) * dist;
      const br = h * (0.10 + Math.random() * 0.26);
      const cut = ctx.createRadialGradient(bx, by, 0, bx, by, br);
      cut.addColorStop(0, 'rgba(0,0,0,0.24)');
      cut.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = cut;
      ctx.beginPath();
      ctx.arc(bx, by, br, 0, Math.PI * 2);
      ctx.fill();
    }

    // 再从外圈随机咬掉更大的半透明缺口，破坏所有 plane 共享的圆形边界。
    for (let i = 0; i < 26; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = h * (0.62 + Math.random() * 0.38);
      const bx = h + Math.cos(angle) * dist;
      const by = h + Math.sin(angle) * dist;
      const rx = h * (0.12 + Math.random() * 0.34);
      const ry = h * (0.10 + Math.random() * 0.30);
      const rot = Math.random() * Math.PI;
      const alpha = 0.10 + Math.random() * 0.22;
      const cut = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      cut.addColorStop(0, `rgba(0,0,0,${alpha})`);
      cut.addColorStop(0.65, `rgba(0,0,0,${alpha * 0.45})`);
      cut.addColorStop(1, 'rgba(0,0,0,0)');

      ctx.save();
      ctx.translate(bx, by);
      ctx.rotate(rot);
      ctx.scale(rx, ry);
      ctx.fillStyle = cut;
      ctx.beginPath();
      ctx.arc(0, 0, 1, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';

    this._texture = new THREE.CanvasTexture(canvas);
    this._texture.minFilter = THREE.LinearFilter;
    this._texture.magFilter = THREE.LinearFilter;
    this._texture.needsUpdate = true;
    return this._texture;
  }

  // ── 辅助 ──────────────────────────────────────

  _randomInVolume() {
    const hs = this._spread / 2;
    return new THREE.Vector3(
      this._center.x + (Math.random() - 0.5) * this._spread,
      this._center.y + (Math.random() - 0.5) * this._spread,
      this._center.z + (Math.random() - 0.5) * this._spread
    );
  }

  _randomVelocity() {
    const s = this._riseSpeed;
    return new THREE.Vector3(
      (Math.random() - 0.5) * s * 0.4,
      s * (0.5 + Math.random()),
      (Math.random() - 0.5) * s * 0.4
    );
  }

  // ── 构建与销毁 ────────────────────────────────

  /** 创建所有烟雾平面（按簇组织，每簇 CLUSTER_SIZE 个平面） */
  create() {
    this.dispose();

    const texture = this._createTexture();
    this._sharedGeometry = new THREE.PlaneGeometry(1, 1);

    const numClusters = Math.floor(this._count / CLUSTER_SIZE);

    for (let c = 0; c < numClusters; c++) {
      // 簇的共享属性：中心位置 + 基础速度
      const clusterCenter = this._randomInVolume();
      const clusterVelocity = this._randomVelocity();
      // 确保初始 age 不在淡出区：至少保留 fadeDuration + 2s 的可见余量
      const clusterMaxAge = this._lifetime * (0.65 + Math.random() * 0.7);
      const maxInitAge = Math.max(0.1, clusterMaxAge - this._fadeDuration - 2);
      const clusterAge = Math.random() * maxInitAge;

      // 预计算主平面大小因子（子平面需以此为基准做比例约束）
      const primVariance = 1 - this._sizeVariance + Math.random() * this._sizeVariance * 2;
      const primarySizeFactor = primVariance * 1.0;

      for (let p = 0; p < CLUSTER_SIZE; p++) {
        const isPrimary = (p === 0);

        // 主平面正常大小，子平面 55-80%（保证 max/min ≤ 2）
        let sizeFactor;
        if (isPrimary) {
          sizeFactor = primarySizeFactor;
        } else {
          const childMult = 0.55 + Math.random() * 0.25;
          const variancePart = 1 - this._sizeVariance + Math.random() * this._sizeVariance * 2;
          let raw = variancePart * childMult;
          // 约束：子平面大小 ∈ [主平面×0.5, 主平面×1.0]
          sizeFactor = Math.max(primarySizeFactor * 0.5, Math.min(primarySizeFactor, raw));
        }

        // 子平面透明度略低
        const opacityMult = isPrimary ? 1.0 : (0.5 + Math.random() * 0.35);
        const opacityFactor = (1 - this._opacityVariance + Math.random() * this._opacityVariance * 2) * opacityMult;

        const material = new THREE.MeshBasicMaterial({
          map: texture,
          color: this._color.clone(),
          transparent: true,
          blending: THREE.NormalBlending,
          opacity: this._opacity * opacityFactor,
          depthWrite: false,
          depthTest: true,
          side: THREE.DoubleSide
        });

        const mesh = new THREE.Mesh(this._sharedGeometry, material);
        mesh.name = 'smoke-plane';
        mesh.renderOrder = 998;
        mesh.frustumCulled = false;
        mesh.visible = this._enabled;

        // 位置：簇中心 + 子平面随机偏移（紧贴主平面周围）
        if (isPrimary) {
          mesh.position.copy(clusterCenter);
        } else {
          const offsetR = this._size * (0.08 + Math.random() * 0.35);
          const offsetAngle = Math.random() * Math.PI * 2;
          mesh.position.set(
            clusterCenter.x + Math.cos(offsetAngle) * offsetR,
            clusterCenter.y + (Math.random() - 0.5) * this._size * 0.25,
            clusterCenter.z + Math.sin(offsetAngle) * offsetR
          );
        }

        // 尺寸
        const planeSize = this._size * sizeFactor;
        mesh.scale.set(planeSize, planeSize, 1);

        // 速度：共享基础速度 + 子平面微小扰动
        const vel = clusterVelocity.clone();
        if (!isPrimary) {
          vel.x += (Math.random() - 0.5) * this._riseSpeed * 0.15;
          vel.y += (Math.random() - 0.5) * this._riseSpeed * 0.15;
          vel.z += (Math.random() - 0.5) * this._riseSpeed * 0.15;
        }

        mesh.userData.smokeData = {
          velocity: vel,
          isPrimary,
          clusterId: c,
          sizeFactor,
          opacityFactor,
          turbPhase: Math.random() * Math.PI * 2,
          turbFreq: 0.4 + Math.random() * 2.2,
          turbAmp: 0.5 + Math.random(),
          roll: Math.random() * Math.PI * 2,
          rollSpeed: (Math.random() - 0.5) * 0.12,
          age: clusterAge,
          maxAge: clusterMaxAge
        };

        this.scene.add(mesh);
        this._planes.push(mesh);
      }
    }
  }

  /** 每帧更新 */
  update(deltaTime) {
    if (!this._enabled || this._planes.length === 0) return;

    const dt = Math.min(deltaTime, 0.1);
    const time = performance.now() * 0.001;
    const cx = this._center.x;
    const cy = this._center.y;
    const cz = this._center.z;
    const halfSpread = this._spread / 2;
    const turbAmount = this._turbulence;

    // 更新视锥（用于手动剔除）
    if (this._camera) {
      this._projScreenMatrix.multiplyMatrices(
        this._camera.projectionMatrix,
        this._camera.matrixWorldInverse
      );
      this._frustum.setFromProjectionMatrix(this._projScreenMatrix);
    }

    // ── 第一遍：推进年龄，收集需要重置的簇 ──
    /** @type {Set<number>} */
    const expiredClusters = new Set();
    for (const mesh of this._planes) {
      const sd = mesh.userData.smokeData;
      if (!sd) continue;
      sd.age += dt;
      // 寿命结束后再留 _fadeDuration 秒让淡出自然完成（避免瞬间消失）
      if (sd.age >= sd.maxAge + this._fadeDuration) {
        expiredClusters.add(sd.clusterId);
      }
    }

    // ── 第二遍：簇重置 + 逐平面更新 ──
    for (const mesh of this._planes) {
      const sd = mesh.userData.smokeData;
      if (!sd) continue;

      const pos = mesh.position;

      // ── 簇到期 → 整簇重置 ──
      if (expiredClusters.has(sd.clusterId)) {
        // 调试：重置时检查是否已完全淡出
        if (mesh.material.opacity > 0.001) {
          console.warn('⚠ Smoke reset while still visible!',
            'cluster', sd.clusterId,
            'primary', sd.isPrimary,
            'age', sd.age.toFixed(2),
            'maxAge', sd.maxAge.toFixed(2),
            'remaining', (sd.maxAge - sd.age).toFixed(3),
            'opacity', mesh.material.opacity.toFixed(5));
        }
        sd.age = 0;
        sd.maxAge = this._lifetime * (0.65 + Math.random() * 0.7);

        if (sd.isPrimary) {
          // 主平面：新随机位置 + 新速度
          pos.copy(this._randomInVolume());
          sd.velocity.copy(this._randomVelocity());
          // 将簇中心缓存到 userData，供子平面读取
          sd._clusterCenter = pos.clone();
          sd._clusterVelocity = sd.velocity.clone();
        } else {
          // 子平面：围绕主平面的新位置偏移
          const primary = this._getPrimaryInCluster(sd.clusterId);
          if (primary) {
            const cc = primary.userData.smokeData._clusterCenter;
            const offsetR = this._size * (0.08 + Math.random() * 0.35);
            const offsetAngle = Math.random() * Math.PI * 2;
            pos.set(
              cc.x + Math.cos(offsetAngle) * offsetR,
              cc.y + (Math.random() - 0.5) * this._size * 0.25,
              cc.z + Math.sin(offsetAngle) * offsetR
            );
            sd.velocity.copy(primary.userData.smokeData._clusterVelocity);
            sd.velocity.x += (Math.random() - 0.5) * this._riseSpeed * 0.15;
            sd.velocity.y += (Math.random() - 0.5) * this._riseSpeed * 0.15;
            sd.velocity.z += (Math.random() - 0.5) * this._riseSpeed * 0.15;

            // 重新计算子平面大小因子（约束在 primary 的 0.5~1.0 范围）
            const primSizeFactor = primary.userData.smokeData.sizeFactor;
            const childMult = 0.55 + Math.random() * 0.25;
            const variancePart = 1 - this._sizeVariance + Math.random() * this._sizeVariance * 2;
            let raw = variancePart * childMult;
            sd.sizeFactor = Math.max(primSizeFactor * 0.5, Math.min(primSizeFactor, raw));
            const planeSize = this._size * sd.sizeFactor;
            mesh.scale.set(planeSize, planeSize, 1);
          } else {
            pos.copy(this._randomInVolume());
            sd.velocity.copy(this._randomVelocity());
          }
        }

        sd.turbPhase = Math.random() * Math.PI * 2;
        sd.turbFreq = 0.4 + Math.random() * 2.2;
        sd.roll = Math.random() * Math.PI * 2;
        sd.rollSpeed = (Math.random() - 0.5) * 0.12;
      }

      // ── 透明度淡入淡出（首尾各 _fadeDuration 秒） ──
      let fadeMult = 1.0;
      if (this._fadeDuration > 0 && sd.maxAge > 0) {
        // 淡入
        if (sd.age < this._fadeDuration) {
          fadeMult = sd.age / this._fadeDuration;
        }
        // 淡出（优先级更高）
        const remaining = sd.maxAge - sd.age;
        if (remaining < this._fadeDuration) {
          fadeMult = Math.min(fadeMult, Math.max(0, remaining / this._fadeDuration));
        }
      }
      fadeMult = Math.max(0, Math.min(1, fadeMult));
      const prevOpacity = mesh.material.opacity;
      mesh.material.opacity = this._opacity * sd.opacityFactor * fadeMult;
      // 调试：追踪非淡出的瞬间消失（opacity 在单帧内骤降 80%+ 且之前可见）
      if (prevOpacity > 0.005 && mesh.material.opacity < prevOpacity * 0.2) {
        console.warn('⚠ Smoke sudden drop!',
          'cluster', sd.clusterId,
          'primary', sd.isPrimary,
          'age', sd.age.toFixed(2),
          'maxAge', sd.maxAge.toFixed(2),
          'remaining', (sd.maxAge - sd.age).toFixed(3),
          'fadeMult', fadeMult.toFixed(4),
          'opacity', prevOpacity.toFixed(4), '→', mesh.material.opacity.toFixed(5));
      }

      // ── 越界 → 速度转向回中心 ──
      const outX = Math.abs(pos.x - cx) > halfSpread;
      const outY = Math.abs(pos.y - cy) > halfSpread * 1.1;
      const outZ = Math.abs(pos.z - cz) > halfSpread;

      if (outX || outY || outZ) {
        this._steerVec.set(cx - pos.x, cy - pos.y, cz - pos.z).normalize();
        const steerStrength = this._riseSpeed * 0.6;
        sd.velocity.x += this._steerVec.x * steerStrength * dt;
        sd.velocity.y += this._steerVec.y * steerStrength * dt;
        sd.velocity.z += this._steerVec.z * steerStrength * dt;
      }

      // ── 湍流 ──
      const turbX = Math.sin(time * sd.turbFreq + sd.turbPhase) * turbAmount * sd.turbAmp;
      const turbY = Math.cos(time * sd.turbFreq * 1.37 + sd.turbPhase) * turbAmount * sd.turbAmp * 0.7;
      const turbZ = Math.sin(time * sd.turbFreq * 0.73 + sd.turbPhase + 1.2) * turbAmount * sd.turbAmp * 0.6;

      // ── 位移 ──
      pos.x += (sd.velocity.x + this._drift.x + turbX) * dt;
      pos.y += (sd.velocity.y + this._drift.y + turbY) * dt;
      pos.z += (sd.velocity.z + this._drift.z + turbZ) * dt;

      // ── Billboard ──
      if (this._camera) {
        mesh.quaternion.copy(this._camera.quaternion);
        mesh.rotateZ(sd.roll + sd.age * sd.rollSpeed);
      }
    }
  }

  /** 查找指定簇中的主平面 */
  _getPrimaryInCluster(clusterId) {
    for (const mesh of this._planes) {
      const sd = mesh.userData.smokeData;
      if (sd && sd.clusterId === clusterId && sd.isPrimary) {
        return mesh;
      }
    }
    return null;
  }

  dispose() {
    for (const mesh of this._planes) {
      this.scene.remove(mesh);
      if (mesh.material) {
        // map 是共享纹理，不在此 dispose
        mesh.material.dispose();
      }
    }
    this._planes.length = 0;

    if (this._sharedGeometry) {
      this._sharedGeometry.dispose();
      this._sharedGeometry = null;
    }

    if (this._texture) {
      this._texture.dispose();
      this._texture = null;
    }
  }

  // ── 样式切换 ─────────────────────────────────

  setStyle(style) {
    if (!STYLES.includes(style) || style === this._style) return;
    this._style = style;

    const p = STYLE_PRESETS[style];
    this._count = p.count;
    this._size = p.size;
    this._riseSpeed = p.riseSpeed;
    this._spread = p.spread;
    this._color.set(p.color);
    this._opacity = p.opacity;
    this._drift.set(p.driftX, p.driftY, p.driftZ);
    this._sizeVariance = p.sizeVar;
    this._opacityVariance = p.opacityVar;
    this._turbulence = p.turbulence;
    this._lifetime = p.lifetime;

    this.create(); // 完全重建
  }

  get style() { return this._style; }

  // ── 开关 ─────────────────────────────────────

  setEnabled(v) {
    this._enabled = v;
    for (const mesh of this._planes) {
      mesh.visible = v;
    }
  }

  toggle() {
    this.setEnabled(!this._enabled);
    return this._enabled;
  }

  // ── 参数接口 ─────────────────────────────────

  setCount(n) {
    n = Math.max(1, Math.min(Math.round(n), 1000));
    if (n === this._count) return;
    this._count = n;
    this.create();
  }

  setSize(s) {
    this._size = Math.max(0.1, s);
    for (const mesh of this._planes) {
      const sd = mesh.userData.smokeData;
      const sf = sd ? sd.sizeFactor : 1;
      const planeSize = this._size * sf;
      mesh.scale.set(planeSize, planeSize, 1);
    }
  }

  setRiseSpeed(s) { this._riseSpeed = Math.max(0.02, s); }

  setSpread(s) {
    this._spread = Math.max(0.5, s);
    this.create();
  }

  setLifetime(l) {
    this._lifetime = Math.max(1, l);
  }

  setOpacity(o) {
    this._opacity = Math.max(0.005, Math.min(0.5, o));
    for (const mesh of this._planes) {
      const sd = mesh.userData.smokeData;
      const of = sd ? sd.opacityFactor : 1;
      mesh.material.opacity = this._opacity * of;
    }
  }

  setColor(hex) {
    this._color.set(hex);
    for (const mesh of this._planes) {
      mesh.material.color.copy(this._color);
    }
  }

  setCenter(x, y, z) {
    this._center.set(x, y, z);
    this._originOffset.set(x, y, z);
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
    for (const mesh of this._planes) {
      mesh.position.x += dx;
      mesh.position.y += dy;
      mesh.position.z += dz;
      const sd = mesh.userData.smokeData;
      if (sd?._clusterCenter) {
        sd._clusterCenter.x += dx;
        sd._clusterCenter.y += dy;
        sd._clusterCenter.z += dz;
      }
    }
  }

  setDrift(dx, dy, dz) { this._drift.set(dx, dy, dz); }

  setSizeVariance(v) {
    this._sizeVariance = Math.max(0, Math.min(1, v));
    // 按簇处理，保证子平面 ≤ 2× primary 的比例约束
    const done = new Set();
    for (const mesh of this._planes) {
      const sd = mesh.userData.smokeData;
      if (!sd || done.has(sd.clusterId)) continue;
      done.add(sd.clusterId);

      const primary = this._getPrimaryInCluster(sd.clusterId);
      if (!primary) continue;
      const primSD = primary.userData.smokeData;

      // 主平面
      const primVariance = 1 - this._sizeVariance + Math.random() * this._sizeVariance * 2;
      primSD.sizeFactor = primVariance * 1.0;
      primary.scale.set(this._size * primSD.sizeFactor, this._size * primSD.sizeFactor, 1);

      // 子平面：约束 ∈ [primary×0.5, primary×1.0]
      for (const child of this._planes) {
        const csd = child.userData.smokeData;
        if (!csd || csd.clusterId !== sd.clusterId || csd.isPrimary) continue;
        const childMult = 0.55 + Math.random() * 0.25;
        const variancePart = 1 - this._sizeVariance + Math.random() * this._sizeVariance * 2;
        let raw = variancePart * childMult;
        csd.sizeFactor = Math.max(primSD.sizeFactor * 0.5, Math.min(primSD.sizeFactor, raw));
        child.scale.set(this._size * csd.sizeFactor, this._size * csd.sizeFactor, 1);
      }
    }
  }

  setOpacityVariance(v) {
    this._opacityVariance = Math.max(0, Math.min(1, v));
    for (const mesh of this._planes) {
      const sd = mesh.userData.smokeData;
      if (sd) {
        const variancePart = 1 - this._opacityVariance + Math.random() * this._opacityVariance * 2;
        const childMult = sd.isPrimary ? 1.0 : (0.5 + Math.random() * 0.35);
        sd.opacityFactor = variancePart * childMult;
        mesh.material.opacity = this._opacity * sd.opacityFactor;
      }
    }
  }

  setTurbulence(v) { this._turbulence = Math.max(0, Math.min(5, v)); }

  setCamera(camera) { this._camera = camera; }

  /** 保留 API 兼容（平面方案中为 no-op） */
  updatePointScale(_height) { /* no-op */ }

  // ── 访问器 ──────────────────────────────────

  get enabled() { return this._enabled; }
  get count() { return this._count; }
  get size() { return this._size; }
  get riseSpeed() { return this._riseSpeed; }
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
  get lifetime() { return this._lifetime; }
}
