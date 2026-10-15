# Atmosphere — cuerpos de humo y estelas

Iteración de morfología sobre `ca5ca0a` (Prompt 7), 15 de octubre de 2026.
El cambio de producción está en `src/visual/atmosphereMorphology.ts` y en su
composición desde `AtmosphereVolume.ts`. No agrega controles de interfaz.

## Qué producía el aspecto fusionado

La función anterior calculaba `max(0, matter.a - erosion)`. Su erosión podía
ser negativa al aumentar el ruido de detalle. Por tanto, incluso un voxel con
densidad cero podía aportar humo visible. El diagnóstico GPU con todo el
campo de materia en cero midió opacidad media 0,00549 en la ruta anterior y
**exactamente cero** en la nueva.

La densidad inicial procedía de un campo de ruido extendido por gran parte
del volumen. Al integrar muchas capas, las regiones se superponían hasta
formar una proyección casi continua. La reposición ambiental consultaba un
reservorio fijo en coordenadas del mundo; la materia que se desplazaba recibía
otra vez densidad de la forma estacionaria. Esto favorecía las mezclas y
arrastres en lugar de conservar una formación reconocible. El detalle fino
modificaba esa masa amplia, pero no creaba una jerarquía espacial clara.

## Cambios de materia

La semilla contiene seis recorridos de humo finitos, curvados e irregulares,
repartidos entre fondo, plano medio y primer plano. Los cuerpos grandes tienen
densidad interna variable y espacios entre billows. Los recorridos cercanos
se abren en tres hebras curvas que se desprenden entre sí. Sus perfiles son
suaves, con extremos y bordes progresivos; no son partículas ni sprites.

Esta distribución se escribe como densidad 3D real en los campos existentes.
La advección MacCormack, el paso de 60 Hz, las velocidades persistentes y el
limitador siguen transportándola. La reposición consulta ahora el reservorio
en `p + desplazamientoMaterial`, de modo que acompaña al material deformado.
El suministro lento de RGB frío, concentración cálida e índice de pigmentos
personalizados consulta el mismo marco material. La prueba de estrés encontró
que mantener su reserva fija en el mundo reducía excesivamente el turquesa
mientras las formaciones viajaban; esta alineación preserva su identidad sin
cambiar los colores ni los coeficientes de mezcla.
La relajación de coordenadas existente evita acumular pliegues numéricos
indefinidamente. No se vuelve a sembrar ni se reinicia el gas en cada frame.

En el raymarch, la densidad renderizada requiere soporte físico positivo y
permanece dentro del volumen. Los cuerpos densos conservan masa y sombras;
sus bordes pasan a pliegues anisótropos y filamentos en coordenadas materiales.
La orientación es oblicua y el detalle cercano es más fino que el lejano.
Se conservan los filtros LOD y el presupuesto de muestreo para evitar convertir
el detalle en partículas duras o ruido de pantalla. No se aplica sharpening.

La composición continúa siendo absorción volumétrica con sombras internas,
transmisión, luz y profundidad. El espacio oscuro es consecuencia de la
ausencia de densidad, no de una máscara negra aplicada a la imagen.

## Qué se conserva

- Registro, RGB exactos, codificaciones y protección de Cold & Fire.
- Editor, presets personales, persistencia y preferencias existentes.
- Adaptador GPU de temas, pigmentos adicionales y transiciones de paleta.
- Detector de audio, bandas, sensibilidad, intensidad y suavidad.
- Nacimiento, dosis, presupuesto, perfiles, fuerzas y disipación de plumas.
- Campos, formatos GPU, resolución del gas, calidad y pasadas existentes.
- Liquid y Texture, sus shaders y sus modelos de movimiento.

Los adaptadores de morfología se componen con los bindings de temas existentes.
Las constantes cromáticas originales no se editan y el color sigue siendo
material iluminado dentro del volumen. La nueva distribución de densidad sí
cambia qué pigmentos quedan expuestos, su oclusión y la luminosidad de los
píxeles: no se afirma identidad de imagen con la morfología anterior.

El banco de temas usa las fórmulas cromáticas del tag sobre campos y formas
iguales en ambos controles para aislar la compatibilidad del binding. El banco
de morfología compara por separado las dos versiones completas de las formas,
incluyendo sus semillas, reservorios y funciones de densidad.

## Comparación reproducible

`npm.cmd run test:atmosphere:morphology` genera
`artifacts/atmosphere-morphology/comparison.html`, PNG y `result.json`.

Ambas versiones reciben el mismo reloj, PCM causal, grilla 96×72×48, paleta,
cámara, resolución y 72 pasos de raymarch. Las capturas promedian ocho fases
de jitter sobre un campo congelado; no se favorece una fase ni se retoca la
captura. Las métricas usan una pasada diagnóstica de opacidad sin depender de
la luminosidad o del color.

Medidas con Cold & Fire sin audio, salida 960×540:

