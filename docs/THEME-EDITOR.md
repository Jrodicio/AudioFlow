# Temas, pigmentos y editor

Implementación del 15 de octubre de 2026. Referencia visual:
`atmosphere-cold-fire-plumes-v1`.

Desde Ajustes → Tema global → Editar colores se puede seleccionar un oficial
o personal, duplicar, crear, renombrar, editar, agregar y quitar colores,
guardar, guardar como nuevo, descartar y eliminar con confirmación. El panel
lateral conserva visible el universo. Guardar y las acciones del borrador
permanecen al pie; las muestras se desplazan. Rojo y amarillo tienen accesos
directos. Las categorías son pigmento, fondo, iluminación/dispersión y profundidad.

## Modelo y almacenamiento

Se usa el mismo `ThemePreset`, `ThemeColor` y `UserThemeLibrary` de la fase
anterior. No hay otro formato paralelo de temas. `characteristics.presence`
es un número entre 0 y 4, con valor implícito 1. Cero conserva el color en el
documento pero lo desactiva como pigmento.

`library.ts` implementa las operaciones y validaciones fuera de React. Una
duplicación crea `user:<UUID>` y fechas ISO UTC; editar conserva ID y fecha de
creación, y guardar actualiza la fecha de modificación. `derivedFrom` registra
la procedencia histórica y puede apuntar a una copia que luego fue eliminada.
Las copias contienen datos independientes del original.

Claves locales:

| Clave | Contenido |
| --- | --- |
| `audioflow.themes.v1` | `UserThemeLibrary`, exclusivamente personales |
| `audioflow.theme-selection.v1` | ID seleccionado, después de guardar o seleccionar |
| `audioflow.preferences.v1` | Preferencias existentes, con su parser y estructura originales |

Se validan esquema, origen, UUID, nombres, fechas reales y orden temporal,
duplicados, RGB de tres componentes finitos en [0,1], codificación, roles,
atributos, procedencia y referencias de materiales. Se recuperan los hermanos
válidos de una biblioteca parcialmente corrupta. Una selección perdida,
corrupta o no renderizable vuelve a Cold & Fire. Los demás ajustes se leen por
su mecanismo previo. Una escritura fallida conserva el borrador y muestra el
error; no se confirma un guardado ni una eliminación que no se escribió.

El registro oficial continúa congelado recursivamente. Los servicios rechazan
guardar, renombrar mediante guardado, sobrescribir o eliminar oficiales y
rechazan IDs personales que invadan el registro. Ningún JSON local hidrata ni
reemplaza un oficial. El inventario original de `coldAndFire.ts` permanece
intacto, incluido su descriptor histórico `metadata-only`; la conexión efectiva
la realiza el adaptador GPU. Las copias y ediciones declaran bindings
`connected` para los tres materiales utilizando el contrato existente.

## Adaptación GPU

`ThemeGPU` compila cada snapshot a uniforms y una textura de paleta. Los
adaptadores se aplican una vez al construir cada material; seleccionar temas o
arrastrar el selector sólo cambia sus datos. No hay recompilación, readback,
recreación de render targets ni reinicio físico por cambios cromáticos.

Atmosphere mantiene sin cambios numéricos los campos aprobados: velocidad y
densidad reactiva, coordenadas materiales y densidad total, RGB frío y
concentración cálida. Las fórmulas de fuerzas, nacimiento de plumas, humedad,
extinción, iluminación, acústica y transporte de esos campos son las originales.

Los ocho tonos fríos originales se interpretan mediante deltas suaves en el
albedo de cada muestra volumétrica, antes de dispersión, iluminación e
integración. Su RGB transportado permanece como referencia espacial estable.
El cobre sigue ligado a su concentración cálida. Fondo, dispersión y profundidad
tienen sus propios uniforms. Con colores y presencias originales se evita el
mapeo cromático adicional y se conserva la ruta aprobada.

Los pigmentos agregados usan un **cuarto attachment RGBA16F de costo fijo** en
los tres targets de transporte. RG guarda un índice circular material,
codificado como coseno y seno. Se siembra en el volumen y se transporta con los
mismos puntos de partida, corrección MacCormack y limitador de los otros campos.
Las plumas aportan su índice según su semilla de nacimiento y su dosis real.
La reserva original conserva también este índice en canales antes libres;
una alimentación lenta evita su desaparición numérica. Esto no crea densidad.

