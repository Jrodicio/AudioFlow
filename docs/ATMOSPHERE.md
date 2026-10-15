# Atmosphere: fuerzas acústicas y pigmento volumétrico

El volumen existente se conserva: 96 × 72 × 48 celdas, atlas 8 × 6,
velocidad persistente, advección a paso fijo 1/60 s, corrección limitada
MacCormack, detalle 3D y raymarching con absorción y sombras internas.

## Diagnóstico comprobado

El problema no era un uniform desconectado. En la señal suave reproducible
(RMS PCM 0,00886), las bandas visuales originales llegaban aproximadamente a
0,544 / 0,710 / 0,452 en graves, medios y brillo. Sin embargo, la aceleración
acústica RMS resultante era 0,000487 unidades de volumen/s², frente a 0,00601
ambientales: apenas 8,1 %. La integración por dt era dimensionalmente correcta.
El producto vectorial sin normalizar por radio y la máscara espacial reducían
mucho la magnitud efectiva. En un paso de 1/60 s sólo añadía 0,00000812 de
velocidad RMS, sobre una velocidad ambiental RMS cercana a 0,0166.

El límite de 0,085 no era el cuello de botella original: el banco previo midió
máximos cercanos a 0,032. La amortiguación de 0,26/s conserva varios segundos
de inercia y se mantiene. La saliencia ya era independiente por banda y el
extractor entregaba características válidas; no se cambió el análisis.

Había además una cadena de suavizado: envolventes del extractor, resortes
visuales de MaterialResponse, otra envolvente sostenida y acumulación de
imagen con constante de 84 ms. Las perturbaciones débiles y localizadas podían
quedar ocultas por las capas delanteras, el umbral de densidad y ese historial.
El banco anterior sólo exigía una diferencia de velocidad de 0,00001.

El color se reconstruía con una textura procedural en coordenadas materiales,
mezclando varias veces hacia tonos pálidos y atenuándolo en profundidad. No
existía un campo independiente de pigmento transportado.

## Interacción acústica

AtmosphereAcoustics consume las características existentes antes del resorte
visual compartido. Añade sólo 25 ms de ataque; utiliza directamente sostenida
y saliencia del extractor. Conserva los eventos superpuestos de MaterialResponse.
Una ganancia entre 0,38 y 1 conserva parte de la dinámica absoluta del RMS,
sin eliminar la normalización relativa que permite responder al audio tranquilo.
La demo utiliza una ganancia explícita y sigue identificada como sintética.
Liquid/Texture conservan sus propias entradas y su shader original.

Las fuerzas son aceleraciones, no desplazamientos ni cambios de reloj:

- Subgraves/graves: radio 0,38, presión direccional y rotación normalizada por
  radio, con un campo curl de escala grande. Desplazan masas por varios segundos.
- Medios: radio 0,25, giro y curl intermedio; modifican dirección y estiran cuerpos.
- Agudos: radio 0,18, curl de mayor frecuencia espacial, reforzado en densidades
  de borde. La escala sigue resolviéndose en el grid, sin ruido subvoxel.
- Transitorios: frente de presión grueso y deformado, con radio inicial finito,
  propagación radial y estela tangencial. La fuerza cae exponencialmente y deja
  velocidad persistente. El centro de profundidad depende también del evento.

Los centros de banda derivan lentamente con fases diferentes; el desplazamiento
material deforma sus máscaras. No hay selección de una única región ganadora.
Los doce eventos pueden superponerse en posiciones independientes. El sonido
no cambia exposición, cámara, escala global, densidad directamente ni velocidad
del tiempo. El movimiento ambiental continúa sin señal.

En los escenarios sostenidos medidos a los cinco segundos, la aceleración
acústica/ambiental RMS pasa a aproximadamente 0,67 para audio suave, 1,08 para
graves, 0,81 para medios y 0,66 para agudos. Las cifras, unidades, máximos,
gradientes espaciales y uniforms completos quedan en result.json. Son señales
sintéticas; no son mediciones de contenido loopback del usuario.

## Pigmentos y continuidad

Los tres targets MRT pasan de dos a tres adjuntos RGBA16F:

