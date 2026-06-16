/**
 * MotionBlurSystem.js — final-frame temporal blur
 *
 * Keeps a copy of the previous composited frame and blends it over the
 * current frame. Because it runs after the normal render path, it affects
 * visible light beams, particles, smoke, and frame-sequence exports.
 */

import * as THREE from 'three';

export const MOTION_BLUR_DEFAULTS = {
  enabled: false,
  strength: 0.18,
  maxStrength: 0.65
};

const VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uPreviousFrame;
  uniform float uOpacity;
  varying vec2 vUv;

  void main() {
    vec4 prev = texture2D(uPreviousFrame, vUv);
    gl_FragColor = vec4(prev.rgb, prev.a * uOpacity);
  }
`;

export class MotionBlurSystem {
  constructor(renderer) {
    this._renderer = renderer;
    this._enabled = MOTION_BLUR_DEFAULTS.enabled;
    this._strength = MOTION_BLUR_DEFAULTS.strength;
    this._texture = null;
    this._hasPreviousFrame = false;
    this._width = 0;
    this._height = 0;

    this._scene = new THREE.Scene();
    this._camera = new THREE.Camera();
    this._material = new THREE.ShaderMaterial({
      uniforms: {
        uPreviousFrame: { value: null },
        uOpacity: { value: this._strength }
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NormalBlending
    });
    this._quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this._material);
    this._quad.frustumCulled = false;
    this._scene.add(this._quad);
  }

  apply() {
    if (!this._enabled || this._strength <= 0.001) {
      this.reset();
      return;
    }

    this._ensureTexture();
    if (!this._texture) return;

    if (this._hasPreviousFrame) {
      const oldAutoClear = this._renderer.autoClear;
      this._renderer.autoClear = false;
      this._material.uniforms.uOpacity.value = this._strength;
      this._renderer.render(this._scene, this._camera);
      this._renderer.autoClear = oldAutoClear;
    }

    this._renderer.copyFramebufferToTexture(this._texture);
    this._hasPreviousFrame = true;
  }

  reset() {
    this._hasPreviousFrame = false;
  }

  setSize(width, height) {
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    if (w === this._width && h === this._height && this._texture) return;

    if (this._texture) this._texture.dispose();
    this._texture = new THREE.FramebufferTexture(w, h);
    this._texture.minFilter = THREE.LinearFilter;
    this._texture.magFilter = THREE.LinearFilter;
    this._texture.generateMipmaps = false;
    this._material.uniforms.uPreviousFrame.value = this._texture;
    this._width = w;
    this._height = h;
    this.reset();
  }

  setEnabled(value) {
    const next = !!value;
    if (next === this._enabled) return;
    this._enabled = next;
    this.reset();
  }

  get enabled() { return this._enabled; }

  set strength(value) {
    this._strength = Math.max(0, Math.min(MOTION_BLUR_DEFAULTS.maxStrength, value));
    this._material.uniforms.uOpacity.value = this._strength;
  }

  get strength() { return this._strength; }

  _ensureTexture() {
    const canvas = this._renderer.domElement;
    this.setSize(canvas.width, canvas.height);
  }

  dispose() {
    if (this._texture) this._texture.dispose();
    this._quad.geometry.dispose();
    this._material.dispose();
  }
}
