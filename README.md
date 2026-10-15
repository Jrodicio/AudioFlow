# AudioFlow

Aplicación de escritorio para Windows que transforma el audio de salida en un material procedural animado. Electron + React + TypeScript + Vite + Three.js / GLSL. Todo el funcionamiento es local: sin micrófono, servicios externos, fondos de imagen, grabación ni reproducción del audio capturado.

Atmosphere separa ahora las corrientes sostenidas de los impulsos acústicos
discretos. Diagnóstico, pruebas A–F y latencias medidas en
[sincronización audiovisual](docs/ATMOSPHERE-SYNC.md) y
[validación temporal](docs/ATMOSPHERE-VALIDATION.md).

La evolución actual añade [plumas volumétricas con nacimiento progresivo](docs/ATMOSPHERE-PLUMES.md),
materia reactiva transportada y más definición. Banco reproducible:
`npm.cmd run test:atmosphere:plumes`.

## Ejecutar en Windows con PowerShell

Requiere Windows 10/11 de 64 bits, Node.js 22.12 o posterior y una GPU con WebGL 2. Los comandos usan `npm.cmd` para funcionar también cuando PowerShell bloquea `npm.ps1`.

```powershell
Set-Location E:\Proyectos\AudioFlow
npm.cmd install
npm.cmd run dev
```

Las dependencias ya están instaladas en este proyecto. La primera descarga de Electron y las herramientas de distribución necesitan Internet; la aplicación terminada funciona sin conexión. Vite sólo inicia un servidor de desarrollo en `127.0.0.1`; la distribución carga sus archivos mediante un protocolo local y no inicia servidores.

Para ejecutar el build local:

```powershell
npm.cmd run build
npm.cmd start
```

## Uso

- **Escuchar PC** activa `getDisplayMedia` y el loopback de Windows. Reproducí música en cualquier aplicación del equipo. **Detener escucha** libera todas las pistas y cierra el contexto de audio. La escucha nunca se activa sola al abrir la aplicación.
- El medidor en **dBFS** muestra exclusivamente el RMS real capturado; no representa volumen percibido ni volumen del dispositivo. Con loopback conectado pero silencio aparece **Conectado · sin señal**.
- **Demo visual** usa modulación sintética exclusivamente visual, no genera sonido y desactiva la captura. Siempre se identifica como demo; nunca alimenta el medidor de audio real ni se activa automáticamente ante errores.
- **Atmosphere / Liquid / Texture** cambian gradualmente la misma escena procedural, aproximadamente en 10 segundos. La transición automática cambia el destino cada 55 segundos de render visible. Seleccionar un estilo manual desactiva el viaje automático.
- **Sensibilidad** adapta la respuesta a la señal. **Intensidad** regula su influencia física y cromática. **Suavidad** ajusta attack/release y la amortiguación del movimiento. En silencio continúa el flujo ambiental.
- **F11** alterna pantalla completa. **H** oculta / muestra toda la interfaz. **Escape** recupera los controles. El botón de ajustes oculta sólo el panel. La captura activa o sus errores siguen indicados al ocultar la interfaz.
- Estilo, sensibilidad, intensidad, suavidad, calidad y modo automático se guardan en `localStorage`. Demo, captura y pantalla completa requieren activación explícita en cada sesión.

## Distribución Windows

```powershell
npm.cmd run dist:win
```

Genera en `release/`:

- `AudioFlow-1.0.0-Setup.exe`: instalador NSIS con selección de carpeta.
- `AudioFlow-1.0.0-Portable.exe`: ejecutable portable, sin instalación.
- `win-unpacked/AudioFlow.exe`: aplicación desempaquetada; mantener la carpeta completa.

`npm.cmd run pack:win` genera sólo la carpeta desempaquetada. Los ejecutables no incluyen un certificado de firma comercial. No se instaló la aplicación en el sistema como parte del desarrollo.

## Captura y privacidad

El proceso principal registra `session.setDisplayMediaRequestHandler`, obtiene una fuente de pantalla sin miniaturas (`thumbnailSize: 0 × 0`) y concede `audio: 'loopback'`. La pista de video es un requisito de Chromium: se detiene inmediatamente al obtener el stream. No se conecta a elementos de video ni se leen, procesan o almacenan sus fotogramas.

