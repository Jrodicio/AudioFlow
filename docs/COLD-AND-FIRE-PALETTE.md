# Cold & Fire — referencia de color y arquitectura, fase 1

Fecha local: 15 de octubre de 2026. Base aprobada: tag
`atmosphere-cold-fire-plumes-v1`, commit
`238ab193be4e2d52f3cca26e7f7cc7cb35925889`.

Cold & Fire describe exactamente el Atmosphere volumétrico de esa base. Esta
fase agrega un inventario inmutable, un contrato de temas compartido y una
indicación de lectura en ajustes de Atmosphere. **Los shaders y todos los
archivos de `src/visual`, `src/audio` y `src/settings.ts` permanecen intactos.**
No se conecta la paleta al GPU, ni se cambia Liquid, Texture, simulación,
captura, calidad o preferencias. Tampoco hay selector, editor o CRUD de temas.

## 1. Espacio de color y significado del HEX

Los valores siguientes son los números originales del GLSL, entre 0 y 1.
La ruta actual hace operaciones aritméticas con esos valores en texturas
sin etiqueta de color (`NoColorSpace` por defecto): no decodifica entradas
sRGB, ni convierte explícitamente una salida lineal a sRGB. Los
`ShaderMaterial` propios no incluyen `colorspace_fragment` ni invocan
`linearToOutputTexel`. Three incluye la definición de esa función en su
prefijo, pero definirla no significa ejecutarla. `Universe.ts` tampoco
configura una conversión de color específica.

Al final del raymarch se aplica `pow(max(color, vec3(0)), vec3(.88))`, dither,
historial y clamp; después `withVolumetricAtmosphere` copia la textura al
framebuffer en Atmosphere puro (`uStyle.x > .995`). Esa curva artística
**no es la transferencia estándar de sRGB**. No hay evidencia para etiquetar
los pigmentos actuales como valores calibrados de radiancia lineal.
El modelo los identifica como `shader-native` para conservar esta distinción.

Por ello, la columna **HEX nominal** cuantiza directamente cada componente:
`round(clamp(c, 0, 1) * 255)`. Es una muestra sRGB orientativa de la constante,
no una predicción del píxel iluminado, ni una fuente para reconstruir el RGB.
La columna **HEX si RGB lineal** permite consultar la conversión correcta si
en una fase futura se interpreta una entrada como `linear-srgb`:

```text
sRGB(c) = 12.92*c                         si c <= 0.0031308
sRGB(c) = 1.055*c^(1/2.4) - 0.055          en otro caso
byte = round(clamp(sRGB(c), 0, 1) * 255)
```

Esa segunda columna no describe una conversión que hoy ejecute AudioFlow.
Aplicarla a los GLSL existentes cambiaría la estética aprobada. Los valores
exactos de origen se conservan como decimales; el almacenamiento GPU FP16
existente continúa teniendo su cuantización normal, sin modificaciones.

## 2. Inventario del Atmosphere volumétrico aprobado

Todas las ubicaciones de esta tabla pertenecen a
[`src/visual/atmosphereShaders.ts`](../src/visual/atmosphereShaders.ts).
Las líneas se refieren al checkpoint, que esta fase no modifica.

