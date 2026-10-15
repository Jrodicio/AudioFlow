// Standalone artifact viewer. The application never loads this diagnostic UI.
exports.renderReport=r=>{
  const fixed=(v,n=5)=>Number.isFinite(v)?v.toFixed(n):'—';
  const definition=r.definition ? `<section><h2>Definición: mismo gas, mismos campos</h2>
    <p>Promedio de las ocho fases de muestreo sobre un volumen congelado. Así el ruido del raymarch no cuenta como detalle. Se comparan el render previo (64 pasos, 980.000 píxeles) y el actual (72 pasos, 1.150.000 píxeles), compuestos a 1920×1080.</p>
    <div class="pair"><figure><figcaption>Antes</figcaption><a href="definition-before.png"><img src="definition-before.png"></a></figure><figure><figcaption>Ahora</figcaption><a href="definition-after.png"><img src="definition-after.png"></a></figure></div>
    <p>Gradiente medio: ${fixed(r.definition.before.gradient)} → ${fixed(r.definition.after.gradient)} (${fixed((r.definition.after.gradient/r.definition.before.gradient-1)*100,1)}%). Luminancia: ${fixed(r.definition.before.luminance,3)} → ${fixed(r.definition.after.luminance,3)}. No se usa sharpening de pantalla.</p></section>` : '';
  const release=r.release ? `<section><h2>Disipación de la materia nueva</h2><p>Densidad reactiva media antes de ocho segundos sin sonido: ${fixed(r.release.before.mean,6)}; después: ${fixed(r.release.after.mean,6)}. Emisores activos finales: ${r.release.state.activeEmitters}. El trazador se transporta con la materia y evapora sólo la fracción reactiva.</p></section>` : '';
  const cases=Object.entries(r.cases).map(([name,c])=>`<article data-case="${name}"><h2>${name}</h2>
    <audio controls src="${name}.wav"></audio><p class="time">0.000 s</p><img class="playback" src="${c.images[0].file}" alt="Volumen con plumas reactivas">
    <canvas width="900" height="150"></canvas><p>Azul: RMS de audio · naranja: diferencia visual del evento · verde: materia reactiva añadida · líneas: comienzos PCM · puntos: fuentes nuevas. Cada curva tiene escala propia.</p>
    <table><tr><th>Evento (s)</th><th>Detectado (ms)</th><th>Materia nueva (ms)</th><th>Visible (ms)</th><th>Bandas</th><th>Fuentes</th><th>Δ materia a 300 ms</th></tr>${c.events.map(e=>`<tr><td>${e.onset}</td><td>${e.detectionMs??'—'}</td><td>${e.birthMs??'—'}</td><td>${e.firstVisibleMs??'—'}</td><td>${e.eventBands.join(', ')}</td><td>${e.impulses}</td><td>${fixed(e.reactiveMass300ms,6)}</td></tr>`).join('')}</table>
    <p>${c.events.length ? `Eventos asociados: ${fixed(c.alignment.recall*100,0)}% · fuentes dentro de ataques: ${fixed(c.alignment.precision*100,0)}% · correlación binaria máxima ${fixed(c.alignment.bestCorrelation.value,3)} a ${c.alignment.bestCorrelation.lagMs} ms.` : `Silencio: ${c.state.plumesBorn} fuentes, densidad reactiva ${fixed(c.state.reactiveMean,6)}; velocidad RMS ambiental ${fixed(c.state.rmsSpeed)}.`}</p>
    <details><summary>Cuadros por evento: 0 / +33 / +150 / +300 ms</summary>${c.events.map((e,index)=>`<h3>Evento ${index+1} · t=${e.onset} s</h3><div class="sequence">${[0,2,9,18].map(offset=>{const frame=Math.round(e.onset*60)+offset,file=`${name}-${String(frame).padStart(3,'0')}.png`;return `<figure><figcaption>+${Math.round(offset/60*1000)} ms</figcaption><a href="${file}"><img src="${file}" loading="lazy"></a><a href="${file.replace('.png','-control.png')}">Control sin nueva fuente</a><br><a href="${file.replace('.png','-difference.png')}">Diferencia ×4</a></figure>`;}).join('')}</div>`).join('')}</details>
    <a href="${name}.csv">Mediciones por cuadro (CSV)</a></article>`).join('');
  const data=Object.fromEntries(Object.entries(r.cases).map(([name,c])=>{
    let mass=0;
    return [name,{images:c.images,onsets:c.onsets,frames:c.frames.map(f=>{if(f.reactive)mass=f.reactive.delta;return {...f,reactiveDelta:mass};})}];
  }));
  return `<!doctype html><html lang="es"><meta charset="utf-8"><title>Atmosphere · nacimiento de plumas</title>
    <style>body{background:#08101b;color:#dce8f4;font:15px/1.6 system-ui;max-width:1150px;margin:auto;padding:28px}a{color:#66dbda}article,section{margin:48px 0}img{width:100%}img.playback{max-width:960px}canvas{width:100%;background:#0e1b2c}table{border-collapse:collapse}td,th{padding:6px 10px;border-bottom:1px solid #344}figure{margin:0}.sequence,.pair{display:flex;gap:12px}.sequence figure{width:25%}.pair figure{width:50%}summary{cursor:pointer}@media(max-width:750px){.sequence,.pair{display:block}.sequence figure,.pair figure{width:100%}table{font-size:11px}}</style>
    <h1>Atmosphere · nacimiento, transporte y disipación</h1><p>${r.method}</p><p>Hardware: ${r.hardware}. Resolución temporal de las métricas: 16,7 ms. Visibilidad exige RMS RGB ≥0,001, píxeles con cambio &gt;4/255 ≥0,1% y MAE local ≥0,002. Esto verifica PCM→análisis→GPU→imagen; no mide loopback, compositor ni pantalla física.</p>
    <p>El audio es la señal PCM exacta de la prueba. Las imágenes avanzan por tiempo de audio, cada 100 ms y con cuadros extra alrededor de los ataques. Antes de cada evento se copia el gas actual al control, que mantiene las corrientes y emisiones anteriores y omite sólo las fuentes nuevas. El flujo principal no se reinicia entre golpes. Las estadísticas de alineación excluyen los primeros 500 ms de arranque del fondo continuo.</p>
    ${definition}${cases}${release}<p>Datos completos: <a href="result.json">JSON</a>. Las métricas no sustituyen la evaluación perceptual con audio cotidiano.</p>
    <script>const data=${JSON.stringify(data)};
    for(const el of document.querySelectorAll('article')) {
      const d=data[el.dataset.case],audio=el.querySelector('audio'),img=el.querySelector('.playback'),label=el.querySelector('.time'),ctx=el.querySelector('canvas').getContext('2d');
      const curve=(key,color)=>{const max=Math.max(...d.frames.map(f=>f[key]),.0001);ctx.strokeStyle=color;ctx.beginPath();d.frames.forEach((f,i)=>{const x=f.time/6*900,y=145-f[key]/max*130;i?ctx.lineTo(x,y):ctx.moveTo(x,y)});ctx.stroke()};
      curve('rms','#57baf3');curve('imageRms','#ffaf66');curve('reactiveDelta','#64dba2');
      ctx.strokeStyle='#b0c6dc';for(const t of d.onsets){ctx.beginPath();ctx.moveTo(t/6*900,0);ctx.lineTo(t/6*900,150);ctx.stroke()}
      ctx.fillStyle='#e46f91';for(const f of d.frames.filter(f=>f.pending)){ctx.beginPath();ctx.arc(f.time/6*900,10,3,0,7);ctx.fill()}
      const update=()=>{const t=audio.currentTime,f=d.images.filter(f=>f.time<=t).at(-1)||d.images[0];if(!img.src.endsWith(f.file))img.src=f.file;label.textContent='Audio '+t.toFixed(3)+' s · cuadro '+f.time.toFixed(3)+' s';if(!audio.paused)requestAnimationFrame(update)};
      audio.addEventListener('play',()=>{document.querySelectorAll('audio').forEach(a=>{if(a!==audio)a.pause()});update()});audio.addEventListener('seeked',update);
    }</script></html>`;
};
