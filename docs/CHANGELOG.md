# Changelog

Formato: una entrada por fase. Ver las fases en la sección 11 del
[master prompt](MASTER_PROMPT.md).

---

## Fase 2 · Entrega D — Extras del importador · 3 de septiembre de 2026

Los tres extras de §7.12, y seis defectos de la Entrega C que aparecieron al someter su
diseño a crítica adversarial contra el repositorio.

### Primero: seis defectos del código que ya corría

Los críticos devolvieron 31 hallazgos confirmados. Cuatro no eran del diseño propuesto sino
de lo que ya estaba en producción, y dos más aparecieron al construir.

| # | Qué estaba mal | Por qué importaba |
|---|---|---|
| 1 | El **grado votaba** sobre cómo se lee el dinero | PSA imprime "9.5" y el dueño lo transcribe; el dinero lo teclea él a la venezolana. Un "9.5" resolvía el archivo entero como gringo —con `confident: true`, así que el toggle del paso 3 ni aparecía— y "1.234" se leía como un dólar con veintitrés. Comprobado antes de creerlo |
| 2 | Una carta **vendida volvía al inventario** | El camino de actualizar comprobaba el estado destino pero no el actual. Una carta vendida que siguiera en el Excel con "recibido = sí" reaparecía disponible, y en la tienda |
| 3 | El **valor de mercado** no lo validaba nadie | "aprox 1.200" llegaba intacto al `::numeric` y abortaba la transacción ENTERA, con un error de Postgres en inglés |
| 4 | Las **plantillas se guardaban por posición** de columna | El comentario de la migración prometía `{ "Jugador / Personaje": ... }` y el código guardaba `{ "5": ... }`. Insertar una columna hacía leer la aduana donde está el valor de mercado: dos montos válidos, nada que falle, y el error aparece meses después |
| 5 | Una **gradadora mal tecleada** se volvía "sin gradar" | "PSAA" entraba como carta SIN GRADAR con grado 10: un slab PSA 10 archivado como carta suelta |
| 6 | Guardar una plantilla **no servía de nada** | No había forma de volver a aplicarla |

### Exportación inversa: la ida y vuelta por SKU

El master prompt pide bajar el inventario "en el mismo formato de la plantilla". No se hace
así, y el motivo es de dinero: la plantilla tiene forma de **compra** y reimportar el
inventario en ese formato crearía lotes falsos y volvería a cargar un costo ya pagado.

Lo que sí funciona es el **SKU**. Un SKU solo puede haber salido de este sistema: no es un
parecido, es identidad. El importador lo lee como "esta pieza ya existe" y la fila entra por
el camino de actualizar, que solo toca valor de mercado, precios, ubicación y si ya llegó.

Por eso una fila con SKU se marca para actualizar **sola** — es lo que el dueño pidió al
bajar el inventario para editarlo. Las otras dos coincidencias, cert y posición en el lote,
son heurísticas y siguen empezando en "omitir". Y una fila **sin** SKU en ese archivo sale
con los cinco errores que le faltan para ser una compra, que es la respuesta honesta.

### Google Sheets sin OAuth

Una hoja compartida por enlace se baja como CSV sin credenciales. El riesgo no es Google: es
que el servidor haga una petición HTTP a partir de algo que escribió el usuario. La defensa
no es una lista de hosts prohibidos — **la URL del usuario nunca se pide**. De ella se
extraen dos cadenas y el servidor construye la única URL que puede pedir; no queda ni host,
ni ruta, ni query bajo su control. Encima, redirecciones seguidas a mano con el host
comprobado en cada salto, tope de saltos, de tiempo, y de bytes *mientras* se lee.

Verificado contra Google de verdad: los metadatos de la nube (`169.254.169.254`) y un
servicio interno se rechazan antes de salir; una hoja pública se baja, queda en el bucket
privado, y el pipeline la rechaza sola porque sus columnas no son de cartas.

