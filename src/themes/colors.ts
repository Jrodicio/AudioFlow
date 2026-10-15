import type { ThemeColor, ThemeRGB } from './model';
export const srgbToLinear = (c: number) => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;
export const linearToSrgb = (c: number) => c <= .0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - .055;
/** This artistic renderer works in its historical numerical domain. Explicit
 * linear RGB is encoded to that domain; native constants are never decoded. */
export function shaderRGB(color: ThemeColor): ThemeRGB {
  return color.encoding === 'linear-srgb' ? color.rgb.map(linearToSrgb) as unknown as ThemeRGB : color.rgb;
}
export function colorHex(color: ThemeColor): string {
  return '#' + shaderRGB(color).map(c => Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, '0')).join('');
}
export function fromHex(hex: string, color: ThemeColor): ThemeColor | null {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return null;
  const rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  return { ...color, rgb: (color.encoding === 'linear-srgb' ? rgb.map(srgbToLinear) : rgb) as unknown as ThemeRGB };
}
