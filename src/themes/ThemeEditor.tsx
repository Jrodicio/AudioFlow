import { useEffect, useState } from 'react';
import { COLD_AND_FIRE, OFFICIAL_THEMES, type ThemeColor, type ThemeColorRole, type ThemePreset, type UserThemePreset } from './index';
import { colorHex, fromHex } from './colors';
import { deleteTheme, duplicateTheme, readThemes, resolveTheme, saveTheme, THEME_SELECTION_KEY, withColors, writeThemes } from './library';
import { assertRenderable, MAX_ACTIVE_PIGMENTS } from './gpu';

const categories: [ThemeColorRole, string][] = [['pigment', 'Pigmentos'], ['background', 'Fondo'], ['scattering', 'Iluminación / dispersión'], ['depth', 'Profundidad']];
function ColorRow({ color, editable, change, remove }: { color: ThemeColor; editable: boolean; change: (c: ThemeColor) => void; remove: () => void }) {
  const [hex, setHex] = useState(colorHex(color));
  useEffect(() => setHex(colorHex(color)), [color]);
  return <div className="theme-color">
    <input className="color-picker" type="color" aria-label={`Elegir color ${color.name}`} value={colorHex(color)} disabled={!editable}
      onChange={e => change(fromHex(e.target.value, color)!)} />
    <div className="color-fields">
      <input aria-label={`Nombre de ${color.name}`} value={color.name} disabled={!editable} maxLength={200} onChange={e => change({ ...color, name: e.target.value })} />
      <div className="color-values"><input aria-label={`Hexadecimal de ${color.name}`} value={hex} disabled={!editable} spellCheck={false} maxLength={7}
        aria-invalid={!/^#[0-9a-f]{6}$/i.test(hex)} onChange={e => { setHex(e.target.value); const next = fromHex(e.target.value, color); if (next) change(next); }}
        onBlur={() => setHex(colorHex(color))} />
        <select aria-label={`Función de ${color.name}`} value={color.role} disabled={!editable} onChange={e => change({ ...color, role: e.target.value as ThemeColorRole })}>
          {categories.map(([role, title]) => <option key={role} value={role}>{title}</option>)}
        </select>
      </div>
      {color.role === 'pigment' && <label className="presence">Presencia <input type="range" min="0" max="4" step="0.05" disabled={!editable}
        value={Number(color.characteristics?.presence ?? 1)} onChange={e => change({ ...color, characteristics: { ...color.characteristics, presence: Number(e.target.value) } })} />
        <output>{Number(color.characteristics?.presence ?? 1).toFixed(2)}</output></label>}
      <small>{color.encoding === 'shader-native' ? 'GLSL nativo · HEX nominal' : color.encoding === 'linear-srgb' ? 'RGB lineal · HEX sRGB' : 'sRGB'}</small>
    </div>
    {editable && <button className="remove-color" onClick={remove} aria-label={`Quitar ${color.name}`} title="Quitar color">×</button>}
  </div>;
}

export function ThemeEditor({ open, onClose, onTheme }: { open: boolean; onClose: () => void; onTheme: (theme: ThemePreset) => void }) {
  const [initial] = useState(readThemes);
  const [library, setLibrary] = useState(initial.library);
  const [selected, setSelected] = useState(initial.selected.id);
  const [draft, setDraft] = useState<UserThemePreset | null>(null);
  const [message, setMessage] = useState('');
  const [confirmation, setConfirmation] = useState<{ message: string; action: () => void } | null>(null);
  const saved = resolveTheme(library, selected);
  const theme = draft ?? saved;
  const dirty = !!draft && JSON.stringify(draft) !== JSON.stringify(saved);
  useEffect(() => { onTheme(theme); }, [theme, onTheme]);

  function remember(id: string) {
    setSelected(id);
    try { localStorage.setItem(THEME_SELECTION_KEY, id); }
    catch { setMessage('La selección se aplica ahora, pero no pudo guardarse para el próximo inicio.'); }
  }
  function select(id: string) {
    const action = () => { try { assertRenderable(resolveTheme(library, id)); setDraft(null); setMessage(''); remember(id); } catch (error) { setMessage((error as Error).message); } };
    if (dirty) setConfirmation({ message: 'Hay cambios sin guardar. ¿Descartarlos y cambiar de tema?', action }); else action();
  }
  function edit(next: UserThemePreset) {
    try { assertRenderable(next); setDraft(next); setMessage(''); }
    catch (error) { setMessage(String((error as Error).message)); }
  }
  function copy(asNew = false) {
    const next = duplicateTheme(theme, asNew ? `${theme.name} - Copia` : `${theme.name} - Personal`);
    setDraft(next); setMessage('Copia personal en vista previa. Guardá para conservarla.');
  }
  function create() {
    const action = () => {
      const base = duplicateTheme(COLD_AND_FIRE, 'Nuevo universo');
      const next = withColors(base, [{ id: `pigment:${crypto.randomUUID()}`, name: 'Azul', role: 'pigment', encoding: 'srgb', rgb: [.08, .35, .9] }, ...base.colors.filter(c => c.role !== 'pigment')]);
      setDraft(next); setMessage('Nuevo tema en vista previa.');
    };
    if (dirty) setConfirmation({ message: '¿Descartar el borrador actual y crear un tema nuevo?', action }); else action();
  }
  function save(snapshot: ThemePreset = theme) {
    if (snapshot.origin !== 'user') { copy(); return; }
    try {
      assertRenderable(snapshot);
      const next = saveTheme(library, snapshot);
      writeThemes(next); // Commit UI state only after successful storage.
      setLibrary(next); setDraft(null); setMessage('Tema guardado en este equipo.'); remember(snapshot.id);
    } catch (error) { setMessage(`No se guardó el tema. ${(error as Error).message}`); }
  }
  function remove() {
    if (theme.origin !== 'user') return;
    setConfirmation({ message: `¿Eliminar “${theme.name}”? Esta acción no se puede deshacer.`, action: () => {
      try {
        const next = deleteTheme(library, theme.id); writeThemes(next);
        setLibrary(next); setDraft(null); setMessage('Tema eliminado.'); remember(COLD_AND_FIRE.id);
      } catch (error) { setMessage(`No se eliminó el tema. ${(error as Error).message}`); }
    } });
  }
  function colors(next: readonly ThemeColor[]) { if (theme.origin === 'user') edit(withColors(theme, next)); }
  function add(role: ThemeColorRole, name = 'Nuevo color', rgb: readonly [number, number, number] = [.5, .5, .8]) {
    colors([...theme.colors, { id: `color:${crypto.randomUUID()}`, name, rgb, role, encoding: 'srgb', characteristics: { presence: 1 } }]);
  }
  if (!open) return null;
  return <aside className="theme-editor" aria-label="Editor de temas">
    <header><div><span className="eyebrow">UNIVERSOS CROMÁTICOS</span><h2>Temas <span>{dirty ? '· Sin guardar' : '· Guardado'}</span></h2></div>
      <button onClick={onClose} aria-label="Volver a ajustes">×</button></header>
    <label className="theme-select">Tema global<select value={draft && !library.presets.some(p => p.id === draft.id) ? draft.id : selected} onChange={e => select(e.target.value)}>
      <optgroup label="Oficiales">{OFFICIAL_THEMES.map(p => <option key={p.id} value={p.id}>{p.name} · Oficial</option>)}</optgroup>
      <optgroup label="Personales">{library.presets.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        {draft && !library.presets.some(p => p.id === draft.id) && <option value={draft.id}>{draft.name} · Borrador</option>}
      </optgroup></select></label>
    <div className="theme-actions"><button onClick={() => copy()}>Duplicar</button><button onClick={create}>Crear nuevo</button></div>
    {theme.origin === 'official' ? <div className="official-note">Preset oficial protegido. Consultá sus colores o <button onClick={() => copy()}>creá una copia personal para editar</button>.</div> :
      <label className="theme-name">Nombre del tema<input value={theme.name} maxLength={200} onChange={e => edit({ ...theme, name: e.target.value })} /></label>}
    <p className="theme-preview-note">Vista previa en vivo · Atmosphere, Liquid y Texture</p>
    {theme.origin === 'user' && <div className="theme-quick-add"><span>Agregar pigmento</span><button onClick={() => add('pigment', 'Rojo intenso', [1, .015, .01])}>+ Rojo</button><button onClick={() => add('pigment', 'Amarillo intenso', [1, .92, .005])}>+ Amarillo</button></div>}
    <div className="theme-colors">{categories.map(([role, title]) => <section key={role}>
      <div className="category-title"><h3>{title}</h3>{theme.origin === 'user' && <button onClick={() => add(role)} aria-label={`Agregar color de ${title}`}>+ Agregar</button>}</div>
      {theme.colors.filter(c => c.role === role).map(color => <ColorRow key={color.id} color={color} editable={theme.origin === 'user'}
        change={next => colors(theme.colors.map(c => c.id === next.id ? next : c))}
        remove={() => { if (role === 'pigment' && theme.colors.filter(c => c.role === 'pigment').length === 1) setMessage('Conservá al menos un pigmento.'); else colors(theme.colors.filter(c => c.id !== color.id)); }} />)}
    </section>)}</div>

    <footer>{theme.origin === 'user' && <>
      <div className="theme-actions"><button className="primary" onClick={() => save()}>Guardar</button><button onClick={() => { const next = duplicateTheme(theme, `${theme.name} - Copia`); setDraft(next); save(next); }}>Guardar como nuevo</button></div>
      <div className="theme-actions"><button disabled={!dirty} onClick={() => { setDraft(null); setMessage('Cambios descartados.'); }}>Descartar cambios</button><button className="danger" onClick={remove}>Eliminar preset</button></div>
    </>}
      <small>Hasta {MAX_ACTIVE_PIGMENTS} pigmentos activos. Presencia distribuye color; no agrega materia. Los colores con presencia 0 quedan conservados.</small>
      {message && <p className="theme-message" role="status">{message}</p>}
    </footer>
    {confirmation && <div className="theme-confirm" role="alertdialog" aria-label="Confirmar acción"><p>{confirmation.message}</p><div className="theme-actions"><button onClick={() => { const action = confirmation.action; setConfirmation(null); action(); }}>Confirmar</button><button autoFocus onClick={() => setConfirmation(null)}>Cancelar</button></div></div>}
  </aside>;
}
