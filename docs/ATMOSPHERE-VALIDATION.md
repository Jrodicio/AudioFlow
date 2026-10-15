# Validación de Atmosphere: sincronización temporal

Fecha local: **15 de octubre de 2026**. Arquitectura y límites en
[ATMOSPHERE-SYNC.md](ATMOSPHERE-SYNC.md).

> Informe de la etapa previa. Las mediciones actuales de nacimiento progresivo,
> definición y rendimiento están en [ATMOSPHERE-PLUMES.md](ATMOSPHERE-PLUMES.md)
> y su visor. Los archivos del banco GPU se regeneran con la implementación actual.

Pasaron 27 pruebas unitarias, TypeScript de aplicación/Electron y banco,
build, banco GPU, banco temporal A–F, smoke de Electron y ejecutable empaquetado.
Se regeneraron portable y NSIS x64 1.0.0.

## Evidencia temporal

El [visor audiovisual](../artifacts/atmosphere-temporal/comparison.html) incluye
WAV exactos, secuencias con tiempos, curvas, cuadros por evento y diferencias
×4. Hay [datos por cuadro](../artifacts/atmosphere-temporal/result.json) y CSV
por escenario.

PCM causal a 48 kHz, ventanas FFT Blackman consecutivas de 4096 muestras a
60 Hz, extractor real, GPU e historial de producción, render interno 640×360
y 64 pasos. Antes de **cada evento** se copia el estado del gas y su historial
a un control que recibe las mismas fuerzas sostenidas, omitiendo sólo los
nuevos impulsos. El gas principal continúa entre golpes.

La primera respuesta debe superar simultáneamente RMS RGB 0,001, 0,1 % de
píxeles con cambio mayor que 4/255 y MAE local 0,002. Resolución temporal:
16,7 ms. Son umbrales de medición de imagen, no una certificación perceptual.

| Prueba | Primera respuesta por evento | Resultado |
|---|---|---|
| A: golpes aislados | 17 / 17 / 17 / 17 ms | Cuatro impulsos, uno por golpe; sin excitaciones entre ellos. |
| B: grave constante con golpes | 17 / 17 / 17 / 17 ms | Corriente sostenida más ataques; cada golpe activa dos regiones espectrales. |
| C: grave, medio, agudo, medio | 17 / 17 / 17 / 17 ms | Escalas y regiones distintas. |
| D: señal armónica modulada con consonantes de ruido | 50 / 50 / 50 / 50 ms | Cuatro variaciones con excitaciones multibanda. |
| E: sonido/silencio alternados | 17 / 17 / 17 ms | Nuevas excitaciones en el sonido, con estela posterior. |
| F: normal (1,2 / 0,8) y máximo (3 / 1,5) | 17 ms en ambos ajustes | Más expresión, sin retraso ni saturación permanente. |

Los tiempos abarcan comienzo PCM→imagen; en estos casos la respuesta medible
coincide con el cuadro de aplicación. D crece gradualmente y se detecta más
tarde. **No incluyen loopback Windows, compositor ni pantalla física.**

El 100 % de los eventos previstos recibió respuesta en ≤150 ms. Todos los
cuadros con impulsos nuevos quedaron en intervalos de ataque definidos; en B
se excluye el arranque inicial del grave de los cuatro golpes superpuestos.
Correlación binaria máxima entre comienzos PCM y cuadros con impulso: 1,0 a
17 ms en A/C/E/F y 50 ms en D; 0,703 a 17 ms en B por activaciones regionales
en cuadros contiguos. No son estadísticas sobre música o voz reales.

RMS de imagen a 300 ms en A: 0,01613 / 0,00565 / 0,00885 / 0,01075. Cada golpe
deja estela. Picos RMS en F máximo: aproximadamente 1,40 / 1,60 / 1,42 / 1,69
veces los normales. Ningún estado final A–F tuvo celdas próximas al limitador.

## Campo GPU e inyección única

Lecturas del impulso antes de consumirlo:

| Evento C | Δ velocidad RMS | Fracción activa | Gradiente relativo |
|---|---:|---:|---:|
| Grave | 0,00769 | 35,14 % | 0,0674 |
| Medio | 0,00228 | 4,29 % | 0,1409 |
| Agudo | 0,00108 | 0,47 % | 0,3825 |

Activa significa módulo de Δ velocidad >0,001. El golpe grave también puede
activar bandas vecinas debido a la resolución de la ventana corta. El campo
agudo tiene gradiente unas 5,7 veces mayor que el grave, con región menor.

La prueba GPU de cola conserva un impulso pendiente tras 1/120 s; el siguiente
cuadro completa el paso y lo aplica una vez. Tres subpasos adicionales mantienen
el total aplicado en uno. Las pruebas unitarias cubren ticks omitidos por render,
fuentes nuevas, eventos antiguos, sensibilidad y FFT causal a 30/60/144 Hz.

## Estabilidad, estética y rendimiento

El [banco GPU completo](../artifacts/atmosphere-volume/result.json) y su
[comparación visual](../artifacts/atmosphere-volume/comparison.html) comprueban
transporte, pigmento, silencio, profundidad, resize, repetibilidad y recursos.
Sus comparaciones tras segundos respaldan esos aspectos; la sincronización
se valida mediante el banco temporal independiente.

Cinco minutos adicionales alternando audio/silencio, 317 s simulados con
calentamiento: sin NaN/Inf ni campos fuera de rango. Máximos en los finales
de minuto entre 0,03236 y 0,06506, límite 0,085, fracción saturada cero.
Se conservaron cuerpos, varianza y pigmentos azul, turquesa y cálido.

Tras retirar audio dinámico, Δ velocidad RMS fue 0,01906 al segundo y
0,000563 después de otros quince segundos. La excitación termina y la inercia
decae; la materia desplazada no tiene que volver a su estado anterior.

Liquid/Texture frente al shader heredado: diferencia máxima **cero bytes**.
Se conserva el render volumétrico, iluminación, detalle y reservas de pigmento.
Memoria estable: 13 texturas y 2 geometrías en el banco de un volumen; tras
dispose, cero texturas y geometrías. No hay nuevos targets ni readbacks en
producción.

GTX 1080 Ti, ANGLE Direct3D11 en Windows, salida 1920×1080, calidad equilibrada,
integración 1320×742 y 64 pasos: **59,95 FPS**, mediana GPU **7,94 ms**, p95
**9,41 ms** (479 consultas en ocho segundos). Cambio entre cuadros con
historial: p95 RMS 0,00302. No garantiza mínimos bajo otras cargas o hardware.

## Integración y entregables

La [prueba Electron](../artifacts/smoke-result.json) pasó F3, demo, estilos,
preferencias, tamaños, pantalla completa, render y ciclo de loopback. Windows
entregó audio real durante el recorrido; eso comprueba adquisición e integración,
sin medir latencia física ni evaluar perceptualmente contenido identificado.

La [prueba del paquete](../artifacts/package-result.json) pasó ASAR, preload,
F3 con slider enfocado, volumen, pausa de Liquid bajo Atmosphere y reanudación
al cambiar. No se probó instalación en máquina limpia.

- [Portable](../release/AudioFlow-1.0.0-Portable.exe).
- [Instalador](../release/AudioFlow-1.0.0-Setup.exe).
- [Hashes SHA-256](../release/SHA256SUMS.txt).
- [Captura del paquete](../artifacts/packaged-atmosphere.png).

Persisten los límites de la FFT, refractario por banda, oclusión y simulación
artística sin solver de presión ni conservación exacta de masa. La aceptación
perceptual con audio cotidiano del usuario sigue siendo una comprobación manual.