**Lo que no se construyó**: la sincronización incremental por hash de fila. La crítica la
desarmó — sacar las filas sin cambios del grupo hace que el lote pierda sus costos comunes y
el prorrateo se reparta entre menos piezas, o sea que **el costo de las cartas viejas cambia
solo**; una clave de idempotencia derivada de la conexión hace imposible agregar una carta a
un lote ya importado; y un documento que cualquiera con el enlace puede editar no puede
tener autoridad de escritura sobre inventario existente. Traer la hoja entera y pasarla por
los cuatro pasos hace el mismo trabajo sin ninguno de esos agujeros.

### Importar por foto

Una foto no produce montos, produce **celdas**. Lo que sale del modelo es texto transcrito
tal como se ve; se materializa en una hoja con las columnas de la plantilla y de ahí en
adelante es un archivo como cualquier otro. Ningún campo del esquema es `number`, y el
esquema **omite** los costos comunes, la plataforma, la referencia y la fecha: lo que no
está declarado no puede aparecer en la respuesta, ni alucinado.

La ruta de la foto se valida contra un patrón exacto —`docs` guarda comprobantes de pago— y
el action lleva guardia de rol explícita, porque el gasto y la salida hacia un tercero
ocurren antes de que ninguna política de Postgres tenga nada que decir.

Sin `ANTHROPIC_API_KEY` el módulo se apaga entero y dice por qué.

### Verificación

- 235 tests unitarios (17 nuevos de dominio) y 50 pgTAP.
- La ida y vuelta, en el navegador con un archivo editado de verdad: 2 filas actualizadas,
  **0 lotes creados**, "1.850,50" leído como 1850.5000 y el costo prorrateado intacto.
- Las tres defensas de SSRF, contra Google de verdad.

---

## Fase 2 · Entrega C — Importador semanal de Excel · 31 de agosto de 2026

El módulo que más cambia el día a día: el dueño arma su tabla en Excel, la sube, y el
sistema crea los lotes, las piezas y el prorrateo sin cargar nada a mano.

### Los dos idiomas del archivo

`1.234` significa **mil doscientos treinta y cuatro** en Venezuela y **uno coma doscientos
treinta y cuatro** en Estados Unidos. Adivinar mal multiplica un precio por mil, y ese
precio entra al costo de una carta que después se vende.

`08/09/2026` tiene el mismo problema con otra cara: 8 de septiembre aquí, 9 de agosto allá.
Una fecha de compra movida un mes descuadra el corte contable y el aging del inventario, y
nadie lo nota porque la fecha SÍ existe — no revienta nada.

La regla, en los dos casos, es no adivinar nunca celda por celda. La convención se deduce
mirando el **archivo completo**: basta un solo valor inequívoco —un `1.234,56`, un día
mayor que doce— para resolverlo todo. Si no hay ninguno, se **pregunta** antes de confirmar.

Un Excel lo escribe una sola persona con un solo teclado, así que un valor inequívoco en la
columna de la aduana resuelve también la del martillo. Deducir columna por columna daría
menos evidencia y preguntaría más veces por lo mismo.

### Confirmar es todo o nada, y se puede deshacer

`commit_import_batch` no inventa un camino de escritura: llama a `create_acquisition`, la
misma función del wizard de Compras, una vez por grupo de filas. **Tres módulos que crean
inventario con costo por un solo camino.**

Lo único que hace de más es enlazar cada fila del archivo con la pieza que produjo, y lo
hace **dentro de la misma transacción**. Si ese enlace se escribiera después, un fallo entre
las dos escrituras dejaría cientos de items creados sin registro de cuáles son: un lote
irreversible, que es justo lo que la reversión promete que no pasa.

Revertir no es un `DELETE`. Es borrado suave con guardias que se niegan si una pieza ya tomó
vida propia: vendida, en un pedido, publicada, fotografiada, abierta en un break o con pagos
contra su lote de compra. La guardia **no** bloquea por "lote recibido" — un lote recibido es
el caso normal del archivo semanal, y bloquear ahí sería no tener reversión. Cuando se niega,
lista pieza por pieza qué lo impide, todas de una vez: descubrirlas de a una, reintentando,
es insoportable.

