# Atmosphere: gas persistente y render volumétrico

Esta iteración sustituye exclusivamente el camino visual de Atmosphere. El shader
heredado de Liquid/Texture, su simulación, las señales acústicas, la captura,
React, estilos CSS, controles, preferencias y permisos no fueron modificados.
La integración se limita al planificador, composición, recursos y diagnóstico de
`Universe`. Se añade `npm.cmd run test:atmosphere` para validar el volumen.

## Por qué se veía plano

El material anterior evaluaba fBm/domain warping sobre un plano 2D y calculaba
normales de superficie. Tenía movimiento y acentos regionales, pero no guardaba un
campo gaseoso, no transportaba densidad en profundidad y no integraba luz a través
de espesores. Cambiar sus parámetros no podía producir oclusión volumétrica real.

## Arquitectura

`AtmosphereVolume.ts` mantiene un volumen **96 × 72 × 48** en un atlas de **8 × 6**
cortes. No son tres imágenes superpuestas: todas las celdas se muestrean con
interpolación trilineal y las velocidades tienen componentes X, Y y Z.

Tres render targets MRT de dos adjuntos RGBA16F permiten hacer ping-pong y un paso
intermedio de transporte:

- Adjunto 0: velocidad XYZ persistente y reserva de humedad W.
- Adjunto 1: desplazamiento de coordenadas materiales RGB y densidad A.
- Primera pasada: advección semi-Lagrangiana con velocidad en el punto medio.
- Segunda: corrección MacCormack limitada por el entorno de la celda; después,
  fuerzas ambientales/acústicas, amortiguación y condiciones de borde.

Paso fijo de **1/60 s**, máximo cuatro recuperaciones por frame. La velocidad está
limitada a 0,085 unidades normalizadas/s. La amortiguación tiene una constante de
unos 3,85 s; los bordes imponen componente normal nula en la primera celda.
Ninguna variación ordinaria del audio reinicia el campo.

Una reserva espacial de humedad, generada una sola vez, repone/evapora densidad de
forma continua con una constante de unos **22 s**. Evita que el transporte numérico
termine vaciando la escena. No reemplaza la densidad: la materia existente sigue
siendo transportada y las aportaciones son pequeñas e incrementales.

El detalle de alta frecuencia reside en una textura 3D periódica de **64³**, creada
localmente con semilla fija. Se evalúa a través de coordenadas materiales que el
flujo transporta; no mediante una animación temporal independiente. Se almacena el
desplazamiento de esas coordenadas para conservar incrementos pequeños en FP16.
Su deformación se relaja gradualmente (12,5 s) para evitar acumulación de pliegues
y aliasing. La densidad y la velocidad conservan sus propios historiales.

## Profundidad e iluminación

Un raymarching en perspectiva atraviesa el volumen de adelante hacia atrás:

- Extinción/absorción según densidad y longitud de cada paso.
- Dispersión coloreada dentro de las masas, con paleta acotada.
- Dos consultas hacia la luz para aproximar sombras internas suaves.
- Transmitancia acumulada: una masa cercana oculta parcialmente las lejanas.
- Atenuación de contraste por distancia y cambio de escala aparente por perspectiva.

Las posiciones y las velocidades 3D producen movimiento diferencial entre fondo,
plano medio y primer plano. No se aplica desenfoque por profundidad para fabricarlos.
El banco GPU permite aislar tercios del trayecto del rayo para inspeccionar esas
regiones; ese recorte no forma parte de los controles del producto.

El muestreo intercalado del rayo, filtrado mip del detalle según huella del paso y
acumulación temporal eliminan bandas coherentes del raymarching. Dos imágenes
alternadas guardan el historial de iluminación. Su peso usa tiempo simulado real
entre renders (unos 84 ms), no un número fijo de frames. Cambiar resolución invalida
sólo ese historial de imagen, preservando el gas.

## Audio como fuerza

Se reutilizan sin cambios `FeatureExtractor` y `MaterialResponse`:

- Graves y subgraves: fuerzas amplias de circulación y presión local.
- Medios: torque alrededor de distintos ejes y regiones del volumen.
- Presencia/agudos: fuerzas de curl más pequeñas y rápidas que estiran detalles.
- Sostenidos/saliencia: mantienen fuerzas regionales graduales e independientes.
- Eventos: cascarones de presión con centro, banda, edad y decaimiento propios.
- Estéreo disponible: sesgo espacial de las regiones, sin identificar fuentes.