| Nombre / ID | RGB original GLSL | HEX nominal | HEX si RGB lineal | Función | Definición |
|---|---|---|---|---|---|
| Azul profundo / `deep-blue` | `vec3(.025,.065,.40)` | `#061166` | `#2C48AA` | Pigmento frío inicial de zonas bajas del campo `body` | L64, `initialPigment.dye` |
| Azul eléctrico / `electric-blue` | `vec3(.045,.24,.82)` | `#0B3DD1` | `#3C86EA` | Segundo extremo azul del pigmento inicial | L64, `initialPigment.dye` |
| Turquesa / `turquoise` | `vec3(.015,.67,.62)` | `#04AB9E` | `#21D6CE` | Pigmento frío intermedio | L65, `initialPigment.dye` |
| Cian hielo / `ice-cyan` | `vec3(.30,.86,.92)` | `#4DDBEB` | `#95EFF6` | Pigmento claro en valores altos de `body` | L66, `initialPigment.dye` |
| Perla fría / `pearl` | `vec3(.82,.91,.94)` | `#D1E8F0` | `#EAF5F8` | Mezcla secundaria pálida, no luz blanca agregada | L68, `initialPigment.dye` |
| Pluma azul grave / `plume-bass` | `vec3(.025,.095,.38)` | `#061861` | `#2C57A6` | RGB inyectado por bandas 0–1 | L256, `transportShader.cool` |
| Pluma turquesa media / `plume-mid` | `vec3(.025,.49,.60)` | `#067D99` | `#2CBACB` | RGB inyectado por bandas 2–4 | L256, `transportShader.cool` |
| Pluma cian aguda / `plume-high` | `vec3(.23,.79,.87)` | `#3BC9DE` | `#84E6F0` | RGB inyectado por bandas 5–6 | L256, `transportShader.cool` |
| Cobre naranja / `copper` | `vec3(.88,.43,.12)` | `#E06E1F` | `#F1AF61` | Extremo cálido de albedo, controlado por concentración A | L354, `volumeRenderShader.albedo` |
| Fondo azul inferior / `background-low` | `vec3(.006,.020,.052)` | `#02050D` | `#122740` | Extremo inferior del gradiente de fondo | L330, `volumeRenderShader.background` |
| Fondo azul superior / `background-high` | `vec3(.014,.052,.087)` | `#040D16` | `#1F4053` | Extremo superior del gradiente de fondo | L330, `volumeRenderShader.background` |
| Dispersión azul verdosa / `edge-scattering` | `vec3(.15,.29,.32)` | `#264A52` | `#6C9399` | Aporte aditivo a bordes iluminados, no tinte transportado | L357, `volumeRenderShader.scatter` |
| Azul de profundidad / `depth-blue` | `vec3(.045,.12,.21)` | `#0B1F36` | `#3C617E` | Mezcla atmosférica según profundidad del rayo | L359, `volumeRenderShader.scatter` |

Hay nueve colores fuente de pigmento (cinco iniciales, tres reactivos y un
cobre), dos fondos y dos aportes de sombreado. Los nueve no representan nueve
especies simuladas independientes: cinco extremos iniciales y tres inyectados
se combinan en un único RGB frío; el cobre usa una concentración escalar aparte.

`vec3(0)` en L338 (`color`) y L368 (`max`) equivale a RGB `(0,0,0)`, HEX
`#000000`. Es el acumulador sin radiancia y el límite inferior, **no un pigmento
negro**. Las regiones casi negras resultan de fondos oscuros, sombra, transmisión
y viñeta. No existe una constante adicional de tinta negra.

## 3. Colores del shader anterior, fallback y transiciones

[`src/visual/shaders.ts`](../src/visual/shaders.ts) contiene otra paleta. Sigue
siendo la de Liquid/Texture y del fallback si no hay
`EXT_color_buffer_float`. Durante transiciones también puede contribuir al
resultado. **No es la paleta volumétrica oficial Cold & Fire** y no se la
conecta ni se la reemplaza en esta fase.

| Nombre | RGB original GLSL | HEX nominal | HEX si RGB lineal | Función y definición en `shaders.ts` |
|---|---|---|---|---|
| Abismo (`abyss`) | `vec3(.009,.033,.085)` | `#020816` | `#183352` | L76, extremo oscuro de `pigment` |
| Cobalto (`cobalt`) | `vec3(.015,.14,.29)` | `#04244A` | `#216993` | L77, pigmento azul |
| Verde azulado (`teal`) | `vec3(.025,.43,.43)` | `#066E6E` | `#2CAFAF` | L78, pigmento intermedio |
| Espuma (`foam`) | `vec3(.43,.78,.72)` | `#6EC7B8` | `#AFE5DD` | L79, pigmento verde claro |
| Ocre (`ochre`) | `vec3(.78,.52,.19)` | `#C78530` | `#E5BF79` | L80, pigmento cálido, mezcla `gold*.72` |
| Perla amarillenta (`pearl`) | `vec3(.83,.86,.69)` | `#D4DBB0` | `#EBEFD8` | L81, aclarado de `pigment` |
| Veta mineral verde | `vec3(.12,.23,.18)` | `#1F3B2E` | `#618476` | L196, aporte de veta en Texture (`rockStyle`) |
| Reflejo verde perla | `vec3(.56,.76,.67)` | `#8FC2AB` | `#C5E2D6` | L217, reflexión especular en Liquid/Texture |
| Bruma verde azulada | `vec3(.25,.59,.58)` | `#409694` | `#89CAC8` | L220, bruma del Atmosphere anterior (`air`) |

