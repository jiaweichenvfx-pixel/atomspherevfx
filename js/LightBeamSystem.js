/**
 * LightBeamSystem.js - 场景内可见体积光束
 *
 * 这是 VFX 风格的丁达尔光实现：用多片交叉透明光片组成一个光锥，
 * 不依赖 shadow map 或屏幕空间后处理，因此退出摄像机视角后依然可见。
 */

import * as THREE from 'three';

const DEFAULT_PARAMS = {
  originX: 0,
  originY: 6,
  originZ: 0,
  targetX: 0,
  targetY: 0,
  targetZ: 0,
  length: 18,
  radius: 4,
  intensity: 1.6,
  color: '#ffe7b2',
  planeCount: 10,
  stripeCount: 7,
  stripeStrength: 0.65,
  noiseStrength: 0.35,
  edgeSoftness: 0.75,
  attenuation: 1.15,
  driftSpeed: 0.08,
  helperVisible: true,
  followLight: true
};

const VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uColor;
  uniform float uIntensity;
  uniform float uTime;
  uniform float uStripeCount;
  uniform float uStripeStrength;
  uniform float uNoiseStrength;
  uniform float uEdgeSoftness;
  uniform float uAttenuation;
  uniform float uDriftSpeed;
  uniform float uOccluderEnabled;
  uniform float uOccPatternType;
  uniform float uOccPatternCount;
  uniform float uOccPatternAngle;
  uniform float uOccDensity;
  uniform float uOccSoftness;
  uniform vec2 uOccOffset;
  uniform float uOccSeed;
  varying vec2 vUv;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float valueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  float stripeCut(vec2 p, float count, float angle, float density, float softness) {
    float c = cos(angle);
    float s = sin(angle);
    vec2 rp = vec2(p.x * c - p.y * s, p.x * s + p.y * c);
    float wave = 0.5 + 0.5 * sin(rp.x * count * 6.2831853);
    float gapWidth = clamp(1.0 - density, 0.06, 0.88);
    return smoothstep(1.0 - gapWidth - softness, 1.0 - gapWidth + softness, wave);
  }

  float radialCut(vec2 p, float count, float density, float softness) {
    vec2 cp = p - vec2(0.5, 0.15);
    float angle = atan(cp.y, cp.x);
    float wave = 0.5 + 0.5 * sin(angle * count);
    float gapWidth = clamp(1.0 - density, 0.06, 0.88);
    return smoothstep(1.0 - gapWidth - softness, 1.0 - gapWidth + softness, wave);
  }

  float gridCut(vec2 p, float count, float density, float softness) {
    float sx = stripeCut(p, count, 0.0, density, softness);
    float sy = stripeCut(p, count, 1.5707963, density, softness);
    return max(sx, sy);
  }

  float noiseCut(vec2 p, float density, float softness, float seed) {
    vec2 np = p * vec2(8.0, 18.0) + seed;
    float n = valueNoise(np) * 0.55 + valueNoise(np * 2.2 + 17.0) * 0.45;
    return smoothstep(density - softness, density + softness, n);
  }

  float occluderTransmission(vec2 p) {
    if (uOccluderEnabled < 0.5) return 1.0;

    vec2 op = p + uOccOffset;
    float count = max(1.0, uOccPatternCount);
    float density = clamp(uOccDensity, 0.02, 0.98);
    float softness = clamp(uOccSoftness, 0.005, 0.35);
    float angle = radians(uOccPatternAngle);

    float passMask;
    if (uOccPatternType < 0.5) {
      passMask = stripeCut(op, count, angle, density, softness);
    } else if (uOccPatternType < 1.5) {
      passMask = radialCut(op, count, density, softness);
    } else if (uOccPatternType < 2.5) {
      passMask = gridCut(op, count, density, softness);
    } else {
      passMask = noiseCut(op, density, softness, uOccSeed);
    }

    return mix(1.0, passMask, 0.92);
  }

  void main() {
    float axisDist = abs(vUv.x * 2.0 - 1.0);
    float radialBase = max(0.0, 1.0 - axisDist);
    float radialPower = mix(7.0, 1.35, clamp(uEdgeSoftness, 0.0, 1.0));
    float radial = pow(radialBase, radialPower);

    float startFade = smoothstep(0.0, 0.055, vUv.y);
    float endFade = 1.0 - smoothstep(0.72, 1.0, vUv.y);
    float distanceFade = exp(-vUv.y * max(0.0, uAttenuation));
    float longitudinal = startFade * endFade * distanceFade;

    float stripeWave = sin((vUv.x * uStripeCount + vUv.y * 1.65 - uTime * uDriftSpeed) * 6.2831853);
    float stripes = smoothstep(-0.35, 0.95, stripeWave);
    float stripeMask = mix(1.0, stripes, clamp(uStripeStrength, 0.0, 1.0));

    vec2 noiseUv = vec2(vUv.x * 5.0, vUv.y * 18.0 - uTime * uDriftSpeed * 2.0);
    float n = valueNoise(noiseUv) * 0.62 + valueNoise(noiseUv * 2.3 + 19.4) * 0.38;
    float noiseMask = mix(1.0, 0.62 + n * 0.84, clamp(uNoiseStrength, 0.0, 1.0));
    float occlusionMask = occluderTransmission(vUv);

    float alpha = radial * longitudinal * stripeMask * noiseMask * occlusionMask * uIntensity * 0.62;
    alpha = clamp(alpha, 0.0, 0.92);

    vec3 color = uColor * (0.72 + stripeMask * 0.48) * (0.55 + occlusionMask * 0.45) * uIntensity;
    gl_FragColor = vec4(color * alpha, alpha);
  }
