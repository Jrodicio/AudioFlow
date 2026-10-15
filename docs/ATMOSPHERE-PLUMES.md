# Atmosphere: nacimiento de plumas y definición

Validación local del 15 de octubre de 2026. Se continúa el volumen existente:
atlas 96×72×48, transporte MacCormack, profundidad, transparencias, sombras y
pigmento azul/turquesa/cálido. Liquid, Texture, captura y detector FFT conservan
su comportamiento. No se usan sprites, pulsos de luz ni overlays.

## Causa de los saltos

La versión anterior convertía el ataque en un salto de velocidad y trasladaba
inmediatamente parcelas por `deltaVelocidad * 0,60 s`. Una celda podía cambiar
varios voxeles en un cuadro, deformando bruscamente una nube ya existente.
La elección de humo vecino favorecía alterar masas existentes; no creaba materia.

Se elimina ese traslado instantáneo. El evento pasa a abrir una fuente volumétrica
breve. La velocidad, densidad y pigmento se incorporan gradualmente al mismo gas.

## Fuente finita: attack, bloom, advection, decay

`AtmospherePlumes` mantiene hasta 16 fuentes simultáneas. Cada evento inicia una
sola fuente con origen y fuerza propios. La emisión dura 320 ms en graves,
240 ms en medios y 170 ms en agudos. La curva acumulada es
`F(s) = 6s² − 8s³ + 3s⁴`, con `s = edad/duración`, limitada a [0,1]. Su derivada
es cero al inicio y al final, con máximo al primer tercio de la vida emisora.

Cada paso GPU recibe sólo `F(edad + dt) − F(edad)`. No vuelve a aplicar todo el
evento. La suma del presupuesto previo a los límites físicos es uno, incluso
con FPS distintos o varios subpasos en un cuadro. Hay pruebas a 30/60/144 Hz
y una comprobación GPU de inicio único entre cuadros de 1/120 s.

La fuente describe una cinta elipsoidal curvada, con detalle coherente en su
espacio local. Recorre una trayectoria corta orientada por el flujo existente.
Añade densidad ocupando el espacio disponible mediante una ley exponencial
acotada y mezcla el pigmento por la cantidad de materia incorporada. También
aporta empuje y vorticidad distribuidos por la misma envolvente. La suma del
empuje por paso se limita a 0,012; la velocidad conserva su límite de 0,085.

La fuente termina de emitir, pero la materia liberada permanece en los campos
GPU: se transporta, mezcla, estira y disipa. El canal W de velocidad guarda ahora
la densidad reactiva transportada. Su evaporación, 0,48/s, resta sólo esa fracción
de la densidad total. La reserva original de humedad pasa a un segundo adjunto
del atlas fuente, para mantener el humo ambiental sin evaporarlo junto a la pluma.

La nueva reserva añade unos 2,53 MiB. Se genera durante la inicialización existente;
no añade pasadas por cuadro ni lecturas GPU→CPU en producción. El banco de un
volumen usa 14 texturas frente a las 13 anteriores y libera todas al terminar.

## Bandas, fuerza y controles

| Banda | Forma y movimiento | Pigmento local |
|---|---|---|
| Graves | Ancho aproximado 0,105; masas profundas, empuje amplio, recorrido lento | Azul profundo, con acento cálido según la fuerza |
| Medios | Ancho 0,066; cinta ondulante, torsión y remolinos secundarios | Turquesa con acentos cálidos moderados |
| Agudos | Ancho 0,034; filamentos largos, recorrido rápido y turbulencia fina | Cian/turquesa claro |

Las posiciones no son localización de instrumentos: usan una secuencia espacial
determinista y el balance estéreo disponible. Los graves ocupan un intervalo más
profundo; medios y agudos nacen más cerca del frente para conservar legibilidad.
Toda la emisión sigue estando en coordenadas 3D y puede ocluirse.

Sensibilidad regula admisión: `0,24 / sensibilidad`. No multiplica otra vez la
fuerza de un evento ya admitido. Se atenúan colas espectrales pequeñas, pero una
observación regional con confianza alta conserva apoyo mínimo aunque tenga poca
potencia frente al fondo. Así puede destacar una banda nueva relativamente débil.

Un onset pequeño puede cruzar el umbral del detector antes de llenar su ventana
FFT. El adaptador revisita **ese mismo candidato** durante hasta 65 ms, utilizando
flujo y potencia regional ya calculados. Si gana confianza, se admite una vez;
si no, se descarta. No se cambia el refractario ni se inventan nuevos ataques.

Intensidad regula empuje, cantidad de materia y, de forma moderada, anchura.
La densidad usa compresión suave de la fuerza acústica para que una entrada
sutil admitida conserve presencia. Ni duración de la simulación ni reloj global
se aceleran. Las corrientes continuas y ambientales existentes se mantienen.
En silencio no nacen fuentes nuevas; quedan advección, inercia y disipación.

