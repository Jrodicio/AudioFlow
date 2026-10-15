/** Shared color metadata. Materials keep their own transport and mixing models. */
export type ThemeMaterial = 'atmosphere' | 'liquid' | 'texture';
export type ThemeRGB = readonly [number, number, number];
export type ThemeColorRole = 'pigment' | 'background' | 'scattering' | 'depth';
export type ThemeColorEncoding = 'shader-native' | 'linear-srgb' | 'srgb';

export interface ThemeColor {
  readonly id: string;
  readonly name: string;
  readonly rgb: ThemeRGB;
  readonly encoding: ThemeColorEncoding;
  readonly role: ThemeColorRole;
  /** Open-ended chromatic attributes; no fixed number of pigments or slots. */
  readonly characteristics?: Readonly<Record<string, string | number | boolean>>;
  readonly source?: {
    readonly file: string;
    readonly line: number;
    readonly symbol: string;
    readonly glsl: string;
  };
}

export interface ThemeMaterialBinding {
  readonly status: 'metadata-only' | 'connected';
  readonly colorIds: readonly string[];
  readonly interpretation: string;
}

interface ThemeDefinition {
  readonly schemaVersion: 1;
  readonly name: string;
  readonly colors: readonly ThemeColor[];
  readonly materials: Readonly<Partial<Record<ThemeMaterial, ThemeMaterialBinding>>>;
}

export interface OfficialThemePreset extends ThemeDefinition {
  readonly id: string;
  readonly origin: 'official';
  readonly baseline: { readonly commit: string; readonly tag: string };
}

/** Persisted snapshots. IDs must be generated once as user:<UUID>.
 * Editing produces a new snapshot retaining the ID; duplication gets a new ID. */
export interface UserThemePreset extends ThemeDefinition {
  readonly id: `user:${string}`;
  readonly origin: 'user';
  readonly derivedFrom?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type ThemePreset = OfficialThemePreset | UserThemePreset;

/** Separate storage envelope; never serialize officials into user data. */
export interface UserThemeLibrary {
  readonly schemaVersion: 1;
  readonly presets: readonly UserThemePreset[];
}

const officialPermissions = Object.freeze({
  rename: false, edit: false, save: false, overwrite: false, delete: false, duplicate: true,
} as const);
const userPermissions = Object.freeze({
  rename: true, edit: true, save: true, overwrite: true, delete: true, duplicate: true,
} as const);

/** Capabilities are derived from origin, never writable flags on a preset. */
export function themePermissions(preset: Pick<ThemePreset, 'origin'>) {
  return preset.origin === 'official' ? officialPermissions : userPermissions;
}
