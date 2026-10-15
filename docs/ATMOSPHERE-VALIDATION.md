# Validación de Atmosphere volumétrico

Fecha local: **15 de octubre de 2026**.

## Resultados

- **21 pruebas automatizadas aprobadas**: se conservan las 18 pruebas de audio,
  captura/permisos y preferencias; se agregan atlas/presupuesto, detalle 3D
  reproducible y ruta sin adjuntos flotantes.
- **TypeScript y build de producción aprobados** mediante `npm.cmd run dist:win`.
- **Banco GPU aprobado** (`npm.cmd run test:atmosphere`) con WebGL real:
  silencio, señal suave, impulsos, retirada del sonido, profundidad y estabilidad.
- Escenarios en tiempo real: aproximadamente **59,8–60 FPS**. La medición con un
  solo volumen dio **59,93 FPS** con backing buffer 1920×1080, integración 1131×636
  y 48 pasos en calidad equilibrada. Se usa ampliación, no raymarching nativo 1080p.
- Cinco minutos adicionales de tiempo simulado (más de 345 s totales a paso 1/60):
  **cero valores NaN/Inf**, densidad en 0..1 y velocidad máxima final aproximada
  0,0322 frente al límite de 0,085. La densidad media final fue 0,138 y su varianza
  0,0172; la escena mantuvo cuerpos visibles, en vez de quedar vacía.
- **Memoria estable:** nueve texturas y dos geometrías en el banco después de
  liberar la simulación gemela. Al terminar: **cero texturas y cero geometrías**.
  El control de crecimiento se toma después de inicializar ambos buffers de imagen.
- Resize y cambios de calidad conservan el tiempo y los campos de simulación.
- Con entradas idénticas, comparación GPU entre shader heredado y composición
  nueva: **diferencia máxima cero bytes** para Liquid y Texture.
- Hashes de `shaders.ts`, `response.ts`, ambos archivos de audio, App, settings,
  CSS y procesos Electron sin cambios. Se mantiene el empaquetado; sólo se agrega
  el comando del banco GPU a los scripts de package.json.
- **Prueba general Electron aprobada:** tres estilos, compilación, demo y medidor
  separados, F3, pantalla completa, ventana mínima, ocultación de interfaz,
  persistencia, loopback real estéreo con señal observada y detención.
- **Instalador NSIS y portable x64 regenerados**, versión conservada 1.0.0.
- **Prueba del ejecutable empaquetado aprobada:** preload, render desde ASAR, F3
  con un slider enfocado e inicialización de Atmosphere. Atmosphere registró
  **60 FPS** después de entrar al estilo; hubo una lectura de 43 FPS durante el
  arranque inicial de la aplicación.

## Evidencia

- [Banco GPU: informe](../artifacts/atmosphere-volume/result.json).
- [Alcance: hashes preservados](../artifacts/atmosphere-volume/scope-check.json).
- [Silencio inicial](../artifacts/atmosphere-volume/A-silence-start.png) y
  [evolución en silencio](../artifacts/atmosphere-volume/A-silence-evolved.png).
- [Fuerzas suaves sintéticas](../artifacts/atmosphere-volume/B-soft-synthetic.png).
- [Impulsos sintéticos](../artifacts/atmosphere-volume/C-impulses-synthetic.png).
- [Inercia al retirar sonido](../artifacts/atmosphere-volume/D-after-sound.png) y
  [disipación posterior](../artifacts/atmosphere-volume/D-dissipation.png).
- [Fondo](../artifacts/atmosphere-volume/E-background.png),
  [plano medio](../artifacts/atmosphere-volume/E-middle.png),
  [primer plano](../artifacts/atmosphere-volume/E-foreground.png), aislados sólo
  para diagnóstico del mismo campo 3D.
- [Estado después de estabilidad acelerada](../artifacts/atmosphere-volume/stability-final.png).
- [Informe Electron](../artifacts/smoke-result.json).
- [Informe empaquetado](../artifacts/package-result.json) y
  [captura de Atmosphere empaquetado](../artifacts/packaged-atmosphere.png).
- `release/SHA256SUMS.txt` identifica los dos ejecutables generados.

Se inspeccionaron esas capturas durante el trabajo. Se corrigieron la bruma inicial
excesivamente uniforme, la pérdida progresiva de densidad y las bandas de muestreo.
Las capturas muestran espesores, oclusión y evolución; no equivalen a certificar
fotorrealismo o una calidad artística universal.

## Límites de la comprobación

Las señales B/C del banco son tonos e impulsos reproducibles que pasan por el
extractor existente: **no se afirma haber evaluado perceptualmente una voz o una
película específica**. La prueba general sí observó señal loopback real, pero no
clasifica su contenido. No se añadieron análisis ni identificación de fuentes.

La prueba acelerada verifica estabilidad numérica y recursos durante cinco minutos
simulados, no una ejecución real de varias horas. No se midió específicamente una
GTX 1080 Ti a 144 Hz, ni se certifican 60 FPS mínimos bajo todas las cargas.
No se instaló el producto en una máquina limpia. Los ejecutables siguen sin firma
comercial.

La simulación usa advección y fuerzas, sin proyección de presión ni conservación
exacta de masa. La humedad mantiene la población de nubes mediante reposición
continua. La iluminación y dispersión son aproximadas; la resolución del grid,
raymarching y acumulación temporal acotan nitidez y respuesta a detalles muy breves.
La ruta volumétrica necesita `EXT_color_buffer_float`; si falta, Atmosphere usa
el material anterior. Liquid y Texture mantienen sus caminos originales.