Otros vectores cromáticos del shader anterior son **factores**, no muestras
RGB ni pigmentos; asignarles un HEX normalizado ocultaría su significado:

| Factor exacto | Ubicación | Función |
|---|---|---|
| `vec3(.82,1.04,1.08)` | `shaders.ts:87` | Multiplica canales para enfriar el material gaseoso; mezcla con peso `air*.45` |
| `vec3(1.18,1.07,.87)` | `shaders.ts:198` | Multiplicador cálido local, peso `clamp(local.w*.19,0,.22)` |
| `vec3(.2126,.7152,.0722)` | `shaders.ts:223` | Pesos de luminancia para saturación; no color ni absorción |

El shader anterior usa mezclas sucesivas abismo→cobalto→teal→espuma,
ocre por `gold`, y perla; agrega relieve, reflexión, bruma, saturación y
`pow(...,.88)`. No hay un fondo RGB independiente allí. Los vectores de
dirección de luz, coordenadas y ruido no son colores.

## 4. Generación, transporte y mezcla actuales

### Semilla independiente de pigmento

`initialPigment(p)` genera un `warp` con ruido 3D y un `body` amplio. Sus
operaciones, en orden, son:

```glsl
dye = mix(deepBlue, electricBlue, smoothstep(.24,.48,body));
dye = mix(dye, turquoise, smoothstep(.46,.64,body));
dye = mix(dye, iceCyan, smoothstep(.65,.82,body));
dye = mix(dye, pearl, smoothstep(.63,.84,pale)*.8);
warmConcentration = smoothstep(.63,.79,gold);
```

`pale=noise3(p*7.1+warp+31.7)` y
`gold=noise3(p*6.2+warp*1.7+73.4)`. El nombre `gold` describe el campo
procedural de concentración cálida, **no un pigmento amarillo RGB**.
`initialMatter` crea densidad de forma independiente: sus canales RGB son
desplazamientos materiales inicialmente cero, no colores.

### Campos persistentes

`AtmosphereVolume.allocate` mantiene un atlas 96×72×48, mosaico 8×6, tres
bancos de trabajo con tres adjuntos RGBA16F cada uno:

| Adjunto | RGB | A/W |
|---|---|---|
| Velocidad | Velocidad XYZ | Densidad reactiva transportada |
| Materia | Desplazamiento de coordenadas materiales | Densidad total |
| Pigmento | RGB frío transportado | Concentración cálida |

El atlas fuente guarda pigmento original y humedad original en dos adjuntos
separados. `pigmentSourceShader` se ejecuta al inicializar; no recolorea toda la
imagen con el audio. El transporte semi-Lagrangiano usa punto medio, corrección
MacCormack limitada por vecinos y clamp para no introducir extremos nuevos.
El RGB y la concentración cálida se transportan juntos como `vec4`.

La humedad ambiental se repone a `.045/s`. El pigmento recibe la reserva según
`fresh=condensed/max(.04,corrected.a)` y
`dyeFeed=1-(1-fresh)*exp(-dt*.025)`. Esta reposición lenta conserva diversidad
frente a difusión numérica; no genera un ciclo de paleta global.

### Plumas reactivas