La ventana de 7 días vive en `settings`, no clavada en el código.

### Lo que la crítica del diseño destapó

- **Normalizar los VALORES, no solo los encabezados.** El Excel dice "Fanatics Collect",
  "carta graduada" y "psa"; el esquema espera `fanatics`, `graded_card` y `PSA`. Sin esa
  capa, cada fila reventaba a mitad de la transacción con un error ilegible. Detalle fino:
  `grading_company` es el único enum del esquema en mayúsculas.
- **`items.category` es obligatorio y la plantilla de 27 columnas no tiene esa columna.** Se
  deduce del deporte o juego; cuando no lo reconoce devuelve "no sé" para que el dueño elija,
  en vez de caer en `other` en silencio y dejar la pieza en el sitio equivocado.
- **El duplicado dentro del MISMO archivo** no lo atrapa ningún índice único, porque las dos
  filas son nuevas. La clave del cert se arma exactamente igual que el índice de la base: si
  se calculara distinto, el importador diría "nueva" y el insert moriría con 23505.
- **Los errores se comprueban antes**, no en la base. Una restricción que salta dentro de la
  transacción aborta el archivo entero y llega como un mensaje de Postgres; aquí llega como
  "el grado 11 está fuera de 0 a 10" en la fila 7, corregible sin volver a subir nada.
- **Un costo común ilegible bloquea su fila** en vez de valer cero. Dejarlo pasar perdería
  plata del lote en silencio y abarataría el costo de cada carta.
- **Un lote se da por recibido solo si TODAS sus filas llegaron.** Con una pendiente, darlo
  por recibido pondría en el inventario disponible una carta que sigue en Estados Unidos.
- **Las filas duplicadas y las que traen error quedan fuera del lote por completo.** Su
  martillo no cuenta para el total y el envío se reparte solo entre las que sí entraron.

### Tres enums, no dos

Al estado del archivo que pide §7.12 (`previewed`, `committed`, `reverted`) se suman el de
la **previsualización** y el del **desenlace**. "Duplicada en base" es una decisión;
"omitida" es lo que ocurrió. Mezclarlos obligaría a borrar el motivo para escribir el
resultado, y el motivo es lo único que explica por qué una carta que estaba en el archivo no
está en el inventario.

### Verificación

- 62 tests nuevos de dominio (203 en total), incluido uno que arma un `.xlsx` como los de
  verdad —título arriba, fila vacía, `1.234,56`, `psa` en minúscula, "Fanatics Collect", un
  cert repetido, un grado imposible y una fila sin nombre— y lo lleva hasta el plan.
- 17 tests pgTAP nuevos (45 en total): atomicidad del commit, idempotencia del segundo toque,
  las guardias de la reversión y la ventana de 7 días.
- Recorrido completo en el navegador con ese mismo archivo: 2 piezas creadas, 1 lote,
  $1.812,56 invertidos, prorrateo cuadrado al centavo contra `acquisitions.total_cost`.
  Reversión bloqueada con una pieza publicada, y limpia sin ella.

### Pendiente de la fase

La Entrega D: exportación inversa, import por foto con visión (necesita `ANTHROPIC_API_KEY`)
y sincronización con Google Sheets (necesita OAuth de Google Cloud).

---

## Fase 2 · Entrega B — Compras · 26 de agosto de 2026

Wizard de cuatro pasos, listado con alerta de lotes que no llegan, y ficha del lote.

> Nota de historial: el código de esta entrega se publicó dentro del commit `09bb8da`
> ("aplicar la guía de marca"), porque ese commit usó `git add -A` mientras Compras estaba a
> medio verificar. El mensaje de aquel commit no lo menciona; queda registrado aquí.

### La ruta única de escritura

Un lote son cuatro tablas que tienen que nacer juntas: `acquisitions`,
`acquisition_lines`, `items` e `item_costs`. Un lote a medio escribir deja inventario
fantasma con SKU consumido y un total que no cuadra con la suma de sus piezas.

