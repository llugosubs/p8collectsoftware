# P8 Collects OS

Sistema administrativo integral + tienda online para **P8 Collects** (Luis Lugo, Caracas):
compraventa de cartas coleccionables graduadas y raw, cajas selladas y breaks, con
operación binacional Venezuela / EE. UU. y contabilidad en dos monedas (USD y Bs.).

**La especificación completa vive en [`docs/MASTER_PROMPT.md`](docs/MASTER_PROMPT.md).**
Ese archivo es la fuente de verdad del alcance, el modelo de datos y las reglas de negocio.
Si algo de este CLAUDE.md contradice al master prompt, gana el master prompt.

Superficies de la app:

- `app/(admin)` — panel administrativo protegido, PWA, mobile-first, UI en español (VE).
- `app/(store)` — tienda pública, SSR/ISR, SEO, bilingüe ES/EN.
- `app/api` — webhooks (Stripe, Resend) y endpoints del asistente IA.

---

## Comandos

```bash
npm run dev            # Next.js en desarrollo
npm run build          # build de producción
npm run lint           # ESLint
npm run typecheck      # tsc --noEmit (TypeScript strict)
npm test               # Vitest (unit) — reglas de /lib/domain
npm run test:e2e       # Playwright (flujos críticos)
```

Supabase (CLI contra el proyecto en la nube — ver _Decisiones tomadas_):

```bash
npx supabase link --project-ref <ref>            # enlazar el repo con el proyecto
npx supabase migration new <nombre>              # nueva migración SQL versionada
npx supabase db push                             # aplicar migraciones al proyecto
npx supabase gen types typescript --linked > lib/supabase/database.types.ts
npm run seed                                     # datos de arranque (sección 13 del master prompt)
npm run test:rls                                 # pgTAP: políticas RLS por rol
```

El CLI se instala como dependencia de desarrollo (`npm i -D supabase`), no global.

---

## Convenciones

**Idioma.** Código, nombres de tablas, columnas, funciones y commits en **inglés**.
Todo texto visible al usuario en **español (Venezuela)** por defecto, vía `next-intl`.
Nunca hardcodear copy en los componentes: todo pasa por los archivos de i18n desde el
primer día. La tienda pública además tiene inglés con selector.

**Dinero.** `numeric(14,4)` en Postgres, `Decimal.js` en la aplicación. **Nunca `float`,
nunca `number` de JavaScript para montos.** Toda cifra se guarda en su moneda original
más su equivalente en USD y la tasa usada. La moneda base de los reportes es USD.

**Reglas de negocio.** Viven **solo** en `/lib/domain`, como funciones puras con tests
unitarios (prorrateo, costo de adquisición, margen, ROI, FX, comisión de consignación,
reparto de costo en breaks). La UI no calcula: consume el resultado. Un componente que
hace aritmética de dinero es un bug.

**Validación y mutaciones.** Todo input pasa por un schema Zod en `/lib/validations`,
validado en cliente **y** en servidor. Toda mutación pasa por un Server Action que
valida, ejecuta y registra en `audit_log`. Nunca el service role key desde el cliente.

**TypeScript.** `strict` activo. **Nunca `any`** — si el tipo no se conoce, `unknown` con
narrowing. Los tipos de la base se generan con `supabase gen types`, no se escriben a mano.

**Base de datos.** RLS activo en todas las tablas, sin excepción. Soft delete
(`deleted_at`) en entidades de negocio. **Una migración por cambio**, versionada en
`supabase/migrations`, nunca editar una migración ya aplicada.