`atmospherePlumes.ts` mantiene 16 emisores breves: 320/240/170 ms para
graves/medios/agudos. No define RGB. Envía origen, fuerza, banda, edad y dosis
integrada al shader. **16 emisores no equivalen a 16 nubes persistentes**:
la materia liberada continúa viviendo en el campo después de liberar el slot.

El GLSL L256–258 selecciona uno de los tres RGB de pluma y una concentración:

```glsl
warm = band<2.0 ? .08+.15*e.w
     : (band<5.0 ? .03+.12*e.w*e.w : .015);
bornPigment += vec4(cool,warm)*addition;
```

`addition` es materia nueva, acotada por espacio libre:
`(1-corrected.a)*(1-exp(-profile*dose*densityBudget*sqrt(e.w)*uIntensity))`.
El pigmento de varias fuentes se promedia por esa materia y se integra a lo
existente con `bornDensity/max(.000001,corrected.a)`. La densidad reactiva se
evapora a `.48/s`. No se cambia ninguna de estas fórmulas en esta fase.

### Mezcla fría y cálida

`mix` interpola componentes numéricamente, no implementa mezcla espectral
sustractiva de pigmentos físicos. La concentración cálida se transforma en
`smoothstep(.04,.30,pigment.a)` para mezclar el RGB frío con cobre al renderizar.
Se evita transportar directamente una mezcla RGB de cobre y cian que tendería
a neutralizarse numéricamente. Las mezclas producen azules intermedios,
celestes, verdes azulados, perlas y cobres desaturados; son un continuo, no
una lista finita de nuevos pigmentos con un HEX único.

## 5. Iluminación, absorción, profundidad y color final

La dirección `normalize(vec3(-.65,.8,.45))` es un vector espacial, no un tinte.
Se consultan densidades hacia la luz a `.055` y `.15` unidades del volumen:

```glsl
light = exp(-(closeShadow*.8 + farShadow*1.3)*2.35);
edge = clamp((density-closeShadow)*3.0+.35,0.0,1.0);
albedo = mix(pigment.rgb, copper, smoothstep(.04,.30,pigment.a));
scatter = albedo*(.42+light*1.45) + edgeScattering*edge*light*.25;
scatter = mix(scatter, depthBlue, depth*.16);
opacity = 1-exp(-density*stepLength*1.4);
color += transmission*opacity*scatter;
transmission *= 1-opacity;
```

La absorción/extinción es escalar, no un RGB negro ni un coeficiente espectral
por canal. La componente ambiental `.42` mantiene identidad fría bajo sombra;
la parte direccional puede elevar componentes por encima de 1 antes del clamp.
El tinte profundo tiene un peso máximo `.16`. Después se suma
`background*transmission`, una viñeta `1-.10*dot(vUv-.5,vUv-.5)`, la potencia
`.88` y dither fijo de amplitud `1/1024` pico a pico. Se mezcla historial y se
limita el resultado a [0,1]. La textura de imagen/historial es RGBA8.

`AtmosphereVolume.draw` usa historial con constante temporal
`.034-.012*excitation` segundos. Puede suavizar la evolución cromática local,
pero no cambia los pigmentos. En pantalla también existen los overlays CSS
de interfaz (`edge-shade`, paneles); no pertenecen al preset del material.

`volumeDetail.ts` no contiene colores: los bytes R/G son ruido de erosión
de densidad, B es otro ruido y A=255; el render muestrea R/G. Tampoco son
colores los adjuntos RGB de velocidad o desplazamiento. `AtmosphereVolume.ts`
orquesta campos e historial, sin nuevas constantes de pigmento.

## 6. Registro y protección de presets

Implementado:

- [`src/themes/model.ts`](../src/themes/model.ts): tipos compartidos,
  `ThemeColor`, `ThemeMaterialBinding`, unión oficial/personal, permisos y
  contrato versionado `UserThemeLibrary` para almacenamiento futuro.
- [`src/themes/coldAndFire.ts`](../src/themes/coldAndFire.ts): preset
  `cold-and-fire`, nombre `Cold & Fire`, origen `official`, checkpoint y
  trece constantes exactas con función, codificación y origen GLSL.
