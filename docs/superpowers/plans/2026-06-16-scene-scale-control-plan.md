# Scene Scale Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an adjustable FBX scene scale control that only scales the imported FBX root while refreshing camera and bounds references.

**Architecture:** `FBXHandler` owns import scale state and exposes methods for user scale changes. `UIHandler` binds the scene scale controls and refreshes camera/bounds feedback after changes. Existing particle, smoke, beam, occluder, and user-added scene objects stay in app-world coordinates.

**Tech Stack:** Vanilla JavaScript ES modules, Three.js, Node-based test scripts.

---

### Task 1: Scale State Tests

**Files:**
- Modify: `/Volumes/flame_stone/AI/codex/atomspherefx/tests/fbx-normalization.test.mjs`

- [ ] **Step 1: Write failing tests**

Add assertions that require `getImportScaleInfo()`, `setUserSceneScale()`, and `resetUserSceneScale()`:

```js
const scaleInfo = handler.getImportScaleInfo();
assert.equal(scaleInfo.userScale, 1, 'user scale defaults to 1');
assert.equal(scaleInfo.effectiveScale, scaleInfo.autoScale, 'effective scale starts at auto scale');

const sizeBeforeUserScale = normalizedBounds.getSize(new THREE.Vector3()).length();
handler.setUserSceneScale(2);
const doubledInfo = handler.getImportScaleInfo();
assert.equal(doubledInfo.userScale, 2, 'user scale stores manual multiplier');
assert.ok(Math.abs(doubledInfo.effectiveScale - doubledInfo.autoScale * 2) < 1e-12, 'effective scale combines auto and user scale');

const doubledBounds = handler._computeImportBounds(group);
const sizeAfterUserScale = doubledBounds.getSize(new THREE.Vector3()).length();
assert.ok(sizeAfterUserScale > sizeBeforeUserScale * 1.99, 'manual user scale doubles imported scene bounds');

handler._extractCameras(group);
const afterScaleCameraWorld = handler.cameras[0].worldPos;
assert.ok(afterScaleCameraWorld.some(v => Math.abs(v) > 0.2), 'camera list world position refreshes after user scale');
assert.deepEqual(handler.cameras[0].sourceWorldPos, scaleInfo.cameras?.[0]?.sourceWorldPos ?? handler.cameras[0].sourceWorldPos, 'source coordinates remain stable');

handler.resetUserSceneScale();
const resetInfo = handler.getImportScaleInfo();
assert.equal(resetInfo.userScale, 1, 'reset restores user scale');
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
node tests/fbx-normalization.test.mjs
```

Expected: FAIL because `getImportScaleInfo` or `setUserSceneScale` is not defined.

### Task 2: FBXHandler Scale API

**Files:**
- Modify: `/Volumes/flame_stone/AI/codex/atomspherefx/js/FBXHandler.js`

- [ ] **Step 1: Implement scale state**

Update `_importTransform` to store:

```js
autoScale: 1,
userScale: 1,
effectiveScale: 1,
center: new THREE.Vector3(),
rawSize: 0,
targetSize: 10
```

Change `_normalizeGroupToEditingScale(group)` so it computes `autoScale`, sets `userScale` to `1`, and calls a helper that applies `effectiveScale`.

- [ ] **Step 2: Add public methods**

Add:

```js
getImportScaleInfo()
setUserSceneScale(userScale)
resetUserSceneScale()
refreshImportDerivedData()
```

`setUserSceneScale()` clamps non-finite values and applies only to `currentModel`.

- [ ] **Step 3: Verify green**

Run:

```bash
node tests/fbx-normalization.test.mjs
```

Expected: PASS.

### Task 3: Scene Scale UI

**Files:**
- Modify: `/Volumes/flame_stone/AI/codex/atomspherefx/index.html`
- Modify: `/Volumes/flame_stone/AI/codex/atomspherefx/css/style.css`
- Modify: `/Volumes/flame_stone/AI/codex/atomspherefx/js/UIHandler.js`

- [ ] **Step 1: Add markup**

Add a compact panel with:

```html
<input type="range" id="scene-scale-log" min="-2" max="2" step="0.01" value="0">
<span id="scene-scale-value">1.00x</span>
<span id="scene-scale-info">未导入</span>
<button id="btn-reset-scene-scale">重置</button>
```

- [ ] **Step 2: Bind UIHandler**

Add methods:

```js
_bindSceneScaleControls()
_refreshSceneScaleUI()
_applySceneScaleFromSlider()
```

The slider maps `logValue` to `Math.pow(10, logValue)`.

- [ ] **Step 3: Refresh references after scale changes**

After `setUserSceneScale()`:

- call `_renderCameraList(this.fbxHandler.cameras)`
- call `_updateSliderRanges()`
- update the active camera view if following FBX camera
- refresh orbit bounds without moving free-view unless needed

### Task 4: Verification

**Files:**
- No production file changes beyond Tasks 1-3.

- [ ] **Step 1: Run automated checks**

Run:

```bash
node tests/fbx-normalization.test.mjs
node tests/particle-presets.test.mjs
node tests/smoke-presets.test.mjs
node tests/motion-blur.test.mjs
for f in js/*.js; do node --check "$f" || exit 1; done
node --input-type=module -e "import * as esbuild from 'esbuild'; await esbuild.build({entryPoints:['js/main.js'],bundle:true,format:'iife',globalName:'App',outfile:'/tmp/atomspherefx-check.js',external:['postprocessing','three-good-godrays'],logLevel:'warning'}); console.log('bundle ok');"
```

Expected: all commands exit `0`.

- [ ] **Step 2: Browser verification**

Open:

```text
http://127.0.0.1:8080/index.html?v=34
```

Expected:

- page loads without console errors
- scene scale panel is visible after FBX import
- changing scale affects imported FBX/camera path only
- effect UI values remain unchanged

