/**
 * SceneManager.js — 场景管理模块
 * 管理灯光组、动态对象增删、视频背景开关
 * 依赖：无（仅接收 Three.js 场景引用）
 */

import * as THREE from 'three';

export class SceneManager {
  /**
   * @param {THREE.Scene} scene - 主场景引用
   */
  constructor(scene) {
    this.scene = scene;

    // 唯一 ID 计数器
    this._idCounter = 0;

    // 灯光统一管理组
    this.lightsGroup = new THREE.Group();
    this.lightsGroup.name = 'user-lights';
    this.scene.add(this.lightsGroup);

    // 用户添加的动态对象组
    this.objectsGroup = new THREE.Group();
    this.objectsGroup.name = 'user-objects';
    this.scene.add(this.objectsGroup);

    // 视频背景相关
    this.videoElement = document.getElementById('video-background');
    this.videoSource = null;
    this._videoEnabled = false;
    this._onVideoSizeKnown = null;  // 回调：视频尺寸已知时通知外部

    // 当前选中的对象
    this.selectedObject = null;
    this._onObjectSelected = null;   // 回调
    this._onObjectDeselected = null;
  }

  _nextId() { return ++this._idCounter; }

  // ── 灯光操作 ────────────────────────────────────

  /**
   * 创建光源发光指示 Sprite（始终朝向相机，任何距离可见）
   */
  _createLightIndicator(colorHex, scale) {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    // 径向渐变光点
    const gradient = ctx.createRadialGradient(size/2, size/2, 0, size/2, size/2, size/2);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.15, colorHex);
    gradient.addColorStop(0.4, 'rgba(255,200,100,0.6)');
    gradient.addColorStop(0.7, 'rgba(255,100,50,0.1)');
    gradient.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({
      map: texture,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true
    });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(scale, scale, 1);
    sprite.userData._afxIndicator = true;
    return sprite;
  }

  /**
   * 添加点光源
   * @param {object} [options]
   * @returns {THREE.PointLight}
   */
  addPointLight(options = {}) {
    const color = options.color || 0xffeedd;
    const intensity = options.intensity ?? 20;
    const distance = options.distance ?? 0;  // 0 = 自动计算
    const position = options.position || [0, 5, 0];
    const indicatorScale = options.indicatorScale || 1.0;

    const colorObj = new THREE.Color(color);
    const light = new THREE.PointLight(colorObj, intensity, distance);
    light.position.set(position[0], position[1], position[2]);
    light.castShadow = true;
    light.shadow.mapSize.set(1024, 1024);          // 更高分辨率以保留噪点细节
    light.shadow.camera.near = 0.1;
    light.shadow.camera.far = distance || 150;
    light.shadow.bias = -0.0005;                   // 减少阴影痤疮

    // 元数据
    const id = this._nextId();
    light.userData._afxId = id;
    light.userData._afxType = 'pointLight';
    light.userData._afxName = options.name || `点光源 ${id}`;
    light.userData._afxColor = color;

    this.lightsGroup.add(light);

    // 发光 Sprite 指示器（始终可见，始终朝向相机）
    const indicator = this._createLightIndicator('#' + colorObj.getHexString(), indicatorScale);
    light.add(indicator);

    return light;
  }

  /**
   * 添加方向光
   * @param {object} [options]
   * @returns {THREE.DirectionalLight}
   */
  addDirectionalLight(options = {}) {
    const color = options.color || 0xffffff;
    const intensity = options.intensity ?? 3;
    const position = options.position || [5, 10, 5];

    const light = new THREE.DirectionalLight(color, intensity);
    light.position.set(position[0], position[1], position[2]);
    light.castShadow = true;
    light.shadow.mapSize.set(1024, 1024);
    light.shadow.camera.near = 0.5;
    light.shadow.camera.far = 50;
    light.shadow.camera.left = -15;
    light.shadow.camera.right = 15;
    light.shadow.camera.top = 15;
    light.shadow.camera.bottom = -15;

    this.lightsGroup.add(light);
    return light;
  }

  // ── 对象选择与列表 ──────────────────────────────

  /**
   * 获取所有用户对象（灯光、几何体）
   * @returns {Array<{id: number, type: string, name: string, object: THREE.Object3D}>}
   */
  getAllUserObjects() {
    const list = [];
    this.lightsGroup.children.forEach(light => {
      if (light.userData._afxId) {
        list.push({
          id: light.userData._afxId,
          type: light.userData._afxType,
          name: light.userData._afxName,
          object: light,
          icon: '💡'
        });
      }
    });
    this.objectsGroup.children.forEach(obj => {
      if (obj.userData._afxId) {
        list.push({
          id: obj.userData._afxId,
          type: obj.userData._afxType,
          name: obj.userData._afxName,
          object: obj,
          icon: obj.userData._afxType === 'cube' ? '📦'
              : obj.userData._afxType === 'occluder' ? '🪟'
              : '🔵'
        });
      }
    });
    return list;
  }

  /**
   * 获取所有射线可检测的指示器
   */
  getSelectableIndicators() {
    const indicators = [];
    this.lightsGroup.children.forEach(light => {
      light.children.forEach(child => {
        if (child.userData._afxIndicator) indicators.push(child);
      });
    });
    return indicators;
  }

  /**
   * 根据指示球找到所属光源
   */
  getLightByIndicator(indicatorMesh) {
    return indicatorMesh.parent;
  }

  /**
   * 选中/取消选中对象
   */
  selectObject(obj) {
    if (this.selectedObject === obj) return;

    // 取消旧选中
    if (this.selectedObject) {
      this._highlightObject(this.selectedObject, false);
    }

    this.selectedObject = obj;

    if (obj) {
      this._highlightObject(obj, true);
      if (this._onObjectSelected) this._onObjectSelected(obj);
    } else {
      if (this._onObjectDeselected) this._onObjectDeselected();
    }
  }

  _highlightObject(obj, active) {
    // 光源：高亮指示器 Sprite
    if (obj.isLight) {
      obj.children.forEach(child => {
        if (child.userData._afxIndicator && child.material) {
          if (child.material.isSpriteMaterial) {
            // Sprite 无 emissive，用 color 叠加
            child.material.color.set(active ? 0xff8800 : 0xffffff);
          } else {
            child.material.emissive = child.material.emissive || new THREE.Color();
            child.material.emissive.set(active ? 0x444444 : 0x000000);
          }
        }
      });
    }
    // 几何体：高亮边框（可选，后续加 OutlineEffect）
  }

  onObjectSelected(cb) { this._onObjectSelected = cb; }
  onObjectDeselected(cb) { this._onObjectDeselected = cb; }

  /** @deprecated 使用 selectObject */
  get selectedLight() { return this.selectedObject?.isLight ? this.selectedObject : null; }

  /** @deprecated 使用 selectObject */
  selectLight(light) { this.selectObject(light); }
  getLightIndicators() { return this.getSelectableIndicators(); }

  // ── 删除与隐藏 ────────────────────────────────────

  /**
   * 根据 ID 查找对象（跨灯光组和几何体组）
   * @param {number} id
   * @returns {THREE.Object3D|null}
   */
  _findObjectById(id) {
    for (const child of this.lightsGroup.children) {
      if (child.userData._afxId === id) return child;
    }
    for (const child of this.objectsGroup.children) {
      if (child.userData._afxId === id) return child;
    }
    return null;
  }

  /**
   * 根据 ID 删除对象
   * @param {number} id
   * @returns {boolean} 是否成功删除
   */
  removeObjectById(id) {
    const obj = this._findObjectById(id);
    if (!obj) return false;

    // 如果删除的是当前选中对象，先取消选中
    if (this.selectedObject === obj) {
      this.selectObject(null);
    }

    // 从父组移除
    if (obj.parent) {
      obj.parent.remove(obj);
    }

    // 释放资源
    if (obj.isLight) {
      this.disposeLight(obj);
    } else {
      this.disposeObject(obj);
    }

    return true;
  }

  /**
   * 切换对象可见性
   * @param {number} id
   * @returns {boolean|null} 切换后的可见状态，未找到返回 null
   */
  toggleObjectVisibility(id) {
    const obj = this._findObjectById(id);
    if (!obj) return null;

    obj.visible = !obj.visible;
    return obj.visible;
  }

  /**
   * 总开关：一次性启用/禁用所有用户灯光
   * @returns {boolean} 当前是否启用
   */
  toggleAllLights() {
    this.lightsGroup.visible = !this.lightsGroup.visible;
    return this.lightsGroup.visible;
  }

  // ── 物体操作 ────────────────────────────────────

  /**
   * 添加立方体（用于测试场景）
   * @param {object} [options]
   * @returns {THREE.Mesh}
   */
  addCube(options = {}) {
    const size = options.size || 1;
    const color = options.color || 0x4a9eff;
    const position = options.position || [0, size / 2, 0];

    const geometry = new THREE.BoxGeometry(size, size, size);
    const material = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.4,
      metalness: 0.1
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(position[0], position[1], position[2]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const id = this._nextId();
    mesh.userData._afxId = id;
    mesh.userData._afxType = 'cube';
    mesh.userData._afxName = options.name || `立方体 ${id}`;

    this.objectsGroup.add(mesh);
    return mesh;
  }

  /**
   * 添加球体（用于测试场景）
   * @param {object} [options]
   * @returns {THREE.Mesh}
   */
  addSphere(options = {}) {
    const radius = options.radius || 0.5;
    const color = options.color || 0xff6b6b;
    const position = options.position || [2, radius, 0];

    const geometry = new THREE.SphereGeometry(radius, 32, 32);
    const material = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.3,
      metalness: 0.2
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(position[0], position[1], position[2]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const id = this._nextId();
    mesh.userData._afxId = id;
    mesh.userData._afxType = 'sphere';
    mesh.userData._afxName = options.name || `球体 ${id}`;

    this.objectsGroup.add(mesh);
    return mesh;
  }

  // ── 视频背景 ────────────────────────────────────

  /**
   * 注册视频尺寸回调（用于外部 resize renderer）
   */
  onVideoSizeKnown(cb) { this._onVideoSizeKnown = cb; }

  /**
   * 获取视频是否启用
   */
  get videoEnabled() { return this._videoEnabled; }

  /**
   * 切换视频背景显示（不传参则切换开关）
   * @param {string} [videoUrl] - 视频文件 URL，不传则切换 on/off
   */
  toggleVideoBackground(videoUrl) {
    if (videoUrl) {
      this.videoElement.src = videoUrl;
      this.videoElement.classList.add('active');
      this._videoEnabled = true;
      this.videoElement.play().catch(e => {
        console.warn('视频自动播放被阻止:', e.message);
      });
    } else if (this._videoEnabled) {
      // 关闭
      this.videoElement.pause();
      this.videoElement.classList.remove('active');
      this._videoEnabled = false;
      if (this._onVideoSizeKnown) this._onVideoSizeKnown(null);
    } else {
      // 当前关闭，重新打开（需要已有 src）
      if (this.videoElement.src && this.videoElement.src !== window.location.href) {
        this.videoElement.classList.add('active');
        this._videoEnabled = true;
        this.videoElement.play().catch(e => {});
        // 重新通知尺寸
        this._notifyVideoSize();
      }
    }
  }

  /** 通知外部视频尺寸 */
  _notifyVideoSize() {
    const vw = this.videoElement.videoWidth;
    const vh = this.videoElement.videoHeight;
    if (vw && vh && this._onVideoSizeKnown) {
      this._onVideoSizeKnown({ width: vw, height: vh });
    }
  }

  /**
   * 设置视频背景文件
   * @param {File} file - 用户选择的视频文件
   */
  setVideoBackgroundFile(file) {
    const url = URL.createObjectURL(file);
    if (this.videoSource) {
      URL.revokeObjectURL(this.videoSource);
    }
    this.videoSource = url;

    // 监听 metadata 获取视频尺寸
    const onMeta = () => {
      this._notifyVideoSize();
      this.videoElement.removeEventListener('loadedmetadata', onMeta);
    };
    this.videoElement.addEventListener('loadedmetadata', onMeta);

    this.toggleVideoBackground(url);
  }

  // ── 清理 ────────────────────────────────────────

  /**
   * 清理所有用户添加的灯光
   */
  clearLights() {
    while (this.lightsGroup.children.length > 0) {
      const light = this.lightsGroup.children[0];
      this.disposeLight(light);
      this.lightsGroup.remove(light);
    }
  }

  /**
   * 清理所有用户添加的物体
   */
  clearObjects() {
    while (this.objectsGroup.children.length > 0) {
      const obj = this.objectsGroup.children[0];
      this.disposeObject(obj);
      this.objectsGroup.remove(obj);
    }
  }

  disposeLight(light) {
    if (light.dispose) light.dispose();
    // 清理子对象（如光源可视化球）
    while (light.children.length > 0) {
      const child = light.children[0];
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
      light.remove(child);
    }
  }

  disposeObject(obj) {
    obj.traverse(child => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach(m => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    });
  }

  /**
   * 销毁场景管理器
   */
  dispose() {
    this.clearLights();
    this.clearObjects();
    if (this.videoSource) {
      URL.revokeObjectURL(this.videoSource);
    }
  }
}
