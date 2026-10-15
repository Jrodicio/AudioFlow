import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { COLD_AND_FIRE, DEFAULT_THEME, DEFAULT_THEME_ID, OFFICIAL_THEMES,
  getOfficialTheme, themePermissions } from '../src/themes/index.ts';
import { defaults, parseSettings, readSettings, STORAGE_KEY } from '../src/settings.ts';

test('Cold & Fire is the registered official default with protected capabilities', () => {
  assert.equal(DEFAULT_THEME_ID, 'cold-and-fire');
  assert.equal(DEFAULT_THEME, COLD_AND_FIRE);
  assert.equal(getOfficialTheme('cold-and-fire'), COLD_AND_FIRE);
  assert.equal(getOfficialTheme('user:unknown'), undefined);
  assert.equal(COLD_AND_FIRE.name, 'Cold & Fire');
  assert.equal(COLD_AND_FIRE.origin, 'official');
  assert.deepEqual(themePermissions(COLD_AND_FIRE), {
    rename: false, edit: false, save: false, overwrite: false, delete: false, duplicate: true,
  });
  assert.deepEqual(themePermissions({ origin: 'user' }), {
    rename: true, edit: true, save: true, overwrite: true, delete: true, duplicate: true,
  });
  assert.equal(COLD_AND_FIRE.materials.atmosphere?.status, 'metadata-only');
  assert.equal(COLD_AND_FIRE.materials.liquid, undefined);
  assert.equal(COLD_AND_FIRE.materials.texture, undefined);
});

test('registry, official definition and derived permissions cannot be mutated at runtime', () => {
  function frozenTree(value: unknown) {
    if (!value || typeof value !== 'object') return;
    assert.equal(Object.isFrozen(value), true);
    for (const child of Object.values(value)) frozenTree(child);
  }
  frozenTree(OFFICIAL_THEMES);
  frozenTree(themePermissions(COLD_AND_FIRE));
  frozenTree(themePermissions({ origin: 'user' }));
  assert.equal(Reflect.set(COLD_AND_FIRE, 'name', 'Changed'), false);
  assert.equal(Reflect.set(COLD_AND_FIRE.colors[0].rgb, '0', 1), false);
  assert.equal(Reflect.set(OFFICIAL_THEMES, '0', undefined), false);
  assert.equal(Reflect.deleteProperty(COLD_AND_FIRE.colors, '0'), false);
  assert.equal(getOfficialTheme('cold-and-fire')?.name, 'Cold & Fire');
});

test('every registered RGB matches its exact GLSL definition and material references resolve', () => {
  const ids = new Set(COLD_AND_FIRE.colors.map(color => color.id));
  assert.equal(ids.size, COLD_AND_FIRE.colors.length);
  assert.equal(ids.size, 13, 'Approved volumetric inventory; changes require a new palette review');
  for (const color of COLD_AND_FIRE.colors) {
    assert.equal(color.encoding, 'shader-native');
    assert.ok(color.source);
    const lines = readFileSync(new URL(`../${color.source.file}`, import.meta.url), 'utf8').split(/\r?\n/);
    assert.ok(lines[color.source.line - 1].includes(color.source.glsl), color.id);
    const rgb = color.source.glsl.slice(5, -1).split(',').map(Number);
    assert.deepEqual(color.rgb, rgb, color.id);
  }
  for (const binding of Object.values(COLD_AND_FIRE.materials)) {
    for (const id of binding.colorIds) assert.ok(ids.has(id), id);
  }
});

test('pre-theme preferences round-trip without loss or a storage-key migration', () => {
  assert.equal(STORAGE_KEY, 'audioflow.preferences.v1');
  for (const style of ['atmosphere', 'liquid', 'texture'] as const) {
    const previous = { style, sensitivity: 2.35, intensity: 1.17, softness: .26, quality: 'high', auto: true };
    const loaded = parseSettings(JSON.stringify(previous));
    assert.deepEqual(loaded, previous);
    assert.deepEqual(parseSettings(JSON.stringify(loaded)), previous);
    assert.deepEqual(parseSettings(JSON.stringify({ ...previous, themeId: 'unknown-future-theme' })), previous);
  }
  for (const raw of [null, '{}', 'null', '{broken']) assert.deepEqual(parseSettings(raw), defaults);
});

test('persisted legacy settings load from the same key and unavailable storage still falls back', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const previous = { ...defaults, style: 'atmosphere', sensitivity: .55, intensity: 1.31 };
  try {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
      getItem(key: string) { assert.equal(key, STORAGE_KEY); return JSON.stringify(previous); },
    } });
    assert.deepEqual(readSettings(), previous);
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('Storage unavailable'); } });
    assert.deepEqual(readSettings(), defaults);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
