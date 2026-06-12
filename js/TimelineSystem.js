/**
 * TimelineSystem.js — 时间线关键帧动画引擎
 *
 * 管理所有参数的关键帧数据，提供播放/录制/插值功能。
 * 无 DOM 依赖，通过回调与 UI 层通信。
 *
 * 数据模型：
 *   _keyframes: Map<paramId, Keyframe[]>
 *   Keyframe = { time: number, value: number }
 *
 * 回调：
 *   onApplyParam(paramId, value) — 插值结果应用到参数
 *   onTimeChange(time, duration) — 时间/进度更新
 */

export class TimelineSystem {
  constructor() {
    /** @type {Map<string, {time:number, value:number}[]>} */
    this._keyframes = new Map();

    this._isPlaying = false;
    this._isLooping = true;
    this._isRecording = false;

    this.currentTime = 0;
    this.duration = 10;

    /** @type {(paramId:string, value:number) => void} */
    this.onApplyParam = null;

    /** @type {(time:number, duration:number) => void} */
    this.onTimeChange = null;

    /** @type {() => void} */
    this.onKeyframesChanged = null;

    /** 每参数上次应用的值，避免冗余回调 */
    this._lastValues = new Map();

    /** 录制防抖：每参数 { time, value } */
    this._lastRecordInfo = new Map();
  }

  // ── 播放控制 ──────────────────────────────────

  get isPlaying() { return this._isPlaying; }
  get isLooping() { return this._isLooping; }
  get isRecording() { return this._isRecording; }

  play() {
    this._isPlaying = true;
  }

  pause() {
    this._isPlaying = false;
  }

  stop() {
    this._isPlaying = false;
    this.setTime(0);
  }

  togglePlay() {
    this._isPlaying = !this._isPlaying;
    return this._isPlaying;
  }

  toggleLoop() {
    this._isLooping = !this._isLooping;
    return this._isLooping;
  }

  toggleRecording() {
    this._isRecording = !this._isRecording;
    return this._isRecording;
  }

  // ── 时间控制 ──────────────────────────────────

  /**
   * 跳转到指定时间，立即应用插值
   */
  setTime(t) {
    this.currentTime = Math.max(0, Math.min(t, this.duration));
    this._applyAll();
    if (this.onTimeChange) {
      this.onTimeChange(this.currentTime, this.duration);
    }
  }

  // ── 关键帧操作 ────────────────────────────────

  /**
   * 添加/更新关键帧。0.3s 内同一 param 的连续记录会合并。
   */
  addKeyframe(paramId, time, value) {
    const last = this._lastRecordInfo.get(paramId);
    if (last && (time - last.time) < 0.3) {
      // 防抖：更新最近的关键帧值
      this._updateLatestKeyframeValue(paramId, value);
      last.time = time;
      last.value = value;
      return;
    }
    const inserted = this._insertKeyframe(paramId, { time, value });
    this._lastRecordInfo.set(paramId, { time, value });
    if (inserted && this.onKeyframesChanged) {
      this.onKeyframesChanged();
    }
  }

  /**
   * 删除 paramId 在 time 附近的关键帧
   */
  removeKeyframe(paramId, time) {
    const list = this._keyframes.get(paramId);
    if (!list || list.length === 0) return;

    let nearest = 0;
    let minDist = Infinity;
    for (let i = 0; i < list.length; i++) {
      const d = Math.abs(list[i].time - time);
      if (d < minDist) { minDist = d; nearest = i; }
    }
    list.splice(nearest, 1);
    if (list.length === 0) this._keyframes.delete(paramId);
    this._lastValues.delete(paramId);
    if (this.onKeyframesChanged) this.onKeyframesChanged();
  }

  /**
   * 删除指定时间点附近的所有参数的关键帧
   * @param {number} time
   */
  removeAllKeyframesAt(time) {
    let anyRemoved = false;
    for (const [paramId, list] of this._keyframes) {
      for (let i = list.length - 1; i >= 0; i--) {
        if (Math.abs(list[i].time - time) < 0.01) {
          list.splice(i, 1);
          anyRemoved = true;
        }
      }
      if (list.length === 0) {
        this._keyframes.delete(paramId);
      }
    }
    if (anyRemoved) {
      this._lastValues.clear();
      if (this.onKeyframesChanged) this.onKeyframesChanged();
    }
  }

  /**
   * 获取 paramId 的所有关键帧（按时间排序的拷贝）
   */
  getKeyframes(paramId) {
    const list = this._keyframes.get(paramId);
    return list ? list.map(kf => ({ ...kf })) : [];
  }

  /**
   * 获取所有有关键帧的 paramId
   */
  getAllParamIds() {
    return Array.from(this._keyframes.keys());
  }

  /**
   * 获取所有唯一的关键帧时间点（跨所有参数），升序排列
   * @returns {number[]}
   */
  getAllKeyframeTimes() {
    const seen = new Set();
    const times = [];
    for (const [, list] of this._keyframes) {
      for (const kf of list) {
        const t = Math.round(kf.time * 100) / 100;
        if (!seen.has(t)) {
          seen.add(t);
          times.push(t);
        }
      }
    }
    times.sort((a, b) => a - b);
    return times;
  }

  /**
   * 获取当前时间之前的最近关键帧时间
   * @param {number} time
   * @returns {number|null}
   */
  getPrevKeyframeTime(time) {
    const times = this.getAllKeyframeTimes();
    if (times.length === 0) return null;
    const rounded = Math.round(time * 100) / 100;
    for (let i = times.length - 1; i >= 0; i--) {
      if (times[i] < rounded - 0.01) return times[i];
    }
    return null;
  }