- [`src/themes/index.ts`](../src/themes/index.ts): registro de oficiales,
  búsqueda y `DEFAULT_THEME_ID`/`DEFAULT_THEME`.
- [`src/App.tsx`](../src/App.tsx): texto de lectura `Tema: Cold & Fire`
  sólo en ajustes de Atmosphere. Reutiliza `panel-note`; como las otras notas,
  se oculta en ventanas bajas según el CSS existente. No anuncia esa paleta
  como ya aplicada a Liquid/Texture. En hardware sin volumen, el texto indica
  el preset predeterminado, aunque el fallback conserva su paleta anterior.

El registro, preset, RGB, fuentes, bindings y listas están congelados con
`Object.freeze`, además de ser `readonly` en TypeScript. Los permisos se
derivan del origen mediante objetos congelados; no son flags editables en
un preset. No se expone una API para reemplazar o borrar oficiales.

| Operación | Oficial | Personal (contrato futuro) |
|---|---|---|
| Renombrar, editar, guardar, sobrescribir | No | Sí |
| Eliminar | No | Sí |
| Duplicar como preset personal | Sí | Sí |

La protección es de integridad del modelo en ejecución, no una barrera contra
editar el código fuente. La duplicación está permitida por el modelo; aún no
se implementa un servicio ni botones para ejecutarla.

`colors` es una lista de longitud variable, con identificadores estables; no
hay enum de nombres de pigmento ni cantidad máxima. `characteristics` admite
atributos cromáticos adicionales. Los materiales referencian IDs y definen
su propia interpretación y estado de conexión. En esta fase sólo Atmosphere
tiene un binding, `metadata-only`; el render sigue leyendo su GLSL original.
El contrato compartido no obliga a gas, líquido y granos a usar igual mezcla.

El inventario no parametriza todavía las fórmulas de las secciones 4–5:
umbrales de ruido, concentraciones cálidas, iluminación y transferencia siguen
en el checkpoint. Antes de conectar uniforms hace falta definir un adaptador
versionado que preserve todas esas fórmulas, además de los RGB.

### Persistencia futura compatible

No se extiende `Settings`, ni se cambia `audioflow.preferences.v1`; no hay
migración ni reescritura adicional. El tema predeterminado se resuelve desde
el registro, sin agregar datos persistentes mientras existe una única opción.
El estilo inicial continúa siendo el guardado por el usuario (o Liquid en
una instalación nueva): tema predeterminado no significa cambiar de estilo.

Para la siguiente fase se propone una clave separada
`audioflow.themes.v1` con `{schemaVersion:1,presets:UserThemePreset[]}` y,
al implementar selección, un `themeId` opcional en preferencias con fallback
a `DEFAULT_THEME_ID`. El contrato `UserThemeLibrary` ya representa el primer
objeto; el servicio de lectura/escritura queda pendiente.

Cada creación/duplicación deberá usar `crypto.randomUUID()` una sola vez,
prefijado `user:`, persistiendo ese ID y fechas ISO. Duplicar Cold & Fire hará
copia profunda de datos, `origin:'user'`, ID nuevo y `derivedFrom:'cold-and-fire'`;
editar/sobrescribir conservará el ID personal. Ninguna operación recibe los
objetos oficiales como destino de escritura.

El lector futuro deberá validar esquema, RGB finitos, encoding, IDs únicos,
referencias internas y fechas; rechazar IDs reservados/oficiales o entradas
con origen oficial dentro del almacén personal. Resolver oficiales siempre
desde el registro estático, nunca por combinación de objetos de localStorage.
Ante un tema ausente, datos corruptos o almacenamiento bloqueado, mantener
el oficial predeterminado sin borrar otras preferencias. Una escritura fallida
deberá conservar la última biblioteca válida e informar que no se guardó.

## 7. Amarillo y rojo: análisis previo