El audio pasa de `MediaStreamAudioSourceNode` a `AnalyserNode`, **sin conexión a `AudioContext.destination`**. No hay eco, reproducción, `MediaRecorder`, solicitudes de micrófono ni almacenamiento de muestras. Los buffers FFT y de señal se reutilizan.

Los permisos se limitan a la ventana y el frame principal de la aplicación, dentro de una solicitud explícita de diez segundos que se consume una vez. Electron 42 pide un permiso `media` con `mediaTypes: []` para escritorio; se acepta sólo ese caso y `display-capture`. Las solicitudes de dispositivos `audio` / `video` quedan denegadas. La ventana usa aislamiento de contexto, sandbox, CSP, integración Node desactivada y navegación / ventanas externas bloqueadas.

La captura se detiene al cerrar la ventana y libera sus recursos al desmontarse. Se detectan pistas finalizadas, contexto suspendido, ausencia de pistas de audio, silencio, permisos denegados y errores de dispositivo. No se sustituye una captura fallida con audio ficticio.

Si no entra señal, comprobá la salida predeterminada de Windows, que el reproductor no esté silenciado y que no use una salida distinta o un modo exclusivo. Tras cambiar de dispositivo, detené y volvé a iniciar la escucha. Las salidas protegidas, dispositivos especiales o aplicaciones exclusivas pueden limitar el loopback. Un silencio prolongado se informa como ausencia de señal, no como prueba de que el dispositivo esté funcionando.

## Motor visual y percepción acústica

El motor conserva el universo procedural del MVP y separa análisis, memoria material y render. El reloj ambiental avanza a velocidad constante: el volumen ya no acelera toda la escena. En silencio continúa el movimiento, mientras las excitaciones anteriores se disipan.

- FFT de **4096** muestras y **siete bandas**: 25–60, 60–250, 250–500, 500–2000, 2000–4000, 4000–6000 y 6000–18000 Hz; límites recortados por Nyquist y resolución real de bins.
- RMS real, potencia instantánea, pico/cresta, contexto reciente y largo; excitación rápida, sostenida y ambiental.
- Por banda: potencia, normalización adaptativa, envolventes rápidas/lentas, tendencia, variación, distribución, flujo, historial, saliencia y ataques independientes.
- Centro espectral, rolloff al 85%, flujo positivo, cambios de distribución y planitud espectral como aproximación limitada a concentración frente a ruido.
- Captura estéreo cuando la pista informa canales útiles: potencia combinada sin cancelación por contrafase, balance, ancho diferencial y correlación. Mono sigue funcionando.
- Normalización con compresión suave, confianza/piso de señal, gate con histéresis, attack/release y refractario regional. Varias regiones pueden ser salientes simultáneamente.

La adquisición usa un temporizador propio, independiente de FPS/calidad. Los buffers se reutilizan. No se clasifican ni separan voces, instrumentos, efectos o emociones; las observaciones describen propiedades acústicas.

| Universo | Comportamiento |
| --- | --- |
| Atmosphere | Volumen 3D persistente: velocidad, densidad, coordenadas materiales transportadas y raymarching con absorción, sombras y oclusión. El audio produce fuerzas regionales, no pulsación global. |
| Liquid | Velocidad y pigmentos persistentes en GPU, advección, difusión viscosa y arrastre. Graves desplazan masa, medios mantienen remolinos y agudos alteran superficie/reflejos. |
| Texture | Relieve mineral anclado, estratos, pliegues, vetas y tensión con resortes amortiguados. Normales analíticas para evitar contornos pixelados. |

Siete excitaciones materiales tienen dirección e inercia; hasta doce perturbaciones locales se superponen, propagan y decaen. El líquido conserva su campo al cambiar de universo. La luminosidad, saturación, reflejos y acentos dorados responden gradualmente a estado sostenido y actividad regional, sin cambios globales aleatorios de paleta.

**F3** muestra/oculta el diagnóstico, oculto al iniciar y sin alterar preferencias. Incluye RMS, contexto, espectro, bandas, saliencia, transitorios, estéreo disponible, excitaciones materiales y FPS. La demo mantiene su identificación sintética; el medidor principal continúa mostrando exclusivamente audio real.