  /**
   * 获取当前时间之后的下一个关键帧时间
   * @param {number} time
   * @returns {number|null}
   */
  getNextKeyframeTime(time) {
    const times = this.getAllKeyframeTimes();
    if (times.length === 0) return null;
    const rounded = Math.round(time * 100) / 100;
    for (const t of times) {
      if (t > rounded + 0.01) return t;
    }
    return null;
  }

  /**
   * 清除所有关键帧
   */
  clear() {
    this._keyframes.clear();
    this._lastValues.clear();
    this._lastRecordInfo.clear();
    if (this.onKeyframesChanged) this.onKeyframesChanged();
  }

  /**
   * 记录当前所有已注册参数的值到当前时间点
   * 通过 onApplyParam 读取参数当前值的机制：如果系统提供了 getter，
   * 调用者应在 recordSnapshot 前将 getter 注入。
   */
  recordSnapshot(paramValues) {
    // paramValues: { paramId: value, ... }
    // 如果没传则尝试通过 onApplyParam 反向获取（不完美，但可用）
    if (paramValues) {
      for (const [paramId, value] of Object.entries(paramValues)) {
        this.addKeyframe(paramId, this.currentTime, value);
      }
    } else {
      // 用 lastValues 作为 fallback（不够准确但不会崩溃）
      for (const [paramId] of this._keyframes) {
        const val = this._lastValues.get(paramId);
        if (val !== undefined) {
          this.addKeyframe(paramId, this.currentTime, val);
        }
      }
    }
  }

  // ── 每帧更新 ──────────────────────────────────

  /**
   * 动画循环中调用
   * @param {number} dt — 帧间隔秒数
   */
  update(dt) {
    if (!this._isPlaying) return;

    this.currentTime += Math.min(dt, 0.1);

    if (this.currentTime >= this.duration) {
      if (this._isLooping) {
        this.currentTime %= this.duration;
        this._applyAll();
      } else {
        this.currentTime = this.duration;
        this._isPlaying = false;
        this._applyAll();
      }
      if (this.onTimeChange) {
        this.onTimeChange(this.currentTime, this.duration);
      }
      return;
    }

    this._applyAll();

    if (this.onTimeChange) {
      this.onTimeChange(this.currentTime, this.duration);
    }
  }

  // ── 序列化 ────────────────────────────────────

  toJSON() {
    const data = { duration: this.duration, tracks: {} };
    for (const [paramId, list] of this._keyframes) {
      if (list.length > 0) {
        data.tracks[paramId] = list.map(kf => ({ t: kf.time, v: kf.value }));
      }
    }
    return JSON.stringify(data);
  }

  fromJSON(jsonStr) {
    try {
      const data = typeof jsonStr === 'string' ? JSON.parse(jsonStr) : jsonStr;
      this.clear();
      this.duration = data.duration || 10;
      if (data.tracks) {
        for (const [paramId, list] of Object.entries(data.tracks)) {
          const kfs = list.map(item => ({ time: item.t, value: item.v }));
          kfs.sort((a, b) => a.time - b.time);
          this._keyframes.set(paramId, kfs);
        }
      }
      this.setTime(0);
      if (this.onKeyframesChanged) this.onKeyframesChanged();
    } catch (e) {
      console.error('TimelineSystem: JSON 解析失败', e);
    }
  }

  // ── 内部方法 ──────────────────────────────────

  _insertKeyframe(paramId, kf) {
    let list = this._keyframes.get(paramId);
    if (!list) {
      list = [];
      this._keyframes.set(paramId, list);
    }

    // 如果该时间已存在关键帧，更新值
    for (let i = 0; i < list.length; i++) {
      if (Math.abs(list[i].time - kf.time) < 0.01) {
        list[i].value = kf.value;
        return false;
      }
    }

    list.push({ time: kf.time, value: kf.value });
    list.sort((a, b) => a.time - b.time);
    this._lastValues.delete(paramId);
    return true;
  }

  _updateLatestKeyframeValue(paramId, value) {
    const list = this._keyframes.get(paramId);
    if (list && list.length > 0) {
      list[list.length - 1].value = value;
      this._lastValues.delete(paramId);
    }
  }

  /**
   * 线性插值
   */
  _interpolate(paramId, time) {
    const list = this._keyframes.get(paramId);
    if (!list || list.length === 0) return null;
    if (list.length === 1) return list[0].value;
    if (time <= list[0].time) return list[0].value;
    if (time >= list[list.length - 1].time) return list[list.length - 1].value;

    // 二分查找
    let lo = 0, hi = list.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (list[mid].time <= time) lo = mid;
      else hi = mid;
    }

    const a = list[lo], b = list[hi];
    const t = (time - a.time) / (b.time - a.time);
    return a.value + (b.value - a.value) * Math.max(0, Math.min(1, t));
  }

  /**
   * 对所有有关键帧的参数应用当前时间的插值
   */
  _applyAll() {
    for (const [paramId] of this._keyframes) {
      const val = this._interpolate(paramId, this.currentTime);
      if (val === null) continue;
      const last = this._lastValues.get(paramId);
      if (val !== last) {
        this._lastValues.set(paramId, val);
        if (this.onApplyParam) {
          this.onApplyParam(paramId, val);
        }
      }
    }
  }
}
