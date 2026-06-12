/**
 * FBXHandler.js — FBX 文件处理器
 * 负责 FBX 加载、摄像机提取、动画信息解析
 * 依赖：Three.js FBXLoader addon
 */

import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

export class FBXHandler {
  /**
   * @param {THREE.Scene} scene
   * @param {THREE.WebGLRenderer} renderer
   */
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;

    this.loader = new FBXLoader();
    this.currentModel = null;
    this.cameras = [];          // 提取的摄像机列表
    this.animations = [];       // 动画片段列表
    this.mixer = null;          // AnimationMixer
    this.actions = [];          // AnimationAction 列表
    this.activeAnimationIndex = -1;
    this.activeCameraIndex = -1;
    this.animationPlaying = false;
    this.cameraPathLine = null;
    this._onCamerasChanged = null;  // 回调：摄像机列表变更时通知 UIHandler
    this._onStatusUpdate = null;    // 回调：状态更新通知 UIHandler
    this._onModelLoaded = null;     // 回调：模型加载完成
  }

  /**
   * 加载 FBX 文件
   * @param {File} file - 用户选择的 .fbx 文件
   * @returns {Promise<THREE.Group>}
   */
  async loadFBX(file) {
    const url = URL.createObjectURL(file);

    this._notifyStatus('正在解析 FBX...');

    // 清理旧模型
    this._removeCurrentModel();

    try {
      const arrayBuffer = await file.arrayBuffer();
      const group = await this._parseWithTimeout(arrayBuffer, 30000);
      // parseWithTimeout resolves to null on timeout — error already handled internally

      if (!group) return null;

      this.currentModel = group;

      // 遍历模型，处理材质和阴影，关闭 FBX 自带灯光
      group.traverse(child => {
        if (child.isLight) {
          // 关闭 FBX 内嵌灯光，用户通过 SceneManager 自行添加
          child.intensity = 0;
          child.visible = false;
        }

        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;

          // 处理材质丢失
          if (child.material) {
            const materials = Array.isArray(child.material)
              ? child.material
              : [child.material];

            materials.forEach(mat => {
              if (mat.isMeshStandardMaterial && !mat.map) {
                // 没有纹理，使用默认灰色材质
                mat.color = mat.color || new THREE.Color(0x888888);
                mat.roughness = mat.roughness ?? 0.6;
                mat.metalness = mat.metalness ?? 0.1;
              }
              mat.needsUpdate = true;
            });
          }
        }
      });

      // 居中并归一化模型大小（使灯光、距离都工作在合理尺度）
      const box = new THREE.Box3().setFromObject(group);
      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3()).length();

      const targetSize = 10;  // 归一化对角线 ~10 单位
      if (size > 0.01) {
        const scale = targetSize / size;
        group.scale.setScalar(scale);
        // 缩放后重新居中：将原中心映射到原点
        group.position.set(
          -center.x * scale,
          -center.y * scale,
          -center.z * scale
        );
      } else {
        // 极小模型，仅居中
        group.position.copy(center).multiplyScalar(-1);
      }

      this.scene.add(group);

      // 提取动画
      this._extractAnimations(group);

      // 提取摄像机（依赖 animations 判断哪些摄像机会动）
      this._extractCameras(group);
      this._buildCameraPath();

      this._notifyStatus(`已加载: ${file.name} (${this.cameras.length} 个摄像机, ${this.animations.length} 个动画)`);

      // 通知模型加载完成
      if (this._onModelLoaded) this._onModelLoaded(group);

    } catch (err) {
      console.error('FBX 加载失败:', err);
      this._notifyStatus(`加载失败: ${err.message}`);
      throw err;
    } finally {
      URL.revokeObjectURL(url);
    }

    return this.currentModel;
  }

  /**
   * 带超时的 FBX 解析，防止损坏文件导致无限挂起
   * @param {ArrayBuffer} buffer
   * @param {number} timeoutMs
   * @returns {Promise<THREE.Group|null>}
   */
  _parseWithTimeout(buffer, timeoutMs) {
    return new Promise((resolve) => {
      try {
        // FBXLoader 覆盖了 parse(FBXBuffer, path)，是同步方法
        // 不能用 callback 形式（Loader 基类的 callback 签名被覆盖了）
        const group = this.loader.parse(buffer, '');
        resolve(group);
      } catch (err) {
        console.error('FBX 解析错误:', err);
        this._notifyStatus(`解析失败: ${err.message || err}`);
        resolve(null);
      }
    });
  }

  /**
   * 从模型中提取摄像机
   */
  _extractCameras(group) {
    this.cameras = [];

    group.traverse(child => {
      if (child.isCamera) {
        const worldPos = new THREE.Vector3();
        child.getWorldPosition(worldPos);
        const animated = this._objectOrAncestorsHaveAnimation(child);

        this.cameras.push({
          name: child.name || `摄像机 ${this.cameras.length + 1}`,
          type: child.isPerspectiveCamera ? '透视' : '正交',
          camera: child,
          animated,
          active: false,
          followAnimation: false,
          fov: child.isPerspectiveCamera ? child.fov : null,
          near: child.near,
          far: child.far,
          worldPos: worldPos.toArray().map(v => +v.toFixed(1))
        });
      }
    });

    // 通知 UIHandler
    if (this._onCamerasChanged) {
      this._onCamerasChanged(this.cameras);
    }
  }

  /**
   * 提取动画片段
   */
  _extractAnimations(group) {
    this.animations = group.animations || [];
    this.actions = [];
    this.activeAnimationIndex = -1;

    if (this.animations.length > 0 && this.currentModel) {
      this.mixer = new THREE.AnimationMixer(this.currentModel);
      this.actions = this.animations.map(clip => this.mixer.clipAction(clip));
      this.playAnimation(this._selectDefaultAnimationIndex());
      this.setAnimationPlaying(false);
      this.setAnimationTime(0);
    }
  }

  /**
   * 播放指定动画。FBX 的多个 clip 通常是多个 Take，不能全部同时播放。
   * @param {number} index
   * @returns {THREE.AnimationClip|null}
   */
  playAnimation(index = 0) {
    if (!this.mixer || index < 0 || index >= this.animations.length) {
      return null;
    }

    this.mixer.stopAllAction();
    const action = this.actions[index] || this.mixer.clipAction(this.animations[index]);
    action.reset();
    action.enabled = true;
    action.setEffectiveWeight(1);
    action.setEffectiveTimeScale(1);
    action.play();
    this.activeAnimationIndex = index;
    return this.animations[index];
  }

  /**
   * 设置 FBX 动画播放/暂停。暂停时仍保持当前帧，便于预览相机。
   * @param {boolean} playing
   */
  setAnimationPlaying(playing) {
    this.animationPlaying = !!playing;
  }

  /**
   * 停止并回到第 0 帧。
   */
  stopAnimation() {
    this.animationPlaying = false;
    this.setAnimationTime(0);
  }

  /**
   * 跳转 FBX 动画时间。
   * @param {number} seconds
   */
  setAnimationTime(seconds) {
    if (!this.mixer || this.activeAnimationIndex < 0) return;
    const clip = this.getActiveAnimationClip();
    const duration = clip?.duration || 0;
    const time = duration > 0
      ? Math.max(0, Math.min(seconds, duration))
      : Math.max(0, seconds);
    this.mixer.setTime(time);
  }

  /**
   * 获取第一个带动画轨道的 FBX 摄像机索引。
   * @returns {number}
   */
  getFirstAnimatedCameraIndex() {
    return this.cameras.findIndex(camInfo => camInfo.animated);
  }

  /**
   * 获取当前激活的摄像机信息。
   * @returns {object|null}
   */
  getActiveCameraInfo() {
    if (this.activeCameraIndex < 0 || this.activeCameraIndex >= this.cameras.length) {
      return null;
    }
    return this.cameras[this.activeCameraIndex];
  }

  /**
   * 获取当前播放的动画片段。
   * @returns {THREE.AnimationClip|null}
   */
  getActiveAnimationClip() {
    if (this.activeAnimationIndex < 0 || this.activeAnimationIndex >= this.animations.length) {
      return null;
    }
    return this.animations[this.activeAnimationIndex];
  }

  /**
   * @returns {number}
   */
  getActiveAnimationDuration() {
    return this.getActiveAnimationClip()?.duration || 0;
  }

  /**
   * 是否需要把当前 FBX 摄像机动画同步到主相机。
   * @returns {boolean}
   */
  shouldFollowActiveCamera() {
    const camInfo = this.getActiveCameraInfo();
    return !!(camInfo && camInfo.followAnimation);
  }

  setActiveCameraViewFollowing(following) {
    const camInfo = this.getActiveCameraInfo();
    if (camInfo) {
      camInfo.followAnimation = !!following;
    }
  }

  releaseCameraView() {
    this.setActiveCameraViewFollowing(false);
  }

  /**
   * Orbit/LookAt 类 FBX 经常只烘了相机位置，约束朝向没有完整进入 quaternion。
   * 这种情况下预览应强制看向模型中心，否则环绕时模型会跑出画面。
   * @returns {boolean}
   */
  shouldAimActiveCameraAtModel() {
    const clip = this.getActiveAnimationClip();
    if (!clip) return false;

    const name = (clip.name || '').toLowerCase();
    if (name.includes('orbit') || name.includes('lookat') || name.includes('look_at') || name.includes('target')) {
      return true;
    }

    return false;
  }

  /**
   * 解除 FBX 摄像机跟随。
   */
  clearActiveCamera() {
    this.activeCameraIndex = -1;
    this.cameras.forEach(c => {
      c.active = false;
      c.followAnimation = false;
    });
  }

  /**
   * 获取当前模型的包围盒中心（用于摄像机 lookAt 计算）
   * @returns {THREE.Vector3|null}
   */
  getModelCenter() {
    if (!this.currentModel) return null;
    const box = new THREE.Box3().setFromObject(this.currentModel);
    return box.getCenter(new THREE.Vector3());
  }

  /**
   * 获取当前模型的包围盒对角线长度（用于缩放指示器等）
   * @returns {number} 对角线长度，无模型时返回 0
   */
  getModelSize() {
    if (!this.currentModel) return 0;
    const box = new THREE.Box3().setFromObject(this.currentModel);
    return box.getSize(new THREE.Vector3()).length();
  }

  /**
   * 切换模型线框模式
   * @param {boolean} [enabled] - 不传则 toggle；传 true/false 则直接设置
   * @returns {boolean} 切换后的状态
   */
  toggleWireframe(enabled) {
    if (!this.currentModel) return false;

    const target = enabled !== undefined ? enabled : !this._wireframeEnabled;
    this._wireframeEnabled = target;

    this.currentModel.traverse(child => {
      if (child.isMesh && child.material) {
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach(mat => {
          if (mat.wireframe !== undefined) {
            mat.wireframe = target;
            mat.needsUpdate = true;
          }
        });
      }
    });

    return target;
  }

  /**
   * 切换到指定摄像机视角
   * @param {number} index - 摄像机列表索引
   * @returns {object|null} 摄像机信息
   */
  switchToCamera(index, options = {}) {
    if (index < 0 || index >= this.cameras.length) return null;

    const camInfo = this.cameras[index];
    // 标记当前激活的摄像机
    const followAnimation = options.followAnimation ?? camInfo.animated;
    this.activeCameraIndex = index;
    this.cameras.forEach((c, i) => {
      c.active = (i === index);
      c.followAnimation = (i === index) && followAnimation;
    });
    return camInfo;
  }

  /**
   * 更新动画（在 animate 循环中调用）
   * @param {number} deltaTime
   */
  updateAnimation(deltaTime) {
    if (this.mixer && this.animationPlaying) {
      this.mixer.update(deltaTime);
    }
  }

  getActiveCameraWorldPosition(target = new THREE.Vector3()) {
    const camInfo = this.getActiveCameraInfo();
    if (!camInfo?.camera) return null;
    camInfo.camera.updateWorldMatrix(true, false);
    camInfo.camera.getWorldPosition(target);
    return target;
  }

  getActiveCameraEffectPoint(target = new THREE.Vector3()) {
    const camInfo = this.getActiveCameraInfo();
    if (!camInfo?.camera) return null;

    camInfo.camera.updateWorldMatrix(true, false);
    camInfo.camera.getWorldPosition(target);

    const direction = new THREE.Vector3();
    const modelCenter = this.shouldAimActiveCameraAtModel()
      ? this.getModelCenter()
      : null;
    if (modelCenter) {
      direction.subVectors(modelCenter, target);
      if (direction.lengthSq() < 1e-8) {
        camInfo.camera.getWorldDirection(direction);
      } else {
        direction.normalize();
      }
    } else {
      camInfo.camera.getWorldDirection(direction);
    }

    const offset = Math.max(1.5, Math.min(this.getModelSize() * 0.15, 5));
    target.add(direction.multiplyScalar(offset));
    return target;
  }

  getCameraPathBounds(target = new THREE.Box3()) {
    if (!this.cameraPathLine?.geometry) return null;
    const geometry = this.cameraPathLine.geometry;
    if (!geometry.boundingBox) {
      geometry.computeBoundingBox();
    }
    if (!geometry.boundingBox) return null;
    this.cameraPathLine.updateWorldMatrix(true, false);
    target.copy(geometry.boundingBox).applyMatrix4(this.cameraPathLine.matrixWorld);
    return target;
  }

  setCameraPathVisible(visible) {
    if (this.cameraPathLine) {
      this.cameraPathLine.visible = !!visible;
    }
  }

  /**
   * 判断物体或其父级是否被当前 FBX 动画轨道驱动。
   * 摄像机常被包在父空物体下，父级动画也会改变摄像机世界矩阵。
   * @param {THREE.Object3D} object
   * @returns {boolean}
   */
  _objectOrAncestorsHaveAnimation(object) {
    if (!object || this.animations.length === 0) return false;

    const names = new Set();
    let node = object;
    while (node && node !== this.currentModel?.parent) {
      if (node.name) {
        names.add(node.name);
        names.add(THREE.PropertyBinding.sanitizeNodeName(node.name));
      }
      if (node === this.currentModel) break;
      node = node.parent;
    }

    return this.animations.some(clip => clip.tracks.some(track => {
      try {
        const parsed = THREE.PropertyBinding.parseTrackName(track.name);
        return names.has(parsed.nodeName);
      } catch (err) {
        const nodeName = track.name.split('.')[0];
        return names.has(nodeName);
      }
    }));
  }

  /**
   * 选择默认动画：优先选择真正带相机位置变化的 baked/orbit clip。
   * 很多 FBX 会同时包含多个 Take，排在第一的可能只是原地旋转。
   * @returns {number}
   */
  _selectDefaultAnimationIndex() {
    if (this.animations.length === 0) return -1;

    let bestIndex = 0;
    let bestScore = -Infinity;

    this.animations.forEach((clip, index) => {
      const name = (clip.name || '').toLowerCase();
      let score = 0;

      if (name.includes('baked')) score += 60;
      if (name.includes('orbit')) score += 40;
      if (name.includes('camera')) score += 10;

      const positionTracks = clip.tracks.filter(track => track.name.endsWith('.position'));
      positionTracks.forEach(track => {
        const movement = this._getVectorTrackRange(track);
        if (movement > 0.001) {
          score += 120 + Math.min(movement * 0.01, 50);
        }
      });

      // Prefer clips with dense keyframes over placeholder two-key clips.
      const maxKeyCount = clip.tracks.reduce((max, track) => Math.max(max, track.times?.length || 0), 0);
      score += Math.min(maxKeyCount, 120) * 0.1;

      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    });

    return bestIndex;
  }

  /**
   * @param {THREE.VectorKeyframeTrack} track
   * @returns {number}
   */
  _getVectorTrackRange(track) {
    if (!track || !track.values || track.values.length < 6) return 0;

    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < track.values.length; i += 3) {
      const x = track.values[i];
      const y = track.values[i + 1];
      const z = track.values[i + 2];
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }

    return Math.sqrt(
      (maxX - minX) ** 2 +
      (maxY - minY) ** 2 +
      (maxZ - minZ) ** 2
    );
  }

  _buildCameraPath() {
    this._disposeCameraPath();
    const camInfo = this.getActiveCameraInfo() || this.cameras[this.getFirstAnimatedCameraIndex()];
    const clip = this.getActiveAnimationClip();
    if (!this.currentModel || !camInfo?.camera || !clip || clip.duration <= 0) return;

    const sampleCount = Math.max(32, Math.min(240, Math.ceil(clip.duration * 30)));
    const points = [];
    const previousTime = this.mixer?.time || 0;

    const sampleMixer = new THREE.AnimationMixer(this.currentModel);
    sampleMixer.clipAction(clip).play();
    for (let i = 0; i <= sampleCount; i++) {
      const t = clip.duration * (i / sampleCount);
      sampleMixer.setTime(t);
      this.currentModel.updateMatrixWorld(true);
      const p = new THREE.Vector3();
      camInfo.camera.getWorldPosition(p);
      points.push(p);
    }
    sampleMixer.stopAllAction();

    if (this.mixer) {
      this.mixer.setTime(previousTime);
      this.currentModel.updateMatrixWorld(true);
    }

    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color: 0x4a9eff,
      transparent: true,
      opacity: 0.85,
      depthTest: false
    });
    this.cameraPathLine = new THREE.Line(geometry, material);
    this.cameraPathLine.name = 'fbx-camera-path';
    this.cameraPathLine.renderOrder = 2000;
    this.scene.add(this.cameraPathLine);
  }

  _disposeCameraPath() {
    if (!this.cameraPathLine) return;
    if (this.cameraPathLine.parent) {
      this.cameraPathLine.parent.remove(this.cameraPathLine);
    }
    if (this.cameraPathLine.geometry) this.cameraPathLine.geometry.dispose();
    if (this.cameraPathLine.material) this.cameraPathLine.material.dispose();
    this.cameraPathLine = null;
  }

  /**
   * 注册摄像机变更回调
   * @param {Function} callback
   */
  onCamerasChanged(callback) {
    this._onCamerasChanged = callback;
  }

  /**
   * 注册状态更新回调
   * @param {Function} callback
   */
  onStatusUpdate(callback) {
    this._onStatusUpdate = callback;
  }

  onModelLoaded(callback) {
    this._onModelLoaded = callback;
  }

  _notifyStatus(message) {
    if (this._onStatusUpdate) {
      this._onStatusUpdate(message);
    }
  }

  /**
   * 移除当前模型并清理资源
   */
  _removeCurrentModel() {
    if (this.currentModel) {
      // 停止动画
      if (this.mixer) {
        this.mixer.stopAllAction();
        this.mixer = null;
      }
      this.animations = [];
      this.actions = [];
      this.activeAnimationIndex = -1;
      this.activeCameraIndex = -1;
      this.animationPlaying = false;
      this._disposeCameraPath();

      // 清理资源
      this.currentModel.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          const materials = Array.isArray(child.material)
            ? child.material
            : [child.material];
          materials.forEach(m => m.dispose());
        }
      });

      this.scene.remove(this.currentModel);
      this.currentModel = null;
    }

    this.cameras = [];
    if (this._onCamerasChanged) {
      this._onCamerasChanged([]);
    }
  }

  /**
   * 销毁
   */
  dispose() {
    this._removeCurrentModel();
    if (this.loader) {
      this.loader = null;
    }
  }
}
