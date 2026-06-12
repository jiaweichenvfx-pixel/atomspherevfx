/**
 * three-shim.js — Three.js 兼容层
 *
 * 从 unpkg 加载 Three.js 0.168.0，并补充旧版编码常量
 * （LinearEncoding 等），确保 postprocessing / three-good-godrays
 * 通过 ?external=three 使用同一 Three.js 实例时的兼容性。
 *
 * 使用方式：
 *   在 import map 中将 "three" 指向本文件，
 *   将 "_three_raw" 指向真实的 unpkg 地址。
 */

// ── 从真实源导出所有内容 ────────────────────────
export * from '_three_raw';

// ── 补充旧版编码常量（Three.js r152+ 已移除） ──
// 参考：https://threejs.org/docs/#api/en/constants/Textures

/** @deprecated Use LinearSRGBColorSpace */
export const LinearEncoding = 3000;
/** @deprecated Use SRGBColorSpace */
export const sRGBEncoding = 3001;
/** @deprecated */
export const GammaEncoding = 3002;
/** @deprecated */
export const RGBEEncoding = 3003;
/** @deprecated */
export const LogLuvEncoding = 3004;
/** @deprecated */
export const RGBM7Encoding = 3005;
/** @deprecated */
export const RGBM16Encoding = 3006;
/** @deprecated */
export const RGBDEncoding = 3007;
/** @deprecated */
export const BasicDepthPacking = 3200;
/** @deprecated */
export const RGBADepthPacking = 3201;