La fase decodificada consulta una distribución de colores en textura. Cada
pigmento añadido tiene un intervalo propio, ponderado por presencia, con bordes
suaves e intercalado con intervalos del material base, para distribuir también
los colores de baja presencia alrededor del dominio circular. En las regiones
restantes se conserva el material original. La opacidad
volumétrica y la iluminación siguen moldeando todos los colores. Una protección
de amplitud evita amplificar fases indefinidas cuando se mezclan índices
opuestos. El índice circular evita la pérdida de amarillo observada al probar
un índice escalar que convergía hacia su media.

Liquid consulta la paleta dentro de su función de pigmento, utilizando sus
concentraciones líquidas persistentes; Texture la consulta desde su campo de
estratos y relieve. Ambos conservan sus seis colores históricos como base y
reciben deltas por rol. Por eso Cold & Fire conserva sus apariencias anteriores,
aunque sus constantes históricas difieran de Atmosphere. La física de ambos
estilos permanece intacta. Las presencias originales también se interpretan
dentro del material y las adicionales distribuyen los intervalos de paleta.

## Codificación y transiciones

`shader-native` conserva los números exactos del GLSL. La muestra HEX es
nominal; abrir el editor o duplicar no cuantiza esos números. Una edición HEX
sí expresa explícitamente nuevos componentes de 8 bits.

La ruta histórica es un dominio numérico artístico, sin transferencia sRGB
global y con su curva final `pow(...,.88)`. Las entradas `srgb` se usan en ese
dominio; las entradas explícitas `linear-srgb` se codifican mediante la función
de transferencia sRGB antes de ingresarlas. El selector muestra HEX sRGB de
esas entradas y decodifica de vuelta al guardar sus componentes lineales.
No se decodifican como lineales las constantes nativas aprobadas.

Los uniforms, presencias y texels de paleta se aproximan exponencialmente al
destino con constante de 0,42 segundos. Los residuos menores que 1e-6 se fijan
al destino. El historial temporal del volumen se conserva. Esto recolorea
gradualmente también la materia existente, respetando su identidad espacial;
no se espera a reemplazarla por fuentes nuevas. Descartar, seleccionar otro tema
o volver al oficial establece otro destino sobre el mismo estado físico.

## Límites y memoria

El modelo conserva listas variables sin un máximo de colores almacenados. La
ruta actual admite **128 pigmentos activos**; los demás deben tener presencia
0. El límite se comprueba al editar, seleccionar y compilar, y se comunica en el
editor. No se trunca la lista silenciosamente.

La textura tiene hasta 8192 texels RGBA32F y se adapta a `MAX_TEXTURE_SIZE` del
equipo. Se reservan al menos ocho texels para cada pigmento adicional activo,
incluso con presencia muy pequeña. Esa reserva introduce una participación
mínima y la ponderación no representa porcentajes exactos de píxeles visibles.
El costo de transporte y la cantidad de samplers no crecen con cada color.

Para la grilla 96×72×48:

| Recurso adicional | Memoria |
| --- | ---: |
| Tres attachments RGBA16F | 7.59375 MiB |
| Dos paletas de 8192 RGBA32F, superficie y volumen | 0.25 MiB |
| Total persistente máximo adicional | **7.84375 MiB** |

La reserva de pigmentos utiliza canales ya asignados. Las imágenes y el
historial no cambian de tamaño por un tema. Los contadores de Three y la
liberación de texturas se verifican en los bancos; el cálculo anterior es la
capacidad de los recursos GPU solicitados, no una lectura de VRAM del driver.

Esta es una representación compartida de índices de pigmento, con mezcla
artística, y no un campo de concentración conservativo por cada color. Evita
multiplicar simulaciones por pigmento. Al mezclar fases puede aparecer un
intervalo intermedio de la paleta; no modela química ni absorción espectral.
La distribución visible depende del material, la luz y el flujo. En los roles
de fondo, dispersión y profundidad, los colores adicionales del mismo rol se
combinan por promedio dentro del adaptador de ese rol.

## Validación reproducible

Ejecutar desde la raíz:

```text
npm.cmd run typecheck
npm.cmd test
npm.cmd run test:themes:ui
npm.cmd run test:themes:gpu
npm.cmd run test:atmosphere
npm.cmd run test:atmosphere:plumes
npm.cmd run build
npm.cmd run dist:win
npm.cmd run test:package
```

Los bancos Electron necesitan acceso al controlador gráfico de Windows.
El perfil de cada banco es independiente del perfil real de AudioFlow.