F3 conserva sus datos y añade fuentes nacidas, emisoras activas y reemplazos por
capacidad. Si se oculta Atmosphere se interrumpe la emisión pendiente, preservando
los campos de gas. Si se llena el conjunto, se reemplaza la fuente más avanzada;
la materia que ya liberó sigue existiendo.

## Definición sin sharpening de pantalla

Se conserva el raymarch y la composición volumétrica. El detalle fino pasa a
escalas anisotrópicas, ligado a coordenadas materiales transportadas: permite
wisps alargados con frecuencia en profundidad resoluble. El LOD se calcula con
la huella tridimensional del paso. Se refuerzan su contraste de erosión y las
sombras internas moderadamente; iluminación y paleta no reaccionan globalmente
al audio. El historial integra 22–34 ms, frente a 25–45 ms anteriores.

Presupuestos: eco 320.000 píxeles/36 pasos, equilibrada 1.150.000/72, alta
1.650.000/88. El ajuste adaptativo existente sigue activo y no cambia el grid.

La comparación usa exactamente los mismos campos congelados, el render previo
como fixture y las ocho fases de muestreo promediadas: no cuenta ruido temporal
como detalle. A 1920×1080, el gradiente medio pasó de 0,003308 a 0,003816
(+15,4 %), con luminancia 0,296289→0,296529 y ligeramente menos píxeles recortados.
Es un indicador espacial; las capturas permiten revisar la suavidad y composición.

## Validación reproducible

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run test:atmosphere:plumes
npm.cmd run test:atmosphere
npm.cmd run build
npm.cmd run dist:win
npm.cmd run test:smoke
npm.cmd run test:package
```

El [visor local](../artifacts/atmosphere-plumes/comparison.html) incluye WAV exactos,
secuencias con tiempos, controles por evento, diferencias ×4 y comparación de
definición. Los [datos completos](../artifacts/atmosphere-plumes/result.json) y CSV
registran nacimiento, masa reactiva añadida, primera visibilidad, bandas,
crecimiento entre cuadros, persistencia y correlación temporal.

Se usa PCM a 48 kHz y FFT causal Blackman 4096 a 60 Hz. Antes de cada evento se
copia el gas actual al control, incluidas sus fuentes anteriores; ambas ramas
reciben las mismas fuerzas continuas y sólo una acepta las fuentes nuevas.
La rama principal no se reinicia entre golpes. La imagen debe superar RMS 0,001,
píxeles con cambio >4/255 en al menos 0,1 % y MAE local 0,002 simultáneamente.

| Caso | Primera respuesta visible por evento |
|---|---|
| Cuatro golpes aislados | 33 / 67 / 50 / 50 ms |
| Grave sostenido con golpes | 67 / 67 / 67 / 50 ms |
| Grave, medio, agudo, medio | 17 / 67 / 83 / 83 ms |
| Cadencia armónica y consonantes de ruido | 67 / 83 / 100 / 83 ms |
| Señal nueva débil sobre grave fuerte | 83 / 117 / 117 / 83 ms |
| Sonido/silencio alternados | 33 / 50 / 50 ms |
| Golpes con sensibilidad/intensidad máximas | 33 / 50 / 33 / 33 ms |

Los cuatro golpes aislados crean exactamente cuatro fuentes y añaden materia
medible. Su primera diferencia visual representa sólo 1,5–4,4 % del pico del
bloom de los primeros 350 ms: el nacimiento crece, no aparece entero en un frame.
En silencio puro nacen cero fuentes y la densidad reactiva queda en cero,
con velocidad ambiental y transporte activos.

Después de ocho segundos adicionales sin sonido, la densidad reactiva media
de A baja de 0,001423 a 0,0000184: queda aproximadamente 1,3 %. No hay emisores
activos ni reinicio del humo. En los ajustes máximos aumenta la materia añadida,
sin perder alineación ni saturar el movimiento en los casos medidos.

Pasaron 31 pruebas unitarias, TypeScript, build y los bancos GPU. En GTX 1080 Ti
con ANGLE/D3D11, salida 1920×1080, integración 1430×804/72 pasos: 59,97 FPS,
mediana GPU 9,92 ms y p95 11,00 ms. El costo anterior era aproximadamente
7,94/9,41 ms; la mayor definición mantiene margen para 60 FPS en ese equipo.
Cinco minutos simulados: sin NaN/Inf, exceso de densidad reactiva ni saturación
persistente. Liquid/Texture conservan diferencia máxima cero frente al shader
heredado; el descarte GPU termina con cero texturas y geometrías.

## Límites

La latencia medida es PCM→imagen, con resolución de un cuadro. No mide retardo
físico del loopback Windows, compositor o pantalla. El detector conserva ventana
FFT y refractario de 140 ms por banda; sonidos muy próximos o débiles pueden
agruparse o no admitirse. La profundidad y la oclusión todavía afectan visibilidad.

El grid limita el grosor físico de filamentos. La simulación es artística, sin
proyección de presión ni conservación exacta de masa: las fuentes crean humo
intencionalmente y el trazador permite disiparlo. No se certifica aceptación
perceptual universal ni rendimiento bajo cualquier GPU o carga concurrente.
