# Percepción acústica y materia persistente

Esta iteración conserva Electron, React, preferencias, permisos y protocolo local.
No clasifica voz, instrumentos, efectos ni emociones. Las regiones frecuenciales
pueden activarse simultáneamente, incluso cuando pertenecen a una sola fuente.
Tampoco puede distinguir dos fuentes que comparten espectro y dinámica.

## Adquisición y unidades

`SystemAudio` toma muestras con un temporizador propio de aproximadamente 60 Hz.
`Universe` consulta el último estado: calidad y FPS no fijan la cadencia de análisis.
El reloj es `performance.now()` y todos los filtros reciben segundos reales. Los
buffers, asignaciones de bandas, espectros anteriores y acumuladores se reutilizan.
Los temporizadores del renderer pueden sufrir jitter o throttling en segundo plano;
esto no es análisis de cada muestra en un AudioWorklet. Al suspender la pestaña se
pausa el render; al regresar se conserva el estado sin simular todo el tiempo ausente.

FFT 4096, sin suavizado oculto del AnalyserNode. A 48 kHz: resolución 11,72 Hz y
ventana de 85,3 ms. Una banda incluye los centros de bin en [límite inferior,
límite superior), recortados por Nyquist. No se inventan bins en regiones vacías.
Los límites son 25 / 60 / 250 / 500 / 2000 / 4000 / 6000 / 18000 Hz.

| Variable | Unidad / comportamiento |
| --- | --- |
| `rms`, `peak` | Amplitud lineal digital real. Sin sensibilidad ni normalización visual. |
| `instantaneous` | Media de muestras al cuadrado; potencia de la ventana temporal. |
| `crest` | Pico / RMS, cero en silencio; limitado defensivamente a 100. |
| `shortEnergy`, `longEnergy` | RMS promediado con constantes de 0,35 y 9 segundos. |
| `relative` | Relación reciente / contexto, comprimida y limitada a 0..1. |
| `energy`, `sustained`, `atmosphere` | Excitación visual adaptativa rápida, sostenida y ambiental, 0..1. |
| `centroidHz`, `centroid` | Centro ponderado por magnitud, Hz y Hz/10000 limitado. |
| `rolloffHz` | Frecuencia que acumula el 85% de potencia espectral analizada. |
| `flux` | Suma de aumentos de magnitud / suma actual de magnitud; 0..1. |
| `flatness`, `tonality` | Media geométrica / aritmética de potencia; complemento como proxy de concentración. No estiman altura tonal ni harmonicidad. |
| `textureChange` | Distancia entre distribuciones de potencia por banda consecutivas. |
| `eventId`, `impulse` | Contador acumulativo de ataques regionales y envolvente rápida de esos eventos. |

Por banda: `energy` es potencia espectral lineal, no dBFS calibrados ni sonoridad;
`normalized` es excitación 0..1 con compresión suave y contexto propio;
`fast`/`slow` usan attack/release asimétricos; `history` promedia amplitud espectral
durante 8 segundos; `trend` compara envolventes rápida y lenta (-1..1);
`variation` sigue cambios absolutos relativos; `share` es fracción de potencia total;
`flux` es flujo regional; `salience` combina novedad sobre historial, crecimiento y
flujo; `sustained` conserva excitación regional; `transient` y `eventId` pertenecen
a esa región. `active` aplica histéresis a saliencia, sin imponer un ganador único.

La normalización usa piso de ruido conservador, gate con histéresis, confianza de
señal y denominadores mínimos. El historial nunca amplifica silencio hasta llenar
la escena. La sensibilidad afecta excitaciones, no el medidor. Un contenido fuerte
y estable se estabiliza sin repetir impactos; su saliencia de novedad se adapta,
pero las corrientes sostenidas siguen presentes. La suavidad no elimina los ataques:
los eventos se detectan antes del suavizado estructural, con refractario por banda
de 140 ms y memoria rápida de unos 0,3 s. La granularidad temporal de la FFT limita
la resolución de ataques muy breves o cercanos; esto no es un detector de beats.

## Estéreo condicional

Si la pista declara al menos dos canales, un ChannelSplitter alimenta dos analizadores.
El espectro combina potencia de L/R en vez de promediar amplitud; evita cancelar
contenido en contrafase. RMS es raíz de la potencia promedio de ambos canales.
Balance = (potencia R - potencia L) / suma, rango -1..1; ancho es energía diferencial
normalizada y correlación es producto cruzado normalizado, rango -1..1.
Balance desplaza regiones de respuesta y centros de eventos; ancho extiende su
influencia espacial. Una pista estéreo duplicada tendrá balance/ancho prácticamente
cero. Si Windows no declara canales útiles se mantiene el camino mono y se indica
que la información estéreo no está disponible. No son coordenadas de fuentes.

