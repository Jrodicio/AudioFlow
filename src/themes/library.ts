import { assertRenderable } from './gpu';
import { COLD_AND_FIRE, getOfficialTheme } from './index';
import type { ThemeColor, ThemePreset, UserThemeLibrary, UserThemePreset } from './model';

export const THEME_STORAGE_KEY = 'audioflow.themes.v1';
export const THEME_SELECTION_KEY = 'audioflow.theme-selection.v1';
export const emptyLibrary = (): UserThemeLibrary => ({ schemaVersion: 1, presets: [] });
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0 && v.length <= 200;
const userId = (v: unknown): v is `user:${string}` => typeof v === 'string' && /^user:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const date = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;

export function validColor(v: unknown): v is ThemeColor {
  return record(v) && text(v.id) && text(v.name) && Array.isArray(v.rgb) && v.rgb.length === 3 &&
    v.rgb.every(c => typeof c === 'number' && Number.isFinite(c) && c >= 0 && c <= 1) &&
    ['shader-native', 'srgb', 'linear-srgb'].includes(v.encoding as string) &&
    ['pigment', 'background', 'scattering', 'depth'].includes(v.role as string) &&
    (v.source === undefined || record(v.source) && text(v.source.file) && text(v.source.symbol) && text(v.source.glsl) && Number.isInteger(v.source.line) && Number(v.source.line) > 0) &&
    (v.characteristics === undefined || record(v.characteristics) && Object.entries(v.characteristics).every(([k, c]) =>
      text(k) && (typeof c === 'string' || typeof c === 'boolean' || typeof c === 'number' && Number.isFinite(c))) &&
      (v.characteristics.presence === undefined || typeof v.characteristics.presence === 'number' && v.characteristics.presence >= 0 && v.characteristics.presence <= 4));
}

export function validUserTheme(v: unknown): v is UserThemePreset {
  if (!record(v) || v.schemaVersion !== 1 || v.origin !== 'user' || !userId(v.id) || !text(v.name) ||
    !date(v.createdAt) || !date(v.updatedAt) || v.updatedAt < v.createdAt ||
    (v.derivedFrom !== undefined && !getOfficialTheme(v.derivedFrom as string) && !userId(v.derivedFrom)) ||
    !Array.isArray(v.colors) || !v.colors.length || !v.colors.every(validColor) || !v.colors.some(c => c.role === 'pigment') || !record(v.materials)) return false;
  const ids = new Set(v.colors.map(c => c.id));
  if (ids.size !== v.colors.length) return false;
  return Object.entries(v.materials).every(([key, binding]) => ['atmosphere', 'liquid', 'texture'].includes(key) && record(binding) &&
    ['metadata-only', 'connected'].includes(binding.status as string) && text(binding.interpretation) &&
    Array.isArray(binding.colorIds) && new Set(binding.colorIds).size === binding.colorIds.length && binding.colorIds.every(id => ids.has(id)));
}

/** Recover valid siblings independently; never hydrate the official registry. */
export function parseThemeLibrary(raw: string | null): UserThemeLibrary {
  try {
    const value: unknown = JSON.parse(raw ?? '{}');
    if (!record(value) || value.schemaVersion !== 1 || !Array.isArray(value.presets)) return emptyLibrary();
    const ids = new Set<string>();
    return { schemaVersion: 1, presets: value.presets.filter((p): p is UserThemePreset => {
      if (!validUserTheme(p) || ids.has(p.id)) return false;
      ids.add(p.id); return true;
    }) };
  } catch { return emptyLibrary(); }
}

export function resolveTheme(library: UserThemeLibrary, id: string | null): ThemePreset {
  return getOfficialTheme(id ?? '') ?? library.presets.find(p => p.id === id) ?? COLD_AND_FIRE;
}
export function readThemes(storage?: Pick<Storage, 'getItem'>) {
  try {
    storage ??= localStorage;
    const library = parseThemeLibrary(storage.getItem(THEME_STORAGE_KEY));
    let selected = resolveTheme(library, storage.getItem(THEME_SELECTION_KEY));
    try { assertRenderable(selected); } catch { selected = COLD_AND_FIRE; }
    return { library, selected };
  } catch { return { library: emptyLibrary(), selected: COLD_AND_FIRE }; }
}
export function duplicateTheme(theme: ThemePreset, name = `${theme.name} - Personal`, now = new Date().toISOString()): UserThemePreset {
  const copy: UserThemePreset = { schemaVersion: 1, colors: structuredClone(theme.colors), materials: structuredClone(theme.materials), id: `user:${crypto.randomUUID()}`, name, origin: 'user', createdAt: now, updatedAt: now, derivedFrom: theme.id };
  return withColors(copy, copy.colors);
}
export function saveTheme(library: UserThemeLibrary, theme: ThemePreset, now = new Date().toISOString()): UserThemeLibrary {
  if (theme.origin !== 'user' || getOfficialTheme(theme.id)) throw new Error('Los temas oficiales están protegidos. Creá una copia personal.');
  const snapshot = { ...structuredClone(theme), updatedAt: now };
  if (!validUserTheme(snapshot)) throw new Error('Revisá el nombre, los colores y las referencias del tema.');
  return { schemaVersion: 1, presets: [...library.presets.filter(p => p.id !== theme.id), snapshot] };
}
export function deleteTheme(library: UserThemeLibrary, id: string): UserThemeLibrary {
  if (!userId(id) || getOfficialTheme(id)) throw new Error('No se puede eliminar un tema oficial.');
  return { schemaVersion: 1, presets: library.presets.filter(p => p.id !== id) };
}
export function writeThemes(library: UserThemeLibrary, storage: Pick<Storage, 'setItem'> = localStorage) {
  if (library.schemaVersion !== 1 || library.presets.some(p => !validUserTheme(p)) || new Set(library.presets.map(p => p.id)).size !== library.presets.length) throw new Error('Biblioteca de temas inválida.');
  storage.setItem(THEME_STORAGE_KEY, JSON.stringify(library));
}
export function withColors(theme: UserThemePreset, colors: readonly ThemeColor[]): UserThemePreset {
  const materials = Object.fromEntries(['atmosphere', 'liquid', 'texture'].map(key => [key, {
    status: 'connected' as const, colorIds: colors.map(c => c.id), interpretation: 'Pigmentos y roles interpretados por el material.',
  }]));
  return { ...theme, colors, materials };
}
