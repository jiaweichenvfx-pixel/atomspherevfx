/**
 * OrbitController.js — 视图控制器
 * 封装 OrbitControls，提供统一的摄像机交互接口
 * 依赖：Three.js OrbitControls addon
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export class OrbitController {
  /**
   * @param {THREE.PerspectiveCamera} camera
   * @param {HTMLCanvasElement} domElement
   */
  constructor(camera, domElement) {
    this.camera = camera;
    this.domElement = domElement;

    this.controls = new OrbitControls(camera, domElement);

    // 存储"适配全部"的视角状态，供 resetView 使用
    this._defaultFit = {
      position: new THREE.Vector3(8, 5, 10),
      target: new THREE.Vector3(0, 0, 0)
    };

    this._setupControls();
  }

  _setupControls() {
    const c = this.controls;

    // 阻尼
    c.enableDamping = true;
    c.dampingFactor = 0.08;

    // 旋转
    c.enableRotate = true;
    c.rotateSpeed = 0.8;
    // 左键旋转（默认行为）

    // 平移
    c.enablePan = true;
    c.panSpeed = 0.8;
    // 右键平移（默认行为）
    c.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.PAN
    };

    // 缩放
    c.enableZoom = true;
    c.zoomSpeed = 2.5;  // 较快响应用于大场景
    c.minDistance = 0.000001;
    c.maxDistance = 1000000000;  // 保持足够大，避免观察摄像机轨迹时被卡住

    // 其他
    c.screenSpacePanning = true; // 平移时不跟随倾斜
    c.target.set(0, 0, 0);
  }

  /**
   * 每帧更新（阻尼需要）
   */
  update() {
    this.controls.update();
  }

  /**
   * 设置观察目标
   * @param {THREE.Vector3|number[]} target
   */
  setTarget(target) {
    if (Array.isArray(target)) {
      this.controls.target.set(target[0], target[1], target[2]);
    } else {
      this.controls.target.copy(target);
    }
  }

  /**
   * 从指定摄像机同步视角
   * 使用世界坐标，正确处理 FBX 中摄像机的父级变换
   * @param {THREE.Camera} sourceCamera - FBX 中提取的摄像机
   * @param {THREE.Vector3|object} [optionsOrTarget]
   */
  setFromCamera(sourceCamera, optionsOrTarget) {
    const options = optionsOrTarget && optionsOrTarget.isVector3
      ? { lookTarget: optionsOrTarget }
      : (optionsOrTarget || {});

    // 使用世界坐标（FBX 摄像机可能有父级变换）
    sourceCamera.updateWorldMatrix(true, false);
    const worldPos = new THREE.Vector3();
    sourceCamera.getWorldPosition(worldPos);
    this.camera.position.copy(worldPos);

    const worldQuat = new THREE.Quaternion();
    sourceCamera.getWorldQuaternion(worldQuat);
    this.camera.quaternion.copy(worldQuat);

    const lookTarget = options.lookTarget || null;
    if (lookTarget) {
      this.controls.target.copy(lookTarget);
      this.camera.lookAt(lookTarget);
    } else {
      const lookDir = new THREE.Vector3();
      sourceCamera.getWorldDirection(lookDir);
      const distance = options.targetDistance || Math.max(worldPos.length(), 10);
      this.controls.target.copy(worldPos).add(lookDir.multiplyScalar(distance * 0.5));
    }

    if (options.copyProjection !== false) {
      if (sourceCamera.isPerspectiveCamera && this.camera.isPerspectiveCamera) {
        this.camera.fov = sourceCamera.fov;
        this.camera.zoom = sourceCamera.zoom;
        const targetDistance = this.camera.position.distanceTo(this.controls.target);
        const sceneSpan = options.targetDistance || targetDistance || 10;
        const safeFar = Math.max(sourceCamera.far || 0, targetDistance + sceneSpan * 2, sceneSpan * 10, 1000);
        this.camera.near = Math.min(Math.max(sourceCamera.near || 0.01, 0.001), safeFar / 1000);
        this.camera.far = safeFar;
        this.camera.focus = sourceCamera.focus;
        this.camera.filmGauge = sourceCamera.filmGauge;
        this.camera.filmOffset = sourceCamera.filmOffset;
        this.camera.updateProjectionMatrix();
      } else if (sourceCamera.projectionMatrix) {
        this.camera.projectionMatrix.copy(sourceCamera.projectionMatrix);
        if (this.camera.projectionMatrixInverse) {
          this.camera.projectionMatrixInverse.copy(sourceCamera.projectionMatrixInverse);
        }
      }
    }

    // 关键：同步 OrbitControls 内部球坐标状态，否则缩放/旋转行为异常
    this.controls.update();
  }

  /**
   * 重置视角到"适配全部场景元素"的视图
   */
  resetView() {
    this.camera.position.copy(this._defaultFit.position);
    this.controls.target.copy(this._defaultFit.target);
    this.controls.update();
  }

  /**
   * 启用/禁用交互
   * @param {boolean} enabled
   */
  setEnabled(enabled) {
    this.controls.enabled = enabled;
  }

  /**
   * 根据模型包围盒自适应缩放距离和平移速度
   * @param {THREE.Box3} box - 模型的包围盒
   */
  fitToBounds(box) {
    const { center } = this.updateBoundsSettings(box);

    this.controls.target.copy(center);
    this.camera.position.copy(this._defaultFit.position);
    this.camera.lookAt(center);

    this.controls.update();
  }

  /**
   * 只刷新 OrbitControls 的距离、平移速度和重置视角参考，不移动当前相机。
   * @param {THREE.Box3} box
   * @returns {{size:number, center:THREE.Vector3}}
   */
  updateBoundsSettings(box) {
    const size = Math.max(box.getSize(new THREE.Vector3()).length(), 0.000001);
    const center = box.getCenter(new THREE.Vector3());

    this.controls.maxDistance = Math.max(size * 5000, 1000000);
    this.controls.minDistance = Math.max(size * 0.000001, 0.000001);

    if (this.camera.isPerspectiveCamera) {
      this.camera.near = Math.min(this.camera.near, this.controls.minDistance);
      this.camera.far = Math.max(this.camera.far, this.controls.maxDistance * 2);
      this.camera.updateProjectionMatrix();
    }

    this.controls.panSpeed = size * 0.02;

    const dist = size * 1.5;
    this._defaultFit.position.set(
      center.x + dist * 0.6,
      center.y + dist * 0.4,
      center.z + dist * 0.8
    );
    this._defaultFit.target.copy(center);

    return { size, center };
  }

  /**
   * 销毁
   */
  dispose() {
    this.controls.dispose();
  }
}