La reconstrucción exclusiva de Atmosphere está documentada en [docs/ATMOSPHERE.md](docs/ATMOSPHERE.md), con arquitectura, límites y banco GPU `npm.cmd run test:atmosphere`. No modifica los shaders de Liquid/Texture ni el análisis de audio. Atmosphere prioriza 60 FPS con integración a resolución acotada; los límites de los otros estilos se conservan.

Detalles de percepción acústica, variables y unidades en [docs/ACOUSTICS.md](docs/ACOUSTICS.md).

## Rendimiento

| Calidad | Presupuesto máximo | DPR máximo | Objetivo |
| --- | --- | --- | --- |
| Eco | 750 mil píxeles, 4 octavas | 1 | 60 FPS |
| Equilibrada | 1,65 millones, 5 octavas | 1,25 | 60 FPS |
| Alta | 3 millones, 6 octavas | 1,5 | Hasta 144 FPS |

El presupuesto limita la resolución interna; el canvas conserva el tamaño de la ventana. `requestAnimationFrame` regula la cadencia. El render se pausa cuando el documento deja de estar visible; la captura y su análisis permanecen conectados hasta detenerlos. Chromium puede reducir la cadencia del temporizador en segundo plano. Se liberan geometría, material, renderer, observadores, eventos, pistas y contexto de audio. Se informa pérdida / recuperación de contexto WebGL. No hay garantía de 144 FPS: depende de GPU, resolución, controlador y otras cargas. El contador muestra la cadencia efectivamente renderizada.

## Verificación

```powershell
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run test:smoke
npm.cmd run test:package
```

`test:smoke` abre la aplicación Electron real, revisa compilación de shaders, estados de demo, medidor, cambios de estilos, preferencias persistentes, ocultación de interfaz e inicio / cierre del loopback. No reproduce sonidos ni solicita micrófono. Usa un perfil de prueba separado en `.cache/smoke-profile`. Guarda capturas **únicamente de la propia ventana de AudioFlow** y un informe en `artifacts/`. Si Windows no permite captura, el informe la marca no disponible y comprueba que la interfaz explique el error; no afirma que la captura haya pasado.

`test:package` requiere haber ejecutado `dist:win` o `pack:win`. Abre y cierra `release/win-unpacked/AudioFlow.exe` con un perfil de prueba separado, comprueba que el preload y el canvas funcionan desde ASAR y guarda `artifacts/package-result.json` y `artifacts/packaged.png`. Sólo esta prueba habilita temporalmente un puerto de depuración local; el arranque normal de la aplicación no lo habilita.

La iteración de percepción agrega pruebas reproducibles de las siete bandas, normalización de señales bajas/altas, ruido, fondo estable con impacto, aparición simultánea de componentes sostenidos, planitud, estéreo/paneo/contrafase, independencia temporal, silencio prolongado, entradas inválidas y memoria de la materia. Se conserva la cobertura de permisos, ciclo de captura y preferencias: **21 pruebas automatizadas**.

La prueba Electron revisa compilación de shaders, diagnóstico F3, demo y medidor real, cambios de universo, pantalla completa, ventana mínima, preferencias, ocultación de interfaz e inicio/cierre del loopback. Guarda pares de capturas por material e informe en `artifacts/`. La inspección visual de esas capturas permite revisar composición, continuidad entre estados y artefactos; no certifica por sí sola una sesión perceptual completa.

Se conserva el objetivo de al menos 60 FPS con resolución interna acotada. La prueba local registró aproximadamente 60 FPS en calidad equilibrada con WebGL activo y loopback real estéreo. Esto no certifica rendimiento específico en GTX 1080 Ti/144 Hz. Los escenarios de podcast, cine, ambientes e impactos requieren evaluación perceptual con contenido conocido en el equipo final; la lista reproducible está en la documentación acústica.

Los ejecutables no están firmados comercialmente. No se prueba la instalación en una máquina limpia, todos los dispositivos ni sesiones prolongadas. La aproximación líquida no resuelve presión/incompresibilidad completa. El análisis FFT no identifica ni aísla fuentes superpuestas; eventos muy próximos o pequeños pueden agruparse o no detectarse.

Referencias técnicas: [captura de escritorio de Electron](https://www.electronjs.org/docs/latest/api/desktop-capturer), [loopback y permisos de sesión](https://www.electronjs.org/docs/latest/api/session), [seguridad de Electron](https://www.electronjs.org/docs/latest/tutorial/security).