`supabase-js` no da transacciones, así que la escritura entra por
`create_acquisition(jsonb)`: una función plpgsql `security invoker` que corre entera en una
transacción y **solo inserta**. El prorrateo lo calcula `lib/domain/allocation.ts` y la
función únicamente asierta dos invariantes: que el martillo declarado sea la suma de las
líneas, y que lo que costó cada pieza sume exactamente lo que costó el lote.

**La misma función la usará el importador de la Entrega C.** Tres módulos que crean
inventario con costo por un solo camino, no por tres.

### Decisiones que sostienen el módulo

- **El servidor recalcula el prorrateo** desde los martillos validados y descarta lo que
  mandó el navegador. Un Server Action es un endpoint público; aceptar un `allocated_cost`
  del cliente dejaría que cualquiera con sesión escriba la cifra que decide si una venta
  ganó o perdió dinero. Lo del wizard es previsualización.
- **Clave de idempotencia.** Dos toques en "Confirmar" —o un reintento tras un timeout de
  red con la transacción ya comprometida— devuelven el lote que ya existe. El índice único
  de `(platform, reference)` no cubría esto: es parcial, y las compras a particulares no
  traen número de subasta.
- **Marcar un lote como recibido mueve sus piezas** de `incoming` a `in_stock` con su fecha.
  Sin eso, el lote llegaba a Caracas y las cartas seguían invisibles como inventario.
- **El wizard es un borrador local** con autoguardado: se pueden teclear quince cartas,
  cerrar la pestaña sin querer y volver donde ibas.
- **El fee de tarjeta se sugiere y deja de recalcularse en cuanto lo tocas.** El número que
  manda es el del estado de cuenta, no el nuestro.
- **Pre-vuelo de certs** antes de habilitar el botón: descubrir el choque dentro de la
  transacción revierte el lote —correcto— pero el dueño acaba de teclear quince cartas y no
  sabría cuál falló.
- **"Pagado vs mercado" muestra tres cifras**, no dos: costo, realizado, y mercado de lo que
  queda. Mezclar lo vendido con lo que sigue en la bóveda esconde cuál es cuál.

### Un error del middleware, corregido

Cuando Supabase rotaba el token a mitad de la petición, la página de abajo seguía leyendo
las cookies viejas: la respuesta se construía **antes** del refresco y congelaba el request.
El síntoma era feo y difícil de atribuir — entrabas con tu enlace mágico y la primera
pantalla decía "sin acceso"; recargabas y funcionaba. Ahora la respuesta se reconstruye
dentro de `setAll`, con el request ya actualizado.

### Verificación

De punta a punta en el navegador, con un lote real de tres cartas de Goldin:

- Fee de tarjeta sugerido **52,0641** = 3,3 % de 1.577,70, exacto.
- Reparto **1.154,19 + 435,20 + 195,87 = 1.785,26**, diferencia **0,0000** contra el total.
- Al marcarlo recibido, las tres piezas pasaron a `in_stock` con su fecha.

Contra la función, por separado: un martillo declarado que no cuadra y un prorrateo torcido
se rechazan **sin escribir una fila**.

---

## Fase 2 · Entrega A — Inventario · 25 de agosto de 2026

El primer módulo que sirve para trabajar. Antes hubo que pagar deuda.

### La deuda de la Fase 1

Diseñar los tres módulos de la fase con crítica adversarial destapó **nueve defectos** en lo
ya construido. Cada uno se verificó contra la base antes de creerlo.

El más serio era silencioso: `fromDbNumeric` convertía `NULL` en cero, así que un `staff`
habría visto costo **$0.00** y una ganancia no realizada igual al valor de mercado completo.
El RLS ocultaba bien el dato; la función de lectura lo convertía en una cifra falsa que nada
delataba. Es la misma lección que el prototipo anterior ya había aprendido con los precios
de mercado — una carta sin comp no vale cero — cometida otra vez en otra forma.