**No hay amarillo independiente ni rojo independiente en Atmosphere
volumétrico.** Existe cobre/naranja explícito, cuyo R elevado no lo convierte
en una especie roja separada. `gold` es concentración y `warm` es peso,
no valores RGB de amarillo o rojo. En la ruta anterior hay ocre y perla
amarillenta explícitos: tonos vecinos, no canales independientes para esos
dos nuevos pigmentos.

Un brillo puede percibirse dorado/amarillento por cobre iluminado y recorte
de R/G. Puede haber regiones cálidas percibidas como rojizas, pero no una
fuente de rojo controlable. Esto describe posibilidades de las fórmulas,
no una certificación por muestreo de todos los fotogramas.

Para incorporarlos después:

1. Duplicar el oficial; definir dos nuevas entradas RGB exactas y su encoding,
   características, fuentes, concentración y semilla en la variante personal.
2. Conservar IDs, valores y fuentes existentes. Si se requiere presencia
   independiente, agregar concentraciones amarilla y roja; A del pigmento ya
   está ocupado por cobre. No reemplazar cobre ni mezclar todo en el RGB frío.
3. Diseñar almacenamiento de concentraciones por bloques RGBA/capas o un
   backend equivalente, transportadas con los mismos campos de flujo. El
   límite de especies activas GPU se negocia por hardware/presupuesto; no se
   impone una cantidad arbitraria al modelo ni se trunca la biblioteca.
4. Definir mezcla para nuevos materiales/variantes, manteniendo una ruta
   `cold-fire-v1` con las fórmulas actuales. Con concentraciones nuevas en
   cero se deberá reproducir la referencia. No cambiar la colorimetría de
   todo el proyecto al introducir un editor.
5. Comparar GPU con semilla, campos, audio, tiempo, pasos, historial y calidad
   idénticos, incluyendo plumas, sombras y sesiones prolongadas. Una
   compilación correcta no demuestra equivalencia visual.

No se agregan amarillo ni rojo en esta fase.

## 8. Propuesta técnica: Cantidad de materia

### Estado actual y límites

El fondo gaseoso se origina en un campo continuo `initialMatter`, no en una
lista de nubes. La reserva ambiental fija repone densidad a `.045/s`. Sólo
la fracción reactiva tiene evaporación `.48/s`. Tras nacer, todas las plumas
se mezclan en los mismos campos Eulerianos: no queda un ID por nube.

Por eso no basta con escalar densidad, cambiar sus umbrales de ruido, aumentar
`PLUME_CAPACITY` o multiplicar intensidad. Intensidad también cambia ancho,
emisión y fuerza: no sirve como Cantidad de materia. Aumentar slots sólo
permite más nacimientos simultáneos; no controla cuántos cuerpos sobreviven.

### Unidad de control y ciclo de vida

Crear un gestor independiente `AtmosphereFormations` con IDs/semillas estables,
origen 3D, edad, estado `appearing/active/retiring`, vida y referencia a fuente
de materia. Una formación es un cuerpo o estela emitido con presupuesto fijo,
no un voxel ni un grupo de píxeles conexos. Dos cuerpos pueden fusionarse o
fragmentarse por el flujo: la cantidad controla población de formaciones,
no promete exactamente N componentes visibles en toda imagen.

El parámetro normalizado `matterAmount` se traduce por estilo a población
objetivo y frecuencia de reposición. Los radios, perfiles, pigmentos, dosis
por cuerpo, duración, velocidades y reglas acústicas individuales permanecen
independientes de ese parámetro. El gestor distribuye orígenes en XYZ con
secuencia determinista estratificada y separación espacial; así suma cuerpos
en profundidad sin agrandar cada uno. El movimiento posterior lo gobierna
el flujo, conservando la física individual y sus interacciones naturales.

La población objetivo se suaviza con tiempo continuo y un acumulador de
nacimientos. Al subir, se activan nuevas identidades con emisión progresiva
de presupuesto fijo; no se resembran las existentes. Al bajar, se retiran
fuentes seleccionadas de forma estable, dejan de reponer y su materia se
disipa mediante su ciclo de vida normal. No cambiar globalmente la opacidad
ni acelerar la disipación de todos los cuerpos cuando se mueve el control.
Los ciclos de vida de emisión y de materia deben contabilizarse por separado.