`themes-gpu.cjs` obtiene los shaders directamente del tag Git y los ejecuta
con los tres attachments originales como control. Compara bytes del render y
de los tres campos físicos con la implementación nueva, a igual semilla,
grilla, reloj, resolución, jitter, acústica y presupuesto de raymarch. Incluye
la inicialización, duplicación, restauración en movimiento y nacimientos de
plumas graves, medias y agudas. No compara contra una captura arbitraria ni
deduce equivalencia a partir de los botones del editor.

Los escenarios rojo, amarillo, ambos y edición de un pigmento miden cambios
en píxeles renderizados. Se exige coexistencia con azul/turquesa, continuidad
física durante transiciones, ausencia de valores no finitos y permanencia de
rojo/amarillo durante tres minutos adicionales simulados. Liquid y Texture
comparan su salida histórica y la personalizada con el mismo estado líquido.

Evidencia generada:

- `artifacts/themes/result.json`, PNG A–G y `comparison.html`: equivalencia,
  campos, transiciones, presencia, memoria y tiempos GPU.
- `artifacts/themes-ui/result.json` y capturas: flujo completo de CRUD,
  recuperación, preferencias previas y error de cuota simulado.
- `artifacts/atmosphere-volume/`: banco general y estabilidad de cinco minutos.
- `artifacts/atmosphere-plumes/`: respuesta temporal causal y definición.
- `artifacts/package-result.json`: aplicación de producción empaquetada.

La equivalencia de píxeles informada se limita a las condiciones reproducidas
en la GTX 1080 Ti con ANGLE/D3D11; no garantiza identidad binaria entre drivers.
El objetivo de 60 FPS a 1080p se evalúa con el presupuesto Equilibrado existente
(hasta 1.150.000 muestras de imagen antes del escalado al monitor). No implica
raymarch nativo de 2.073.600 píxeles ni una promesa de 144 FPS.

Medición del banco final de temas en Windows / GTX 1080 Ti / ANGLE D3D11,
salida 1920×1080, sin límite de FPS, cinco segundos por variante:

| Variante | FPS del banco | Mediana GPU | P95 GPU |
| --- | ---: | ---: | ---: |
| Cold & Fire | 125.7 | 7.71 ms | 8.86 ms |
| Rojo + amarillo, presencia predeterminada 1 | 104.1 | 9.27 ms | 11.04 ms |
| Pigmento original editado | 112.4 | 8.58 ms | 9.65 ms |
| Edición + rojo + amarillo | 100.3 | 9.64 ms | 11.02 ms |

En la comparación congelada, la variante con ambos colores contiene 3.09% de
píxeles clasificados como rojos y 2.84% como amarillos; conserva 38.21% de azules
y 36.97% de turquesas. Estas categorías se solapan y son umbrales de inspección,
no un balance de masas. Las texturas permanecen constantes durante los tres
minutos adicionales y se liberan todas al terminar.

Máxima diferencia de bytes: **0** frente al tag para el oficial, su duplicado,
la restauración con movimiento, tres momentos del nacimiento y estela de plumas
y la reinicialización mediante la ruta de restauración; también **0** para las rutas oficiales de Liquid y
Texture frente a sus shaders históricos. La validación automatizada incluye
41 pruebas de Node y 17 comprobaciones del editor en Electron.

El banco general final sostuvo 60.0 FPS a 1080p y completó cinco minutos
simulados sin crecimiento de texturas. El banco causal de plumas pasó sus nueve
escenarios. El ejecutable empaquetado confirmó generación de UUID en el
protocolo seguro `audioflow://app`, guardado de una copia de 15 colores,
recuperación de su selección al recargar, ausencia de errores de render y
Atmosphere estable a 60 FPS. Se generaron portable e instalador NSIS en
`release/AudioFlow-1.0.0-Portable.exe` y `release/AudioFlow-1.0.0-Setup.exe`.

## Archivos

Producción: `src/App.tsx`, `src/styles.css`, `src/themes/model.ts`,
`src/themes/ThemeEditor.tsx`, `src/themes/library.ts`, `src/themes/colors.ts`,
`src/themes/gpu.ts`, `src/visual/Universe.ts`, `src/visual/AtmosphereVolume.ts`.

Validación: `tests/theme-library.test.ts`, `tests/theme-gpu.ts`,
`tests/theme-gpu.html`, `scripts/themes-ui.cjs`, `scripts/themes-gpu.cjs`,
`scripts/themes-report.cjs`, `scripts/test-atmosphere.mjs`,
`scripts/package-smoke.mjs`, `package.json`.
Los shaders originales y el registro oficial permanecen intactos.