No hay conexión al destino de audio, micrófono, grabación, red ni muestras guardadas.
Se desconectan splitter/analizadores y se cancela el temporizador al detener captura.

## Materia y memoria

`MaterialResponse` conserva siete excitaciones con resortes amortiguados, corrientes
sostenidas, saliencia y tensión lenta. Integra el resorte con pasos de hasta 1/120 s.
Doce perturbaciones simultáneas conservan centro, banda, intensidad y edad. Una
región recibe eventos a partir de su contador, aunque no se dibuje cada muestra.
Si llegan más eventos que ranuras disponibles se reutiliza la más antigua; varias
ocurrencias de una misma banda entre renders se condensan en una perturbación.
Los centros siguen una secuencia determinista y señales estéreo disponibles, nunca
una supuesta localización del objeto sonoro. Las ondas se propagan y disipan sin
reemplazar el material. El reloj ambiental avanza a velocidad constante con y sin
audio. Intensidad cero elimina influencia acústica y conserva evolución ambiental.

- **Atmosphere:** se reconstruyó posteriormente como un gas 3D persistente,
  transportado y compuesto con raymarching. Las señales acústicas de este documento
  se conservan y pasan a actuar como fuerzas. Arquitectura actual y validación en
  [ATMOSPHERE.md](ATMOSPHERE.md).
- **Liquid:** dos render targets RGBA de 512² intercambian velocidad y dos pigmentos.
  Advección semi-Lagrangiana con muestreo de punto medio, difusión moderada,
  amortiguación viscosa, fuerzas de curl ambiental/regionales, impulsos de presión
  y reposición muy lenta de pigmento. El campo continúa durante los otros estilos.
  RG guarda velocidad codificada y BA concentraciones, no capturas de la pantalla.
  FP16 si `EXT_color_buffer_float` está disponible; RGBA8 como alternativa con menor
  precisión dinámica: almacena dos pigmentos de 16 bits fijos y usa un campo de velocidad coherente con las excitaciones amortiguadas. Esto evita que incrementos pequeños queden congelados por cuantización a 8 bits. El resultado guía color, relieve y reflejos del material. No hay solver
  de presión/incompresibilidad: es una aproximación advectiva, no Navier–Stokes.
- **Texture:** relieve mineral anclado, estratos suaves y vetas discretas. La tensión
  de cada región deforma/pliega estructuras resistentes con memoria. Altas frecuencias
  iluminan detalles y los eventos deforman el relieve temporalmente. No advecta
  pigmentos ni comparte los contornos de mármol de Liquid.

En Liquid/Texture se conserva la modulación cromática original. En Atmosphere el color se transporta con la materia y su luz no depende directamente del audio. La descripción cromática de la iteración anterior es: energía lenta modula luminosidad/saturación;
centro y actividad regional afectan detalle; saliencia produce acentos locales;
las perturbaciones modulan tensión cromática suavemente, sin flashes globales.
Transiciones de estilo conservan los pesos interpolados y el campo líquido.
No hay lecturas GPU→CPU. Presupuesto de resolución y límites de FPS del MVP conservados.
El panel opcional F3 muestra observaciones reales y excitaciones físicas; en demo
indica explícitamente la procedencia sintética de las excitaciones visuales.

## Evaluación perceptual reproducible pendiente de material real

Las pruebas automatizadas usan tonos bin-centered de FFT conocida, impulso,
ruido con semilla fija, combinaciones y canales idénticos/paneados/contrafase.
Estos casos comprueban señales y continuidad, no equivalen a evaluar podcasts o cine.
La inspección de capturas de la propia ventana permite revisar composición y errores
visuales; dos capturas separadas permiten observar evolución, no certificar fluidez
durante una sesión completa ni un objetivo de FPS en otro hardware.

Para evaluación en el equipo final, activar loopback y F3 y recorrer los tres estilos:

1. Voz con pausas: verificar ataques regionales, cambios espectrales y decaimiento
   durante pausas manteniendo evolución ambiental.
2. Graves + agudos simultáneos: observar excitaciones de ambas regiones, masa y detalle
   coexistentes, sin elegir un único protagonista.
3. Ambiente continuo + golpe: comprobar evento/onda superpuesto a corrientes de fondo;
   el nivel estable no debe crear impactos continuos.
4. Nuevo componente sostenido: saliencia inicial regional que se adapta; excitación
   y corriente sostenida permanecen mientras sigue el componente.
5. Silencio prolongado + audio: movimiento ambiental durante silencio, recuperación
   de ataques sin ruido artificialmente amplificado ni reinicio de escena.

Registrar salida de audio, volumen digital, calidad, resolución, FPS y observaciones.
GTX 1080 Ti a 144 Hz, sesiones prolongadas y todos los dispositivos requieren pruebas
específicas: el build y los tests no certifican por sí solos calidad perceptual o FPS.