Los otros ocho: el admin veía los items borrados; `item_images` e `item_valuations` no
tenían auditoría, y una valuación mueve la mitad de la cifra de valor de inventario; el slug
chocaba entre años; `acquisition_lines` no tenía orden, así que el residuo del redondeo
podía saltar de pieza al recalcular un lote; las compras sin número de subasta no tenían
protección contra el doble envío; **un `viewer` podía subir fotos** a un bucket público y un
`staff` dejaba archivos huérfanos servidos para siempre; el bucket rechazaba los `.xlsx` del
importador; y `acquisitions.fx_rate` significaba dos cosas a la vez.

El prorrateo ahora **exige** el número de línea y ordena por él: pasar una lista que salió
de un `SELECT` sin `ORDER BY` dejó de ser posible.

### Lo construido

Listado con filtros, búsqueda por `search_vector`, paginación y valor por segmento. En
escritorio es tabla ordenable; en móvil son tarjetas, porque nueve columnas en 375 px
obligan a desplazar de lado para ver el precio.

El valor va en **cuatro líneas separadas**, nunca sumadas: las cajas abiertas ya trasladaron
su costo a las cartas que salieron y lo consignado es de terceros. Una sola cifra contaría
dinero dos veces y sumaría plata ajena.

Ficha de pieza, publicar en tienda con la razón visible cuando no se puede, fotos, breaks,
etiquetas con QR, exportación CSV y acciones masivas.

### Decisiones que sostienen el módulo

- **El `NULL` de costo es un estado de primera clase.** `Decimal | null`, nunca cero. La
  pantalla de un `staff` dice "sin acceso" y "—", y los totales reportan cuántas piezas
  quedaron sin costo visible.
- **El filtro por costo está cerrado en dos capas** para quien no ve costos: la interfaz no
  lo ofrece y el servidor lo ignora aunque se arme la URL a mano. Con un rango y unos
  intentos se deduce el costo exacto por búsqueda binaria.
- **Las fotos se preparan en el navegador** antes de subir: se reducen a 2000 px y se
  recodifican, lo que descarta el EXIF entero — incluida la geolocalización, que en una foto
  tomada en casa es la dirección del dueño y que iría a un bucket público.
- **Al borrar una foto, primero el archivo y después la fila.** Al revés, un fallo dejaría un
  huérfano servido para siempre y sin fila que lo delate.
- **Abrir un break entra por una función plpgsql** que corre en una transacción y solo
  inserta: el reparto lo calcula `lib/domain` y la función únicamente asierta que los hijos
  suman exactamente el costo de la caja. Probado con un reparto torcido: rechazado, y cero
  filas escritas.
- **Los hijos de un break heredan dueño y consignante**: las cartas que salen de la caja de
  un tercero siguen siendo de ese tercero.
- **Una fila con varias cajas no se abre**: pasaría todas a consumidas y el índice único
  impediría abrir la segunda, perdiendo existencia real.
- **El CSV neutraliza la inyección de fórmulas.** Excel ejecuta cualquier celda que empiece
  por `=`, `+`, `-` o `@`, y este archivo se le manda al contador.
- **Publicar no está entre las acciones masivas**: exige condiciones por pieza, y un botón
  que publica quince de las que ocho fallan en silencio es peor que no tenerlo.

### Dos errores más, encontrados verificando en el navegador

- La compra del **14 de agosto** se mostraba como el **13**. Un `date` de Postgres no tiene
  zona horaria, y `new Date()` lo vuelve medianoche UTC, que en Caracas retrocede un día.
- **`/forbidden` no estaba en la lista de rutas sin idioma**, así que next-intl lo reescribía
  a `/en/forbidden`, que no existe: quien no tenía permiso veía un 404 en lugar de la
  explicación.

### Verificación

81 tests unitarios y 28 pgTAP, con las migraciones aplicadas desde cero. Y con dos sesiones
reales en el navegador: el `owner` ve costo 6.761,13 y ganancia 259,87; el `staff` ve las
mismas 15 piezas, con "sin acceso" donde iría el costo y "15 piezas sin costo visible" al
pie. El filtro por costo le devuelve 15 filas en vez de 6, porque el servidor lo ignora.

