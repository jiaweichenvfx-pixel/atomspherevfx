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

group.updateWorldMatrix(true, true);
const normalizedBounds = handler._computeImportBounds(group);
assert.ok(normalizedBounds.getSize(new THREE.Vector3()).length() <= 100.1, 'normalized camera bounds fits larger editing scale');
assert.ok(normalizedBounds.getCenter(new THREE.Vector3()).length() < 0.01, 'normalized bounds is centered near origin');

handler.currentModel = group;
handler.animations = group.animations;
handler._extractCameras(group);

assert.ok(handler.cameras[0].worldPos.some(v => Math.abs(v) > 0.1), 'normalized camera list position stays readable');
assert.ok(handler.cameras[0].sourceWorldPos.some(v => Math.abs(v) > 1000), 'camera list keeps original source coordinates');
