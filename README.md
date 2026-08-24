# P8 Collects OS

Sistema administrativo integral y tienda online para **P8 Collects**: compraventa de cartas
coleccionables graduadas y raw, cajas selladas y breaks, con operación binacional
Venezuela / EE. UU. y contabilidad en dos monedas.

- **Especificación**: [`docs/MASTER_PROMPT.md`](docs/MASTER_PROMPT.md) — fuente de verdad del
  alcance, el modelo de datos y las reglas de negocio.
- **Convenciones y decisiones**: [`CLAUDE.md`](CLAUDE.md).
- **Historial**: [`docs/CHANGELOG.md`](docs/CHANGELOG.md).

## Arrancar en local

```bash
npm install
cp .env.example .env.local   # y llenar los valores de Supabase
npm run dev
```

La app abre en `http://localhost:3000`:

| Ruta     | Qué es                                    |
| -------- | ----------------------------------------- |
| `/`      | Tienda pública en español                 |
| `/en`    | Tienda pública en inglés                  |
| `/login` | Acceso por enlace mágico                  |
| `/admin` | Panel administrativo (exige sesión y rol) |

## Comandos

```bash
npm run dev          # desarrollo
npm run build        # build de producción
npm run lint         # ESLint
npm run typecheck    # TypeScript strict
npm test             # Vitest — reglas de negocio en /lib/domain
npm run test:e2e     # Playwright (necesita un Supabase real)
npm run format       # Prettier
```

Base de datos:

```bash
npx supabase link --project-ref <ref>
npm run db:push      # aplicar migraciones
npm run gen:types    # regenerar lib/supabase/database.types.ts
```

## Cómo está organizado

```
app/(admin)     panel administrativo, login y rutas de auth — solo español
app/(store)     tienda pública bilingüe bajo /[locale]
lib/domain      reglas de negocio puras, con tests. La UI no calcula.
lib/supabase    clientes server/browser, middleware de sesión, tipos generados
lib/validations schemas Zod
i18n            configuración de next-intl
messages        textos es/en — ningún copy vive dentro de un componente
supabase        migraciones SQL versionadas, edge functions, seed
```

## Dinero

`numeric(14,4)` en Postgres, `Decimal.js` en la aplicación, nunca `float`. Todo pasa por
[`lib/domain/money.ts`](lib/domain/money.ts). Cuatro decimales porque hay cifras que no son
precios — tasas, porcentajes de fee, costos prorrateados entre líneas — y al cobrar se
redondea a dos.
