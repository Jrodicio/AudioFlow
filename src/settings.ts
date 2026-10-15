export type Style = 'atmosphere' | 'liquid' | 'texture';
export type Quality = 'eco' | 'balanced' | 'high';
export interface Settings {
  style: Style;
  sensitivity: number;
  intensity: number;
  softness: number;
  quality: Quality;
  auto: boolean;
}
export const defaults: Settings = {
  style: 'liquid', sensitivity: 1.2, intensity: 0.8, softness: 0.7, quality: 'balanced', auto: false,
};
export const STORAGE_KEY = 'audioflow.preferences.v1';
const finiteRange = (v: unknown, fallback: number, min: number, max: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;

export function parseSettings(raw: string | null): Settings {
  try {
    const s = JSON.parse(raw ?? '{}');
    if (!s || typeof s !== 'object') return { ...defaults };
    return {
      style: ['atmosphere', 'liquid', 'texture'].includes(s.style) ? s.style : defaults.style,
      sensitivity: finiteRange(s.sensitivity, defaults.sensitivity, 0.3, 3),
      intensity: finiteRange(s.intensity, defaults.intensity, 0, 1.5),
      softness: finiteRange(s.softness, defaults.softness, 0, 1),
      quality: ['eco', 'balanced', 'high'].includes(s.quality) ? s.quality : defaults.quality,
      auto: typeof s.auto === 'boolean' ? s.auto : defaults.auto,
    };
  } catch { return { ...defaults }; }
}
export function readSettings(): Settings {
  try { return parseSettings(localStorage.getItem(STORAGE_KEY)); }
  catch { return { ...defaults }; }
}
