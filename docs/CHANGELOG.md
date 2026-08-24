# Changelog

Formato: una entrada por fase. Ver las fases en la sección 11 del
[master prompt](MASTER_PROMPT.md).

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

Las migraciones y 21 aserciones de RLS se corrieron contra el proyecto real **dentro de una
transacción revertida**, así que nada quedó escrito. Ese ensayo encontró los dos errores de
arriba antes de aplicar nada. El arnés se validó mutando una aserción para confirmar que
sabe fallar.

Contra la API real, con la anon key: pedir `min_price`, `acquisitions` o `item_costs`
devuelve 42501; pedir `list_price` devuelve 200.

### Pendiente

- **Docker Desktop.** Sin él no corren los pgTAP (`supabase test db`) ni el seed, que se
  niega a tocar nada que no sea una base local. Los tests están escritos en
  `supabase/tests/`; el seed, en `supabase/seed/`.
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