1. Velocidad XYZ y reserva de humedad W, como antes.
2. Desplazamiento de coordenadas materiales RGB y densidad A, como antes.
3. Pigmento frío RGB y concentración cálida A, nuevos y persistentes.

El pigmento recorre las mismas trayectorias de advección que la materia. Tiene
su propia corrección MacCormack y límites del entorno para evitar colores fuera
de rango. La semilla cromática usa ruido independiente de la densidad: azul
profundo, cobalto, teal/turquesa, cian, bruma clara y cobre/dorado. No usa UV de
pantalla. La concentración cálida ocupa el canal libre del adjunto nuevo: evita
que promediar RGB cobre y cian termine neutralizando por completo los acentos.

Una reserva cromática estática se genera una sola vez en otro atlas RGBA16F.
La materia recién condensada incorpora pigmento de esa reserva; un aporte
continuo con constante de 40 s evita homogeneización numérica irreversible.
No hay reinicios de color ni cambios ligados al volumen del audio. El pigmento
existente sigue deformándose y viajando, aunque el modelo incluye reposición y
no conserva exactamente la masa de cada tinte.

Costo adicional de campos frente a la versión anterior: cuatro texturas
RGBA16F de 331.776 texeles, **10,125 MiB** (tres adjuntos de transporte y una
reserva). La reserva añade una pasada al inicializar y un muestreo durante
transporte, sin nuevas pasadas por frame. El transporte del pigmento aumenta
ancho de banda y el render añade una muestra de atlas por paso del rayo.

## Render, rendimiento y ciclo de vida

Se mantienen rayos a través del mismo volumen, absorción acumulativa,
oclusiones, dos muestras de sombra y detalle en coordenadas materiales.
Se reduce la erosión base de 0,28 a 0,24 para conservar brumas menos densas.
La iluminación ambiental conserva mejor el pigmento en las sombras y se reduce
la mezcla que antes lo teñía uniformemente en profundidad.

La acumulación temporal usa ahora 45 ms en silencio y hasta 25 ms con
excitación. Sólo cambia el peso del historial. El banco mide por separado la
respuesta con ese filtro y las diferencias entre cuadros.

Presupuestos de raymarching (la salida final se amplía cuando corresponde):

| Calidad | Píxeles máximos | Pasos |
|---|---:|---:|
| Eco | 320.000 | 32 |
| Equilibrada | 980.000 | 64 |
| Alta | 1.400.000 | 80 |

Se conserva el ajuste adaptativo lento existente. El grid no cambia con la
resolución. El mayor presupuesto se eligió después de medir margen GPU;
los tiempos finales figuran en ATMOSPHERE-VALIDATION.md.

Universe deja de actualizar Liquid sólo cuando el camino volumétrico puro lo
oculta totalmente (peso Atmosphere >0,995). Conserva ambos buffers y reanuda
pasos ordinarios en cuanto empieza una transición; no reinicia ni intenta
simular retrospectivamente el intervalo oculto. La ruta fallback conserva el
campo líquido activo. La pérdida real de contexto sí regenera las semillas.

F3 conserva el diagnóstico existente y agrega las bandas que recibe Atmosphere,
ganancia dinámica, cantidad de eventos recientes y estado de pausa de Liquid.
Magnitudes de fuerzas, energía cinética, saturación y readbacks de pigmento se
limitan al banco GPU. No hay lecturas GPU→CPU durante el renderizado normal.

## Reproducción y límites

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run test:atmosphere
npm.cmd run dist:win
npm.cmd run test:package
```

El banco usa paso fijo, semillas idénticas y un control en silencio al mismo
instante. Guarda capturas con estímulo, control y diferencia absoluta ×4,
además de comparison.html para inspección local. Desactiva HMR para impedir
que una edición invalide inadvertidamente el estado reproducible.

La simulación no resuelve proyección de presión ni conserva exactamente masa;
las fuerzas de presión son una aproximación artística. El grid y los pasos de
rayo limitan los filamentos. Una perturbación detrás de materia opaca puede
quedar parcialmente ocluida, como corresponde a un volumen. Las métricas de
imagen rechazan cambios despreciables, pero no certifican una valoración
artística ni sustituyen observar la relación audiovisual con contenido real.
