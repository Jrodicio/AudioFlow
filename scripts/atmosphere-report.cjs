// Offline comparison sheet; no app UI, network, or runtime dependencies.
exports.renderReport=report=>{
  const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const cases=Object.entries(report.scenarios).map(([label,s])=>`<article>
    <h2>${escape(label)}</h2><p>RMS imagen ${s.image.rms.toFixed(4)} · ${(s.image.changedFraction*100).toFixed(1)}% de píxeles con cambio &gt;4/255 · Δ densidad ${s.densityDelta.toFixed(4)} · fuerza acústica/ambiental ${s.forces.after.ratio.toFixed(2)}</p>
    <div class="images">${[['','Con estímulo'],['-control','Control en silencio, mismo tiempo y semilla'],['-difference-x4','Diferencia absoluta ×4']].map(([suffix,title])=>`<figure><figcaption>${title}</figcaption><a href="${label}${suffix}.png"><img loading="lazy" src="${label}${suffix}.png" alt="${escape(label)}: ${title}"></a></figure>`).join('')}</div></article>`).join('');
  return `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Atmosphere · comparaciones GPU</title>
    <style>body{background:#0a101b;color:#dde8f5;font:16px/1.5 system-ui;margin:32px auto;max-width:1600px;padding:0 24px}h1,h2{font-weight:600}article{margin:48px 0}p{color:#adbed1}.images{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}figure{margin:0}img{width:100%;height:auto;border-radius:6px}figcaption{font-size:13px;margin-bottom:8px}a{color:#81ddeb}@media(max-width:850px){.images{grid-template-columns:1fr}}</style>
    <h1>Atmosphere · comparación reproducible</h1><p>Señales sintéticas procesadas con el extractor existente. No certifica respuesta perceptual con audio loopback real. Las comparaciones A–G usan paso fijo, estado inicial idéntico y el mismo patrón de muestreo, sin historial temporal.</p>
    <p>${escape(report.hardware)}<br>Salida 1920×1080; ${escape(report.singleVolumePerformance?.debug??'')}<br>${report.singleVolumePerformance?.fps.toFixed(2)??'—'} FPS. Tiempos GPU y uniforms completos en <a href="result.json">result.json</a>.</p>
    ${cases}<h2>Acumulación temporal de producción</h2><p>RMS de cambio entre cuadros, p95: ${report.temporal?.frameChange.p95.toFixed(5)??'—'}.</p><img src="G-temporal.png" alt="Imagen con acumulación temporal">
    <h2>Después de cinco minutos simulados</h2><img src="stability-final.png" alt="Volumen y pigmento al finalizar estabilidad"><p>Las métricas verifican cambios, límites y recursos; la evaluación artística y la relación perceptual con contenido real requieren observar la aplicación.</p></html>`;
};
