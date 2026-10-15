import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { SystemAudio, type CaptureSnapshot } from './audio/capture';
import { clamp } from './audio/features';
import { readSettings, STORAGE_KEY, type Settings, type Style } from './settings';
import { Universe, type VisualStats } from './visual/Universe';

const descriptions: Record<Style, { number: string; title: string; subtitle: string; detail: string }> = {
  atmosphere: { number: '01', title: 'Atmosphere', subtitle: 'El sonido se vuelve aire.', detail: 'Nubes de tinta · corrientes suaves · profundidad' },
  liquid: { number: '02', title: 'Liquid', subtitle: 'El sonido se vuelve materia.', detail: 'Pintura líquida · remolinos · luz mineral' },
  texture: { number: '03', title: 'Texture', subtitle: 'El sonido deja una huella.', detail: 'Relieves orgánicos · capas · tensión eléctrica' },
};
const styleList: Style[] = ['atmosphere', 'liquid', 'texture'];

function Icon({ name }: { name: 'expand' | 'sliders' | 'close' | 'play' | 'pause' | 'sound' | 'arrow' }) {
  const paths = {
    expand: <path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" />,
    sliders: <><path d="M5 3v18M12 3v18M19 3v18" /><path d="M2 8h6m1 9h6m1-11h6" /></>,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    play: <path d="m8 5 11 7-11 7Z" />,
    pause: <path d="M8 5v14M16 5v14" />,
    sound: <><path d="m11 4-6 5H2v6h3l6 5ZM16 8c3 2 3 6 0 8m3-11c5 4 5 10 0 14" /></>,
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
  };
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function Slider({ label, value, min, max, step, format, onChange }: {
  label: string; value: number; min: number; max: number; step: number;
  format: (v: number) => string; onChange: (v: number) => void;
}) {
  return <label className="slider-field">
    <span>{label}<output>{format(value)}</output></span>
    <input type="range" min={min} max={max} step={step} value={value}
      style={{ '--fill': `${(value-min)/(max-min)*100}%` } as CSSProperties}
      onChange={event => onChange(Number(event.target.value))} />
  </label>;
}

export function App() {
  const [settings, setSettings] = useState(readSettings);
  const [capture, setCapture] = useState<CaptureSnapshot>({ status: 'idle', message: 'La escucha está desactivada.', rms: 0 });
  const [demo, setDemo] = useState(false);
  const [panel, setPanel] = useState(true);
  const [immersive, setImmersive] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [error, setError] = useState('');
  const [storageError, setStorageError] = useState(false);
  const [debug, setDebug] = useState(false);
  const [stats, setStats] = useState<VisualStats>({ fps: 0, scale: 1, style: settings.style });
  const canvas = useRef<HTMLCanvasElement>(null);
  const meter = useRef<HTMLDivElement>(null);
  const meterText = useRef<HTMLOutputElement>(null);
  const engine = useRef<Universe | null>(null);
  const audio = useRef<SystemAudio | null>(null);
  const settingsRef = useRef(settings);
  const demoRef = useRef(demo);
  settingsRef.current = settings;
  demoRef.current = demo;
  const active = ['listening', 'silent', 'suspended'].includes(capture.status);
  const requesting = capture.status === 'requesting';
  const visualStyle = settings.auto ? stats.style : settings.style;
  const description = descriptions[visualStyle];

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); setStorageError(false); }
    catch { setStorageError(true); }
  }, [settings]);

  useEffect(() => {
    const input = new SystemAudio(setCapture);
    audio.current = input;
    let visual: Universe | null = null;
    let meterSeconds = 0;
    try {
      visual = new Universe(canvas.current!, () => settingsRef.current,
        dt => {
          const s = settingsRef.current;
          const f = input.sample(dt, s.sensitivity, s.softness);
          meterSeconds += dt;
          if (meterSeconds > .08) {
            meterSeconds = 0;
            const db = f.rms > .000001 ? 20*Math.log10(f.rms) : -Infinity;
            if (meter.current) meter.current.style.transform = `scaleX(${clamp((db+60)/60)})`;
            if (meterText.current) meterText.current.textContent = Number.isFinite(db) ? `${Math.round(db)} dBFS` : '−∞ dBFS';
          }
          return f;
        }, () => demoRef.current, setStats, setError);
      engine.current = visual;
    } catch (e) {
      console.error(e);
      setError('No se pudo iniciar WebGL 2. Activá la aceleración gráfica y verificá el controlador de tu GPU.');
    }
    return () => { input.dispose(); visual?.dispose(); audio.current = null; engine.current = null; };
  }, []);

  useEffect(() => { engine.current?.resize(); }, [settings.quality]);
  useEffect(() => { engine.current?.setStyle(settings.style); }, [settings.style, settings.auto]);

  async function toggleFullscreen() {
    try {
      if (window.audioflow) setFullscreen(await window.audioflow.toggleFullscreen());
      else if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch { setError('No se pudo activar pantalla completa. Probá con F11 desde la aplicación.'); }
  }

  useEffect(() => {
    const off = window.audioflow?.onFullscreen(setFullscreen);
    const changed = () => setFullscreen(!!document.fullscreenElement);
    const key = (event: KeyboardEvent) => {
      if (event.key === 'F3') {
        event.preventDefault();
        if (!event.repeat) setDebug(v => !v);
        return;
      }
      const target = event.target as HTMLElement;
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return;
      if (event.key === 'F11') { event.preventDefault(); void toggleFullscreen(); }
      if (event.key.toLowerCase() === 'h') setImmersive(v => !v);
      if (event.key === 'Escape') setImmersive(false);
    };
    document.addEventListener('keydown', key);
    document.addEventListener('fullscreenchange', changed);
    return () => { off?.(); document.removeEventListener('keydown', key); document.removeEventListener('fullscreenchange', changed); };
  }, []);

  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings(previous => ({ ...previous, [key]: value }));
  }
  function selectStyle(style: Style) { setSettings(previous => ({ ...previous, style, auto: false })); }
  async function toggleCapture() {
    if (active || requesting) audio.current?.stop();
    else { setDemo(false); await audio.current?.start(); }
  }
  function toggleDemo() {
    if (!demo) audio.current?.stop();
    setDemo(value => !value);
  }

  return <main className={`app ${immersive ? 'immersive' : ''}`}>
    <canvas ref={canvas} className="universe" aria-label="Universo procedural animado que responde al audio del sistema" />
    <div className="edge-shade" />
    <div className="interface">
      <header className="topbar">
        <div className="brand"><span className="brand-mark" aria-hidden="true">≈</span><span>audioflow<span className="brand-dot">.</span></span><span className="brand-caption">SOUND INTO MATTER</span></div>
        <div className="top-actions">
          <span className={`source-badge ${demo ? 'demo' : active ? 'connected' : ''}`}><i />{demo ? 'DEMO VISUAL · SIN CAPTURA' : capture.status === 'listening' ? 'LOOPBACK CONECTADO' : capture.status === 'silent' ? 'CONECTADO · SIN SEÑAL' : capture.status === 'suspended' ? 'ANÁLISIS EN PAUSA' : requesting ? 'CONECTANDO' : 'ESCUCHA DESACTIVADA'}</span>
          <button className="icon-button" onClick={() => void toggleFullscreen()} aria-label={fullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'} title="Pantalla completa · F11"><Icon name="expand" /></button>
          <button className={`icon-button ${panel ? 'selected' : ''}`} onClick={() => setPanel(v => !v)} aria-label={panel ? 'Ocultar ajustes' : 'Mostrar ajustes'} aria-expanded={panel} title="Ajustes"><Icon name="sliders" /></button>
        </div>
      </header>

      <section className="scene-caption" aria-live="polite">
        <div className="eyebrow"><span className="caption-line" />UN UNIVERSO EN CONSTANTE CAMBIO</div>
        <h1>{description.title}<span>{description.number}</span></h1>
        <p>{description.subtitle}</p>
        <span className="scene-detail">{description.detail}</span>
      </section>

      {panel && <aside className="control-panel" aria-label="Ajustes del universo">
        <div className="panel-heading"><div><span className="eyebrow">TU UNIVERSO</span><h2>Ajustá la materia</h2></div><button className="icon-button" onClick={() => setPanel(false)} aria-label="Cerrar ajustes"><Icon name="close" /></button></div>
        <Slider label="Sensibilidad" value={settings.sensitivity} min={0.3} max={3} step={0.05} format={v => `${v.toFixed(2)}×`} onChange={v => update('sensitivity', v)} />
        <Slider label="Intensidad" value={settings.intensity} min={0} max={1.5} step={0.01} format={v => `${Math.round(v*100)}%`} onChange={v => update('intensity', v)} />
        <Slider label="Suavidad" value={settings.softness} min={0} max={1} step={0.01} format={v => `${Math.round(v*100)}%`} onChange={v => update('softness', v)} />
        <div className="quality-field"><label htmlFor="quality">Calidad gráfica</label><select id="quality" value={settings.quality} onChange={e => update('quality', e.target.value as Settings['quality'])}><option value="eco">Eco · 60 FPS</option><option value="balanced">Equilibrada · 60 FPS</option><option value="high">Alta · hasta 144 FPS</option></select></div>
        <div className="auto-field"><div><label htmlFor="auto">Viaje automático</label><p>Un nuevo estado cada 55 segundos</p></div><button id="auto" role="switch" aria-checked={settings.auto} aria-label="Transición automática entre estilos" className={`switch ${settings.auto ? 'on' : ''}`} onClick={() => update('auto', !settings.auto)}><span /></button></div>
        <div className="panel-note"><span className="tiny-star">✧</span>Sin sonido, la materia sigue respirando.</div>
        {storageError && <p className="storage-note" role="status">No se pudieron guardar las preferencias en este equipo.</p>}
      </aside>}

      <div className="bottom-area">
        <div className="scene-meta"><span><i />GENERADO EN TIEMPO REAL</span><span>{stats.fps || '—'} FPS <b>·</b> GPU <b>·</b> {settings.quality === 'high' ? 'ALTA' : settings.quality === 'eco' ? 'ECO' : 'EQUILIBRADA'}</span></div>
        <nav className="transport" aria-label="Estilos y captura de audio">
          <div className="style-selector" aria-label="Estilo visual">{styleList.map(style => <button key={style} aria-pressed={visualStyle === style} className={visualStyle === style ? 'active' : ''} onClick={() => selectStyle(style)}><span>{descriptions[style].number}</span>{descriptions[style].title}</button>)}</div>
          <div className="transport-divider" />
          <div className="audio-controls">
            <button className={`capture-button ${active ? 'capturing' : ''}`} onClick={() => void toggleCapture()}><Icon name={active || requesting ? 'pause' : 'sound'} />{requesting ? 'Cancelar' : active ? 'Detener escucha' : 'Escuchar PC'}</button>
            <div className="meter" aria-label="Nivel real del audio capturado"><div className="meter-label"><span>AUDIO DE SALIDA</span><output ref={meterText}>−∞ dBFS</output></div><div className="meter-track"><div ref={meter} className="meter-fill" /></div></div>
          </div>
          <button className={`demo-button ${demo ? 'active' : ''}`} onClick={toggleDemo} aria-pressed={demo}><Icon name={demo ? 'pause' : 'play'} />{demo ? 'Salir de demo' : 'Demo visual'}</button>
        </nav>
        <div className="bottom-hint"><span>{demo ? 'DEMO · Modulación sintética visual. No se está capturando audio.' : '100% LOCAL  /  SIN MICRÓFONO  /  SIN ECO'}</span><button onClick={() => setImmersive(true)}>Ocultar interfaz <kbd>H</kbd><Icon name="arrow" /></button></div>
      </div>
    </div>
    {capture.status !== 'idle' && <div className={`capture-status ${capture.status === 'error' ? 'error' : ''}`} role="status"><span className="status-dot" /><span>{capture.message}</span>{capture.status === 'suspended' && <button onClick={() => void audio.current?.resume()}>Reanudar audio</button>}{capture.status === 'error' && <button onClick={() => audio.current?.stop()} aria-label="Cerrar mensaje de captura">×</button>}</div>}
    {error && <div className="render-error" role="alert"><strong>El universo necesita atención</strong><p>{error}</p></div>}
    {immersive && <button className="restore-button" onClick={() => setImmersive(false)}><Icon name="sliders" />Mostrar controles <kbd>H</kbd></button>}
    {immersive && demo && <span className="immersive-demo">DEMO VISUAL · SIN CAPTURA</span>}
    {debug && <aside className="acoustic-debug" aria-label="Diagnóstico acústico"><strong>AudioFlow · diagnóstico · F3</strong><pre>{stats.debug ?? 'Esperando análisis…'}</pre></aside>}
  </main>;
}
