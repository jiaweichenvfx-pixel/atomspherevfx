/**
 * UIHandler.js — UI 事件桥梁
 * 绑定按钮事件、管理摄像机列表、更新状态栏
 * 依赖：DOM 元素，接收各模块引用
 */

import * as THREE from 'three';

export class UIHandler {
  /**
   * @param {object} modules - 注入的模块引用
   * @param {import('./SceneManager.js').SceneManager} modules.sceneManager
   * @param {import('./OrbitController.js').OrbitController} modules.orbitController
   * @param {import('./FBXHandler.js').FBXHandler} modules.fbxHandler
   * @param {import('./ParticleSystem.js').ParticleSystem} modules.particleSystem
   * @param {THREE.WebGLRenderer} modules.renderer
   * @param {THREE.PerspectiveCamera} modules.camera
   * @param {THREE.Scene} modules.scene
   */
  constructor({ sceneManager, orbitController, fbxHandler, particleSystem, smokeSystem, godRaysSystem, lightBeamSystem, occluderSystem, timelineSystem, exportHandler, renderer, camera, scene }) {
    this.sceneManager = sceneManager;
    this.orbitController = orbitController;
    this.fbxHandler = fbxHandler;
    this.particleSystem = particleSystem;
    this.smokeSystem = smokeSystem;
    this.godRaysSystem = godRaysSystem;
    this.lightBeamSystem = lightBeamSystem;
    this.occluderSystem = occluderSystem;
    this.timelineSystem = timelineSystem;
    this.exportHandler = exportHandler;
    this.renderer = renderer;
    this.camera = camera;
    this.scene = scene;

    // 在各模块就绪前挂起 DOMContentLoaded
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this._init());
    } else {
      this._init();
    }

    // 注册 FBXHandler 回调
    this.fbxHandler.onCamerasChanged((cameras) => this._renderCameraList(cameras));
    this.fbxHandler.onStatusUpdate((msg) => this.updateStatus(msg));
    this.fbxHandler.onModelLoaded(() => this._onModelLoaded());
  }

  _init() {
    if (this._initialized) return;
    this._initialized = true;

    this._bindButtons();
    this._bindPanelToggles();
    this._bindTabSwitching();
    this._bindLightControls();
    this._bindParticleControls();
    this._bindSmokeControls();
    this._bindGodRaysControls();
    this._bindOccluderControls();
    this._toggleNoiseControls(false);  // 默认条纹模式，隐藏噪点专属控件
    this._bindObjectsPanel();
    this._bindBackgroundControl();
    this._bindGridToggle();
    this._bindVideoToggle();
    this._bindExportButtons();

    // 时间线系统
    if (this.timelineSystem) {
      this._hookSliderRecording();
      this._bindTimelineControls();
      this._registerTimelineCallbacks();
    }

    // 使 Canvas 可交互
    document.getElementById('canvas-container').classList.add('interactive');

    // 初始化帧号 FPS
    const fpsInput = document.getElementById('timeline-fps');
    this._fps = fpsInput ? Math.max(1, parseInt(fpsInput.value) || 30) : 30;

    // 初始渲染关键帧标记
    this._renderKeyframeMarkers();

    // 初始化光源面板为隐藏
    this._setLightPanelEnabled(false);

    // 监听对象变化，刷新列表
    this.sceneManager.onObjectSelected((obj) => {
      this._renderObjectsList();
      if (obj?.isLight) {
        this._onLightSelected(obj);
      } else {
        this._onLightDeselected();
      }
    });
    this.sceneManager.onObjectDeselected(() => {
      this._renderObjectsList();
      this._onLightDeselected();
    });
  }

  // ── 按钮事件绑定 ────────────────────────────────

  _bindButtons() {
    // FBX 导入
    const btnImport = document.getElementById('btn-import-fbx');
    const fileInput = document.getElementById('fbx-file-input');
    const loadingOverlay = document.getElementById('loading-overlay');
    const loadingText = document.getElementById('loading-text');

    btnImport.addEventListener('click', () => {
      fileInput.click();
    });

    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      // 显示加载蒙层
      loadingOverlay.classList.remove('hidden');
      loadingText.textContent = '正在加载 FBX...';

      try {
        await this.fbxHandler.loadFBX(file);
        if (this.timelineSystem) {
          this.timelineSystem.pause();
          const playBtn = document.getElementById('timeline-play');
          if (playBtn) playBtn.textContent = '▶';
        }
        this.fbxHandler.setAnimationPlaying(false);

        // 加载成功后优先启用 FBX 内置的动画摄像机；没有则回退到包围盒视角
        const animatedCameraIndex = this.fbxHandler.getFirstAnimatedCameraIndex();
        if (animatedCameraIndex >= 0) {
          const result = this.fbxHandler.switchToCamera(animatedCameraIndex, { followAnimation: true });
          if (result) {
            const modelCenter = this.fbxHandler.shouldAimActiveCameraAtModel()
              ? this.fbxHandler.getModelCenter()
              : null;
            this.orbitController.setFromCamera(result.camera, {
              copyProjection: true,
              lookTarget: modelCenter,
              targetDistance: Math.max(this.fbxHandler.getModelSize(), 10)
            });
            this._renderCameraList(this.fbxHandler.cameras);
            this.updateStatus(`已加载: ${file.name} — 正在跟随动画摄像机 ${result.name}`);
          }
        } else if (this.fbxHandler.currentModel) {
          const box = new THREE.Box3().setFromObject(this.fbxHandler.currentModel);
          this.orbitController.fitToBounds(box);
        }

      } catch (err) {
        console.error('FBX 导入失败:', err);
        this.updateStatus(`导入失败: ${err.message}`);
      } finally {
        loadingOverlay.classList.add('hidden');
        // 重置 file input，允许重复导入同一文件
        fileInput.value = '';
      }
    });

    // 添加点光源
    document.getElementById('btn-add-light').addEventListener('click', () => {
      const modelCenter = this.fbxHandler.getModelCenter();
      const modelSize = this.fbxHandler.getModelSize();

      let posX, posY, posZ;
      if (modelCenter && modelSize > 0) {
        // 有模型：放置在模型上方，确保不受遮挡
        posX = modelCenter.x;
        posY = modelCenter.y + modelSize * 0.7;
        posZ = modelCenter.z;
      } else {
        // 无模型：放置在相机前方
        const dir = new THREE.Vector3();
        this.camera.getWorldDirection(dir);
        const camPos = this.camera.position.clone().add(
          dir.multiplyScalar(5)
        );
        posX = camPos.x;
        posY = camPos.y;
        posZ = camPos.z;
      }

      const light = this.sceneManager.addPointLight({
        position: [posX, posY, posZ],
        color: 0xffeedd,
        intensity: 20,
        indicatorScale: 0.5,
        distance: 30
      });
      this._renderObjectsList();
      this.updateStatus('已添加点光源 — 点击光源球体或左侧列表选中');
    });

    // 隐藏/显示场景物体（FBX 模型）
    document.getElementById('btn-toggle-model').addEventListener('click', () => {
      const model = this.fbxHandler.currentModel;
      if (!model) {
        this.updateStatus('没有导入的场景物体');
        return;
      }
      const visible = !model.visible;
      model.visible = visible;
      const btn = document.getElementById('btn-toggle-model');
      if (visible) {
        btn.classList.remove('off');
        this.updateStatus('场景物体: 显示');
      } else {
        btn.classList.add('off');
        this.updateStatus('场景物体: 隐藏');
      }
    });

    // 视频背景
    const btnVideoBg = document.getElementById('btn-video-bg');
    btnVideoBg.addEventListener('click', () => {
      // 如果当前有视频在播放，则关闭
      if (this.sceneManager.videoEnabled) {
        this.sceneManager.toggleVideoBackground(null);
        this._syncVideoToggleBtn();
        this.updateStatus('视频背景已关闭');
        return;
      }

      // 创建文件选择器选择视频
      const videoInput = document.createElement('input');
      videoInput.type = 'file';
      videoInput.accept = 'video/*';
      videoInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
          this.sceneManager.setVideoBackgroundFile(file);
          this._syncVideoToggleBtn();
          this.updateStatus(`视频背景: ${file.name}`);
        }
      });
      videoInput.click();
    });

    // 重置视角
    document.getElementById('btn-reset-view').addEventListener('click', () => {
      this.fbxHandler.clearActiveCamera();
      this._renderCameraList(this.fbxHandler.cameras);
      this.orbitController.resetView();
      this.updateStatus('视角已重置');
    });


    // 线框模式切换
    document.getElementById('btn-wireframe').addEventListener('click', () => {
      const active = this.fbxHandler.toggleWireframe();
      const btn = document.getElementById('btn-wireframe');
      if (active) {
        btn.classList.add('active');
        this.updateStatus('线框模式: 开启');
      } else {
        btn.classList.remove('active');
        this.updateStatus('线框模式: 关闭');
      }
    });

    // 粒子效果切换
    document.getElementById('btn-particles').addEventListener('click', () => {
      const active = this.particleSystem.toggle();
      const btn = document.getElementById('btn-particles');
      if (active) {
        btn.classList.add('active');
        this._updateParticleSliders();
        // 显示参数面板并切换到粒子 tab
        const paramsPanel = document.getElementById('params-panel');
        if (paramsPanel) paramsPanel.classList.remove('hidden');
        const particlesTab = document.querySelector('.tab-btn[data-tab="particles"]');
        if (particlesTab) particlesTab.click();
        this.updateStatus('粒子效果: 开启');
      } else {
        btn.classList.remove('active');
        this.updateStatus('粒子效果: 关闭');
      }
    });

    // 烟雾效果
    document.getElementById('btn-smoke').addEventListener('click', () => {
      const active = this.smokeSystem.toggle();
      const btn = document.getElementById('btn-smoke');
      if (active) {
        btn.classList.add('active');
        this._updateSmokeSliders();
        const paramsPanel = document.getElementById('params-panel');
        if (paramsPanel) paramsPanel.classList.remove('hidden');
        const smokeTab = document.querySelector('.tab-btn[data-tab="smoke"]');
        if (smokeTab) smokeTab.click();
        this.updateStatus('烟雾效果: 开启');
      } else {
        btn.classList.remove('active');
        this.updateStatus('烟雾效果: 关闭');
      }
    });

    // 光束效果
    document.getElementById('btn-godrays').addEventListener('click', () => {
      this._prepareLightBeamDefaults();
      const active = this.lightBeamSystem.toggle();
      const btn = document.getElementById('btn-godrays');
      if (active) {
        // 如果还没有设置光源，自动选取场景中第一个点光源
        if (!this.godRaysSystem.light) {
          let firstPointLight = null;
          this.scene.traverse((obj) => {
            if (!firstPointLight && obj.isPointLight) {
              firstPointLight = obj;
            }
          });
          if (firstPointLight) {
            this.godRaysSystem.setLight(firstPointLight);
            this.lightBeamSystem.setLight(firstPointLight);
          }
        }
        btn.classList.add('active');
        this._updateGodRaysSliders();
        this._updateLightBeamSliders();
        const paramsPanel = document.getElementById('params-panel');
        if (paramsPanel) paramsPanel.classList.remove('hidden');
        const godraysTab = document.querySelector('.tab-btn[data-tab="godrays"]');
        if (godraysTab) godraysTab.click();
        this.updateStatus('丁达尔光束: 开启 — 可用源点/目标/长度/半径控制');
      } else {
        this.godRaysSystem.setEnabled(false);
        const postprocessCheck = document.getElementById('godrays-postprocess-enabled');
        if (postprocessCheck) postprocessCheck.checked = false;
        btn.classList.remove('active');
        this.updateStatus('丁达尔光束: 关闭');
      }
    });
  }

  // ── 面板折叠 ─────────────────────────────────────

  _bindPanelToggles() {
    // 摄像机列表面板
    const cameraPanel = document.getElementById('camera-panel');
    const cameraToggle = document.getElementById('camera-panel-toggle');
    if (cameraToggle) {
      cameraToggle.addEventListener('click', () => {
        // 如果面板是 hidden 状态，先显示再展开
        cameraPanel.classList.remove('hidden');
        cameraPanel.classList.toggle('collapsed');
      });
    }

    // 参数面板
    const paramsPanel = document.getElementById('params-panel');
    const paramsToggle = document.getElementById('params-panel-toggle');
    if (paramsToggle) {
      paramsToggle.addEventListener('click', () => {
        paramsPanel.classList.toggle('collapsed');
      });
    }
  }

  // ── 参数面板选项卡切换 ───────────────────────────

  _bindTabSwitching() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const targetTab = btn.dataset.tab;

        // 切换按钮激活状态
        tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');

        // 切换内容显示
        tabContents.forEach(content => {
          if (content.id === `tab-${targetTab}`) {
            content.classList.remove('hidden');
          } else {
            content.classList.add('hidden');
          }
        });
      });
    });
  }

  // ── 摄像机列表渲染 ───────────────────────────────

  _renderCameraList(cameras) {
    const panel = document.getElementById('camera-panel');
    const list = document.getElementById('camera-list');

    // 清空列表
    list.innerHTML = '';

    if (cameras.length === 0) {
      panel.classList.add('hidden');
      return;
    }

    // 显示面板（展开状态）
    panel.classList.remove('hidden', 'collapsed');

    // 根据模型大小更新滑块范围
    this._updateSliderRanges();

    const freeViewItem = document.createElement('li');
    freeViewItem.className = 'camera-free-view';
    freeViewItem.innerHTML = `
      <div class="cam-name">退出摄像机视角</div>
      <div class="cam-meta">
        <span class="cam-type">自由视角</span>
        <span class="cam-fov">显示轨迹</span>
      </div>
    `;
    freeViewItem.addEventListener('click', () => {
      this.fbxHandler.releaseCameraView();
      this.orbitController.setEnabled(true);
      this.fbxHandler.setCameraPathVisible(true);
      this.updateStatus('已退出摄像机视角 — 保持当前画面，可自由移动视角，效果仍跟随动画摄像机');
      list.querySelectorAll('li').forEach(item => item.classList.remove('active'));
      freeViewItem.classList.add('active');
    });
    list.appendChild(freeViewItem);

    cameras.forEach((camInfo, index) => {
      const li = document.createElement('li');
      const fovStr = camInfo.fov ? `FOV ${camInfo.fov.toFixed(1)}°` : '正交';
      const posStr = camInfo.worldPos
        ? `(${camInfo.worldPos[0]}, ${camInfo.worldPos[1]}, ${camInfo.worldPos[2]})`
        : '';
      if (camInfo.active) {
        li.classList.add('active');
      }
      li.innerHTML = `
        <div class="cam-name">${camInfo.name}</div>
        <div class="cam-meta">
          <span class="cam-type">${camInfo.type}</span>
          <span class="cam-fov">${camInfo.animated ? '动画' : fovStr}</span>
        </div>
        <div class="cam-pos">${posStr}</div>
      `;

      li.addEventListener('click', () => {
        const result = this.fbxHandler.switchToCamera(index, { followAnimation: camInfo.animated });
        if (result) {
          // 切换摄像机前先取消物体选中，避免 TransformControls 干扰
          this.sceneManager.selectObject(null);
          window.__atmosphereFX._deselectForTransform?.();

          this.orbitController.setFromCamera(result.camera, {
            copyProjection: true,
            lookTarget: this.fbxHandler.shouldAimActiveCameraAtModel()
              ? this.fbxHandler.getModelCenter()
              : null,
            targetDistance: Math.max(this.fbxHandler.getModelSize(), 10)
          });
          this.updateStatus(
            camInfo.animated
              ? `已切换: ${result.name} — 跟随动画摄像机`
              : `已切换: ${result.name} — 鼠标操作自由旋转`
          );

          // 更新列表激活状态
          list.querySelectorAll('li').forEach(item => item.classList.remove('active'));
          li.classList.add('active');
        }
      });

      list.appendChild(li);
    });
  }

  // ── 状态栏 ───────────────────────────────────────

  /**
   * 更新顶部状态栏
   * @param {string} message
   */
  updateStatus(message) {
    const statusText = document.getElementById('status-text');
    if (statusText) {
      statusText.textContent = message;
    }
  }

  // ── 场景对象列表面板 ───────────────────────────

  _bindObjectsPanel() {
    const panelToggle = document.getElementById('objects-panel-toggle');
    if (panelToggle) {
      panelToggle.addEventListener('click', () => {
        document.getElementById('objects-panel').classList.toggle('collapsed');
      });
    }
  }

  /**
   * 刷新对象列表（在添加/删除/选中对象后调用）
   */
  _renderObjectsList() {
    const panel = document.getElementById('objects-panel');
    const list = document.getElementById('objects-list');
    if (!panel || !list) return;

    const objects = this.sceneManager.getAllUserObjects();

    if (objects.length === 0) {
      panel.classList.add('hidden');
      return;
    }

    panel.classList.remove('hidden');
    list.innerHTML = '';

    const selectedObj = this.sceneManager.selectedObject;

    objects.forEach(item => {
      const li = document.createElement('li');
      const isHidden = !item.object.visible;

      li.innerHTML = `
        <span class="obj-icon">${item.icon}</span>
        <span class="obj-name">${isHidden ? '<s>' + item.name + '</s>' : item.name}</span>
        <span class="obj-type">${item.type === 'pointLight' ? '点光' : item.type === 'occluder' ? '遮挡板' : item.type === 'cube' ? '立方体' : '球体'}</span>
        <button class="obj-action obj-hide" data-id="${item.id}" title="${isHidden ? '显示' : '隐藏'}">${isHidden ? '🔦' : '👁'}</button>
        <button class="obj-action obj-delete" data-id="${item.id}" title="删除">🗑</button>
      `;

      if (isHidden) li.classList.add('hidden-item');
      if (selectedObj === item.object) {
        li.classList.add('active');
      }

      // 点击主体区域：选中对象
      li.addEventListener('click', (e) => {
        // 不拦截按钮点击
        if (e.target.closest('.obj-action')) return;
        this.sceneManager.selectObject(item.object);
        if (item.type === 'pointLight') {
          window.__atmosphereFX._selectLightForTransform?.(item.object);
        } else if (item.type === 'occluder') {
          window.__atmosphereFX._selectOccluderForTransform?.();
        } else {
          window.__atmosphereFX._deselectForTransform?.();
        }
        this.updateStatus(`已选中: ${item.name}`);
      });

      // 隐藏/显示按钮
      li.querySelector('.obj-hide').addEventListener('click', (e) => {
        e.stopPropagation();
        const visible = this.sceneManager.toggleObjectVisibility(item.id);
        this._renderObjectsList();
        this.updateStatus(`${item.name}: ${visible ? '已显示' : '已隐藏'}`);
      });

      // 删除按钮
      li.querySelector('.obj-delete').addEventListener('click', (e) => {
        e.stopPropagation();
        // 遮挡板特殊处理：调用 dispose 并隐藏
        if (item.type === 'occluder') {
          window.__atmosphereFX._deselectForTransform?.();
          this.occluderSystem.disable();
          this._renderObjectsList();
          this.updateStatus('遮挡板已移除');
          return;
        }
        this.sceneManager.removeObjectById(item.id);
        // 如果删除的是光源，断开 TransformControls
        if (item.type === 'pointLight') {
          window.__atmosphereFX._deselectForTransform?.();
        }
        this._renderObjectsList();
        this.updateStatus(`已删除: ${item.name}`);
      });

      list.appendChild(li);
    });
  }

  // ── 光源控制 ─────────────────────────────────────

  _bindLightControls() {
    const ids = ['light-pos-x', 'light-pos-y', 'light-pos-z', 'light-intensity'];
    ids.forEach(id => {
      const slider = document.getElementById(id);
      const valSpan = document.getElementById(id + '-val');
      if (!slider) return;

      slider.addEventListener('input', () => {
        if (valSpan) valSpan.textContent = slider.value;
        this._applyLightFromSliders();
      });
    });

    const colorInput = document.getElementById('light-color');
    if (colorInput) {
      colorInput.addEventListener('input', () => {
        this._applyLightFromSliders();
      });
    }
  }

  _applyLightFromSliders() {
    const light = this.sceneManager.selectedLight;
    if (!light) return;

    const x = parseFloat(document.getElementById('light-pos-x')?.value || 0);
    const y = parseFloat(document.getElementById('light-pos-y')?.value || 0);
    const z = parseFloat(document.getElementById('light-pos-z')?.value || 0);
    const intensity = parseFloat(document.getElementById('light-intensity')?.value || 50);
    const color = document.getElementById('light-color')?.value || '#ffeedd';

    light.position.set(x, y, z);
    light.intensity = intensity;
    light.color.set(color);
  }

  _updateLightSliders(light) {
    if (!light) return;
    const setSlider = (id, val) => {
      const el = document.getElementById(id);
      const valEl = document.getElementById(id + '-val');
      if (el) el.value = val;
      if (valEl) valEl.textContent = val;
    };
    setSlider('light-pos-x', +light.position.x.toFixed(1));
    setSlider('light-pos-y', +light.position.y.toFixed(1));
    setSlider('light-pos-z', +light.position.z.toFixed(1));
    setSlider('light-intensity', light.intensity);

    const colorInput = document.getElementById('light-color');
    if (colorInput) colorInput.value = '#' + light.color.getHexString();
  }

  _setLightPanelEnabled(enabled) {
    const ids = ['light-pos-x', 'light-pos-y', 'light-pos-z', 'light-intensity', 'light-color'];
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.disabled = !enabled;
    });
  }

  /**
   * 根据模型大小动态调整滑块范围
   */
  _updateSliderRanges() {
    const modelSize = this.fbxHandler.getModelSize();
    if (modelSize <= 0) return;

    const maxRange = Math.ceil(modelSize * 2);
    const effectOriginRange = Math.ceil(modelSize * 4);
    const step = modelSize > 100 ? 1 : 0.5;

    ['light-pos-x', 'light-pos-y', 'light-pos-z'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.min = -maxRange;
        el.max = maxRange;
        el.step = step;
      }
    });

    [
      'particle-origin-x', 'particle-origin-y', 'particle-origin-z',
      'smoke-origin-x', 'smoke-origin-y', 'smoke-origin-z',
      'beam-origin-x', 'beam-origin-y', 'beam-origin-z',
      'beam-target-x', 'beam-target-y', 'beam-target-z'
    ].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.min = -effectOriginRange;
        el.max = effectOriginRange;
        el.step = step;
      }
    });

    // 强度上限也按模型大小缩放
    const intensityEl = document.getElementById('light-intensity');
    if (intensityEl) {
      intensityEl.max = Math.max(500, Math.ceil(modelSize * 0.1));
    }
  }

  // ── 粒子控制 ─────────────────────────────────────

  _bindParticleControls() {
    const ids = [
      'particle-count', 'particle-size', 'particle-size-var',
      'particle-speed', 'particle-spread',
      'particle-origin-x', 'particle-origin-y', 'particle-origin-z',
      'particle-opacity', 'particle-opacity-var',
      'particle-drift-x', 'particle-drift-y', 'particle-drift-z',
      'particle-turbulence', 'particle-rotation'
    ];
    ids.forEach(id => {
      const slider = document.getElementById(id);
      const valSpan = document.getElementById(id + '-val');
      if (!slider) return;

      slider.addEventListener('input', () => {
        if (valSpan) valSpan.textContent = slider.value;
        this._applyParticleFromSliders();
      });
    });

    const colorInput = document.getElementById('particle-color');
    if (colorInput) {
      colorInput.addEventListener('input', () => this._applyParticleFromSliders());
    }

    // 重置旋转按钮
    const btnResetRot = document.getElementById('btn-reset-rotation');
    if (btnResetRot) {
      btnResetRot.addEventListener('click', () => {
        this.particleSystem.resetRotation();
        // 同时重置旋转滑块
        const rotSlider = document.getElementById('particle-rotation');
        const rotVal = document.getElementById('particle-rotation-val');
        if (rotSlider) rotSlider.value = 0;
        if (rotVal) rotVal.textContent = '0';
        this.updateStatus('粒子旋转已重置');
      });
    }

    // 粒子样式切换按钮
    const styleBtns = document.querySelectorAll('#particle-style-bar .style-btn');
    styleBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const style = btn.dataset.style;
        this.particleSystem.setStyle(style);
        // 更新按钮激活状态
        styleBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        // 刷新所有滑块为预设值
        this._updateParticleSliders();
        this.updateStatus(`粒子样式: ${btn.textContent.trim()}`);
      });
    });
  }

  _applyParticleFromSliders() {
    const ps = this.particleSystem;
    if (!ps) return;

    const count = parseInt(document.getElementById('particle-count')?.value || 300);
    const size = parseFloat(document.getElementById('particle-size')?.value || 0.08);
    const sizeVar = parseFloat(document.getElementById('particle-size-var')?.value || 0.5);
    const speed = parseFloat(document.getElementById('particle-speed')?.value || 0.4);
    const spread = parseFloat(document.getElementById('particle-spread')?.value || 5);
    const originX = parseFloat(document.getElementById('particle-origin-x')?.value || 0);
    const originY = parseFloat(document.getElementById('particle-origin-y')?.value || 0);
    const originZ = parseFloat(document.getElementById('particle-origin-z')?.value || 0);
    const opacity = parseFloat(document.getElementById('particle-opacity')?.value || 0.5);
    const opacityVar = parseFloat(document.getElementById('particle-opacity-var')?.value || 0.5);
    const driftX = parseFloat(document.getElementById('particle-drift-x')?.value || 0);
    const driftY = parseFloat(document.getElementById('particle-drift-y')?.value || 0);
    const driftZ = parseFloat(document.getElementById('particle-drift-z')?.value || 0);
    const turbulence = parseFloat(document.getElementById('particle-turbulence')?.value || 0.5);
    const rotation = parseFloat(document.getElementById('particle-rotation')?.value || 0);
    const color = document.getElementById('particle-color')?.value || '#ffeedd';

    if (count !== ps.count) ps.setCount(count);
    if (size !== ps.size) ps.setSize(size);
    if (sizeVar !== ps.sizeVariance) ps.setSizeVariance(sizeVar);
    if (speed !== ps.speed) ps.setSpeed(speed);
    if (spread !== ps.spread) ps.setSpread(spread);
    if (originX !== ps.originX || originY !== ps.originY || originZ !== ps.originZ) {
      ps.setOriginOffset(originX, originY, originZ);
    }
    if (opacity !== ps.opacity) ps.setOpacity(opacity);
    if (opacityVar !== ps.opacityVariance) ps.setOpacityVariance(opacityVar);
    if (driftX !== ps.driftX || driftY !== ps.driftY || driftZ !== ps.driftZ) {
      ps.setDrift(driftX, driftY, driftZ);
    }
    // 同步烟雾漂移方向（双向绑定）
    if (!this._syncingDrift) {
      this._syncingDrift = true;
      const ss = this.smokeSystem;
      if (ss) {
        ss.setDrift(driftX, driftY, driftZ);
      }
      const sdx = document.getElementById('smoke-drift-x');
      const sdy = document.getElementById('smoke-drift-y');
      const sdz = document.getElementById('smoke-drift-z');
      const sdxv = document.getElementById('smoke-drift-x-val');
      const sdyv = document.getElementById('smoke-drift-y-val');
      const sdzv = document.getElementById('smoke-drift-z-val');
      if (sdx) { sdx.value = driftX; if (sdxv) sdxv.textContent = driftX; }
      if (sdy) { sdy.value = driftY; if (sdyv) sdyv.textContent = driftY; }
      if (sdz) { sdz.value = driftZ; if (sdzv) sdzv.textContent = driftZ; }
      this._syncingDrift = false;
    }
    if (turbulence !== ps.turbulence) ps.setTurbulence(turbulence);
    if (rotation !== ps.rotationSpeed) ps.setRotationSpeed(rotation);
    if (color !== ps.color) ps.setColor(color);
  }

  _updateParticleSliders() {
    const ps = this.particleSystem;
    if (!ps) return;
    const setSlider = (id, val) => {
      const el = document.getElementById(id);
      const valEl = document.getElementById(id + '-val');
      if (el) el.value = val;
      if (valEl) valEl.textContent = val;
    };
    setSlider('particle-count', ps.count);
    setSlider('particle-size', ps.size);
    setSlider('particle-size-var', ps.sizeVariance);
    setSlider('particle-speed', ps.speed);
    setSlider('particle-spread', ps.spread);
    setSlider('particle-origin-x', ps.originX);
    setSlider('particle-origin-y', ps.originY);
    setSlider('particle-origin-z', ps.originZ);
    setSlider('particle-opacity', ps.opacity);
    setSlider('particle-opacity-var', ps.opacityVariance);
    setSlider('particle-drift-x', ps.driftX);
    setSlider('particle-drift-y', ps.driftY);
    setSlider('particle-drift-z', ps.driftZ);
    setSlider('particle-turbulence', ps.turbulence);
    setSlider('particle-rotation', ps.rotationSpeed);
    const colorInput = document.getElementById('particle-color');
    if (colorInput) colorInput.value = ps.color;
  }

  // ── 烟雾控件绑定 ──────────────────────────────────

  _bindSmokeControls() {
    const ids = [
      'smoke-count', 'smoke-size', 'smoke-size-var',
      'smoke-spread',
      'smoke-origin-x', 'smoke-origin-y', 'smoke-origin-z',
      'smoke-opacity', 'smoke-opacity-var',
      'smoke-drift-x', 'smoke-drift-y', 'smoke-drift-z',
      'smoke-turbulence'
    ];
    ids.forEach(id => {
      const slider = document.getElementById(id);
      const valSpan = document.getElementById(id + '-val');
      if (!slider) return;

      slider.addEventListener('input', () => {
        if (valSpan) valSpan.textContent = slider.value;
        this._applySmokeFromSliders();
      });
    });

    const colorInput = document.getElementById('smoke-color');
    if (colorInput) {
      colorInput.addEventListener('input', () => this._applySmokeFromSliders());
    }

    // 烟雾样式切换按钮
    const styleBtns = document.querySelectorAll('#smoke-style-bar .style-btn');
    styleBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const style = btn.dataset.style;
        this.smokeSystem.setStyle(style);
        styleBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._updateSmokeSliders();
        this.updateStatus(`烟雾样式: ${btn.textContent.trim()}`);
      });
    });
  }

  _applySmokeFromSliders() {
    const ss = this.smokeSystem;
    if (!ss) return;

    const count = parseInt(document.getElementById('smoke-count')?.value || 60);
    const size = parseFloat(document.getElementById('smoke-size')?.value || 3.5);
    const sizeVar = parseFloat(document.getElementById('smoke-size-var')?.value || 0.3);
    const spread = parseFloat(document.getElementById('smoke-spread')?.value || 12);
    const originX = parseFloat(document.getElementById('smoke-origin-x')?.value || 0);
    const originY = parseFloat(document.getElementById('smoke-origin-y')?.value || 0);
    const originZ = parseFloat(document.getElementById('smoke-origin-z')?.value || 0);
    const opacity = parseFloat(document.getElementById('smoke-opacity')?.value || 0.07);
    const opacityVar = parseFloat(document.getElementById('smoke-opacity-var')?.value || 0.4);
    const driftX = parseFloat(document.getElementById('smoke-drift-x')?.value || 0);
    const driftY = parseFloat(document.getElementById('smoke-drift-y')?.value || 0.03);
    const driftZ = parseFloat(document.getElementById('smoke-drift-z')?.value || 0);
    const turbulence = parseFloat(document.getElementById('smoke-turbulence')?.value || 0.08);
    const color = document.getElementById('smoke-color')?.value || '#ddeeff';

    if (count !== ss.count) ss.setCount(count);
    if (size !== ss.size) ss.setSize(size);
    if (sizeVar !== ss.sizeVariance) ss.setSizeVariance(sizeVar);
    if (spread !== ss.spread) ss.setSpread(spread);
    if (originX !== ss.originX || originY !== ss.originY || originZ !== ss.originZ) {
      ss.setOriginOffset(originX, originY, originZ);
    }
    if (opacity !== ss.opacity) ss.setOpacity(opacity);
    if (opacityVar !== ss.opacityVariance) ss.setOpacityVariance(opacityVar);
    if (driftX !== ss.driftX || driftY !== ss.driftY || driftZ !== ss.driftZ) {
      ss.setDrift(driftX, driftY, driftZ);
    }
    // 同步粒子漂移方向（双向绑定）
    if (!this._syncingDrift) {
      this._syncingDrift = true;
      const ps = this.particleSystem;
      if (ps) {
        ps.setDrift(driftX, driftY, driftZ);
      }
      // 同步更新粒子侧 slider 显示值
      const pdx = document.getElementById('particle-drift-x');
      const pdy = document.getElementById('particle-drift-y');
      const pdz = document.getElementById('particle-drift-z');
      const pdxv = document.getElementById('particle-drift-x-val');
      const pdyv = document.getElementById('particle-drift-y-val');
      const pdzv = document.getElementById('particle-drift-z-val');
      if (pdx) { pdx.value = driftX; if (pdxv) pdxv.textContent = driftX; }
      if (pdy) { pdy.value = driftY; if (pdyv) pdyv.textContent = driftY; }
      if (pdz) { pdz.value = driftZ; if (pdzv) pdzv.textContent = driftZ; }
      this._syncingDrift = false;
    }
    if (turbulence !== ss.turbulence) ss.setTurbulence(turbulence);
    if (color !== ss.color) ss.setColor(color);
  }

  _updateSmokeSliders() {
    const ss = this.smokeSystem;
    if (!ss) return;
    const setSlider = (id, val) => {
      const el = document.getElementById(id);
      const valEl = document.getElementById(id + '-val');
      if (el) el.value = val;
      if (valEl) valEl.textContent = val;
    };
    setSlider('smoke-count', ss.count);
    setSlider('smoke-size', ss.size);
    setSlider('smoke-size-var', ss.sizeVariance);
    setSlider('smoke-spread', ss.spread);
    setSlider('smoke-origin-x', ss.originX);
    setSlider('smoke-origin-y', ss.originY);
    setSlider('smoke-origin-z', ss.originZ);
    setSlider('smoke-opacity', ss.opacity);
    setSlider('smoke-opacity-var', ss.opacityVariance);
    setSlider('smoke-drift-x', ss.driftX);
    setSlider('smoke-drift-y', ss.driftY);
    setSlider('smoke-drift-z', ss.driftZ);
    setSlider('smoke-turbulence', ss.turbulence);
    const colorInput = document.getElementById('smoke-color');
    if (colorInput) colorInput.value = ss.color;
  }

  // ── 光束控件绑定 ──────────────────────────────────

  _bindGodRaysControls() {
    const beamSliderIds = [
      'beam-origin-x', 'beam-origin-y', 'beam-origin-z',
      'beam-target-x', 'beam-target-y', 'beam-target-z',
      'beam-length', 'beam-radius', 'beam-intensity',
      'beam-plane-count', 'beam-stripe-count', 'beam-stripe-strength',
      'beam-noise-strength', 'beam-edge-softness',
      'beam-attenuation', 'beam-drift-speed'
    ];
    beamSliderIds.forEach(id => {
      const slider = document.getElementById(id);
      const valSpan = document.getElementById(id + '-val');
      if (!slider) return;
      slider.addEventListener('input', () => {
        if (valSpan) valSpan.textContent = slider.value;
        this._applyLightBeamFromSliders();
      });
    });

    const beamColorInput = document.getElementById('beam-color');
    if (beamColorInput) {
      beamColorInput.addEventListener('input', () => this._applyLightBeamFromSliders());
    }

    const beamHelperCheck = document.getElementById('beam-helper-visible');
    const beamFollowCheck = document.getElementById('beam-follow-light');
    if (beamHelperCheck) beamHelperCheck.addEventListener('change', () => this._applyLightBeamFromSliders());
    if (beamFollowCheck) beamFollowCheck.addEventListener('change', () => this._applyLightBeamFromSliders());

    const sliderIds = [
      'godrays-density', 'godrays-max-density',
      'godrays-distance-attenuation', 'godrays-raymarch-steps'
    ];
    sliderIds.forEach(id => {
      const slider = document.getElementById(id);
      const valSpan = document.getElementById(id + '-val');
      if (!slider) return;
      slider.addEventListener('input', () => {
        if (valSpan) valSpan.textContent = slider.value;
        this._applyGodRaysFromSliders();
      });
    });

    const colorInput = document.getElementById('godrays-color');
    if (colorInput) {
      colorInput.addEventListener('input', () => this._applyGodRaysFromSliders());
    }

    const blurCheck = document.getElementById('godrays-blur');
    const gammaCheck = document.getElementById('godrays-gamma');
    const postprocessCheck = document.getElementById('godrays-postprocess-enabled');
    if (blurCheck) blurCheck.addEventListener('change', () => this._applyGodRaysFromSliders());
    if (gammaCheck) gammaCheck.addEventListener('change', () => this._applyGodRaysFromSliders());
    if (postprocessCheck) {
      postprocessCheck.addEventListener('change', () => {
        this.godRaysSystem.setEnabled(postprocessCheck.checked);
        if (postprocessCheck.checked) {
          this._prepareLightBeamDefaults();
        }
        this._applyGodRaysFromSliders();
        this.updateStatus(postprocessCheck.checked ? '后处理光束: 开启' : '后处理光束: 关闭');
      });
    }
  }

  _prepareLightBeamDefaults() {
    const beam = this.lightBeamSystem;
    if (!beam) return;

    let sourceLight = this.sceneManager.selectedLight || this.godRaysSystem?.light || null;
    if (!sourceLight) {
      this.scene.traverse((obj) => {
        if (!sourceLight && obj.isPointLight) sourceLight = obj;
      });
    }

    if (sourceLight) {
      this.godRaysSystem?.setLight(sourceLight);
      beam.setLight(sourceLight);
    } else {
      const dir = new THREE.Vector3();
      this.camera.getWorldDirection(dir);
      const origin = this.camera.position.clone().add(dir.clone().multiplyScalar(4));
      origin.y += 2;
      beam.setOrigin(origin.x, origin.y, origin.z);
    }

    const center = this.fbxHandler.getModelCenter?.();
    const size = this.fbxHandler.getModelSize?.() || 0;
    if (center) {
      beam.setTarget(center.x, center.y, center.z);
      if (size > 0) {
        beam.length = Math.max(size * 1.6, 12);
        beam.radius = Math.max(size * 0.28, 2.5);
      }
    }
  }

  _applyLightBeamFromSliders() {
    const beam = this.lightBeamSystem;
    if (!beam) return;

    const originX = parseFloat(document.getElementById('beam-origin-x')?.value || 0);
    const originY = parseFloat(document.getElementById('beam-origin-y')?.value || 6);
    const originZ = parseFloat(document.getElementById('beam-origin-z')?.value || 0);
    const targetX = parseFloat(document.getElementById('beam-target-x')?.value || 0);
    const targetY = parseFloat(document.getElementById('beam-target-y')?.value || 0);
    const targetZ = parseFloat(document.getElementById('beam-target-z')?.value || 0);
    const length = parseFloat(document.getElementById('beam-length')?.value || 18);
    const radius = parseFloat(document.getElementById('beam-radius')?.value || 4);
    const intensity = parseFloat(document.getElementById('beam-intensity')?.value || 1.6);
    const planeCount = parseFloat(document.getElementById('beam-plane-count')?.value || 10);
    const stripeCount = parseFloat(document.getElementById('beam-stripe-count')?.value || 7);
    const stripeStrength = parseFloat(document.getElementById('beam-stripe-strength')?.value || 0.65);
    const noiseStrength = parseFloat(document.getElementById('beam-noise-strength')?.value || 0.35);
    const edgeSoftness = parseFloat(document.getElementById('beam-edge-softness')?.value || 0.75);
    const attenuation = parseFloat(document.getElementById('beam-attenuation')?.value || 1.15);
    const driftSpeed = parseFloat(document.getElementById('beam-drift-speed')?.value || 0.08);
    const color = document.getElementById('beam-color')?.value || '#ffe7b2';
    const helperVisible = document.getElementById('beam-helper-visible')?.checked ?? true;
    const followLight = document.getElementById('beam-follow-light')?.checked ?? true;

    this._syncLightBeamFollowUI(followLight);

    beam.followLight = followLight;
    if (!followLight) beam.setOrigin(originX, originY, originZ);
    beam.setTarget(targetX, targetY, targetZ);
    beam.length = length;
    beam.radius = radius;
    beam.intensity = intensity;
    beam.planeCount = planeCount;
    beam.stripeCount = stripeCount;
    beam.stripeStrength = stripeStrength;
    beam.noiseStrength = noiseStrength;
    beam.edgeSoftness = edgeSoftness;
    beam.attenuation = attenuation;
    beam.driftSpeed = driftSpeed;
    beam.color = color;
    beam.helperVisible = helperVisible;
  }

  _updateLightBeamSliders() {
    const beam = this.lightBeamSystem;
    if (!beam) return;
    const params = beam.getParams();
    const setSlider = (id, val) => {
      const el = document.getElementById(id);
      const valEl = document.getElementById(id + '-val');
      const rounded = typeof val === 'number' ? +val.toFixed(2) : val;
      if (el) el.value = rounded;
      if (valEl) valEl.textContent = rounded;
    };

    setSlider('beam-origin-x', params.originX);
    setSlider('beam-origin-y', params.originY);
    setSlider('beam-origin-z', params.originZ);
    setSlider('beam-target-x', params.targetX);
    setSlider('beam-target-y', params.targetY);
    setSlider('beam-target-z', params.targetZ);
    setSlider('beam-length', params.length);
    setSlider('beam-radius', params.radius);
    setSlider('beam-intensity', params.intensity);
    setSlider('beam-plane-count', params.planeCount);
    setSlider('beam-stripe-count', params.stripeCount);
    setSlider('beam-stripe-strength', params.stripeStrength);
    setSlider('beam-noise-strength', params.noiseStrength);
    setSlider('beam-edge-softness', params.edgeSoftness);
    setSlider('beam-attenuation', params.attenuation);
    setSlider('beam-drift-speed', params.driftSpeed);

    const colorInput = document.getElementById('beam-color');
    if (colorInput) colorInput.value = params.color;
    const helperCheck = document.getElementById('beam-helper-visible');
    if (helperCheck) helperCheck.checked = params.helperVisible;
    const followCheck = document.getElementById('beam-follow-light');
    if (followCheck) followCheck.checked = params.followLight;
    this._syncLightBeamFollowUI(params.followLight);
  }

  _syncLightBeamFollowUI(followLight) {
    ['beam-origin-x', 'beam-origin-y', 'beam-origin-z'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.disabled = !!followLight;
    });
  }

  _applyGodRaysFromSliders() {
    const gr = this.godRaysSystem;
    if (!gr || !gr.enabled) return;

    const density = parseFloat(document.getElementById('godrays-density')?.value || 0.3);
    const maxDensity = parseFloat(document.getElementById('godrays-max-density')?.value || 0.5);
    const distanceAttenuation = parseFloat(document.getElementById('godrays-distance-attenuation')?.value || 1.0);
    const raymarchSteps = parseInt(document.getElementById('godrays-raymarch-steps')?.value || 64);
    const color = document.getElementById('godrays-color')?.value || '#ffffff';
    const blur = document.getElementById('godrays-blur')?.checked ?? true;
    const gamma = document.getElementById('godrays-gamma')?.checked ?? true;

    if (density !== gr.density) gr.density = density;
    if (maxDensity !== gr.maxDensity) gr.maxDensity = maxDensity;
    if (distanceAttenuation !== gr.distanceAttenuation) gr.distanceAttenuation = distanceAttenuation;
    if (raymarchSteps !== gr.raymarchSteps) gr.raymarchSteps = raymarchSteps;
    if (color !== gr.color) gr.color = color;
    if (blur !== gr.blur) gr.blur = blur;
    if (gamma !== gr.gammaCorrection) gr.gammaCorrection = gamma;
  }

  _updateGodRaysSliders() {
    const gr = this.godRaysSystem;
    if (!gr) return;
    const setSlider = (id, val) => {
      const el = document.getElementById(id);
      const valEl = document.getElementById(id + '-val');
      if (el) el.value = val;
      if (valEl) valEl.textContent = val;
    };
    setSlider('godrays-density', gr.density);
    setSlider('godrays-max-density', gr.maxDensity);
    setSlider('godrays-distance-attenuation', gr.distanceAttenuation);
    setSlider('godrays-raymarch-steps', gr.raymarchSteps);
    const colorInput = document.getElementById('godrays-color');
    if (colorInput) colorInput.value = gr.color;
    const blurCheck = document.getElementById('godrays-blur');
    if (blurCheck) blurCheck.checked = gr.blur;
    const gammaCheck = document.getElementById('godrays-gamma');
    if (gammaCheck) gammaCheck.checked = gr.gammaCorrection;
    const postprocessCheck = document.getElementById('godrays-postprocess-enabled');
    if (postprocessCheck) postprocessCheck.checked = gr.enabled;
  }

  // ── 遮挡板控件 ──────────────────────────────────

  _bindOccluderControls() {
    const oc = this.occluderSystem;
    if (!oc) return;

    // 生成按钮
    const btnGen = document.getElementById('btn-generate-occluder');
    if (btnGen) {
      btnGen.addEventListener('click', () => {
        if (!oc.enabled) {
          // 同步光束系统的光源
          if (this.godRaysSystem && this.godRaysSystem.light) {
            oc.setLight(this.godRaysSystem.light);
          }
          oc.enable();
          if (oc.enabled) {
            btnGen.textContent = '👁 隐藏';
            this._updateOccluderSliders();
            // ★ 自动选中遮挡板并显示 TransformControls 把手
            this.sceneManager.selectObject(oc._mesh);
            window.__atmosphereFX._selectOccluderForTransform?.();
            this.updateStatus('遮挡板已生成 — 光束图案可见');
          } else {
            this.updateStatus('遮挡板生成失败 — 请先添加点光源');
          }
        } else {
          oc.disable();
          btnGen.textContent = '⬛ 生成';
          this.updateStatus('遮挡板已隐藏');
        }
      });
    }

    // 滑块
    const bindSlider = (id, setter) => {
      const el = document.getElementById(id);
      const valEl = document.getElementById(id + '-val');
      if (!el) return;
      el.addEventListener('input', () => {
        const v = parseFloat(el.value);
        if (valEl) valEl.textContent = v;
        setter.call(oc, v);
      });
    };

    bindSlider('occluder-size',           function(v) { this.size = v; });
    bindSlider('occluder-pattern-count',  function(v) { this.patternCount = v; });
    bindSlider('occluder-pattern-angle',  function(v) { this.patternAngle = v; });
    bindSlider('occluder-noise-density',  function(v) { this.noiseDensity = v; });
    bindSlider('occluder-noise-scale',    function(v) { this.noiseScale = v; });
    bindSlider('occluder-spot-size',      function(v) { this.noiseSpotSize = v; });
    bindSlider('occluder-edge-softness',  function(v) { this.noiseEdgeSoftness = v; });
    bindSlider('occluder-octaves',        function(v) { this.noiseOctaves = v; });
    bindSlider('occluder-stretch-x',      function(v) { this.noiseStretchX = v; });
    bindSlider('occluder-stretch-y',      function(v) { this.noiseStretchY = v; });
    bindSlider('occluder-contrast',       function(v) { this.noiseContrast = v; });
    bindSlider('occluder-distance',       function(v) { this.distance = v; });
    bindSlider('occluder-offset-x',       function(v) { this.offsetX = v; });
    bindSlider('occluder-offset-y',       function(v) { this.offsetY = v; });
    bindSlider('occluder-rot-x',          function(v) { this.rotX = v; });
    bindSlider('occluder-rot-y',          function(v) { this.rotY = v; });
    bindSlider('occluder-rot-z',          function(v) { this.rotZ = v; });

    // 自动朝向 checkbox
    const autoOrientChk = document.getElementById('occluder-auto-orient');
    if (autoOrientChk) {
      autoOrientChk.addEventListener('change', () => {
        oc.useAutoOrient = autoOrientChk.checked;
        this.updateStatus(autoOrientChk.checked ? '遮挡板：自动朝向光源' : '遮挡板：手动旋转');
      });
    }

    // 随机噪点按钮
    const btnRand = document.getElementById('btn-randomize-occluder');
    if (btnRand) {
      btnRand.addEventListener('click', () => {
        oc.randomizeSeed();
        this._updateOccluderSliders();
        this.updateStatus('噪点已随机化');
      });
    }

    // 图案类型切换按钮
    const patternBtns = document.querySelectorAll('#occluder-pattern-bar .style-btn');
    patternBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const pattern = btn.dataset.pattern;
        oc.patternType = pattern;
        patternBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._updateOccluderSliders();
        this._toggleNoiseControls(pattern === 'noise');
        this.updateStatus(`遮挡板图案: ${btn.textContent.trim()}`);
      });
    });

    // 跟随相机 checkbox
    const followChk = document.getElementById('occluder-follow-camera');
    const txEl = document.getElementById('occluder-target-x');
    const tyEl = document.getElementById('occluder-target-y');
    const tzEl = document.getElementById('occluder-target-z');
    if (followChk) {
      followChk.addEventListener('change', () => {
        const disabled = followChk.checked;
        if (txEl) txEl.disabled = disabled;
        if (tyEl) tyEl.disabled = disabled;
        if (tzEl) tzEl.disabled = disabled;
        if (followChk.checked) {
          this.updateStatus('遮挡板目标：跟随相机');
        } else {
          this.updateStatus('遮挡板目标：手动控制');
          // 同步 slider 值为当前 target
          this._updateOccluderTargetSliders();
        }
      });
    }

    // 目标位置滑块
    const bindTargetSlider = (id, axis) => {
      const el = document.getElementById(id);
      const valEl = document.getElementById(id + '-val');
      if (!el) return;
      el.addEventListener('input', () => {
        const v = parseFloat(el.value);
        if (valEl) valEl.textContent = v;
        oc.target[axis] = v;
        this.updateStatus('遮挡板目标：手动 (' + oc.target.x.toFixed(0) + ', ' + oc.target.y.toFixed(0) + ', ' + oc.target.z.toFixed(0) + ')');
      });
    };
    bindTargetSlider('occluder-target-x', 'x');
    bindTargetSlider('occluder-target-y', 'y');
    bindTargetSlider('occluder-target-z', 'z');

    // 当光源位置变化（transformControls objectChange）时更新遮挡板位置
    // 委托给 animate loop 中的 occluderSystem.update()
  }

  _updateOccluderSliders() {
    const oc = this.occluderSystem;
    if (!oc) return;
    const params = oc.getParams();
    const setSlider = (id, val) => {
      const el = document.getElementById(id);
      const valEl = document.getElementById(id + '-val');
      if (el) el.value = val;
      if (valEl) valEl.textContent = val;
    };
    setSlider('occluder-size', params.size);
    setSlider('occluder-pattern-count', params.patternCount);
    setSlider('occluder-pattern-angle', params.patternAngle);
    setSlider('occluder-noise-density', params.noiseDensity);
    setSlider('occluder-noise-scale', params.noiseScale);
    setSlider('occluder-spot-size', params.noiseSpotSize);
    setSlider('occluder-edge-softness', params.noiseEdgeSoftness);
    setSlider('occluder-octaves', params.noiseOctaves);
    setSlider('occluder-stretch-x', params.noiseStretchX);
    setSlider('occluder-stretch-y', params.noiseStretchY);
    setSlider('occluder-contrast', params.noiseContrast);
    setSlider('occluder-distance', params.distance);
    setSlider('occluder-offset-x', params.offsetX);
    setSlider('occluder-offset-y', params.offsetY);
    setSlider('occluder-rot-x', params.rotX);
    setSlider('occluder-rot-y', params.rotY);
    setSlider('occluder-rot-z', params.rotZ);
    this._updateOccluderTargetSliders();
  }

  _updateOccluderTargetSliders() {
    const oc = this.occluderSystem;
    if (!oc || !oc.target) return;
    const t = oc.target;
    const setSlider = (id, val) => {
      const el = document.getElementById(id);
      const valEl = document.getElementById(id + '-val');
      if (el) el.value = val;
      if (valEl) valEl.textContent = parseFloat(val).toFixed(1);
    };
    setSlider('occluder-target-x', t.x);
    setSlider('occluder-target-y', t.y);
    setSlider('occluder-target-z', t.z);
  }

  /**
   * 根据图案类型显示/隐藏噪点专属控件
   */
  _toggleNoiseControls(showNoise) {
    const noiseIds = [
      'occluder-noise-density', 'occluder-noise-scale',
      'occluder-spot-size', 'occluder-octaves',
      'occluder-stretch-x', 'occluder-stretch-y', 'occluder-contrast'
    ];
    noiseIds.forEach(id => {
      const group = document.getElementById(id)?.closest('.param-group');
      if (group) group.style.display = showNoise ? '' : 'none';
    });
    // 条纹角度只在条纹模式下显示
    const angleGroup = document.getElementById('occluder-pattern-angle')?.closest('.param-group');
    if (angleGroup) {
      angleGroup.style.display = this.occluderSystem.patternType === 'stripes' ? '' : 'none';
    }
  }

  /**
   * 模型加载后：粒子重定位到模型中心
   */
  _onModelLoaded() {
    const center = this.fbxHandler.getModelCenter();
    const size = this.fbxHandler.getModelSize();
    if (center && size > 0) {
      this.particleSystem.setCenter(center.x, center.y, center.z);
      this.particleSystem.setSpread(size * 0.6);
      this._updateParticleSliders();

      // 烟雾定位到模型底部
      this.smokeSystem.setCenter(center.x, center.y - size * 0.3, center.z);
      this.smokeSystem.setSpread(size * 0.5);
      this._updateSmokeSliders();

      if (this.lightBeamSystem) {
        this.lightBeamSystem.setTarget(center.x, center.y, center.z);
        this.lightBeamSystem.length = Math.max(size * 1.6, 12);
        this.lightBeamSystem.radius = Math.max(size * 0.28, 2.5);
        this._updateLightBeamSliders();
      }
    }
  }

  /**
   * 光源被选中时由 main.js 调用
   */
  _onLightSelected(light) {
    this._setLightPanelEnabled(true);
    this._updateLightSliders(light);

    // 同步到光束系统（选中光源 → 光束发射源）
    if (this.godRaysSystem) {
      this.godRaysSystem.setLight(light);
    }

    if (this.lightBeamSystem) {
      this.lightBeamSystem.setLight(light);
      this._updateLightBeamSliders();
    }

    // 同步到遮挡板系统
    if (this.occluderSystem) {
      this.occluderSystem.setLight(light);
    }

    // 显示参数面板
    const paramsPanel = document.getElementById('params-panel');
    if (paramsPanel) paramsPanel.classList.remove('hidden');

    // 切换到光束 tab（光源 tab 已隐藏）
    const godraysTab = document.querySelector('.tab-btn[data-tab="godrays"]');
    if (godraysTab) godraysTab.click();

    this.updateStatus(`已选中光源 — 拖拽坐标轴移动，或调节滑块`);
  }

  /**
   * 光源取消选中时由 main.js 调用
   */
  _onLightDeselected() {
    this._setLightPanelEnabled(false);
  }

  /**
   * 遮挡板被 3D 点击选中时由 main.js 调用
   */
  _onOccluderSelected() {
    const paramsPanel = document.getElementById('params-panel');
    if (paramsPanel) paramsPanel.classList.remove('hidden');
    const godraysTab = document.querySelector('.tab-btn[data-tab="godrays"]');
    if (godraysTab) godraysTab.click();
    this._updateOccluderSliders();
    this.updateStatus('已选中遮挡板 — 拖拽坐标轴调整位置/旋转');
  }

  // ── 背景控制 ─────────────────────────────────────

  _bindBackgroundControl() {
    this._bgEnabled = true;

    const colorInput = document.getElementById('bg-color');
    const toggleBtn = document.getElementById('btn-bg-toggle');

    const applyBg = () => {
      if (this._bgEnabled) {
        document.body.style.backgroundColor = colorInput.value;
      } else {
        document.body.style.backgroundColor = '#000000';
      }
    };

    if (colorInput) {
      colorInput.addEventListener('input', applyBg);
    }

    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        this._bgEnabled = !this._bgEnabled;
        if (this._bgEnabled) {
          toggleBtn.classList.remove('off');
          toggleBtn.textContent = '👁';
          this.updateStatus('背景: 开启');
        } else {
          toggleBtn.classList.add('off');
          toggleBtn.textContent = '🚫';
          this.updateStatus('背景: 关闭 (纯黑)');
        }
        applyBg();
      });
    }

    // 初始应用
    applyBg();
  }

  _bindGridToggle() {
    this._gridVisible = true;
    const btn = document.getElementById('btn-grid-toggle');
    if (!btn) return;

    const fx = () => window.__atmosphereFX;
    const toggle = () => {
      this._gridVisible = !this._gridVisible;
      const api = fx();
      if (api?.gridHelper) api.gridHelper.visible = this._gridVisible;
      if (api?.axesHelper) api.axesHelper.visible = this._gridVisible;

      if (this._gridVisible) {
        btn.classList.remove('off');
        btn.textContent = '📐';
        this.updateStatus('网格/坐标轴: 显示');
      } else {
        btn.classList.add('off');
        btn.textContent = '📐';
        this.updateStatus('网格/坐标轴: 隐藏');
      }
    };

    btn.addEventListener('click', toggle);
  }

  _bindVideoToggle() {
    const btn = document.getElementById('btn-video-toggle');
    if (!btn) return;

    btn.addEventListener('click', () => {
      if (!this.sceneManager.videoSource && !this.sceneManager.videoEnabled) {
        this.updateStatus('请先通过底部工具栏导入视频');
        return;
      }
      this.sceneManager.toggleVideoBackground(null);
      this._syncVideoToggleBtn();
      this.updateStatus(
        this.sceneManager.videoEnabled ? '视频背景: 开启' : '视频背景: 关闭'
      );
    });

    this._syncVideoToggleBtn();
  }

  _syncVideoToggleBtn() {
    const btn = document.getElementById('btn-video-toggle');
    if (!btn) return;
    if (this.sceneManager.videoEnabled) {
      btn.classList.remove('off');
    } else {
      btn.classList.add('off');
    }
  }

  // ── 导出 ─────────────────────────────────────────

  _bindExportButtons() {
    if (!this.exportHandler) return;

    this.exportHandler._onRecordingStateChange = (state) => {
      this._onExportRecordingState(state);
    };

    const modal = document.getElementById('export-modal');
    const btnExport = document.getElementById('btn-export');

    // 点击输出按钮 → 显示模态框
    if (btnExport) {
      btnExport.addEventListener('click', () => {
        if (this.exportHandler.isRecording) {
          this.exportHandler.stopRecording();
          return;
        }
        // 重置 checkbox 为默认不勾选
        document.getElementById('export-bg').checked = false;
        document.getElementById('export-grid').checked = false;
        document.getElementById('export-video').checked = false;
        if (!this._applyImportedAnimationExportPreset({ silent: true })) {
          document.getElementById('export-duration').value = 10;
          // 同步导出 FPS 与时间线 FPS
          const exportFpsInput = document.getElementById('export-fps');
          const timelineFpsInput = document.getElementById('timeline-fps');
          if (exportFpsInput && timelineFpsInput) {
            exportFpsInput.value = timelineFpsInput.value;
          }
          this._setExportPresetInfo('手动');
        }
        modal.classList.remove('hidden');
      });
    }

    const btnMatchAnimation = document.getElementById('btn-export-match-animation');
    if (btnMatchAnimation) {
      btnMatchAnimation.addEventListener('click', () => {
        this._applyImportedAnimationExportPreset({ silent: false });
      });
    }

    // 取消
    const btnCancel = document.getElementById('btn-export-cancel');
    if (btnCancel) {
      btnCancel.addEventListener('click', () => {
        modal.classList.add('hidden');
      });
    }

    // 开始输出
    const btnStart = document.getElementById('btn-export-start');
    if (btnStart) {
      btnStart.addEventListener('click', () => {
        const duration = parseFloat(document.getElementById('export-duration').value) || 10;
        const showBg = document.getElementById('export-bg').checked;
        const showGrid = document.getElementById('export-grid').checked;
        const showVideo = document.getElementById('export-video').checked;
        const fw = parseInt(document.getElementById('frame-width').value) || 1920;
        const fh = parseInt(document.getElementById('frame-height').value) || 1080;
        const fps = parseInt(document.getElementById('export-fps').value) || 30;

        modal.classList.add('hidden');

        const ok = this.exportHandler.exportVideo({
          width: fw,
          height: fh,
          duration: Math.max(0.01, Math.min(3600, duration)),
          fps: fps,
          showBackground: showBg,
          showGrid: showGrid,
          showVideo: showVideo
        });

        if (!ok) {
          this.updateStatus('输出不支持 (请使用 Chrome/Firefox)');
        } else {
          this.updateStatus(`输出中... ${duration.toFixed(2)}s @ ${fps}fps  分辨率 ${fw}×${fh}`);
        }
      });
    }

    // 画幅输入 → 更新绿框
    const fwInput = document.getElementById('frame-width');
    const fhInput = document.getElementById('frame-height');
    const updateBorder = () => {
      const api = window.__atmosphereFX;
      if (api?.updateExportFrameBorder) api.updateExportFrameBorder();
    };
    if (fwInput) fwInput.addEventListener('input', updateBorder);
    if (fhInput) fhInput.addEventListener('input', updateBorder);
  }

  _setExportPresetInfo(text) {
    const info = document.getElementById('export-animation-preset-info');
    if (info) info.textContent = text;
  }

  _formatPresetDuration(seconds) {
    return Number.isInteger(seconds) ? String(seconds) : seconds.toFixed(2);
  }

  _applyImportedAnimationExportPreset({ silent = false } = {}) {
    const fallbackFps = this._fps || 30;
    const preset = this.fbxHandler.getImportedAnimationExportPreset?.(fallbackFps);
    if (!preset) {
      this._setExportPresetInfo('未检测');
      if (!silent) this.updateStatus('没有检测到可用于输出的 FBX 动画');
      return false;
    }

    const duration = Math.max(0.01, Math.min(3600, preset.duration));
    const fps = Math.max(1, Math.min(120, Math.round(preset.fps || fallbackFps)));
    const durationValue = this._formatPresetDuration(duration);

    const exportDurationInput = document.getElementById('export-duration');
    const exportFpsInput = document.getElementById('export-fps');
    if (exportDurationInput) exportDurationInput.value = durationValue;
    if (exportFpsInput) exportFpsInput.value = fps;

    const timelineDurationInput = document.getElementById('timeline-duration');
    const timelineFpsInput = document.getElementById('timeline-fps');
    if (timelineDurationInput) timelineDurationInput.value = durationValue;
    if (timelineFpsInput) timelineFpsInput.value = fps;

    if (this.timelineSystem) {
      this.timelineSystem.duration = duration;
      if (this.timelineSystem.currentTime > duration) {
        this.timelineSystem.setTime(duration);
      }
      const scrubber = document.getElementById('timeline-scrubber');
      if (scrubber) scrubber.max = duration;
      this._fps = fps;
      this._updateTimeDisplay();
      this._updateKeyframeMarkers();
    }

    this._setExportPresetInfo(`${preset.clipName}: ${durationValue}s @ ${fps}fps`);
    if (!silent) {
      this.updateStatus(`输出预设已匹配导入动画: ${durationValue}s @ ${fps}fps`);
    }
    return true;
  }

  _onExportRecordingState(state) {
    const btn = document.getElementById('btn-export');
    if (!btn) return;
    const label = btn.querySelector('span:last-child');

    if (state.isRecording) {
      btn.classList.add('primary');
      btn.classList.add('recording');
      if (label) label.textContent = `停止 ${state.remaining}s`;
    } else {
      btn.classList.remove('primary');
      btn.classList.remove('recording');
      if (label) label.textContent = '输出';
    }
  }


  // ── 时间线 ─────────────────────────────────────────

  /**
   * 为所有 range slider 添加录制监听
   */
  _hookSliderRecording() {
    const tl = this.timelineSystem;
    if (!tl) return;
    document.querySelectorAll('input[type="range"]').forEach(slider => {
      if (slider.id === 'timeline-scrubber' || slider.id === 'timeline-duration') return;
      slider.addEventListener('input', () => {
        if (tl.isRecording) {
          tl.addKeyframe(slider.id, tl.currentTime, parseFloat(slider.value));
        }
      });
    });
  }

  /**
   * 绑定时间线控件
   */
  _bindTimelineControls() {
    const tl = this.timelineSystem;
    if (!tl) return;

    // 播放/暂停
    const playBtn = document.getElementById('timeline-play');
    if (playBtn) {
      playBtn.addEventListener('click', () => {
        const playing = tl.togglePlay();
        this.fbxHandler.setAnimationPlaying(playing);
        playBtn.textContent = playing ? '⏸' : '▶';
        if (!playing && tl.isRecording) {
          tl.toggleRecording();
          const recordBtn = document.getElementById('timeline-record');
          if (recordBtn) recordBtn.classList.remove('recording');
        }
      });
    }

    // 停止
    const stopBtn = document.getElementById('timeline-stop');
    if (stopBtn) {
      stopBtn.addEventListener('click', () => {
        tl.stop();
        this.fbxHandler.stopAnimation();
        if (playBtn) playBtn.textContent = '▶';
        if (tl.isRecording) {
          tl.toggleRecording();
          const recordBtn = document.getElementById('timeline-record');
          if (recordBtn) recordBtn.classList.remove('recording');
        }
      });
    }

    // 循环
    const loopBtn = document.getElementById('timeline-loop');
    if (loopBtn) {
      loopBtn.addEventListener('click', () => {
        const looping = tl.toggleLoop();
        loopBtn.classList.toggle('active', looping);
      });
    }

    // 录制
    const recordBtn = document.getElementById('timeline-record');
    if (recordBtn) {
      recordBtn.addEventListener('click', () => {
        const recording = tl.toggleRecording();
        recordBtn.classList.toggle('recording', recording);
        this.updateStatus(recording ? '⭕ 录制中 — 拖动滑块自动记录关键帧' : '录制已停止');
      });
    }

    // 添加关键帧
    const addKfBtn = document.getElementById('timeline-add-kf');
    if (addKfBtn) {
      addKfBtn.addEventListener('click', () => {
        const snapshot = this._captureSliderSnapshot();
        tl.recordSnapshot(snapshot);
        this.updateStatus('关键帧已添加 — ' + Object.keys(snapshot).length + ' 个参数 @ ' + this._formatTime(tl.currentTime));
      });
    }

    // 清空
    const clearBtn = document.getElementById('timeline-clear');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        if (confirm('确定清除所有关键帧？')) {
          tl.clear();
          this.updateStatus('所有关键帧已清除');
        }
      });
    }

    // 进度条
    const scrubber = document.getElementById('timeline-scrubber');
    if (scrubber) {
      scrubber.addEventListener('input', () => {
        const time = parseFloat(scrubber.value);
        tl.setTime(time);
        const duration = this.fbxHandler.getActiveAnimationDuration();
        if (duration > 0) {
          this.fbxHandler.setAnimationTime(Math.min(time, duration));
        }
      });
    }

    // 时长
    const durInput = document.getElementById('timeline-duration');
    if (durInput) {
      durInput.addEventListener('change', () => {
        const dur = Math.max(1, parseFloat(durInput.value) || 10);
        tl.duration = dur;
        if (scrubber) scrubber.max = dur;
        if (tl.currentTime > dur) tl.setTime(dur);
        this._updateTimeDisplay();
        this._updateKeyframeMarkers();
      });
    }

    // FPS
    const fpsInput = document.getElementById('timeline-fps');
    if (fpsInput) {
      fpsInput.addEventListener('change', () => {
        this._fps = Math.max(1, parseInt(fpsInput.value) || 30);
        this._updateTimeDisplay();
      });
    }

    // 上一个关键帧
    const prevKfBtn = document.getElementById('timeline-prev-kf');
    if (prevKfBtn) {
      prevKfBtn.addEventListener('click', () => {
        const prev = tl.getPrevKeyframeTime(tl.currentTime);
        if (prev !== null) {
          tl.setTime(prev);
        } else {
          this.updateStatus('没有上一个关键帧');
        }
      });
    }

    // 下一个关键帧
    const nextKfBtn = document.getElementById('timeline-next-kf');
    if (nextKfBtn) {
      nextKfBtn.addEventListener('click', () => {
        const next = tl.getNextKeyframeTime(tl.currentTime);
        if (next !== null) {
          tl.setTime(next);
        } else {
          this.updateStatus('没有下一个关键帧');
        }
      });
    }

    // 删除当前时间的关键帧
    const delKfBtn = document.getElementById('timeline-del-kf');
    if (delKfBtn) {
      delKfBtn.addEventListener('click', () => {
        const before = tl.getAllKeyframeTimes().length;
        tl.removeAllKeyframesAt(tl.currentTime);
        const after = tl.getAllKeyframeTimes().length;
        if (after < before) {
          this.updateStatus('已删除当前时间的关键帧 (帧: ' + Math.floor(tl.currentTime * this._fps) + ')');
        } else {
          this.updateStatus('当前时间没有关键帧');
        }
      });
    }

  }

  /**
   * 注册时间线回调
   */
  _registerTimelineCallbacks() {
    const tl = this.timelineSystem;
    if (!tl) return;

    tl.onTimeChange = (time, duration) => {
      this._updateTimeDisplay();
      const scrubber = document.getElementById('timeline-scrubber');
      if (scrubber) scrubber.value = time;
    };

    tl.onApplyParam = (paramId, value) => {
      const slider = document.getElementById(paramId);
      const valSpan = document.getElementById(paramId + '-val');
      if (slider) slider.value = value;
      if (valSpan) valSpan.textContent = parseFloat(value).toFixed(2);

      if (paramId.startsWith('particle-')) {
        this._applyParticleFromSliders();
      } else if (paramId.startsWith('smoke-')) {
        this._applySmokeFromSliders();
      } else if (paramId.startsWith('godrays-')) {
        this._applyGodRaysFromSliders();
      } else if (paramId.startsWith('beam-')) {
        this._applyLightBeamSlider(paramId, value);
      } else if (paramId.startsWith('light-')) {
        this._applyLightFromSliders();
      } else if (paramId.startsWith('occluder-')) {
        this._applyOccluderSlider(paramId, value);
      }
    };

    tl.onKeyframesChanged = () => {
      this._updateKeyframeMarkers();
    };
  }

  /**
   * 捕获所有 range slider 当前值快照
   */
  _captureSliderSnapshot() {
    const snapshot = {};
    document.querySelectorAll('input[type="range"]').forEach(slider => {
      if (slider.id === 'timeline-scrubber' || slider.id === 'timeline-duration') return;
      snapshot[slider.id] = parseFloat(slider.value);
    });
    return snapshot;
  }

  /**
   * 时间格式化 MM:SS.S
   */
  _formatTime(seconds) {
    if (!seconds || !isFinite(seconds)) return '00:00.0';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    const secStr = s.toFixed(1);
    return String(m).padStart(2, '0') + ':' + String(secStr).padStart(4, '0');
  }

  /**
   * 更新时间显示
   */
  _updateTimeDisplay() {
    const display = document.getElementById('timeline-time-display');
    if (display && this.timelineSystem) {
      display.textContent = this._formatTime(this.timelineSystem.currentTime) + ' / ' + this._formatTime(this.timelineSystem.duration);
    }
    const frameDisplay = document.getElementById('timeline-frame-display');
    if (frameDisplay && this.timelineSystem) {
      const frame = Math.floor(this.timelineSystem.currentTime * this._fps);
      frameDisplay.textContent = '(帧: ' + String(frame).padStart(3, '0') + ')';
    }
  }

  /**
   * 应用单个遮挡板参数（用于时间线回放）
   */
  _applyOccluderSlider(paramId, value) {
    const oc = this.occluderSystem;
    if (!oc) return;
    switch (paramId) {
      case 'occluder-size': oc.size = value; break;
      case 'occluder-pattern-count': oc.patternCount = value; break;
      case 'occluder-pattern-angle': oc.patternAngle = value; break;
      case 'occluder-noise-density': oc.noiseDensity = value; break;
      case 'occluder-noise-scale': oc.noiseScale = value; break;
      case 'occluder-spot-size': oc.noiseSpotSize = value; break;
      case 'occluder-edge-softness': oc.noiseEdgeSoftness = value; break;
      case 'occluder-octaves': oc.noiseOctaves = value; break;
      case 'occluder-stretch-x': oc.noiseStretchX = value; break;
      case 'occluder-stretch-y': oc.noiseStretchY = value; break;
      case 'occluder-contrast': oc.noiseContrast = value; break;
      case 'occluder-distance': oc.distance = value; break;
      case 'occluder-offset-x': oc.offsetX = value; break;
      case 'occluder-offset-y': oc.offsetY = value; break;
      case 'occluder-rot-x': oc.rotX = value; break;
      case 'occluder-rot-y': oc.rotY = value; break;
      case 'occluder-rot-z': oc.rotZ = value; break;
    }
  }

  /**
   * 应用单个可见光束参数（用于时间线回放）
   */
  _applyLightBeamSlider(paramId, value) {
    const beam = this.lightBeamSystem;
    if (!beam) return;
    switch (paramId) {
      case 'beam-origin-x': beam.originX = value; break;
      case 'beam-origin-y': beam.originY = value; break;
      case 'beam-origin-z': beam.originZ = value; break;
      case 'beam-target-x': beam.targetX = value; break;
      case 'beam-target-y': beam.targetY = value; break;
      case 'beam-target-z': beam.targetZ = value; break;
      case 'beam-length': beam.length = value; break;
      case 'beam-radius': beam.radius = value; break;
      case 'beam-intensity': beam.intensity = value; break;
      case 'beam-plane-count': beam.planeCount = value; break;
      case 'beam-stripe-count': beam.stripeCount = value; break;
      case 'beam-stripe-strength': beam.stripeStrength = value; break;
      case 'beam-noise-strength': beam.noiseStrength = value; break;
      case 'beam-edge-softness': beam.edgeSoftness = value; break;
      case 'beam-attenuation': beam.attenuation = value; break;
      case 'beam-drift-speed': beam.driftSpeed = value; break;
    }
  }

  // ── 销毁 ─────────────────────────────────────────

  dispose() {
    // 移除所有事件监听（简化处理：克隆节点替换）
    const elements = [
      'btn-import-fbx', 'btn-add-light', 'btn-toggle-model',
      'btn-video-bg', 'btn-reset-view', 'btn-export'
    ];
    elements.forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        const clone = el.cloneNode(true);
        el.parentNode.replaceChild(clone, el);
      }
    });
  }

  /**
   * 在时间线标尺上渲染关键帧菱形标记
   */
  _renderKeyframeMarkers() {
    const ruler = document.getElementById('timeline-ruler');
    const tl = this.timelineSystem;
    if (!ruler || !tl) return;

    const times = tl.getAllKeyframeTimes();
    const duration = tl.duration;
    if (duration <= 0) return;

    for (const time of times) {
      const pct = (time / duration) * 100;
      const marker = document.createElement('div');
      marker.className = 'kf-marker';
      marker.style.left = pct + '%';
      marker.title = time.toFixed(2) + 's';
      marker.addEventListener('click', (e) => {
        e.stopPropagation();
        tl.setTime(time);
      });
      ruler.appendChild(marker);
    }
  }

  /**
   * 清除并重新渲染关键帧标记
   */
  _updateKeyframeMarkers() {
    const ruler = document.getElementById('timeline-ruler');
    if (!ruler) return;
    ruler.querySelectorAll('.kf-marker').forEach(el => el.remove());
    this._renderKeyframeMarkers();
  }

}