La subida de una foto de 3000×4200 sale como WebP de 1429×2000 y 7 KB, sin EXIF ni GPS. Un
break con reparto ponderado 5:1:1:1:1 sobre una caja de 113,0779 da 62,8211 + 12,5642 × 4 =
113,0779 exacto.

### Pendiente de la fase

Compras (Entrega B), Importador (Entrega C) y los tres extras (Entrega D).

---

## Fase 1 — Modelo de datos completo · 24 de agosto de 2026

Catorce migraciones con el esquema de negocio entero, sus políticas y la regla de
prorrateo. Ninguna pantalla: eso es la Fase 2.

**25 tablas, 4 vistas, 53 políticas, cero tablas sin RLS.**

### Cómo se ocultan los costos

El master prompt exige que `staff` no vea costos, y el RLS de Postgres filtra filas, no
columnas. En vez de enmascarar columnas en vistas —que obliga a la vista a saltarse el RLS
y reimplementar el filtro de filas, dos fuentes de verdad que se desincronizan— **lo
sensible se mudó a su propia fila**: `item_costs`, `order_line_costs` y `account_details`,
cada una con su política. `acquisitions`, `acquisition_lines` y `transactions` son
enteramente de owner y admin.

El efecto: `items_with_costs` hace `items LEFT JOIN item_costs` con `security_invoker`, y
el costo llega real para el admin y en `NULL` para el staff **sin una sola condición
escrita**. El RLS de la tabla unida se encarga.

Dos fugas que aparecieron al revisar el diseño con esa lente:

- **Los pagos de un lote son un costo disfrazado**: dicen cuánto se pagó por él. `staff` y
  `viewer` solo ven pagos ligados a una orden.
- **Los datos de cobro de una cuenta** (titular de Zelle, teléfono de Pago Móvil, saldo)
  son tan sensibles como un costo, pero `staff` necesita el nombre de la cuenta para
  registrar un pago. La cuenta se partió: `accounts` con la identidad, `account_details`
  con el dinero.

Para el visitante anónimo sí sirven los permisos por columna, porque `anon` es un rol de
base de datos distinto: la tienda ve el precio de lista y nunca `min_price`, que es el piso
que aceptaríamos en una negociación.

### Prorrateo

`lib/domain/allocation.ts` reparte los costos comunes del lote en proporción al martillo,
con la última línea absorbiendo el residuo del redondeo. El invariante es duro y está en
los tests: la suma de lo que costó cada pieza es **exactamente** lo que se pagó por el
lote. Si se redondea cada línea por su lado, aparecen o desaparecen centavos y el
inventario deja de cuadrar contra lo que salió del banco.

### Decisiones que se apartan del master prompt

- **`acquisition_lines` no guarda `allocated_cost`** (§5.2 lo pone ahí). Ese número ya vive
  en `item_costs`; dos copias del mismo monto en un sistema de dinero terminan divergiendo.
  El prorrateo sigue siendo auditable: la suma de los costos de los items del lote tiene que
  dar `acquisitions.total_cost`.
- **`gross_margin` no es columna generada**, a diferencia de los demás totales. Depende de
  `unit_price` y `quantity`, que viven en `order_lines`, y una columna generada solo lee su
  propia fila; copiarlas a la tabla de costos para poder generarla crearía justo la
  duplicación que el diseño evita. La escribe `lib/domain` al cerrar la venta.
- **`consumed` agregado a `item_status`**: §5.3 dice que la caja pasa a `sold` o `consumed`
  al abrir un break, pero §5.1 no lo listaba. Una caja abierta no se vendió.
- **Las tablas del importador quedan para la Fase 2**, junto con su parser y sus tests.

### Dos errores encontrados y corregidos

- **El trigger de auditoría** asumía que toda tabla tiene columna `id`. Las que guardan la
  parte sensible de otra entidad se llaman `item_id`, `order_line_id`, `account_id`.
- **El guardián de roles de la Fase 0** bloqueaba _todo_ cambio de rol hecho sin sesión de
  usuario — o sea, desde una migración, el service role o el SQL Editor. Era imposible
  ascender a alguien desde el backend, que es como se crea el segundo administrador. La
  regla quería decir algo más estrecho: nadie se asciende a sí mismo.

