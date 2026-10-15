import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COLD_AND_FIRE } from '../src/themes/index.ts';
import { colorHex, fromHex, linearToSrgb, shaderRGB, srgbToLinear } from '../src/themes/colors.ts';
import { deleteTheme, duplicateTheme, emptyLibrary, parseThemeLibrary, readThemes, resolveTheme, saveTheme, THEME_SELECTION_KEY, THEME_STORAGE_KEY, validUserTheme, withColors, writeThemes } from '../src/themes/library.ts';
import { compileTheme, MAX_ACTIVE_PIGMENTS, ThemeGPU } from '../src/themes/gpu.ts';

test('CRUD snapshots preserve UUID identity and dates, isolate copies and protect all official operations', () => {
  const original = JSON.stringify(COLD_AND_FIRE);
  const created = '2026-10-15T12:00:00.000Z', updated = '2026-10-15T13:00:00.000Z';
  const copy = duplicateTheme(COLD_AND_FIRE, 'Mi universo', created);
  assert.match(copy.id, /^user:[0-9a-f-]{36}$/);
  assert.equal(copy.derivedFrom, COLD_AND_FIRE.id);
  assert.deepEqual(copy.colors, COLD_AND_FIRE.colors);
  let library = saveTheme(emptyLibrary(), copy, created);
  const changed = withColors({ ...copy, name: 'Rojo' }, copy.colors.map((c, i) => i ? c : { ...c, name: 'Nuevo rojo', rgb: [1, 0, 0] }));
  library = saveTheme(library, changed, updated);
  assert.equal(library.presets.length, 1);
  assert.equal(library.presets[0].id, copy.id);
  assert.equal(library.presets[0].createdAt, created);
  assert.equal(library.presets[0].updatedAt, updated);
  assert.equal(library.presets[0].name, 'Rojo');
  const second = duplicateTheme(changed, 'Otra', updated);
  assert.notEqual(second.id, copy.id);
  assert.equal(second.derivedFrom, copy.id);
  assert.throws(() => saveTheme(library, { ...COLD_AND_FIRE, name: 'Hacked' }));
  assert.throws(() => saveTheme(library, { ...copy, id: COLD_AND_FIRE.id } as never));
  assert.throws(() => deleteTheme(library, COLD_AND_FIRE.id));
  assert.equal(deleteTheme(library, copy.id).presets.length, 0);
  assert.equal(JSON.stringify(COLD_AND_FIRE), original);
});

test('storage roundtrip, selected theme recovery, failed writes and hostile official injection', () => {
  const data = new Map<string, string>();
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
  const copy = duplicateTheme(COLD_AND_FIRE);
  writeThemes(saveTheme(emptyLibrary(), copy), storage);
  storage.setItem(THEME_SELECTION_KEY, copy.id);
  assert.equal(readThemes(storage).selected.id, copy.id);
  storage.setItem(THEME_SELECTION_KEY, 'user:deleted');
  assert.equal(readThemes(storage).selected, COLD_AND_FIRE);
  storage.setItem(THEME_STORAGE_KEY, JSON.stringify({ schemaVersion: 1, presets: [COLD_AND_FIRE, { ...copy, id: 'cold-and-fire' }, copy] }));
  const loaded = readThemes(storage);
  assert.equal(loaded.library.presets.length, 1);
  assert.equal(resolveTheme(loaded.library, 'cold-and-fire'), COLD_AND_FIRE);
  assert.throws(() => writeThemes(loaded.library, { setItem() { throw new Error('QuotaExceededError'); } }), /Quota/);
  assert.equal(readThemes({ getItem() { throw new Error('unavailable'); } }).selected, COLD_AND_FIRE);
});

test('invalid entries are rejected individually: schema, IDs, RGB, encoding, dates and references', () => {
  const copy = duplicateTheme(COLD_AND_FIRE);
  const bad = [null, {}, { ...copy, schemaVersion: 2 }, { ...copy, id: 'user:123' }, { ...copy, origin: 'official' },
    { ...copy, createdAt: '2026-02-31T00:00:00.000Z' }, { ...copy, updatedAt: '1900-01-01T00:00:00.000Z' }, { ...copy, derivedFrom: 'unknown' },
    { ...copy, name: ' ' }, { ...copy, colors: [] }, { ...copy, colors: [copy.colors[0], copy.colors[0]] },
    { ...copy, materials: { liquid: { status: 'connected', colorIds: ['missing'], interpretation: 'test' } } },
    ...[NaN, Infinity, -1, 2, '1'].map(v => ({ ...copy, colors: [{ ...copy.colors[0], rgb: [v, 0, 0] }] })),
    { ...copy, colors: [{ ...copy.colors[0], encoding: 'gamma' }] },
    { ...copy, colors: [{ ...copy.colors[0], role: 'unknown' }] },
    { ...copy, colors: [{ ...copy.colors[0], characteristics: { presence: -1 } }] },
    { ...copy, colors: [{ ...copy.colors[0], source: { line: -1 } }] },
  ];
  for (const entry of bad) {
    assert.equal(validUserTheme(entry), false);
    assert.equal(parseThemeLibrary(JSON.stringify({ schemaVersion: 1, presets: [entry, copy] })).presets.length, 1);
  }
  for (const raw of ['{broken', 'null', '{}', '{"schemaVersion":2,"presets":[]}']) assert.deepEqual(parseThemeLibrary(raw), emptyLibrary());
  assert.equal(parseThemeLibrary(JSON.stringify({ schemaVersion: 1, presets: [copy, copy] })).presets.length, 1);
});