`;

const LOCAL_AXIS = new THREE.Vector3(0, 1, 0);

export class LightBeamSystem {
  constructor(scene) {
    this._scene = scene;
    this._enabled = false;
    this._params = { ...DEFAULT_PARAMS };
    this._origin = new THREE.Vector3(DEFAULT_PARAMS.originX, DEFAULT_PARAMS.originY, DEFAULT_PARAMS.originZ);
    this._target = new THREE.Vector3(DEFAULT_PARAMS.targetX, DEFAULT_PARAMS.targetY, DEFAULT_PARAMS.targetZ);
    this._direction = new THREE.Vector3(0, -1, 0);
    this._color = new THREE.Color(DEFAULT_PARAMS.color);
    this._light = null;

    this._group = null;
    this._beamGroup = null;
    this._helperGroup = null;
    this._material = null;
    this._geometry = null;
    this._occluderSystem = null;
    this._helperLine = null;
    this._sourceMarker = null;
    this._endMarker = null;
    this._time = 0;
  }

  get enabled() { return this._enabled; }
  get originX() { return this._origin.x; }
  set originX(v) { this._origin.x = v; this._params.originX = v; this._syncTransform(); }
  get originY() { return this._origin.y; }
  set originY(v) { this._origin.y = v; this._params.originY = v; this._syncTransform(); }
  get originZ() { return this._origin.z; }
  set originZ(v) { this._origin.z = v; this._params.originZ = v; this._syncTransform(); }
  get targetX() { return this._target.x; }
  set targetX(v) { this._target.x = v; this._params.targetX = v; this._syncTransform(); }
  get targetY() { return this._target.y; }
  set targetY(v) { this._target.y = v; this._params.targetY = v; this._syncTransform(); }
  get targetZ() { return this._target.z; }
  set targetZ(v) { this._target.z = v; this._params.targetZ = v; this._syncTransform(); }
  get length() { return this._params.length; }
  set length(v) { this._params.length = Math.max(0.1, v); this._rebuildGeometry(); this._syncTransform(); }
  get radius() { return this._params.radius; }
  set radius(v) { this._params.radius = Math.max(0.01, v); this._rebuildGeometry(); }
  get intensity() { return this._params.intensity; }
  set intensity(v) { this._params.intensity = v; this._setUniform('uIntensity', v); }
  get color() { return '#' + this._color.getHexString(); }
  set color(hex) { this._params.color = hex; this._color.set(hex); this._setUniform('uColor', this._color); }
  get planeCount() { return this._params.planeCount; }
  set planeCount(v) { this._params.planeCount = Math.max(2, Math.round(v)); this._rebuildPlanes(); }
  get stripeCount() { return this._params.stripeCount; }
  set stripeCount(v) { this._params.stripeCount = Math.max(0, v); this._setUniform('uStripeCount', this._params.stripeCount); }
  get stripeStrength() { return this._params.stripeStrength; }
  set stripeStrength(v) { this._params.stripeStrength = v; this._setUniform('uStripeStrength', v); }
  get noiseStrength() { return this._params.noiseStrength; }
  set noiseStrength(v) { this._params.noiseStrength = v; this._setUniform('uNoiseStrength', v); }
  get edgeSoftness() { return this._params.edgeSoftness; }
  set edgeSoftness(v) { this._params.edgeSoftness = v; this._setUniform('uEdgeSoftness', v); }
  get attenuation() { return this._params.attenuation; }
  set attenuation(v) { this._params.attenuation = v; this._setUniform('uAttenuation', v); }
  get driftSpeed() { return this._params.driftSpeed; }
  set driftSpeed(v) { this._params.driftSpeed = v; this._setUniform('uDriftSpeed', v); }
  get helperVisible() { return this._params.helperVisible; }
  set helperVisible(v) {
    this._params.helperVisible = !!v;
    if (this._helperGroup) this._helperGroup.visible = this._params.helperVisible && this._enabled;
  }
  get followLight() { return this._params.followLight; }
  set followLight(v) { this._params.followLight = !!v; }

  setLight(light) {
    this._light = light || null;
    if (this._light && this._params.followLight) {
      this._light.getWorldPosition(this._origin);
      this._params.originX = this._origin.x;
      this._params.originY = this._origin.y;
      this._params.originZ = this._origin.z;
      this._syncTransform();
    }
  }

  setOccluderSystem(occluderSystem) {
    this._occluderSystem = occluderSystem || null;
    this._syncOccluderUniforms();
  }

  setOrigin(x, y, z) {
    this._origin.set(x, y, z);
    this._params.originX = x;
    this._params.originY = y;
    this._params.originZ = z;
    this._syncTransform();
  }

  setTarget(x, y, z) {
    this._target.set(x, y, z);
    this._params.targetX = x;
    this._params.targetY = y;
    this._params.targetZ = z;
    this._syncTransform();
  }

  toggle() {
    this.setEnabled(!this._enabled);
    return this._enabled;
  }

  setEnabled(v) {
    this._enabled = !!v;
    this._ensureCreated();
    this._group.visible = this._enabled;
    if (this._helperGroup) this._helperGroup.visible = this._enabled && this._params.helperVisible;
  }

  update(deltaTime, options = {}) {
    if (!this._group) return;
    if (Number.isFinite(options.timeSeconds)) {
      this._time = options.timeSeconds;
    } else {
      this._time += deltaTime;
    }
    this._setUniform('uTime', this._time);
    this._syncOccluderUniforms();

    if (this._enabled && this._light && this._params.followLight) {
      this._light.getWorldPosition(this._origin);
      this._params.originX = this._origin.x;
      this._params.originY = this._origin.y;
      this._params.originZ = this._origin.z;
      this._syncTransform();
    }
  }

  getParams() {
    return {
      ...this._params,
      originX: this._origin.x,
      originY: this._origin.y,
      originZ: this._origin.z,
      targetX: this._target.x,
      targetY: this._target.y,
      targetZ: this._target.z,
      color: this.color
    };
  }

  dispose() {
    if (this._group?.parent) this._group.parent.remove(this._group);
    if (this._geometry) this._geometry.dispose();
    if (this._material) this._material.dispose();
    this._group = null;
    this._beamGroup = null;
    this._helperGroup = null;
    this._geometry = null;
    this._material = null;
    this._helperLine = null;
    this._sourceMarker = null;
    this._endMarker = null;
  }

  _ensureCreated() {
    if (this._group) return;

    this._group = new THREE.Group();
    this._group.name = 'visible-light-beam';
    this._group.visible = false;

    this._beamGroup = new THREE.Group();
    this._helperGroup = new THREE.Group();
    this._group.add(this._beamGroup);
    this._group.add(this._helperGroup);
    this._scene.add(this._group);

    this._material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: {
        uColor: { value: this._color.clone() },
        uIntensity: { value: this._params.intensity },
        uTime: { value: 0 },
        uStripeCount: { value: this._params.stripeCount },
        uStripeStrength: { value: this._params.stripeStrength },
        uNoiseStrength: { value: this._params.noiseStrength },
        uEdgeSoftness: { value: this._params.edgeSoftness },
        uAttenuation: { value: this._params.attenuation },
        uDriftSpeed: { value: this._params.driftSpeed },
        uOccluderEnabled: { value: 0 },
        uOccPatternType: { value: 0 },
        uOccPatternCount: { value: 6 },
        uOccPatternAngle: { value: 45 },
        uOccDensity: { value: 0.7 },
        uOccSoftness: { value: 0.08 },
        uOccOffset: { value: new THREE.Vector2(0, 0) },
        uOccSeed: { value: 0 }
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide
    });

    this._rebuildGeometry();
    this._rebuildPlanes();
    this._createHelper();
    this._syncTransform();
  }

  _rebuildGeometry() {
    this._ensureCreatedGuarded();
    if (!this._beamGroup) return;
    if (this._geometry) this._geometry.dispose();
    this._geometry = new THREE.PlaneGeometry(this._params.radius * 2, this._params.length, 1, 48);
    this._geometry.translate(0, this._params.length / 2, 0);
    this._beamGroup.children.forEach(mesh => {
      mesh.geometry = this._geometry;
    });
    this._updateHelperGeometry();
  }

  _rebuildPlanes() {
    this._ensureCreatedGuarded();
    if (!this._beamGroup || !this._geometry || !this._material) return;
    while (this._beamGroup.children.length > 0) {
      this._beamGroup.remove(this._beamGroup.children[0]);
    }

    for (let i = 0; i < this._params.planeCount; i++) {
      const mesh = new THREE.Mesh(this._geometry, this._material);
      mesh.rotation.y = (Math.PI / this._params.planeCount) * i;
      mesh.frustumCulled = false;
      mesh.renderOrder = 30;
      this._beamGroup.add(mesh);
    }
  }

  _createHelper() {
    const lineMat = new THREE.LineBasicMaterial({
      color: 0xffd080,
      transparent: true,
      opacity: 0.55,
      depthTest: true
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, this._params.length, 0], 3));
    this._helperLine = new THREE.Line(geo, lineMat);
    this._helperGroup.add(this._helperLine);

    const markerMat = new THREE.MeshBasicMaterial({
      color: 0xffd080,
      transparent: true,
      opacity: 0.75,
      depthWrite: false
    });
    this._sourceMarker = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 8), markerMat);
    this._endMarker = new THREE.Mesh(new THREE.SphereGeometry(0.08, 16, 8), markerMat.clone());
    this._helperGroup.add(this._sourceMarker, this._endMarker);
    this._updateHelperGeometry();
  }

  _updateHelperGeometry() {
    if (!this._helperLine) return;
    const attr = this._helperLine.geometry.getAttribute('position');
    attr.setXYZ(0, 0, 0, 0);
    attr.setXYZ(1, 0, this._params.length, 0);
    attr.needsUpdate = true;
    if (this._endMarker) this._endMarker.position.set(0, this._params.length, 0);
  }

  _syncTransform() {
    if (!this._group) return;
    this._group.position.copy(this._origin);

    this._direction.subVectors(this._target, this._origin);
    if (this._direction.lengthSq() < 0.0001) {
      this._direction.set(0, -1, 0);
    } else {
      this._direction.normalize();
    }
    this._group.quaternion.setFromUnitVectors(LOCAL_AXIS, this._direction);
  }

  _setUniform(name, value) {
    if (!this._material?.uniforms[name]) return;
    const uniform = this._material.uniforms[name];
    if (uniform.value?.isColor && value?.isColor) {
      uniform.value.copy(value);
    } else {
      uniform.value = value;
    }
  }

  _syncOccluderUniforms() {
    if (!this._material || !this._occluderSystem) {
      this._setUniform('uOccluderEnabled', 0);
      return;
    }

    const oc = this._occluderSystem;
    if (!oc.enabled) {
      this._setUniform('uOccluderEnabled', 0);
      return;
    }

    const params = oc.getParams();
    const patternMap = {
      stripes: 0,
      radial: 1,
      grid: 2,
      noise: 3
    };
    this._setUniform('uOccluderEnabled', 1);
    this._setUniform('uOccPatternType', patternMap[params.patternType] ?? 0);
    this._setUniform('uOccPatternCount', Math.max(1, params.patternCount || 1));
    this._setUniform('uOccPatternAngle', params.patternAngle || 0);
    this._setUniform('uOccDensity', params.noiseDensity ?? 0.7);
    this._setUniform('uOccSoftness', params.noiseEdgeSoftness ?? 0.08);
    this._setUniform('uOccSeed', params.seed || 0);
    const offset = this._material.uniforms.uOccOffset.value;
    offset.set((params.offsetX || 0) * 0.04, (params.offsetY || 0) * 0.04);
  }

  _ensureCreatedGuarded() {
    // Internal setters can run before construction; _ensureCreated() calls these methods.
  }
}