### El puente numérico

PostgREST entrega los `numeric` como número JSON, así que los tipos generados los declaran
`number` — el float que el proyecto prohíbe para dinero. `lib/supabase/numeric.ts` es el
único punto donde se cruza esa frontera: al escribir manda el string exacto, que Postgres
convierte a `numeric` sin que un float toque el valor.

### Verificación

Antes de aplicar nada, las migraciones y 21 aserciones de RLS se corrieron contra el
proyecto real **dentro de una transacción revertida**. Ese ensayo encontró los dos errores
de arriba sin dejar rastro.

Con Docker ya instalado, sobre la base local:

- Las 16 migraciones se aplican limpias **desde cero**, no solo acumuladas.
- **19 tests pgTAP en verde** (`supabase test db`). Se validaron mutando una aserción para
  confirmar que saben fallar: `have: 0 / want: 2`.
- **El seed corre**: 15 items, 6761.13 repartidos entre las piezas, 1018.13 de costos
  comunes prorrateados. El cuadre se comprobó además en SQL puro, al margen del código
  TypeScript: `total_lote − suma_piezas = 0.0000`.
- Las tres salvaguardas del seed funcionan: es idempotente, `--reset` rehace el lote, y
  apuntarlo a producción aborta.
- Por la API local con la anon key: de 15 items sembrados el anónimo ve los 11 publicados,
  lee `list_price`, y recibe 42501 al pedir `min_price` o `item_costs`. Lo mismo contra la
  API de producción.

### Dos hallazgos más, ya corregidos

- **Los privilegios por defecto no son iguales en los dos entornos.** El seed fallaba en
  local con "permission denied for table fx_rates" usando el service role, y la misma llave
  funcionaba en el proyecto hospedado. Es el peor tipo de error: solo aparece en un lado.
  Los permisos ahora se declaran explícitos en una migración, incluidos los `alter default
privileges` para las tablas que creen las fases siguientes. Ambos entornos reportan hoy
  exactamente una tabla sin acceso para el service role: `document_counters`, que se excluyó
  a propósito.
- **Los tests asumían una base vacía.** Pasaban en limpio y fallaban con el seed cargado,
  porque contaban filas de toda la tabla en vez de las suyas. Cada aserción quedó acotada a
  sus propios datos, y ahora pasan en los dos escenarios.

Cosas menores del mismo hallazgo: el archivo de fixtures se llamaba `.sql` y `pg_prove` lo
tomaba por un test, lo corría fuera de transacción y dejaba usuarios escritos que rompían a
los siguientes; ahora es `.psql`. Y `supabase/.temp/`, que crea `supabase start` con
runtime de Deno minificado, entraba al lint.

### Pendiente

- **El Excel real del lote de Alt de agosto.** El seed carga un lote inventado pero
  realista. Cuando llegue el archivo, se reemplaza `supabase/seed/demo-lot.ts` y nada más.

---

## Fase 0 — Fundación · 24 de agosto de 2026

Esqueleto que compila, autentica y despliega. Ninguna tabla de negocio y ninguna regla de
negocio todavía: eso entra en la Fase 1.

### Andamiaje

- Next.js 15.5 con App Router, React 19, TypeScript en `strict` más
  `noUncheckedIndexedAccess` y `noImplicitOverride`.
- Tailwind CSS 4 y shadcn/ui (11 componentes base), iconos de lucide.
- Montserrat como única familia tipográfica. Radio de esquina 4px y paleta neutra:
  blanco con acento negro, sin decoración de color.
- Prettier con ordenamiento de clases de Tailwind.

### Superficies

- `app/(admin)` — panel, login y rutas de auth. Solo español, sin prefijo de idioma.
- `app/(store)/[locale]` — tienda pública bilingüe: español en `/`, inglés en `/en`.
- Son dos root layouts a propósito: la tienda necesita `<html lang>` variable, y un layout
  raíz único no lo permite.

### Autenticación y roles

