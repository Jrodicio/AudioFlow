# Validación de Atmosphere: fuerzas y pigmentos

Fecha local: **15 de octubre de 2026**.

Se aprobaron **22 pruebas unitarias**, TypeScript de aplicación y Electron,
compilación adicional del banco TypeScript, build de producción, banco GPU y
prueba general Electron. Se regeneraron portable e instalador NSIS x64, versión
1.0.0. Los hashes de los ejecutables están en release/SHA256SUMS.txt.

## Evidencia reproducible

El informe completo está en [result.json](../artifacts/atmosphere-volume/result.json).
La [hoja comparativa local](../artifacts/atmosphere-volume/comparison.html) reúne
estímulo, control y diferencias ×4. Cada caso comienza desde las mismas semillas,
con cuatro segundos de ambiente y paso fijo de 1/60 s. El control avanza hasta
el mismo instante. El replay de audio suave reproduce exactamente las métricas
de densidad y de imagen; dos simulaciones en silencio dan diferencia cero.

Las señales son PCM sintético con espectro discreto correspondiente: graves
117,19 Hz, medios 1007,81 Hz y agudos 8003,91 Hz. Pasan por FeatureExtractor,
MaterialResponse (eventos) y el adaptador específico AtmosphereAcoustics.
No se reemplaza la captura ni se identifican fuentes. Estas pruebas no
constituyen una evaluación audiovisual con música, voz o películas reales.

## Resultado del banco GPU

Los siguientes valores se comparan contra silencio con idéntico estado inicial.
RMS de imagen usa RGB normalizado 0..1. Píxeles cambiados significa al menos un
canal con diferencia >4/255, para excluir dither y redondeo insignificante.
Las capturas de comparación desactivan historial y fijan el mismo muestreo.

| Caso | Tiempo de estímulo | RMS imagen | Píxeles cambiados | RMS Δ densidad | Fuerza acústica/ambiental RMS |
|---|---:|---:|---:|---:|---:|
| Silencio | 5 s | 0 | 0 % | 0 | 0 |
| Suave, RMS PCM 0,00886 | 5 s | 0,1039 | 78,2 % | 0,1219 | 0,67 |
| Graves sostenidos | 5 s | 0,1320 | 88,3 % | 0,1622 | 1,09 |
| Medios sostenidos | 5 s | 0,0790 | 35,0 % | 0,1176 | 0,81 |
| Agudos sostenidos | 5 s | 0,0681 | 18,2 % | 0,0760 | 0,65 |
| Golpe de 100 ms, observado a 350 ms | 0,1 s + retirada | 0,00413 | 1,54 % | 0,00359 | 1,02 |
| Estela del golpe, observada a 1,5 s | 0,1 s + retirada | 0,0271 | 10,7 % | 0,0279 | 0,10 |
| Audio dinámico | 5 s | 0,1418 | 89,4 % | 0,1798 | 1,60 |

El transitorio produce aceleración desde el primer paso. A 100 ms el cambio de
imagen sigue siendo pequeño (RMS 0,00049); no se afirma visibilidad inmediata
de todos los golpes. La prueba exige desplazamiento renderizado medible a
350 ms y evolución posterior. La oclusión depende de dónde ocurre cada evento.

Los controles automáticos exigen además:

- Señales sostenidas: RMS de imagen >0,008, más de 10 % de píxeles cambiados,
  RMS Δ densidad >0,003 y RMS Δ pigmento >0,001.
- Campo de agudos con gradiente relativo más de 1,5 veces el de graves y una
  región de influencia menor. Son mediciones espaciales, no nombres de instrumentos.
- Presión del golpe localizada y movimiento persistente después de terminar.
- Al retirar audio dinámico durante un segundo, Δ velocidad RMS todavía 0,01957;
  después de otros quince segundos baja a 0,000571. La fuerza acústica cae a
  aproximadamente 0,00138 de la ambiental; las deformaciones de materia persisten.
- Azul, teal y pigmento cálido presentes en el render; campo de tinte con varianza,
  valores acotados y transporte distinto del control. La reserva evita que las
  mezclas se homogeneicen permanentemente.
- Densidad y velocidad en los tres tercios de profundidad, capturados por separado
  desde el mismo campo 3D. Se conservan resize y cambio de calidad sin reinicio.
- Composición Liquid/Texture frente al shader heredado: **diferencia máxima cero
  bytes**, con entradas y texturas idénticas.

La ruta con acumulación temporal de producción se prueba por separado durante
tres segundos. El percentil 95 del cambio RMS entre cuadros fue **0,00304**,
con máximo **0,00311**. La diferencia frente a silencio sigue superando el umbral
de imagen. Esto acota ruido/variación por frame en ese escenario; no constituye
una certificación universal de ausencia de ghosting.