### Cambio de motor necesario para disminuir también el gas ambiental

Mantener la reserva ambiental actual íntegra impediría obtener realmente
pocas formaciones: seguiría regenerando el campo denso inicial. Una versión
completa necesita descomponer o sustituir esa reserva por fuentes de formación
con vida finita. Esto exige una etapa propia de simulación y revisión visual,
y queda expresamente fuera de esta fase.

Una alternativa eficiente es agrupar formaciones en pocas cohortes con campos
de propiedad/densidad transportados por el mismo flujo. Sus fuentes se
actualizan sólo al nacer/retirarse. Todas las cohortes usan las mismas leyes
de transporte y disipación, y se componen para el raymarch. Retirar una fuente
no debe permitir que el atlas ambiental fijo la regenere. Si se exige retirar
una identidad concreta después de mezclarse, harán falta etiquetas/pesos por
formación o almacenamiento disperso por cuerpo; el agregado actual no contiene
la información necesaria para hacerlo exactamente.

Para preservar la composición inicial en el punto predeterminado se puede
investigar una partición de unidad `D_i(p)=w_i(p)*D_actual(p)` con
`sum(w_i)=1`, sin recalcular la semilla. Esto sólo garantiza igualdad de la
densidad reconstruida inicial; los limitadores y la composición no lineal
pueden divergir después. La equivalencia temporal requiere pruebas GPU, no
queda garantizada por esa identidad algebraica. No comprometer el preset
aprobado mientras se investiga: mantener la ruta original disponible.

### Coste y separación de audio

- Reutilizar el atlas, advección y detalle existentes donde sea posible; evitar
  una simulación 96×72×48 completa por cada nube o un raymarch por formación.
- Inyectar fuentes con cajas 3D acotadas y listas por tile/slice o volúmenes
  dispersos; evitar un bucle de cientos de formaciones por cada voxel.
- Los campos adicionales son costosos: un RGBA16F 96×72×48 ocupa unos
  2,53 MiB por banco; con tres bancos, unos 7,59 MiB por cohorte adicional.
  Validar ancho de banda, adjuntos disponibles y tiempo GPU antes de fijar
  población/capacidad. La cantidad no debe cambiar grid, pasos o calidad.
- No leer GPU→CPU cada cuadro. El gestor mantiene eventos/semillas y estima
  población/posiciones; flujo y propiedad avanzan en GPU. El conteo perceptual
  se mide offline en el banco de pruebas.
- Mantener los eventos reales y su fuerza/duración por separado de la
  población. Las formaciones ambientales nuevas pueden nacer en silencio;
  no inventar onsets ni modificar captura/FFT para llenar cupos. Una formación
  conserva la respuesta acústica que le corresponda al cambiar cantidad.
- En solapamientos, la extinción acumulada puede subir naturalmente. Evitar
  saturación y falta de espacio con distribución de orígenes y capacidad
  razonable, sin compensar globalmente tamaño, densidad o velocidad.

El contrato conceptual puede compartirse con Liquid y Texture como población
de parcelas, vetas, granos o cuerpos de material. Cada estilo deberá interpretar
el parámetro y gestionar su vida propia; no se comparten obligatoriamente
campos, fórmulas ni conteos literales. Este parámetro no pertenece al tema de
color ni se agrega todavía a `Settings`.

### Criterios de prueba para la próxima fase

Reproducir un barrido bajo→medio→alto→bajo con la misma semilla/audio, sin
llamar `restore`, `allocate` o al pase inicial por un cambio del parámetro.
Registrar nacimientos y retiros, distribución Z y espacios entre formaciones.
Comparar cuerpos aislados: ancho, perfil, densidad por cuerpo, velocidad,
presupuesto y respuesta acústica no deben depender de cantidad. Probar
silencio, ráfagas, todas las calidades, cambios rápidos y FPS 30/60/144; medir
memoria y tiempo GPU. La transición hacia menos materia debe mostrar
disipación local continua, sin recolorear ni borrar todo el volumen.

