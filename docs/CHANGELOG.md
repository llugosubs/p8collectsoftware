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

### Pendiente para cerrar la fase

- Credenciales del proyecto Supabase, para aplicar la migración y regenerar los tipos.
- Proyecto de Vercel conectado al repo.
- Verificar el panel con una sesión real (hoy solo se pudo comprobar que un visitante
  anónimo termina en el login).