**Commits.** Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`,
`refactor:`). Un commit por unidad de trabajo coherente.

**Identidad visual.** Limpio, blanco con acento, tipografía Montserrat. El monograma P8 y
el wordmark **nunca se usan juntos**. Logo en SVG.

**Secretos.** Todas las variables documentadas en `.env.example` con valores de ejemplo.
Nunca commitear un secreto real.

---

## Regla de trabajo

1. **Antes de cada fase**: entrar en plan mode y presentar el plan. No se escribe código
   hasta que el dueño apruebe.
2. **Durante la fase**: si el master prompt no cubre algo, proponer la decisión con una
   justificación breve y esperar aprobación. **No inventar reglas de negocio.**
3. **Al cerrar cada fase**: tests en verde, migraciones aplicadas, commit,
   `docs/CHANGELOG.md` actualizado, y un resumen de lo hecho y lo pendiente.

Fases (detalle en la sección 11 del master prompt):

| Fase | Contenido                                                                  | Estado                      |
| ---- | -------------------------------------------------------------------------- | --------------------------- |
| 0    | Fundación: repo, Next.js, Supabase, Auth, roles, layouts, CI, Sentry, i18n | hecha — falta push y Vercel |
| 1    | Modelo de datos completo, RLS, tipos, seed, pgTAP                          | pendiente                   |
| 2    | Inventario + Compras + Importador de Excel                                 | pendiente                   |
| 3    | Ventas + Clientes + Tesorería + Cuentas pendientes                         | pendiente                   |
| 4    | Tienda pública, Stripe, emails, SEO                                        | pendiente                   |
| 5    | Dashboard + Reportes + Asistente IA                                        | pendiente                   |
| 6    | Consignación y portal de consignante                                       | pendiente                   |
| 7    | Endurecimiento: PWA offline, e2e, Lighthouse, backups, documentación       | pendiente                   |

---

## Decisiones tomadas (24 ago 2026)

Estas se decidieron al arrancar y se apartan del master prompt donde se indica. Cualquier
cambio requiere aprobación explícita del dueño.

- **Base de datos: proyecto Supabase gratis en la nube**, no stack local. Esta Mac no tiene
  Docker y `supabase start` lo exige. Se migra a **Pro** en la Fase 7, cuando entra el PITR
  de los backups (sección 9 del master prompt).
- **PWA con Serwist, no `next-pwa`** (se aparta de la sección 3). `next-pwa` está sin
  mantenimiento y no soporta bien App Router en Next 15. Serwist es su sucesor directo y da
  el mismo resultado: instalable en iOS/Android e inventario cacheado offline.
- **`p8-tracker` archivado** en `../_archivo/p8-tracker`. Era un prototipo local
  (Next.js + Prisma/SQLite) con 3 cartas de demostración, sin inventario real. No se migra
  nada. Su lección sobre dinero sigue vigente y aquí se cumple por otra vía: Postgres tiene
  `numeric` exacto, así que `numeric(14,4)` + `Decimal.js` es seguro donde SQLite no lo era.
- **Git, GitHub y Vercel desde la Fase 0**, con preview deploys por PR.

---

## Decisiones abiertas (requieren respuesta del dueño)

Ninguna de estas se resuelve por cuenta propia. Bloquean la fase indicada.

1. **Proyecto de Vercel** (bloquea el deploy). El repo existe
   (`llugosubs/p8collectsoftware`); falta conectar Vercel y agregar su URL a la lista de
   redirecciones de Auth.
2. **Datos reales del lote de Alt de agosto 2026** (bloquea Fase 1). El master prompt
   referencia `docs/seed-alt-ago-2026.csv` con ~15 cartas PSA 10; ese archivo no existe.
   Hace falta el Excel o la lista real, con hammer, premium, fee, envío y aduana.
3. **Cuenta Stripe** (bloquea Fase 4). Stripe requiere una entidad legal; ¿existe la
   estructura en EE. UU. con cuenta bancaria para recibir? Sin eso, la tienda arranca solo
   con métodos manuales (Zelle, Pago Móvil, Binance) y Stripe queda para después.
4. **Datos de cobro reales** (bloquea Fase 4). Titular y correo de Zelle, banco y teléfono
   de Pago Móvil, cuenta en Bs., wallet de Binance. Van cifrados en `settings`, no en el
   repositorio.
5. **Fuente de la tasa BCV** (bloquea Fase 3). El BCV no publica una API estable. Las
   opciones son scraping del sitio oficial (frágil, se rompe sin aviso), una API pública de
   terceros (depende de un tercero), o carga manual diaria con recordatorio. Recomendación:
   scraping con fallback a manual y notificación cuando falle. Confirmar.
6. **API de PSA** (bloquea la precarga por cert en Fase 2). La API pública de PSA exige
   token y tiene límite de consultas. ¿Hay cuenta? Si no, el campo de cert se carga a mano
   y el enriquecimiento automático queda fuera de la Fase 2.
7. **Alcance de `staff` sobre los costos** (bloquea Fase 1). "`staff` no ve costos" se
   implementa ocultando `cost_basis`, `acquisitions` y `transactions` por RLS. Confirmar si
   `staff` tampoco ve el margen de una venta (se deduce del costo) — probablemente sí.
8. **Dominio de la tienda** (bloquea Fase 4). ¿Qué dominio, y quién lo administra?
9. **Estado `consumed` en breaks** (bloquea Fase 1). La sección 5.3 dice que la caja pasa
   a `sold` o `consumed`, pero `consumed` no está en el enum de `items.status` de la
   sección 5.1. Recomendación: agregarlo al enum, porque una caja abierta para un break no
   se vendió. Confirmar.
