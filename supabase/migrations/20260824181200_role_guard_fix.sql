-- ============================================================================
-- 0014 — Corrección del guardián de roles (Fase 1)
--
-- La versión de la Fase 0 bloqueaba TODO cambio de rol hecho por quien no fuera
-- admin — y "quien no es admin" incluye a nadie: una migración, el service role
-- o el SQL Editor corren sin sesión, así que `current_user_role()` devuelve
-- null y la guardia los tomaba por intrusos. Resultado: era imposible ascender
-- a un usuario desde el backend, que es justamente como se crea el segundo
-- administrador.
--
-- Lo que la regla quería decir es más estrecho: nadie se asciende a sí mismo.
-- Que un `staff` ascienda a otro ya lo impide el RLS, que solo lo deja editar
-- su propia fila.
-- ============================================================================

create or replace function public.prevent_self_role_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role
     and auth.uid() is not null      -- hay una sesión de usuario detrás
     and auth.uid() = old.user_id    -- y está editando su propia fila
     and not public.is_admin()
  then
    raise exception 'No puedes cambiar tu propio rol.' using errcode = '42501';
  end if;

  return new;
end;
$$;

comment on function public.prevent_self_role_escalation() is
  'Impide la auto-promoción. No estorba a las operaciones sin sesión (migraciones, service role).';
