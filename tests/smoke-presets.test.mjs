import assert from 'node:assert/strict';
import { SMOKE_PRESET_ORDER, SMOKE_PRESETS } from '../js/SmokePresets.js';

const expectedOrder = [
  'stageHaze',
  'groundFog',
  'plume',
  'steamJet',
  'dust',
  'heavySmoke',
  'continuousDrift'
];

assert.deepEqual(SMOKE_PRESET_ORDER, expectedOrder);

for (const id of expectedOrder) {
  const preset = SMOKE_PRESETS[id];
  assert.ok(preset, `${id} preset exists`);
  assert.equal(typeof preset.label, 'string', `${id} has label`);
  assert.equal(typeof preset.icon, 'string', `${id} has icon`);
  assert.ok(preset.count >= 5 && preset.count <= 1000, `${id} count in UI range`);
  assert.ok(preset.size >= 0.3 && preset.size <= 10, `${id} size in UI range`);
  assert.ok(preset.spread >= 0.5 && preset.spread <= 30, `${id} spread in UI range`);
  assert.ok(preset.opacity >= 0.005 && preset.opacity <= 0.5, `${id} opacity in UI range`);
  assert.match(preset.color, /^#[0-9a-f]{6}$/i, `${id} color is hex`);
}

assert.ok(SMOKE_PRESETS.stageHaze.spread > SMOKE_PRESETS.plume.spread);
assert.ok(SMOKE_PRESETS.groundFog.driftY < SMOKE_PRESETS.steamJet.driftY);
assert.ok(SMOKE_PRESETS.heavySmoke.opacity > SMOKE_PRESETS.stageHaze.opacity);
assert.equal(SMOKE_PRESETS.continuousDrift.continuous, true);
assert.ok(SMOKE_PRESETS.continuousDrift.emissionRate > 0);
assert.ok(SMOKE_PRESETS.continuousDrift.spawnRadius >= 0);
