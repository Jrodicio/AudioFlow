# Verificación de la iteración de percepción acústica

Fecha local: 14 de octubre de 2026.

- `npm.cmd test`: 18 pruebas aprobadas. Incluyen siete bandas, FFT a distintas
  frecuencias de muestreo, normalización adaptativa, señales constantes, ataques,
  saliencia simultánea, energía sostenida, ruido, estéreo/contrafase, filtros a
  distintas cadencias, silencio prolongado, entradas inválidas y memoria visual.
- `npm.cmd run typecheck` y `npm.cmd run build`: aprobados (también forman parte de
  `dist:win`). No se agregaron dependencias.
- Prueba Electron en WebGL real: compilación de ambos shaders, tres universos,
  transiciones, F3, demo claramente identificada y sin alimentar el medidor real,
  ventana mínima, pantalla completa, interfaz oculta, preferencias y captura/stop.
  Loopback real conectado con señal y canales estéreo útiles observados.
- Ruta FP16 y alternativa RGBA8 ejercitadas en GPU real. La prueba RGBA8 oculta la
  extensión flotante antes de cargar la aplicación; no simula toda una GPU antigua.
- Se inspeccionaron visualmente pares de capturas por estilo. Se corrigieron las
  vetas ajenas al campo transportado de Liquid y los artefactos de contorno de
  Texture usando normales minerales analíticas. La inspección de fotogramas no
  equivale a una evaluación perceptual completa con contenido sonoro conocido.
- Los contadores de las pruebas de los tres estilos registraron aproximadamente
  60 FPS en calidad equilibrada. El ejecutable empaquetado tuvo una lectura inicial
  de 41–43 FPS durante arranque y luego 60 FPS en diagnóstico. No se certifica un
  mínimo estable para otras GPU ni 144 FPS en GTX 1080 Ti.
- `npm.cmd run dist:win`: instalador NSIS y portable Windows x64 generados. Se
  conserva la versión 1.0.0 del proyecto. No están firmados comercialmente.
- `npm.cmd run test:package`: arranque desde ASAR, preload, canvas y F3 con un slider
  enfocado aprobados. Se espera a que cargue realmente la app; la sola aparición
  de un destino de navegación no indica que el renderer esté listo.

Informes y capturas de las pruebas locales:

- `artifacts/smoke-result.json`, `liquid*.png`, `atmosphere*.png`, `texture*.png`.
- `artifacts/rgba8/smoke-result.json` y capturas de la ruta alternativa.
- `artifacts/package-result.json`, `artifacts/packaged.png`.

Comandos de reproducción en PowerShell:

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run test:smoke
$env:AUDIOFLOW_SMOKE_RGBA8 = '1'
npm.cmd run test:smoke
Remove-Item Env:AUDIOFLOW_SMOKE_RGBA8
npm.cmd run dist:win
npm.cmd run test:package
```

Los scripts eliminan `ELECTRON_RUN_AS_NODE` sólo del entorno del proceso Electron
hijo. El empaquetado reutiliza `.cache/electron-builder` dentro del proyecto,
salvo que se indique explícitamente otra caché. No se instala la aplicación como
parte de estas pruebas ni se solicita micrófono.

Pendiente: evaluación perceptual prolongada de los cinco escenarios descritos en
[ACOUSTICS.md](ACOUSTICS.md), dispositivos adicionales, instalación limpia,
sistemas con salidas protegidas y rendimiento específico en el hardware de referencia.
El análisis no identifica instrumentos, voces ni fuentes independientes. El fluido
es una aproximación advectiva con pigmento persistente, sin solver de presión.

