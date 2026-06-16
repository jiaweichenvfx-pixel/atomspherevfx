import assert from 'node:assert/strict';
import { MOTION_BLUR_DEFAULTS } from '../js/MotionBlurSystem.js';

assert.equal(MOTION_BLUR_DEFAULTS.enabled, false);
assert.ok(MOTION_BLUR_DEFAULTS.strength > 0, 'default strength is visible when enabled');
assert.ok(MOTION_BLUR_DEFAULTS.strength <= 0.35, 'default strength stays conservative');
assert.ok(MOTION_BLUR_DEFAULTS.maxStrength <= 0.75, 'UI max avoids heavy smeared trails');
