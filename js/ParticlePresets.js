export const PARTICLE_PRESETS = {
  glow: {
    label: '柔光微尘',
    icon: '✨',
    count: 420,
    size: 0.055,
    speed: 0.28,
    spread: 6,
    color: '#ffe8c8',
    opacity: 0.42,
    driftX: 0,
    driftY: 0.02,
    driftZ: 0,
    sizeVar: 0.75,
    opacityVar: 0.55,
    turbulence: 0.8,
    rotation: 0
  },
  classic: {
    label: '传统圆点',
    icon: '●',
    count: 800,
    size: 0.085,
    speed: 0.35,
    spread: 5,
    color: '#ffffff',
    opacity: 0.85,
    driftX: 0,
    driftY: 0,
    driftZ: 0,
    sizeVar: 0.12,
    opacityVar: 0.25,
    turbulence: 0.45,
    rotation: 0
  },
  snowflake: {
    label: '雪花',
    icon: '❄️',
    count: 200,
    size: 0.3,
    speed: 0.2,
    spread: 8,
    color: '#ffffff',
    opacity: 0.8,
    driftX: 0,
    driftY: 0,
    driftZ: 0,
    sizeVar: 0.6,
    opacityVar: 0.3,
    turbulence: 1.2,
    rotation: 0
  },
  raindrop: {
    label: '雨丝',
    icon: '╱',
    count: 1100,
    size: 0.22,
    speed: 1.85,
    spread: 8,
    color: '#cfe7ff',
    opacity: 0.72,
    driftX: -0.45,
    driftY: -11.5,
    driftZ: 0,
    sizeVar: 0.28,
    opacityVar: 0.25,
    turbulence: 0.06,
    rotation: 0,
    length: 1.25,
    alignToVelocity: true
  }
};

export const PARTICLE_PRESET_ORDER = [
  'glow',
  'classic',
  'snowflake',
  'raindrop'
];

export function getParticlePreset(style) {
  return PARTICLE_PRESETS[style] || PARTICLE_PRESETS.glow;
}