test('encoding conversions retain native precision and round-trip explicit linear RGB', () => {
  for (const c of [0, .001, .04045, .2, .5, 1]) assert.ok(Math.abs(linearToSrgb(srgbToLinear(c)) - c) < 1e-7);
  const native = COLD_AND_FIRE.colors[0];
  assert.equal(shaderRGB(native), native.rgb);
  assert.equal(colorHex(native), '#061166');
  assert.equal(native.rgb[0], .025);
  const linear = { ...native, encoding: 'linear-srgb' as const, rgb: [.21404114048223255, 0, 1] as const };
  assert.equal(colorHex(linear), '#8000ff');
  const changed = fromHex('#ff8000', linear)!;
  assert.equal(changed.encoding, 'linear-srgb');
  assert.ok(Math.abs(changed.rgb[1] - srgbToLinear(128 / 255)) < 1e-9);
  assert.equal(fromHex('#zz0000', linear), null);
});

test('variable palettes carry every added color, support roles, explicit capacity and reversible transitions', () => {
  const copy = duplicateTheme(COLD_AND_FIRE);
  const red = { id: 'red', name: 'Rojo', role: 'pigment' as const, encoding: 'srgb' as const, rgb: [1, 0, 0] as const };
  const yellow = { ...red, id: 'yellow', name: 'Amarillo', rgb: [1, 1, 0] as const };
  const next = withColors(copy, [...copy.colors, red, yellow]);
  assert.equal(validUserTheme(next), true);
  const compiled = compileTheme(next);
  const pixels = Array.from({ length: compiled.extra.length / 4 }, (_, i) => Array.from(compiled.extra.slice(i * 4, i * 4 + 4)));
  assert.ok(pixels.some(c => c[0] === 1 && c[1] === 0 && c[3] > 0));
  assert.ok(pixels.some(c => c[0] === 1 && c[1] === 1 && c[3] > 0));
  const background = withColors(copy, [...copy.colors, { ...red, role: 'background' }]);
  assert.notDeepEqual(compileTheme(background).colors[9], compileTheme(copy).colors[9]);
  const many = withColors(copy, Array.from({ length: MAX_ACTIVE_PIGMENTS + 1 }, (_, i) => ({ ...red, id: `color-${i}` })));
  assert.throws(() => compileTheme(many), /128/);
  assert.doesNotThrow(() => compileTheme(withColors(many, many.colors.map(c => ({ ...c, characteristics: { presence: 0 } })))));
  const onlyRed = withColors(copy, [red]);
  assert.deepEqual(compileTheme(onlyRed).colors, compileTheme(withColors(copy, [red, { ...yellow, characteristics: { presence: 0 } }])).colors);
  const smallGPU = new ThemeGPU(2048);
  smallGPU.setTheme(withColors(many,many.colors.slice(0,MAX_ACTIVE_PIGMENTS)));
  assert.equal(smallGPU.width,2048);smallGPU.dispose();
  const gpu = new ThemeGPU();
  const baseline = gpu.uniforms.uThemeColors.value[0].clone();
  gpu.setTheme(withColors(next, next.colors.map((c, i) => i ? c : { ...c, rgb: [1, 0, 0] })));
  gpu.advance(1 / 60);
  const first = gpu.uniforms.uThemeColors.value[0].clone();
  assert.ok(first.x > baseline.x && first.x < .1);
  assert.equal(gpu.uniforms.uThemeHasExtra.value, 1);
  for (let i = 0; i < 800; i++) gpu.advance(1 / 60);
  assert.equal(gpu.uniforms.uThemeColors.value[0].x, 1);
  gpu.setTheme(COLD_AND_FIRE);
  for (let i = 0; i < 800; i++) gpu.advance(1 / 60);
  assert.deepEqual(gpu.uniforms.uThemeColors.value[0], baseline);
  assert.equal(gpu.uniforms.uThemeEdited.value, 0);
  assert.equal(gpu.uniforms.uThemeHasExtra.value, 0);
  gpu.dispose();
});