- Migración `20260824120000_system_foundation.sql`: enum `user_role`, tabla `profiles` con
  RLS, trigger de alta automática, `current_user_role()` / `is_admin()` /
  `can_access_admin()` como base de todas las políticas de la Fase 1, y los buckets `cards`
  (público) y `docs` (privado) con sus políticas.
- El primer usuario que entra queda como `owner`; los siguientes nacen `viewer`. Un trigger
  impide que nadie se cambie el rol a sí mismo.
- Acceso por enlace mágico, con Google detrás de una bandera de entorno para no ofrecer un
  botón que falla mientras el proveedor no esté configurado.
- Dos rutas de retorno — `/auth/callback` (PKCE, plantilla de correo por defecto) y
  `/auth/confirm` (`token_hash`) — para que personalizar la plantilla más adelante no rompa
  el acceso.
- El middleware resuelve autenticación; la autorización se decide en el layout del panel,
  contra la base. `consignor` no entra: tendrá su portal en la Fase 6.

### Navegación

- Bottom nav móvil con Dashboard, Inventario, Vender, Compras y "Más", y sidebar en
  escritorio. Las diez rutas de módulo existen desde ya, con marca de "en construcción" y la
  fase en que llega cada una.

### i18n

- `next-intl` desde el primer día. Ningún texto visible vive dentro de un componente.

### Calidad

- `lib/domain/money.ts` con 15 tests: suma exacta, redondeo half-up, escala de base,
  porcentajes encadenados y conversión USD/Bs. de ida y vuelta.
- Playwright configurado con tres e2e (redirección del panel, login, cambio de idioma).
- GitHub Actions corriendo lint, typecheck, tests y build.
- Sentry en los tres runtimes, apagado mientras no haya DSN.

### Se apartó del master prompt

- **Serwist en vez de `next-pwa`** (Fase 7): `next-pwa` está sin mantenimiento y no soporta
  bien App Router en Next 15.
- **Supabase en la nube en vez de local**: la máquina de desarrollo no tiene Docker.
- **7.11 Configuración** no está asignada a ninguna fase en el master prompt. Queda marcada
  para la Fase 3, porque los fees por canal hacen falta al registrar la primera venta.

### Aplicado en el proyecto

- Migración `20260824120000` aplicada en `yxbqyqptzandmwbwennm` (Postgres 17, us-east-1).
- `lib/supabase/database.types.ts` regenerado desde el esquema real. Los atajos `UserRole`
  y `Profile` viven en `lib/supabase/types.ts` porque `gen:types` sobrescribe el generado.
- Auth: Site URL en `http://localhost:5190` y lista de redirecciones permitidas.
- Registro público **desactivado** tras crear la cuenta de `owner`. La anon key va en el
  navegador por diseño, así que con el signup abierto cualquiera podía crearse una cuenta
  y entrar al panel como `viewer`. Los usuarios nuevos se crean por invitación.

### Verificado de punta a punta

Con una sesión real: `/auth/confirm` canjea el token y entra al panel; el trigger asignó
`owner` al primer usuario; el sidebar aparece en escritorio y el bottom nav en móvil, cada
uno en su breakpoint; el sheet de "Más" abre con los seis módulos secundarios y cierra con
Escape; el rol y el correo salen en el header; y al cerrar sesión el panel vuelve a rebotar
a login. Sin errores de consola ni de servidor.

### Publicado

- Repo en `llugosubs/p8collectsoftware`, autenticado por llave SSH.
- Producción en **https://p8-collects-os.vercel.app**, región `iad1` — la misma que la base
  de datos, para no pagar latencia entre continentes en cada consulta.
- Variables de entorno cargadas en producción, preview y desarrollo. El service role key
  **no** se subió: todavía ningún código lo usa, y un secreto sin uso en producción es solo
  superficie de ataque. Entra cuando la Fase 1 lo necesite.
- La URL de producción quedó registrada en las redirecciones de Supabase Auth.

Repo conectado a Vercel: cada push a `main` despliega a producción y cada PR levanta su
preview.

**Fase 0 cerrada.**