## 9. Archivos para las siguientes iteraciones

| Función futura | Archivos existentes | Archivos nuevos propuestos y trabajo necesario |
|---|---|---|
| Selector de temas | `src/App.tsx`, `src/settings.ts`, `src/themes/index.ts` | `src/themes/storage.ts`: resolver tema seleccionado y fallback; extender preferencias opcionalmente |
| Editor de colores | `src/App.tsx`, `src/themes/model.ts`, `src/styles.css` | `src/themes/ThemeEditor.tsx`: edición de copia personal, encoding y características explícitos |
| Presets personales y persistencia | `src/themes/model.ts`, `src/themes/index.ts` | `src/themes/storage.ts`: validación versionada, UUID, carga/guardado, errores y exclusión de oficiales |
| Duplicar Cold & Fire | `src/themes/coldAndFire.ts` (sólo lectura), `src/themes/model.ts` | `src/themes/userPresets.ts`: copia profunda con UUID nuevo y procedencia; nunca mutar el original |
| Conectar colores a Atmosphere | `src/visual/AtmosphereVolume.ts`, `src/visual/atmosphereShaders.ts`, `src/visual/Universe.ts` | `src/themes/atmosphereBinding.ts`: adaptador exacto y versionado; comparar uniformes con ruta original |
| Nuevos pigmentos | Los anteriores y futuros bindings por estilo | Plan de canales/concentraciones por material; nuevas fuentes, transporte y mezcla; modelo sin límite fijo de colores |
| Colores en Liquid/Texture | `src/visual/shaders.ts`, `src/visual/Universe.ts` | Adaptadores y validación propios para cada estilo, en una fase posterior |
| Cantidad de materia | `src/App.tsx`, `src/settings.ts`, `src/visual/AtmosphereVolume.ts`, `src/visual/atmosphereShaders.ts` | `src/visual/AtmosphereFormations.ts`: población/vida, fuentes y propiedad; binding conceptual por material |
| Relación con plumas | `src/visual/atmospherePlumes.ts` (si el diseño posterior requiere asociación) | Conservar eventos, fuerza y curvas; no confundir slots emisores con cuerpos vivos |
| Regresiones | `tests/themes.test.ts`, `tests/features.test.ts`, `tests/atmosphere.test.ts`, `scripts/test-atmosphere.mjs` | Pruebas CRUD/almacén y replay visual con campos y PCM idénticos; ampliar harness GPU/temporal |

`volumeDetail.ts`, captura y análisis acústico no necesitan cambios para un
editor de temas o el control de población propuesto.

## 10. Validación de esta fase

- `npm.cmd run typecheck`: correcto, aplicación y Electron.
- `npm.cmd test`: 36 pruebas correctas, incluyendo cinco nuevas de temas y
  compatibilidad. Cubren registro predeterminado, permisos oficiales/personales,
  congelamiento profundo y resistencia a mutación, RGB contra literales GLSL,
  referencias de materiales, preferencias antiguas, round-trip y storage bloqueado.
- `npm.cmd run build`: correcto (TypeScript, compilación Electron y Vite).
- `git diff --exit-code 238ab19 -- src/visual src/audio src/settings.ts electron`:
  sin diferencias. Los cinco archivos pedidos, `Universe.ts` y todo el motor
  conservan el código de la base aprobada. Los metadatos no son importados
  por el motor; sólo la etiqueta del panel usa el registro.

No se modificó ningún shader ni entrada del render: la preservación se basa
en la identidad de su código y configuración, además de las pruebas, no en
atribuir equivalencia visual a que compile. No se ejecutó una nueva comparación
de imágenes GPU; será obligatoria al conectar o cambiar shaders. No se
regeneran instaladores ni ejecutables distribuibles en esta fase.