## Estabilidad y pigmentos

Cinco minutos adicionales a paso fijo, alternando minutos con audio dinámico y
silencio, más calentamiento: **317 s simulados**. No se encontraron NaN/Inf,
velocidades ni pigmentos fuera de rango. Los casos sostenidos por banda no
saturaron el limitador. En el escenario dinámico a cinco segundos, alrededor de
**0,139 %** de las celdas superó 0,084, con límite 0,085. Al final de cada minuto
acelerado no había celdas en ese margen.

La densidad mantuvo cuerpos y varianza. Al finalizar, el render conservó unos
**59,4 %** de píxeles clasificados como azules, **6,27 %** teal y **0,60 %** cálidos
según los umbrales RGB explícitos del banco. Son indicadores aproximados de
presencia cromática, no segmentación física ni apreciaciones artísticas.
La [captura final](../artifacts/atmosphere-volume/stability-final.png) permite
inspeccionar la evolución. Los colores y su distribución cambian durante la sesión.

Memoria estable después de liberar el control: **13 texturas y 2 geometrías**.
Tras dispose: **cero texturas y cero geometrías**. El pigmento y su reserva añaden
10,125 MiB de campos frente a la versión anterior. Las lecturas completas sólo
existen en este banco; el renderizado normal no hace readback.

## Rendimiento medido

GPU identificada por WebGL: **NVIDIA GeForce GTX 1080 Ti**, ANGLE Direct3D11,
Windows. Un volumen, salida **1920×1080**, calidad equilibrada, integración
**1320×742 y 64 pasos**; la salida usa ampliación.

- Medición de ocho segundos con audio dinámico: **59,95 FPS**.
- Consultas GPU no bloqueantes, 479 muestras: **8,70 ms de mediana** y
  **9,81 ms en percentil 95**, incluyendo simulación, volumen y composición del banco.
- El prototipo con 48 pasos y 720.000 píxeles rondó 4,8 ms de mediana. Ese margen
  permitió subir calidad; se informa el costo final, no el del prototipo.

El contador está limitado a 60 FPS. No se probaron 144 FPS ni se garantizan mínimos
bajo toda carga concurrente. El banco no incluye React ni toda la interfaz; la
aplicación empaquetada se comprueba por separado. La estabilidad acelerada no
reemplaza una sesión real de varias horas.

## Alcance y artefactos

[scope-check.json](../artifacts/atmosphere-volume/scope-check.json) compara hashes
normalizados contra HEAD: shaders heredados, response.ts, volumeDetail.ts,
features.ts, capture.ts, App, settings, CSS y todos los archivos Electron sin
cambios. Universe sólo integra Atmosphere, su diagnóstico y la pausa del campo
Liquid cuando queda completamente oculto. Se mantienen buffers y transiciones.

El banco original también se ejecutó antes de modificar la implementación. Su
informe y capturas permanecen en artifacts/atmosphere-before/. Ese banco usaba
una cronología distinta; no se presentan sus capturas como pares idénticos al
banco nuevo. El shader de fuerzas anterior se conserva como fixture de prueba
para medir aceleraciones sobre el mismo estado y los uniforms originales.

La simulación continúa siendo una aproximación con advección, reposición y
fuerzas: no incorpora proyección de presión ni conservación exacta de masa.
Se inspeccionaron capturas sintéticas y sus controles; la aceptación perceptual
con el audio cotidiano del usuario permanece como comprobación manual.

## Integración de la aplicación

La [prueba general Electron](../artifacts/smoke-result.json) pasó los tres estilos,
demo identificada, F3, pantalla completa, tamaño mínimo, preferencias y captura.
Atmosphere registró 60 FPS en ese recorrido. Se observó señal loopback real:
un registro dio RMS 0,351, ganancia Atmosphere 1,000 y excitaciones por banda
0,750 / 0,896 / 0,866 / 0,845 / 0,929 / 0,856 / 0,882, con doce eventos recientes.
Estas son entradas reales del adaptador enlazado a uniforms, sin identificar
el contenido. El estilo seleccionado en esa captura era Texture: valida la
adquisición y la alimentación acústica, **no una evaluación perceptual de
Atmosphere con ese audio**. La captura se detuvo correctamente después.

La [prueba del ejecutable empaquetado](../artifacts/package-result.json) verifica
preload, carga desde ASAR, F3 con slider enfocado e inicialización volumétrica.
También exige que Liquid esté pausado bajo Atmosphere y vuelva a estar activo
al iniciar la transición a Liquid. No se ejecutó una instalación en máquina limpia.

- [Portable](../release/AudioFlow-1.0.0-Portable.exe).
- [Instalador](../release/AudioFlow-1.0.0-Setup.exe).
- [Captura de la aplicación empaquetada](../artifacts/packaged-atmosphere.png).
