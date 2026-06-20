# AtmosphereFX Scene Scale Control Design

## Goal

AtmosphereFX needs a controllable scene-scale workflow for imported FBX files. The app should still auto-fit unusually large or small FBX scenes on import, but users must be able to adjust the imported scene scale afterward without moving existing particles, smoke, light beams, or their emitter origins.

## Selected Approach

Use "scene scale + refreshed references":

- Import keeps the current automatic normalization step.
- A new manual scene scale multiplier applies only to the imported FBX root group.
- After scale changes, the app refreshes camera list positions, model bounds, camera path bounds, slider ranges, and fit/reset view data.
- Existing effect systems remain in app world coordinates. Particle, smoke, beam, and occluder origins do not move when the FBX scene scale changes.

## Behavior

### Import

When an FBX is loaded, `FBXHandler` computes raw bounds from meshes, cameras, lights, and position animation keys. It then computes an automatic import scale:

- camera-position animated scenes target a larger editing span
- ordinary model scenes target a smaller editing span

The automatic scale is stored as `autoScale`. The current effective FBX scale starts as:

```text
effectiveScale = autoScale * userScale
userScale = 1
```

### Manual Scaling

The UI exposes a "scene scale" control. It adjusts `userScale`, not the raw imported data.

The FBX root transform is rebuilt from the original import center:

```text
fbxRoot.scale = effectiveScale
fbxRoot.position = -rawCenter * effectiveScale
```

This keeps the imported scene centered while changing its working size.

### What Changes

Manual scene scaling updates:

- FBX mesh size in the viewport
- FBX cameras and camera animation path in world coordinates
- camera list world-position readouts
- model size and bounds used by fit-to-view
- helper ranges based on current model size
- active FBX camera preview if the app is following that camera

### What Does Not Change

Manual scene scaling does not update:

- particle origin, spread, velocity, or particle positions
- smoke origin, spread, drift, or particle positions
- light beam origin/target/radius
- occluder target or placement
- user-added lights and scene objects

This matches the intended workflow: scene scale is a reference/import correction, while effects are independent scene elements.

## UI

Add a compact "scene scale" block near the camera/import controls or top status area:

- current automatic import scale, read-only
- user scale slider, default `1`
- numeric current working size
- reset button: returns `userScale` to `1`

Suggested slider range:

```text
0.01 to 100, logarithmic mapping
```

The displayed value should be readable as a multiplier:

```text
0.25x, 1.00x, 4.00x
```

The slider can be implemented with a linear range of `-2..2` and mapped to `10^value` for smoother control over tiny and huge scenes.

## Architecture

### `FBXHandler`

Add explicit scale state:

```js
_importTransform = {
  autoScale,
  userScale,
  effectiveScale,
  center,
  rawSize,
  targetSize
}
```

Add methods:

```js
getImportScaleInfo()
setUserSceneScale(userScale)
resetUserSceneScale()
refreshImportDerivedData()
```

`setUserSceneScale()` should:

1. clamp and store the multiplier
2. rebuild root transform from original center and effective scale
3. update world matrices
4. refresh camera metadata and camera path
5. notify UI/model-loaded style callbacks if needed

### `UIHandler`

Add bindings for:

- scene scale slider
- scene scale value text
- reset scene scale button

After scale changes:

- refresh the camera list
- call `_updateSliderRanges()`
- update status text
- if actively following an FBX camera, resync the main camera from that FBX camera
- otherwise update `OrbitController.fitToBounds()` or reset-view data without forcing the user's current view unless necessary

### `OrbitController`

No new ownership of scale. It only receives refreshed bounds and updates min/max distance, pan speed, near/far, and reset view.

## Edge Cases

- FBX without geometry but with animated camera position must still produce usable bounds.
- Tiny scenes should not collapse to unreadable near-zero values.
- Huge scenes should not push camera near/far into unusable ranges.
- Changing scene scale while animation is paused should preserve the current animation time.
- Changing scene scale while following an animated FBX camera should keep the main camera aligned to the current FBX camera frame.

## Testing

Add or extend tests for:

- importing huge camera-animation scenes keeps `autoScale` and exposes `userScale`
- applying `userScale = 2` doubles normalized FBX bounds
- camera list world positions refresh after scaling
- original source coordinates remain unchanged
- effect-origin values are not modified by FBX scene scaling

Run:

```bash
node tests/fbx-normalization.test.mjs
node tests/particle-presets.test.mjs
node tests/smoke-presets.test.mjs
node tests/motion-blur.test.mjs
for f in js/*.js; do node --check "$f" || exit 1; done
```

## Non-Goals

- Do not globally scale all scene objects.
- Do not rewrite particle, smoke, beam, or occluder coordinate systems in this change.
- Do not change exported frame timing or output path behavior.
- Do not replace automatic import normalization; manual scaling builds on top of it.
