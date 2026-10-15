import type { OfficialThemePreset, ThemeColor, ThemeColorRole, ThemeRGB } from './model';

const sourceFile = 'src/visual/atmosphereShaders.ts';
function color(id: string, name: string, rgb: ThemeRGB, role: ThemeColorRole,
  line: number, symbol: string, glsl: string): ThemeColor {
  return Object.freeze({ id, name, rgb: Object.freeze(rgb), role, encoding: 'shader-native',
    source: Object.freeze({ file: sourceFile, line, symbol, glsl }),
  });
}

// Exact GLSL values, deliberately NOT converted to hexadecimal or uniforms.
// This immutable inventory describes baseline 238ab19; the renderer does not read it.
const colors = Object.freeze([
  color('deep-blue', 'Azul profundo', [.025,.065,.40], 'pigment', 64, 'initialPigment.dye', 'vec3(.025,.065,.40)'),
  color('electric-blue', 'Azul eléctrico', [.045,.24,.82], 'pigment', 64, 'initialPigment.dye', 'vec3(.045,.24,.82)'),
  color('turquoise', 'Turquesa', [.015,.67,.62], 'pigment', 65, 'initialPigment.dye', 'vec3(.015,.67,.62)'),
  color('ice-cyan', 'Cian hielo', [.30,.86,.92], 'pigment', 66, 'initialPigment.dye', 'vec3(.30,.86,.92)'),
  color('pearl', 'Perla fría', [.82,.91,.94], 'pigment', 68, 'initialPigment.dye', 'vec3(.82,.91,.94)'),
  color('plume-bass', 'Pluma azul grave', [.025,.095,.38], 'pigment', 256, 'transportShader.cool', 'vec3(.025,.095,.38)'),
  color('plume-mid', 'Pluma turquesa media', [.025,.49,.60], 'pigment', 256, 'transportShader.cool', 'vec3(.025,.49,.60)'),
  color('plume-high', 'Pluma cian aguda', [.23,.79,.87], 'pigment', 256, 'transportShader.cool', 'vec3(.23,.79,.87)'),
  color('copper', 'Cobre naranja', [.88,.43,.12], 'pigment', 354, 'volumeRenderShader.albedo', 'vec3(.88,.43,.12)'),
  color('background-low', 'Fondo azul inferior', [.006,.020,.052], 'background', 330, 'volumeRenderShader.background', 'vec3(.006,.020,.052)'),
  color('background-high', 'Fondo azul superior', [.014,.052,.087], 'background', 330, 'volumeRenderShader.background', 'vec3(.014,.052,.087)'),
  color('edge-scattering', 'Dispersión azul verdosa', [.15,.29,.32], 'scattering', 357, 'volumeRenderShader.scatter', 'vec3(.15,.29,.32)'),
  color('depth-blue', 'Azul de profundidad', [.045,.12,.21], 'depth', 359, 'volumeRenderShader.scatter', 'vec3(.045,.12,.21)'),
]);

export const COLD_AND_FIRE: OfficialThemePreset = Object.freeze({
  schemaVersion: 1,
  id: 'cold-and-fire',
  name: 'Cold & Fire',
  origin: 'official',
  baseline: Object.freeze({ commit: '238ab193be4e2d52f3cca26e7f7cc7cb35925889', tag: 'atmosphere-cold-fire-plumes-v1' }),
  colors,
  materials: Object.freeze({
    atmosphere: Object.freeze({
      status: 'metadata-only',
      colorIds: Object.freeze(colors.map(entry => entry.id)),
      interpretation: 'RGB frío transportado y concentración cálida separada; cobre aplicado en el raymarch existente.',
    }),
  }),
});
