# Atmosphere: sincronización acústica por eventos

> Etapa anterior de sincronización. El traslado instantáneo de parcelas se
> sustituyó por fuentes progresivas de materia; arquitectura y mediciones
> actuales en [ATMOSPHERE-PLUMES.md](ATMOSPHERE-PLUMES.md).

Validación local: 15 de octubre de 2026. Se conserva el volumen, su iluminación,
pigmentos, paleta, transparencias, raymarching, calidad y movimiento ambiental.
Los shaders de Liquid/Texture y MaterialResponse no cambian.

## Diagnóstico de la cadena temporal

La conexión acústica funcionaba. El problema era convertir acontecimientos
discretos en aceleración prolongada y esperar a que esa aceleración desplazara
suficiente humo para hacerse visible. Los eventos antiguos se evaluaban cada
paso con una envolvente de unos 0,4 s y una región en expansión: el resultado
acentuaba actividad acumulada, con poca definición del ataque. Un centro podía
coincidir además con aire vacío o materia ocluida.

| Etapa | Comportamiento y tiempo |
|---|---|
| Captura | Loopback existente de Windows; no se modifica ni se mide aquí su retardo físico. |
| FFT | 4096 muestras, sin smoothing del AnalyserNode: ventana causal de 85,3 ms a 48 kHz. No es un retardo fijo de 85,3 ms: un ataque fuerte puede superar el umbral antes de completar la ventana. |
| Análisis | Aproximadamente 60 Hz. Detección regional por flujo y variación de amplitud, antes de las envolventes. Refractario existente de 140 ms por banda. |
| Envolventes continuas | Banda rápida: ataque de 25–60 ms; adaptador Atmosphere añade 25 ms. Sostenida y saliencia conservan sus filtros. Sólo alimentan fuerzas continuas. |
| Eventos | Registro acotado de 64 observaciones: ID, tiempo de adquisición, banda, fuerza original, RMS y participación espectral. Sin filtro de ataque adicional. |
| Render/uniforms | Consume observaciones nuevas, incluso cuando hubo varios ticks de análisis entre cuadros. No depende del resorte de MaterialResponse. |
| GPU | Paso fijo 16,7 ms. El evento espera si todavía no hay paso; se consume después de una sola pasada de corrección. Los subpasos de recuperación no lo repiten. |
| Materia | Salto local de velocidad y desplazamiento inicial de parcelas: densidad, coordenadas materiales y pigmentos juntos. No espera varios cuadros de aceleración. |
| Imagen | Historial existente de 25–45 ms; el evento también informa su excitación. No se cambian transferencia óptica, luz ni exposición. |

El registro es información adicional del detector existente. Sus umbrales,
envolventes, contadores heredados y entradas de Liquid/Texture se conservan.
La FFT causal mostró pequeñas colas espectrales en bandas vecinas. Atmosphere
pondera su fuerza por `sqrt(clamp(fracciónDePotencia * 16))`: pueden coexistir
varias bandas; una cola de 0,006 % no recibe la fuerza de la banda principal.

## Impulsos y fuerzas continuas

Cada evento admitido entra en una cola de hasta doce impulsos. Su magnitud
combina la observación original y el RMS observado en ese instante, sin esperar
la ganancia suavizada de las fuerzas continuas. La intensidad multiplica la
respuesta física; no modifica el reloj ni la velocidad global de simulación.

Los centros siguen secuencias espaciales deterministas con sesgo de balance
estéreo, dentro de un intervalo de profundidad visible desde la cámara +Z.
La GPU consulta cinco posiciones cercanas en el campo actual de densidad y
elige materia sobre la que actuar. No hay lecturas GPU→CPU en producción,
fuentes semánticas ni una onda superpuesta a la pantalla.

| Bandas | Radios del impulso | Comportamiento |
|---|---|---|
| Subgrave/grave | 0,23 / 0,21 | Presión amplia, desplazamiento direccional y estela tangencial. |
| Medios | 0,15 / 0,13 / 0,11 | Vorticidad y deformación local, con curl intermedio. |
| Presencia/brillo | 0,08 / 0,065 | Curl fino y perturbación rápida de filamentos. |

Las unidades son fracciones del volumen normalizado. Las máscaras son suaves,
con soporte acotado. Las contribuciones coincidentes se suman y su salto total
de velocidad se limita a 0,065. Después se conserva el límite existente de
velocidad 0,085. La deformación inicial toma el mismo campo de impulso y mueve
parcelas por `deltaVelocidad * 0,60 s`, revelando rápidamente el ataque dentro
del humo; no agrega densidad luminosa ni recolorea el pigmento. Los campos se
acotan después para mantener densidad y concentraciones entre cero y uno.

En los pasos siguientes no se vuelve a inyectar ese impulso. La velocidad ya
almacenada transporta y estira la materia, superponiéndose con velocidades
previas, fuerzas ambientales y corrientes sostenidas. Se mantiene la disipación
de 0,26/s (constante aproximada de 3,85 s), advección MacCormack y relajación
de deformaciones. Es propagación por transporte y estela, no un solver de
presión acústica. Una diferencia de imagen puede permanecer después de
disiparse la velocidad porque el humo ya fue desplazado.