El audio no cambia directamente exposición, escala de toda la escena ni velocidad
del reloj. Al cesar, las fuerzas caen según sus envolventes existentes; el campo de
velocidades sigue transportando gas y se amortigua. La intensidad cero conserva
las fuerzas ambientales y la inercia acumulada, retirando el aporte acústico nuevo.

## Rendimiento y ciclo de vida

| Calidad | Pasos máximos | Presupuesto de raymarching |
| --- | --- | --- |
| Eco | 32 | 320.000 píxeles |
| Equilibrada | 48 | 720.000 píxeles |
| Alta | 64 | 1.100.000 píxeles |

La composición final conserva la resolución del canvas del motor existente; el
volumen se integra a resolución acotada y se amplía linealmente. Hay salida temprana
cuando la transmitancia es mínima. Atmosphere se limita a 60 FPS y puede reducir
lentamente su resolución de integración ante frames lentos; el grid no cambia.
No se modifican los límites de FPS de Liquid/Texture.

Los recursos se crean al entrar por primera vez en Atmosphere. Al cambiar a otro
universo se conserva y finalmente pausa el gas cuando su contribución es menor a
0,1%, evitando trabajo permanente sobre los otros estilos. Regresar lo continúa.
Cambiar tamaño o calidad no reinicia densidad/velocidad. Tras pérdida de contexto
GPU se regeneran los campos, porque su contenido anterior ya no existe.
Al cerrar se liberan todos los targets, textura 3D, materiales y geometría.

La ruta volumétrica requiere WebGL2 y `EXT_color_buffer_float`, disponibles en el
hardware de referencia con controlador adecuado. Si falta esa extensión se
mantiene el Atmosphere anterior, sin impedir el uso de los demás universos. F3
informa la ruta, grid, pasos y resolución de integración. No se agregan controles.

No hay lecturas GPU→CPU ni asignaciones de buffers por frame en producción. Las
lecturas completas de estado se limitan al banco de pruebas. La memoria aproximada
adicional del volumen equilibrado ronda 23 MB, sin contar el renderer ni el campo
líquido que ya existía.

## Validación reproducible

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run test:atmosphere
npm.cmd run test:smoke
npm.cmd run dist:win
npm.cmd run test:package
```

`test:atmosphere` sirve sólo el banco local en 127.0.0.1:5174 y abre una ventana
Electron de prueba sin tomar el foco. No reproduce sonido ni solicita captura:
las señales acústicas de sus escenarios B/C son sintéticas, etiquetadas como tales,
y pasan por el extractor existente. No se pretende que sean una voz o una película.

Comprueba:

1. Silencio: transporte y deformación visibles entre capturas, con una simulación
   gemela para comprobar el nivel de redondeo FP16.
2. Señal suave e impulsos: diferencias regionales de velocidad respecto del control.
3. Retirada del sonido: inercia residual y amortiguación posterior.
4. Densidad y movimiento en tres intervalos de profundidad; capturas aisladas.
5. Cinco minutos adicionales de tiempo simulado a paso fijo, sin NaN/Inf, velocidad
   o densidad fuera de límites, pérdida de cuerpos visibles o crecimiento de recursos.
6. Resize/calidad sin reinicio y liberación de todos los recursos al finalizar.
7. Comparación GPU del shader heredado y el compuesto para Liquid/Texture: diferencia
   máxima esperada **cero bytes** con las mismas entradas y texturas.

Informes y capturas: `artifacts/atmosphere-volume/`. La prueba general de Electron
comprueba por separado captura real loopback, interfaz, preferencias y estilos.
Los FPS del banco corresponden a un backing buffer de 1920×1080 y raymarching
1131×636 en equilibrada, no a raymarching nativo de dos millones de píxeles.

## Límites

Es una aproximación gaseosa con estado y transporte 3D; no resuelve Navier–Stokes,
proyección de presión ni conservación exacta de masa. La reserva de humedad es
un mecanismo artístico de estabilidad, no un modelo meteorológico. La dispersión
y las sombras son aproximadas, sin trazado múltiple de luz. El grid y el muestreo
limitan el detalle espacial; la acumulación temporal puede suavizar perturbaciones
muy rápidas. Las fuerzas del audio no identifican ni separan sus fuentes.

La inspección de capturas verifica geometría, oclusión, evolución y defectos visibles;
no certifica fotorrealismo ni calidad artística universal. La estabilidad acelerada
de cinco minutos simulados tampoco equivale a una sesión real de varias horas.
El rendimiento específico en GTX 1080 Ti requiere medir en ese equipo; no se
pretende garantizar 144 FPS en esta iteración.
