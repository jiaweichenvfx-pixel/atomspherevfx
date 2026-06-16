import assert from 'node:assert/strict';
import { PARTICLE_PRESET_ORDER, PARTICLE_PRESETS } from '../js/ParticlePresets.js';

const expectedOrder = [
  'glow',
  'classic',
  'snowflake',
  'raindrop'
];

assert.deepEqual(PARTICLE_PRESET_ORDER, expectedOrder);

for (const id of expectedOrder) {
  const preset = PARTICLE_PRESETS[id];
  assert.ok(preset, `${id} preset exists`);
  assert.equal(typeof preset.label, 'string', `${id} has label`);
  assert.equal(typeof preset.icon, 'string', `${id} has icon`);
  assert.ok(preset.count >= 10 && preset.count <= 4000, `${id} count in UI range`);
  assert.ok(preset.size >= 0.005 && preset.size <= 1, `${id} size in UI range`);
  assert.ok(preset.spread >= 0.25 && preset.spread <= 40, `${id} spread in UI range`);
  assert.ok(preset.opacity >= 0.025 && preset.opacity <= 2, `${id} opacity in UI range`);
  assert.match(preset.color, /^#[0-9a-f]{6}$/i, `${id} color is hex`);
}

assert.ok(PARTICLE_PRESETS.raindrop.driftY < -8, 'raindrop falls decisively downward');
assert.ok(PARTICLE_PRESETS.raindrop.turbulence <= 0.1, 'raindrop uses low turbulence');
assert.ok(PARTICLE_PRESETS.raindrop.length >= 0.25 && PARTICLE_PRESETS.raindrop.length <= 2, 'raindrop exposes controllable streak length');
assert.equal(PARTICLE_PRESETS.raindrop.alignToVelocity, true, 'raindrop aligns streaks to particle motion');
assert.ok(PARTICLE_PRESETS.classic.sizeVar < PARTICLE_PRESETS.glow.sizeVar, 'classic round particles stay more uniform');