| Medida | Anterior, 12 s | Nueva, 12 s |
| --- | ---: | ---: |
| Espacio con opacidad menor de 0,05 | 10,19% | **61,52%** |
| Mayor componente conectado, fracción del encuadre | 81,51% | **11,70%** |
| Píxeles finos dentro de la materia ocupada | 4,09% | **17,80%** |
| Cobertura con opacidad mayor de 0,20 | 82,82% | **23,64%** |

Se descartan componentes menores de 40 píxeles. «Fino» significa distancia
de hasta tres píxeles respecto del vacío dentro de la máscara ocupada.
Son descriptores de la proyección: no equivalen a contar entidades físicas
ni reemplazan la inspección de las imágenes. La galería incluye inicialización,
flujo a 4/12 segundos, rojo y amarillo, audio, tres capas aisladas y evolución
de tres minutos adicionales.

El banco exige aumento de vacío, reducción del cuerpo conectado dominante,
mayor proporción de estructuras finas y cobertura suficiente para rechazar
una solución que simplemente borre todo. También exige pigmentos rojos y
amarillos realmente visibles, igualdad en la cantidad de eventos consumidos,
contenido en todas las capas, campos finitos, velocidades acotadas y memoria
constante. Después de tres minutos, la nueva escena conserva aproximadamente
62,6% de vacío, múltiples componentes y cuerpos densos transportados.

## Rendimiento y límites

GTX 1080 Ti / Windows / ANGLE D3D11, salida 1920×1080, presupuesto Equilibrado
existente de 1.150.000 píxeles internos, medición tras la evolución prolongada:

| Ruta | GPU mediana | GPU P95 | FPS del banco sin límite |
| --- | ---: | ---: | ---: |
| Anterior | 7,83 ms | 9,63 ms | 123,5 |
| Nueva | **6,07 ms** | **6,58 ms** | 144,0 |

El menor relleno reduce el trabajo de sombreado del raymarch. Los cambios no
añaden texturas, render targets, attachments ni pasadas en producción: **0 bytes
adicionales en texturas y render targets** respecto de Prompt 7. No se mide la
memoria interna del driver ni el tamaño binario de los programas GLSL. La semilla
inicial es más compleja, pero se calcula al inicializar el gas y su reservorio;
no en cada paso de transporte.

La grilla continúa siendo finita. Las hebras más finas se describen mediante
detalle material advectado y no mediante una simulación independiente por
filamento. Con mucho tiempo o excitación, los cuerpos se estiran, se mezclan
y cambian su silueta: conservan continuidad, no IDs rígidos. La composición
inicial sigue siendo una receta fija de recorridos; no hay slider de cantidad,
control de población ni un motor físico nuevo. El LOD y la acumulación temporal
existentes todavía pueden suavizar los detalles más pequeños.

El banco general con cinco minutos alternados de excitación intensa y silencio
pasó a 60 FPS con memoria constante. El suministro alineado mantuvo turquesa,
azul y cobre visibles al finalizar; se conservó el requisito cromático anterior
de ese banco, además de sus pruebas de replay, inercia y liberación de recursos.

## Bancos y criterios históricos

El banco general anterior exigía densidad media superior a 0,08, contrario al
objetivo nuevo de vacío. Su guardia ahora exige media mínima 0,008, varianza
0,001, pico de densidad mayor de 0,2 y más del 2% de voxels por encima de 0,1.
Los requisitos visuales de separación se prueban adicionalmente en el banco
morfológico. Se conserva la cota de velocidad, ausencia de NaN, pigmentos,
memoria, replay determinista y estabilidad prolongada.

La estela de un transitorio se exige respecto de su bloom, en lugar de exigir
crecimiento monótono frente a la inyección inicial: en una escena vacía la
pluma ya es visible al nacer y luego debe disiparse. El banco causal conserva
todos sus límites de latencia, persistencia, intensidad, inyección única y
disipación. La comparación de definición usa ahora el renderer de Prompt 7,
con igual presupuesto. Se mide su luminancia, pero no se exige igual media de
imagen ni mayor gradiente global; cambiar cobertura es el objetivo y aumentar
nitidez no lo es. Se mantiene una cota explícita de píxeles saturados.

Comandos relevantes:

```text
npm.cmd run typecheck
npm.cmd test
npm.cmd run test:atmosphere:morphology
npm.cmd run test:themes:gpu
npm.cmd run test:atmosphere
npm.cmd run test:atmosphere:plumes
npm.cmd run test:themes:ui
npm.cmd run build
```

Resultado final: TypeScript y build de producción correctos, 41 pruebas de Node,
17 comprobaciones del editor, bancos GPU de morfología y temas, estabilidad
general de cinco minutos y las nueve señales del banco de plumas aprobados.
Los eventos del banco causal resultaron visibles entre 17 y 67 ms; esto excluye
la latencia de captura loopback y del monitor. El paquete de producción guardó
y recuperó una copia personal de 15 colores y mostró Atmosphere a 60 FPS.
Portable e instalador actualizados en `release/AudioFlow-1.0.0-Portable.exe` y
`release/AudioFlow-1.0.0-Setup.exe`.
