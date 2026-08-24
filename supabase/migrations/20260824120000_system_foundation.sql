-- ============================================================================
-- 0001 — Fundación de sistema (Fase 0)
--
-- Solo lo que hace falta para autenticar y autorizar: roles, perfiles, el helper
-- que usarán todas las políticas de la Fase 1, y los dos buckets de Storage.
-- Ninguna tabla de negocio entra aquí.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------------
create type public.user_role as enum ('owner', 'admin', 'staff', 'viewer', 'consignor');

-- ---------------------------------------------------------------------------
-- updated_at automático, reutilizable por toda tabla de aquí en adelante
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table public.profiles (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  role         public.user_role not null default 'viewer',
  display_name text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.profiles is
  'Rol y datos de presentación de cada usuario. El rol vive aquí, no en auth.users.';

create index profiles_role_idx on public.profiles (role);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Alta automática de perfil al registrarse.
--
-- El primer usuario que entra al sistema es el dueño; cualquiera después nace
-- como 'viewer' y el dueño lo asciende a mano. Así el arranque no necesita
-- ningún paso manual en SQL, y nadie se cuela con permisos por accidente.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  assigned_role public.user_role;
begin
  if exists (select 1 from public.profiles) then
    assigned_role := 'viewer';
  else
    assigned_role := 'owner';
  end if;

  insert into public.profiles (user_id, role, display_name)
  values (
    new.id,
    assigned_role,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name')
  )
  on conflict (user_id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Helper de rol.
--
-- SECURITY DEFINER a propósito: si una política sobre profiles consultara
-- profiles con RLS activo, se llamaría a sí misma sin fin. Esta función lee la
-- tabla por fuera de RLS y corta la recursión. Todas las políticas de la Fase 1
-- se apoyan en ella.
-- ---------------------------------------------------------------------------
create or replace function public.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where user_id = auth.uid();
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_user_role() in ('owner', 'admin'), false);
$$;

-- Puede entrar al panel administrativo. 'consignor' no: tiene su propio portal (Fase 6).
create or replace function public.can_access_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.current_user_role() in ('owner', 'admin', 'staff', 'viewer'), false);
$$;

-- ---------------------------------------------------------------------------
-- RLS sobre profiles
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;

create policy "profiles: cada quien ve el suyo"
  on public.profiles for select
  to authenticated
  using (user_id = auth.uid());

create policy "profiles: owner y admin ven todos"
  on public.profiles for select
  to authenticated
  using (public.is_admin());

create policy "profiles: cada quien edita su nombre"
  on public.profiles for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "profiles: owner y admin editan cualquiera"
  on public.profiles for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- El insert lo hace el trigger (security definer). Nadie inserta perfiles a mano.
-- Tampoco hay política de delete: el perfil muere con el usuario, por cascada.

-- ---------------------------------------------------------------------------
-- Nadie se auto-asciende.
--
-- La política de "cada quien edita su nombre" permitiría cambiarse el rol en la
-- misma sentencia. Este trigger lo impide a nivel de fila.
-- ---------------------------------------------------------------------------
create or replace function public.prevent_self_role_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is distinct from old.role and not public.is_admin() then
    raise exception 'No puedes cambiar tu propio rol.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger profiles_prevent_self_role_escalation
  before update on public.profiles
  for each row execute function public.prevent_self_role_escalation();

-- ---------------------------------------------------------------------------
-- Storage
--   cards → público, fotos de inventario y de la tienda (con transformaciones)
--   docs  → privado, comprobantes de pago, contratos de consignación, exports
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('cards', 'cards', true,  10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/avif']),
  ('docs',  'docs',  false, 20971520, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

create policy "cards: lectura pública"
  on storage.objects for select
  to public
  using (bucket_id = 'cards');

create policy "cards: escritura del equipo"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'cards' and public.can_access_admin());

create policy "cards: actualización del equipo"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'cards' and public.can_access_admin());

create policy "cards: borrado de owner y admin"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'cards' and public.is_admin());

create policy "docs: lectura de owner y admin"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'docs' and public.is_admin());

create policy "docs: escritura de owner y admin"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'docs' and public.is_admin());

create policy "docs: borrado de owner y admin"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'docs' and public.is_admin());
