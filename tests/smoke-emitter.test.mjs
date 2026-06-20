import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SmokeSystem } from '../js/SmokeSystem.js';

class FakeCanvasContext {
  clearRect() {}
  save() {}
  restore() {}
  beginPath() {}
  arc() {}
  fill() {}
  translate() {}
  rotate() {}
  scale() {}
  createRadialGradient() { return { addColorStop() {} }; }
  set filter(_value) {}
  set globalCompositeOperation(_value) {}
  set fillStyle(_value) {}
}

global.document = {
  createElement(tag) {
    assert.equal(tag, 'canvas');
    return {
      width: 0,
      height: 0,
      getContext(type) {
        assert.equal(type, '2d');
        return new FakeCanvasContext();
      }
    };
  }
};

global.performance = { now: () => 0 };

const scene = new THREE.Scene();
const smoke = new SmokeSystem(scene);
smoke.setStyle('continuousDrift');
smoke.setEnabled(true);
smoke.setOriginOffset(4, 2, -3);
smoke.setEmissionRate(2);
smoke.setSpawnRadius(0.25);

assert.equal(smoke.continuous, true, 'continuous preset enables emitter mode');
assert.equal(smoke.emissionRate, 2, 'emission rate can be set');
assert.equal(smoke.spawnRadius, 0.25, 'spawn radius can be set');
assert.equal(scene.children.length, smoke.count, 'emitter reuses a fixed smoke pool');
assert.equal(smoke._planes.filter(mesh => mesh.visible).length, 0, 'continuous smoke starts with hidden inactive puffs');

smoke.update(0.5, { timeSeconds: 0.5 });
assert.equal(smoke._planes.filter(mesh => mesh.visible).length, 5, 'one cluster spawns after accumulated emission time');
const firstPrimary = smoke._planes.find(mesh => mesh.userData.smokeData?.isPrimary && mesh.visible);
assert.ok(firstPrimary, 'spawned cluster has a visible primary puff');
assert.ok(firstPrimary.position.distanceTo(new THREE.Vector3(4, 2, -3)) <= 0.5, 'new puff spawns near emitter origin');

smoke.update(1.0, { timeSeconds: 1.5 });
assert.equal(smoke._planes.filter(mesh => mesh.visible).length, 15, 'additional clusters spawn without increasing pool size');
assert.equal(scene.children.length, smoke.count, 'pool size stays constant during continuous emission');

smoke.setContinuous(false);
assert.equal(smoke.continuous, false, 'continuous mode can be disabled');
