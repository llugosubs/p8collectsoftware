# Changelog

Formato: una entrada por fase. Ver las fases en la sección 11 del
[master prompt](MASTER_PROMPT.md).

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