La rama continua conserva fuerzas ambientales a tres escalas, flotación,
centros que derivan lentamente y excitación regional sostenida. En silencio
terminan los eventos nuevos y las envolventes acústicas se liberan gradualmente;
las corrientes propias continúan. Un sonido constante no se transforma en un
tren de golpes ni se cuantiza mediante BPM.

Sensibilidad regula la admisión de eventos (`umbral = 0,24 / sensibilidad`),
además de la normalización continua existente. Intensidad regula magnitud de
impulsos, desplazamientos y fuerzas continuas. La rama discreta no multiplica
la fuerza otra vez por sensibilidad. Las pruebas incluyen eventos débiles
admitidos sólo con sensibilidad alta y eventos fuertes de idéntica magnitud
admitidos con ambas sensibilidades. Se conserva la interfaz y sus valores.

Se descartan eventos de adquisición con más de 150 ms de antigüedad y los
pendientes de una escena oculta, cambio de fuente o pérdida de contexto. Esto
evita reproducir golpes viejos al volver a Atmosphere. El contador F3 informa
eventos admitidos, aplicados, pendientes, descartados por capacidad, tiempo
desde el último, bandas recientes, excitación rápida, sostenida y estelas.
Las intensidades mostradas son señales de control, no fuerzas GPU medidas.

## Validación temporal reproducible

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run test:atmosphere
npm.cmd run test:atmosphere:temporal
npm.cmd run dist:win
npm.cmd run test:smoke
npm.cmd run test:package
```

El banco temporal genera PCM a 48 kHz y calcula la FFT de ventanas Blackman
consecutivas, causales y solapadas de 4096 muestras. No proporciona onsets ni
espectros inventados al extractor. Una prueba independiente comprueba los
coeficientes de la FFT contra un seno y los lóbulos conocidos de su ventana.
También se verifica detección a 30, 60 y 144 actualizaciones por segundo.

El gas principal evoluciona sin reiniciarse entre golpes. Antes de **cada**
comienzo PCM conocido se copia su estado GPU y su historial a un control.
Ambas ramas reciben las mismas señales sostenidas y el mismo patrón de
raymarching; sólo el control omite los nuevos impulsos. Así se mide el cambio
producido por ese evento, sin confundirlo con la diferencia acumulada desde
el inicio de una canción o con una reducción de movimiento en silencio.

Se conserva la acumulación temporal de producción. Cada 16,7 ms se mide RMS
RGB, proporción de píxeles que cambian más de 4/255 y MAE de 144 regiones.
Una respuesta se considera medible cuando cumple simultáneamente RMS ≥0,001,
píxeles cambiados ≥0,1 % y MAE local ≥0,002. Se exige respuesta en ≤150 ms,
persistencia a 300 ms, alineación de eventos e inactividad entre señales.
La resolución temporal es de un cuadro: no se afirma precisión subcuadro.

El banco también lee el campo GPU del impulso **antes** de consumirlo: salto
de velocidad RMS/máximo, región activa y gradiente espacial. Lo distingue de
las aceleraciones sostenidas. Una comprobación específica verifica cola a
120 Hz y consumo único incluso con tres subpasos adicionales.

El [visor audiovisual](../artifacts/atmosphere-temporal/comparison.html) incluye
las señales WAV exactas, secuencias PNG con tiempos, curvas, cuadros próximos
a cada ataque y diferencias ×4. La reproducción selecciona las imágenes por
el tiempo del audio; la cadencia general es de 100 ms, con cuadros adicionales
alrededor del ataque. Las métricas tienen cadencia de 16,7 ms. Los
[datos completos](../artifacts/atmosphere-temporal/result.json) y CSV por caso
incluyen latencia, magnitud, persistencia, bandas, impulsos y correlación.

## Límites

Estos tiempos cubren PCM→FFT→extractor→GPU→imagen con señales reproducibles.
No incluyen latencia real de salida/captura Windows, temporizadores bajo carga,
cola del compositor ni pantalla física; requieren medición externa. La FFT
propia del banco reproduce la ventana causal, no toda la implementación interna
de Chromium. Un ataque suave aparece más tarde que un ataque abrupto.

Se conservan resolución espectral, refractario por banda y límites del grid:
eventos muy cercanos o débiles pueden agruparse o no superar el detector.
No se separan fuentes que comparten espectro. La elección de materia mejora
visibilidad, pero no garantiza percibir todo evento bajo cualquier oclusión,
posición, configuración o contenido. Las métricas no sustituyen una evaluación
perceptual del usuario con voz, películas o música reales.

El modelo sigue siendo una aproximación artística con advección y fuerzas;
no resuelve incompresibilidad ni conserva exactamente masa. No hay nuevas
pasadas, texturas de simulación ni readbacks en el camino normal; los eventos
añaden consultas locales de densidad en el paso de fuerzas existente.
