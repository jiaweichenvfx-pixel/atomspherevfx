import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FBXHandler } from '../js/FBXHandler.js';

const handler = new FBXHandler(new THREE.Scene(), null);

const group = new THREE.Group();
const cameraRig = new THREE.Group();
cameraRig.name = 'HugeCameraRig';
cameraRig.position.set(100000, 50000, -25000);
group.add(cameraRig);

const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 1000000);
camera.name = 'HugeCamera';
camera.position.set(5000, 0, 0);
cameraRig.add(camera);

const mesh = new THREE.Mesh(
  new THREE.BoxGeometry(2, 2, 2),
  new THREE.MeshBasicMaterial()
);
mesh.name = 'TinyReferenceMesh';
group.add(mesh);

const clip = new THREE.AnimationClip('CameraOrbit', 1, [
  new THREE.VectorKeyframeTrack('HugeCameraRig.position', [0, 1], [
    100000, 50000, -25000,
    -120000, 30000, 40000
  ])
]);
group.animations = [clip];

const rawBounds = handler._computeImportBounds(group);
assert.ok(rawBounds.getSize(new THREE.Vector3()).length() > 100000, 'raw bounds includes huge camera animation');

const result = handler._normalizeGroupToEditingScale(group);
assert.ok(result.scale > 0.0001, 'huge camera scene is not collapsed to near-zero scale');
assert.equal(result.targetSize, 100, 'camera-driven scenes use a larger editing target');
const scaleInfo = handler.getImportScaleInfo();
assert.equal(scaleInfo.userScale, 1, 'user scale defaults to 1');
assert.equal(scaleInfo.effectiveScale, scaleInfo.autoScale, 'effective scale starts at auto scale');

group.updateWorldMatrix(true, true);
const normalizedBounds = handler._computeImportBounds(group);
assert.ok(normalizedBounds.getSize(new THREE.Vector3()).length() <= 100.1, 'normalized camera bounds fits larger editing scale');
assert.ok(normalizedBounds.getCenter(new THREE.Vector3()).length() < 0.01, 'normalized bounds is centered near origin');
const normalizedSize = normalizedBounds.getSize(new THREE.Vector3()).length();

handler.currentModel = group;
handler.animations = group.animations;
handler._extractCameras(group);

assert.ok(handler.cameras[0].worldPos.some(v => Math.abs(v) > 0.1), 'normalized camera list position stays readable');
assert.ok(handler.cameras[0].sourceWorldPos.some(v => Math.abs(v) > 1000), 'camera list keeps original source coordinates');
const originalSourceWorldPos = [...handler.cameras[0].sourceWorldPos];

handler.setUserSceneScale(2);
const doubledInfo = handler.getImportScaleInfo();
assert.equal(doubledInfo.userScale, 2, 'user scale stores manual multiplier');
assert.ok(
  Math.abs(doubledInfo.effectiveScale - doubledInfo.autoScale * 2) < 1e-12,
  'effective scale combines auto and user scale'
);

const doubledBounds = handler._computeImportBounds(group);
const doubledSize = doubledBounds.getSize(new THREE.Vector3()).length();
assert.ok(doubledSize > normalizedSize * 1.99, 'manual user scale doubles imported scene bounds');
assert.ok(doubledBounds.getCenter(new THREE.Vector3()).length() < 0.01, 'manual user scale keeps scene centered');

handler._extractCameras(group);
assert.ok(handler.cameras[0].worldPos.some(v => Math.abs(v) > 0.2), 'camera list world position refreshes after user scale');
assert.deepEqual(handler.cameras[0].sourceWorldPos, originalSourceWorldPos, 'source coordinates remain stable after user scale');

handler.resetUserSceneScale();
const resetInfo = handler.getImportScaleInfo();
assert.equal(resetInfo.userScale, 1, 'reset restores user scale');
const resetBounds = handler._computeImportBounds(group);
const resetSize = resetBounds.getSize(new THREE.Vector3()).length();
assert.ok(Math.abs(resetSize - normalizedSize) < 1e-6, 'reset restores normalized scene bounds');
