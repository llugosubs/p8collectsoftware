# Changelog

Formato: una entrada por fase. Ver las fases en la sección 11 del
[master prompt](MASTER_PROMPT.md).

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
