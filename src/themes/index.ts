import { COLD_AND_FIRE } from './coldAndFire';

export { COLD_AND_FIRE } from './coldAndFire';
export { themePermissions } from './model';
export type { ThemePreset, OfficialThemePreset, UserThemePreset, UserThemeLibrary,
  ThemeColor, ThemeRGB, ThemeColorEncoding, ThemeColorRole, ThemeMaterial, ThemeMaterialBinding } from './model';

export const OFFICIAL_THEMES = Object.freeze([COLD_AND_FIRE]);
export const DEFAULT_THEME_ID = COLD_AND_FIRE.id;
export const DEFAULT_THEME = COLD_AND_FIRE;

export function getOfficialTheme(id: string) {
  return OFFICIAL_THEMES.find(preset => preset.id === id);
}
