/**
 * ExportHandler.js — 输出模块
 * 视频录制 (MP4/WebM via MediaRecorder + canvas.captureStream)
 * 默认 1920×1080，优先 H.264/MP4，高码率 20Mbps
 * 依赖：THREE.WebGLRenderer（需 preserveDrawingBuffer: true）
 */

import * as THREE from 'three';

export class ExportHandler {
  constructor(renderer, gridHelper, axesHelper, sceneManager) {
    this._renderer = renderer;
    this._gridHelper = gridHelper;
    this._axesHelper = axesHelper;
    this._sceneManager = sceneManager;
    this._camera = null; // 由外部设置
    this._particleSystem = null; // 由外部设置，用于导出时调整粒子大小
    this._smokeSystem = null; // 由外部设置，用于导出时调整烟雾大小
    this._godRaysSystem = null; // 由外部设置，用于导出时同步 composer 尺寸

    this._isRecording = false;
    this._mediaRecorder = null;
    this._recordedChunks = [];
    this._mimeType = '';
    this._recordingTimer = null;
    this._countdownInterval = null;
    this._savedState = null;
    this._onRecordingStateChange = null;
    this._savedOccluderHelperVis = undefined;
  }

  setCamera(camera) { this._camera = camera; }
  setParticleSystem(ps) { this._particleSystem = ps; }
  setSmokeSystem(ss) { this._smokeSystem = ss; }
  setGodRaysSystem(grs) { this._godRaysSystem = grs; }

  // ── 输出视频 ──────────────────────────────────

  /**
   * @param {object} options
   * @param {number} options.width
   * @param {number} options.height
   * @param {number} options.duration
   * @param {boolean} options.showBackground
   * @param {boolean} options.showGrid
   * @param {boolean} options.showVideo
   */
  exportVideo(options) {
    if (this._isRecording) return false;

    const { width, height, duration, fps = 30, showBackground, showGrid, showVideo } = options;
    const validFps = Math.max(1, Math.min(120, Math.round(fps)));
    const stream = this._renderer.domElement.captureStream
      ? this._renderer.domElement.captureStream(validFps)
      : null;
    if (!stream || typeof MediaRecorder === 'undefined') {
      console.warn('ExportHandler: MediaRecorder 不支持');
      return false;
    }

    // 保存当前状态
    this._savedState = this._captureState();

    // 应用导出设置
    this._applyExportState(width, height, showBackground, showGrid, showVideo);

    this._mimeType = this._bestMimeType();
    this._recordedChunks = [];

    this._mediaRecorder = new MediaRecorder(stream, {
      mimeType: this._mimeType,
      videoBitsPerSecond: 20000000
    });

    this._mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) this._recordedChunks.push(e.data);
    };

    this._mediaRecorder.onstop = () => {
      const blob = new Blob(this._recordedChunks, { type: this._mimeType });
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const ext = this._mimeType.startsWith('video/mp4') ? 'mp4' : 'webm';
      this._triggerDownload(blob, `atmosphereFX-${ts}.${ext}`);
      this._restoreState();
      this._cleanup();
    };

    this._mediaRecorder.start();

    this._recordingTimer = setTimeout(() => this.stopRecording(), duration * 1000);

    const startTime = performance.now();
    this._countdownInterval = setInterval(() => {
      const elapsed = (performance.now() - startTime) / 1000;
      const remaining = Math.max(0, Math.ceil(duration - elapsed));
      if (this._onRecordingStateChange) {
        this._onRecordingStateChange({ isRecording: true, remaining, total: duration });
      }
    }, 250);

    this._isRecording = true;
    if (this._onRecordingStateChange) {
      this._onRecordingStateChange({ isRecording: true, remaining: duration, total: duration });
    }
    return true;
  }

  stopRecording() {
    if (!this._isRecording || !this._mediaRecorder) return false;

    if (this._mediaRecorder.state === 'recording') {
      this._mediaRecorder.requestData();
      this._mediaRecorder.stop();
    }

    if (this._mediaRecorder.stream) {
      this._mediaRecorder.stream.getTracks().forEach(t => t.stop());
    }

    clearTimeout(this._recordingTimer);
    clearInterval(this._countdownInterval);
    this._recordingTimer = null;
    this._countdownInterval = null;
    this._isRecording = false;

    if (this._onRecordingStateChange) {
      this._onRecordingStateChange({ isRecording: false, remaining: 0, total: 0 });
    }
    return true;
  }

  // ── 状态查询 ──────────────────────────────────

  get isRecording() { return this._isRecording; }

  // ── 销毁 ──────────────────────────────────────

  dispose() {
    if (this._isRecording) this.stopRecording();
    this._onRecordingStateChange = null;
    this._renderer = null;
  }

  // ── 内部：状态保存/应用/恢复 ──────────────────

  _captureState() {
    const bodyStyle = document.body.style.backgroundColor;
    const canvas = this._renderer.domElement;
    const origPixelRatio = this._renderer.getPixelRatio();
    const origWidth = canvas.width;
    const origHeight = canvas.height;
    const origCanvasStyleW = canvas.style.width;
    const origCanvasStyleH = canvas.style.height;
    const origCanvasPos = canvas.style.position;
    const origCanvasLeft = canvas.style.left;
    const origCanvasTop = canvas.style.top;

    const origAspect = this._camera ? this._camera.aspect : 1;
    const origGridVis = this._gridHelper ? this._gridHelper.visible : true;
    const origAxesVis = this._axesHelper ? this._axesHelper.visible : true;
    const origVideoEnabled = this._sceneManager ? this._sceneManager.videoEnabled : false;
    const origVideoEl = document.getElementById('video-background');
    const origVideoDisplay = origVideoEl ? origVideoEl.style.display : '';

    // 保存 renderer 的透明相关状态
    const origClearColor = this._renderer.getClearColor(new THREE.Color());
    const origClearAlpha = this._renderer.getClearAlpha();

    // ★ 保存遮挡板状态（导出时 detach TransformControls 会触发自动更新）
    const api = window.__atmosphereFX;
    const occ = api?.occluderSystem;
    const occState = occ ? {
      pos: occ._mesh?.position.clone(),
      rot: occ._mesh?.rotation.clone(),
      wasControlled: occ._mesh && api._selectOccluderForTransform ? null : null,
      // 实际上我们用 transformControls.object 来判断
      enabled: occ.enabled,
    } : null;

    return {
      bodyStyle, origPixelRatio, origWidth, origHeight,
      origCanvasStyleW, origCanvasStyleH,
      origCanvasPos, origCanvasLeft, origCanvasTop,
      origAspect, origGridVis, origAxesVis,
      origVideoEnabled, origVideoEl, origVideoDisplay,
      origClearColor, origClearAlpha,
      occState  // ★ 新增
    };
  }

  _applyExportState(width, height, showBg, showGrid, showVideo) {
    // 背景色
    let bgColorHex = '#000000';
    if (showBg) {
      const colorPicker = document.getElementById('bg-color');
      bgColorHex = colorPicker ? colorPicker.value : '#1a1a2e';
      document.body.style.backgroundColor = bgColorHex;
    } else {
      document.body.style.backgroundColor = '#000000';
    }

    // 网格/坐标轴
    if (this._gridHelper) this._gridHelper.visible = showGrid;
    if (this._axesHelper) this._axesHelper.visible = showGrid;

    // 视频背景
    const videoEl = document.getElementById('video-background');
    if (videoEl) {
      if (showVideo && this._sceneManager.videoEnabled) {
        videoEl.style.display = 'block';
      } else {
        videoEl.style.display = 'none';
      }
    }

    // ★ 隐藏 TransformControls 把手和遮挡板辅助线框
    const api = window.__atmosphereFX;
    if (api) {
      api._deselectForTransform?.();
      // 隐藏遮挡板橙色辅助线框
      const occHelper = api.occluderSystem?.helper;
      if (occHelper) {
        this._savedOccluderHelperVis = occHelper.visible;
        occHelper.visible = false;
      }
    }

    // Resize renderer to export resolution (pixelRatio=1 for exact match)
    this._renderer.setPixelRatio(1);
    this._renderer.setSize(width, height, false);
    this._godRaysSystem?.setSize(width, height);
    this._renderer.domElement.style.width = width + 'px';
    this._renderer.domElement.style.height = height + 'px';
    this._renderer.domElement.style.position = 'fixed';
    this._renderer.domElement.style.left = '-9999px';
    this._renderer.domElement.style.top = '0px';

    // 设置 canvas 不透明 + 匹配背景色（捕获完整的画面，而非透明的 canvas）
    // 这样 captureStream 拿到的就是所见即所得
    const bgColor = new THREE.Color(bgColorHex);
    this._renderer.setClearColor(bgColor, 1.0);

    // 粒子大小随分辨率缩放（gl_PointSize 基于 viewport 像素）
    if (this._particleSystem) {
      this._particleSystem.updatePointScale(height);
    }
    if (this._smokeSystem) {
      this._smokeSystem.updatePointScale(height);
    }

    if (this._camera) {
      this._camera.aspect = width / height;
      this._camera.updateProjectionMatrix();
    }
  }

  _restoreState() {
    const s = this._savedState;
    if (!s) return;

    document.body.style.backgroundColor = s.bodyStyle;

    if (this._gridHelper) this._gridHelper.visible = s.origGridVis;
    if (this._axesHelper) this._axesHelper.visible = s.origAxesVis;

    if (s.origVideoEl) {
      s.origVideoEl.style.display = s.origVideoDisplay;
    }

    // 恢复像素比（必须在 setSize 之前，且需要还原 CSS 尺寸而非内部尺寸）
    if (s.origPixelRatio) {
      this._renderer.setPixelRatio(s.origPixelRatio);
    }
    // origWidth/origHeight 是 canvas 内部像素尺寸，需换算回 CSS 尺寸
    const cssW = s.origPixelRatio ? s.origWidth / s.origPixelRatio : s.origWidth;
    const cssH = s.origPixelRatio ? s.origHeight / s.origPixelRatio : s.origHeight;
    this._renderer.setSize(cssW, cssH, false);
    this._renderer.domElement.style.width = s.origCanvasStyleW;
    this._renderer.domElement.style.height = s.origCanvasStyleH;
    this._renderer.domElement.style.position = s.origCanvasPos;
    this._renderer.domElement.style.left = s.origCanvasLeft;
    this._renderer.domElement.style.top = s.origCanvasTop;

    // 恢复 canvas 透明设置
    if (s.origClearColor) {
      this._renderer.setClearColor(s.origClearColor, s.origClearAlpha);
    }

    // 恢复粒子大小缩放
    if (this._particleSystem) {
      this._particleSystem.updatePointScale(this._renderer.domElement.height);
    }
    if (this._smokeSystem) {
      this._smokeSystem.updatePointScale(this._renderer.domElement.height);
    }
    if (this._godRaysSystem) {
      this._godRaysSystem.setSize(this._renderer.domElement.width, this._renderer.domElement.height);
    }

    // 恢复遮挡板辅助线框可见性
    if (this._savedOccluderHelperVis !== undefined) {
      const occHelper = window.__atmosphereFX?.occluderSystem?.helper;
      if (occHelper) occHelper.visible = this._savedOccluderHelperVis;
      this._savedOccluderHelperVis = undefined;
    }

    // ★ 恢复遮挡板位置（导出时 animate loop 可能改变了它）
    if (s.occState && s.occState.enabled) {
      const occ = window.__atmosphereFX?.occluderSystem;
      if (occ?._mesh) {
        occ._mesh.position.copy(s.occState.pos);
        occ._mesh.rotation.copy(s.occState.rot);
      }
    }

    if (this._camera) {
      this._camera.aspect = s.origAspect;
      this._camera.updateProjectionMatrix();
    }

    this._savedState = null;
  }

  // ── 内部方法 ──────────────────────────────────

  _bestMimeType() {
    const types = [
      'video/mp4; codecs=avc1.42E01E,mp4a.40.2',
      'video/mp4; codecs=avc1.42E01E',
      'video/mp4',
      'video/webm; codecs=avc1.42E01E',
      'video/webm; codecs=vp9,opus',
      'video/webm; codecs=vp9',
      'video/webm; codecs=vp8,opus',
      'video/webm; codecs=vp8',
      'video/webm'
    ];
    for (const t of types) {
      if (MediaRecorder.isTypeSupported(t)) return t;
    }
    return 'video/webm';
  }

  _triggerDownload(blobOrUrl, filename) {
    const url = blobOrUrl instanceof Blob
      ? URL.createObjectURL(blobOrUrl)
      : blobOrUrl;
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    if (blobOrUrl instanceof Blob) {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }

  _cleanup() {
    clearTimeout(this._recordingTimer);
    clearInterval(this._countdownInterval);
    this._recordingTimer = null;
    this._countdownInterval = null;
    this._isRecording = false;
    if (this._mediaRecorder?.stream) {
      this._mediaRecorder.stream.getTracks().forEach(t => t.stop());
    }
    this._mediaRecorder = null;
  }
}
