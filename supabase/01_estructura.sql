-- =====================================================================
-- INVENTARIO DEL HOGAR · Estructura de datos (v1)
-- Pegar entero en Supabase > SQL Editor > New query > Run.
-- Se puede ejecutar una sola vez sobre un proyecto vacío.
--
-- Idea general:
--  * Todo el dinero se guarda en CÉNTIMOS (enteros) para evitar errores
--    de redondeo. 650,50 € = 65050.
--  * La app solo LEE las tablas directamente. Todo lo que escribe pasa
--    por funciones (create_asset, respond, ...) que comprueban las reglas.
--  * Confirman los "participantes" de cada cosa (los implicados), no
--    todo el hogar. Cada edición sube la versión y hay que reconfirmar.
--  * Lo privado (visibility = 'implicados') solo lo ven sus participantes,
--    y eso lo impide la base de datos, no solo la pantalla.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- 1. PERSONAS
-- ---------------------------------------------------------------------
create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  email        text,
  avatar_url   text,
  created_at   timestamptz not null default now()
);

-- Crea el perfil automáticamente al registrarse.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name, email, avatar_url)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'full_name', ''),
             nullif(new.raw_user_meta_data->>'name', ''),
             split_part(coalesce(new.email, 'usuario'), '@', 1)),
    new.email,
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- 2. HOGARES
-- ---------------------------------------------------------------------
create table public.households (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (length(trim(name)) between 1 and 80),
  kind         text not null check (kind in ('pareja', 'piso')),
  status       text not null default 'activo'
               check (status in ('activo', 'disolviendo', 'disuelto')),
  invite_code  text not null unique
               default translate(encode(extensions.gen_random_bytes(9), 'base64'), '+/', '-_'),
  created_by   uuid not null references public.profiles(id),
  created_at   timestamptz not null default now(),
  dissolved_at timestamptz
);

-- ---------------------------------------------------------------------
-- 3. MIEMBROS (con fecha de entrada y de salida)
-- ---------------------------------------------------------------------
create table public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  role         text not null default 'miembro' check (role in ('admin', 'miembro')),
  joined_at    timestamptz not null default now(),
  left_at      timestamptz,
  primary key (household_id, user_id)
);

-- ---------------------------------------------------------------------
-- 4. BIENES
-- ---------------------------------------------------------------------
create table public.assets (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households(id) on delete cascade,
  name          text not null check (length(trim(name)) between 1 and 120),
  category      text,
  total_cents   bigint not null check (total_cents > 0),
  purchase_date date not null default current_date,
  visibility    text not null default 'hogar' check (visibility in ('hogar', 'implicados')),
  receipt_path  text,             -- foto del ticket (si no hay: "sin ticket")
  photo_path    text,             -- foto del objeto
  notes         text,
  -- futuro: lectura automática del ticket
  store_name    text,
  ocr_data      jsonb,
  status        text not null default 'pendiente'
                check (status in ('pendiente', 'confirmado', 'rechazado')),
  version       int  not null default 1,
  created_by    uuid not null references public.profiles(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index on public.assets (household_id);

-- ---------------------------------------------------------------------
-- 5. PARTICIPANTES Y APORTACIONES DE CADA BIEN
--    Un participante puede haber puesto 0 € (p. ej. en pareja, el otro
--    también confirma aunque no pagara). La suma debe cuadrar con el total.
-- ---------------------------------------------------------------------
create table public.asset_participants (
  asset_id     uuid not null references public.assets(id) on delete cascade,
  user_id      uuid not null references public.profiles(id),
  amount_cents bigint not null default 0 check (amount_cents >= 0),
  primary key (asset_id, user_id)
);

-- ---------------------------------------------------------------------
-- 6. PAGOS RECURRENTES (coche, hipoteca...)
--    Se pueden enlazar a un bien (asset_id): coche = entrada + cuotas.
-- ---------------------------------------------------------------------
create table public.recurring_plans (
  id                 uuid primary key default gen_random_uuid(),
  household_id       uuid not null references public.households(id) on delete cascade,
  asset_id           uuid references public.assets(id) on delete set null,
  concept            text not null check (length(trim(concept)) between 1 and 120),
  monthly_cents      bigint not null check (monthly_cents > 0),
  start_date         date not null,   -- se guarda como día 1 del mes
  installments_count int check (installments_count is null or installments_count > 0), -- null = sin fin
  visibility         text not null default 'hogar' check (visibility in ('hogar', 'implicados')),
  status             text not null default 'pendiente'
                     check (status in ('pendiente', 'confirmado', 'rechazado', 'finalizado')),
  version            int  not null default 1,
  created_by         uuid not null references public.profiles(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index on public.recurring_plans (household_id);

create table public.recurring_plan_shares (
  plan_id      uuid not null references public.recurring_plans(id) on delete cascade,
  user_id      uuid not null references public.profiles(id),
  amount_cents bigint not null default 0 check (amount_cents >= 0),
  primary key (plan_id, user_id)
);

-- ---------------------------------------------------------------------
-- 7. CUOTAS (una por mes) y lo que se pagó de verdad
-- ---------------------------------------------------------------------
create table public.installments (
  id             uuid primary key default gen_random_uuid(),
  plan_id        uuid not null references public.recurring_plans(id) on delete cascade,
  household_id   uuid not null references public.households(id) on delete cascade,
  period         date not null,      -- día 1 del mes
  seq            int  not null,      -- nº de cuota (1, 2, 3...)
  amount_cents   bigint not null check (amount_cents >= 0),
  is_exception   boolean not null default false,
  exception_note text,
  status         text not null default 'pendiente'
                 check (status in ('pendiente', 'confirmado', 'rechazado')),
  version        int  not null default 1,
  created_at     timestamptz not null default now(),
  unique (plan_id, period)
);
create index on public.installments (household_id, period);

create table public.installment_payments (
  installment_id uuid not null references public.installments(id) on delete cascade,
  user_id        uuid not null references public.profiles(id),
  amount_cents   bigint not null default 0 check (amount_cents >= 0),
  primary key (installment_id, user_id)
);

-- ---------------------------------------------------------------------
-- 8. DISOLUCIONES (total o parcial = alguien se va del piso)
-- ---------------------------------------------------------------------
create table public.dissolutions (
  id              uuid primary key default gen_random_uuid(),
  household_id    uuid not null references public.households(id) on delete cascade,
  kind            text not null check (kind in ('total', 'parcial')),
  leaving_user_id uuid references public.profiles(id),  -- solo en parcial
  status          text not null default 'pendiente'
                  check (status in ('pendiente', 'confirmado', 'rechazado', 'cancelado')),
  version         int not null default 1,
  created_by      uuid not null references public.profiles(id),
  created_at      timestamptz not null default now(),
  completed_at    timestamptz,
  check ((kind = 'parcial') = (leaving_user_id is not null))
);

-- ---------------------------------------------------------------------
-- 9. CONFIRMACIONES (una sola tabla para todo)
--    Guarda quién dijo "Confirmar" o "No es así", con qué comentario,
--    sobre qué versión y cuándo. Nunca se borra: es el historial.
-- ---------------------------------------------------------------------
create table public.confirmations (
  id              uuid primary key default gen_random_uuid(),
  household_id    uuid not null references public.households(id) on delete cascade,
  subject_type    text not null
                  check (subject_type in ('asset', 'recurring_plan', 'installment', 'dissolution')),
  subject_id      uuid not null,
  subject_version int  not null,
  user_id         uuid not null references public.profiles(id),
  decision        text not null check (decision in ('confirmar', 'rechazar')),
  comment         text,
  created_at      timestamptz not null default now(),
  unique (subject_type, subject_id, subject_version, user_id)
);
create index on public.confirmations (subject_type, subject_id);

-- ---------------------------------------------------------------------
-- 10. HISTORIAL DE CAMBIOS (foto de cada versión anterior)
-- ---------------------------------------------------------------------
create table public.change_log (
  id           bigserial primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  subject_type text not null,
  subject_id   uuid not null,
  version      int,
  action       text not null,      -- creado, editado, excepcion, borrado...
  snapshot     jsonb,
  actor_id     uuid references public.profiles(id),
  created_at   timestamptz not null default now()
);
create index on public.change_log (subject_type, subject_id);

-- Hueco reservado para el futuro (no se usan aún):
--   valuations          -> valor actual de cada bien (acordado / IA)
--   keep_wishes         -> "me lo quedo" al disolver
--   settlement_proposals-> repartos con compensaciones
--   expenses            -> gastos del día a día
-- Se añadirán como tablas nuevas que apuntan a assets / households,
-- y usarán la misma tabla de confirmaciones. No hace falta tocar nada de hoy.

-- =====================================================================
-- FUNCIONES DE AYUDA (quién es miembro, quién participa, quién ve qué)
-- =====================================================================

create or replace function public.is_member(h uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from household_members
    where household_id = h and user_id = auth.uid() and left_at is null
  );
$$;

-- Antiguos miembros (que salieron) pueden seguir LEYENDO el hogar.
create or replace function public.is_or_was_member(h uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from household_members where household_id = h and user_id = auth.uid()
  );
$$;

create or replace function public.can_see_asset(a uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from assets x
    where x.id = a
      and is_or_was_member(x.household_id)
      and (x.visibility = 'hogar'
           or exists (select 1 from asset_participants p where p.asset_id = x.id and p.user_id = auth.uid()))
  );
$$;

create or replace function public.can_see_plan(pl uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from recurring_plans x
    where x.id = pl
      and is_or_was_member(x.household_id)
      and (x.visibility = 'hogar'
           or exists (select 1 from recurring_plan_shares s where s.plan_id = x.id and s.user_id = auth.uid()))
  );
$$;

create or replace function public.can_see_subject(t text, s uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case t
    when 'asset'          then can_see_asset(s)
    when 'recurring_plan' then can_see_plan(s)
    when 'installment'    then (select can_see_plan(plan_id) from installments where id = s)
    when 'dissolution'    then (select is_or_was_member(household_id) from dissolutions where id = s)
    else false
  end;
$$;

-- Quiénes tienen que confirmar algo.
create or replace function public.subject_participants(t text, s uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  select user_id from asset_participants where t = 'asset' and asset_id = s
  union
  select user_id from recurring_plan_shares where t = 'recurring_plan' and plan_id = s
  union
  select sh.user_id from installments i join recurring_plan_shares sh on sh.plan_id = i.plan_id
   where t = 'installment' and i.id = s
  union
  select ip.user_id from installment_payments ip where t = 'installment' and ip.installment_id = s
  union
  select m.user_id from dissolutions d join household_members m on m.household_id = d.household_id
   where t = 'dissolution' and d.id = s and m.left_at is null;
$$;

-- Recalcula el estado: rechazado si alguien dijo "No es así",
-- confirmado si TODOS los participantes confirmaron la versión actual.
create or replace function public.recompute_status(t text, s uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v int; total int; yes int; no int; new_status text; d record;
begin
  v := case t
    when 'asset'          then (select version from assets where id = s)
    when 'recurring_plan' then (select version from recurring_plans where id = s)
    when 'installment'    then (select version from installments where id = s)
    when 'dissolution'    then (select version from dissolutions where id = s)
  end;

  select count(*) into total from subject_participants(t, s);
  select count(*) filter (where decision = 'confirmar'),
         count(*) filter (where decision = 'rechazar')
    into yes, no
    from confirmations c
   where c.subject_type = t and c.subject_id = s and c.subject_version = v
     and c.user_id in (select subject_participants(t, s));

  new_status := case when no > 0 then 'rechazado'
                     when total > 0 and yes >= total then 'confirmado'
                     else 'pendiente' end;

  if t = 'asset' then
    update assets set status = new_status where id = s;
  elsif t = 'recurring_plan' then
    update recurring_plans set status = new_status where id = s and status <> 'finalizado';
  elsif t = 'installment' then
    update installments set status = new_status where id = s;
  elsif t = 'dissolution' then
    select * into d from dissolutions where id = s;
    if d.status = 'cancelado' then return d.status; end if;
    update dissolutions set status = new_status,
           completed_at = case when new_status = 'confirmado' then now() end
     where id = s;
    if new_status = 'confirmado' then
      if d.kind = 'total' then
        update households set status = 'disuelto', dissolved_at = now() where id = d.household_id;
      else
        update household_members set left_at = now()
         where household_id = d.household_id and user_id = d.leaving_user_id;
      end if;
    elsif new_status = 'rechazado' and d.kind = 'total' then
      update households set status = 'activo' where id = d.household_id and status = 'disolviendo';
    end if;
  end if;
  return new_status;
end $$;

-- Comprueba que el hogar existe, que soy miembro y que no está congelado.
create or replace function public.assert_can_edit(h uuid)
returns void language plpgsql stable security definer set search_path = public as $$
declare st text;
begin
  if auth.uid() is null then raise exception 'Tienes que iniciar sesión'; end if;
  if not is_member(h) then raise exception 'No eres miembro de este hogar'; end if;
  select status into st from households where id = h;
  if st <> 'activo' then
    raise exception 'El hogar está congelado (%) y ya no se puede editar', st;
  end if;
end $$;

-- Valida la lista de aportaciones: [{"user_id": "...", "amount_cents": 50000}, ...]
create or replace function public.validate_shares(h uuid, shares jsonb, expected bigint)
returns void language plpgsql stable security definer set search_path = public as $$
declare total bigint; n int; nd int; bad int;
begin
  if shares is null or jsonb_typeof(shares) <> 'array' or jsonb_array_length(shares) = 0 then
    raise exception 'Indica al menos una persona';
  end if;
  select coalesce(sum((e->>'amount_cents')::bigint), 0), count(*), count(distinct e->>'user_id'),
         count(*) filter (where (e->>'amount_cents')::bigint < 0)
    into total, n, nd, bad
    from jsonb_array_elements(shares) e;
  if bad > 0 then raise exception 'Las aportaciones no pueden ser negativas'; end if;
  if nd <> n then raise exception 'Hay una persona repetida'; end if;
  if total <> expected then
    raise exception 'Las aportaciones suman % € y el total es % €. Tienen que cuadrar.',
      replace(to_char(total / 100.0, 'FM999999990.00'), '.', ','),
      replace(to_char(expected / 100.0, 'FM999999990.00'), '.', ',');
  end if;
  if exists (
    select 1 from jsonb_array_elements(shares) e
     where not exists (select 1 from household_members m
                        where m.household_id = h and m.user_id = (e->>'user_id')::uuid
                          and m.left_at is null)
  ) then
    raise exception 'Alguna persona no es miembro activo del hogar';
  end if;
end $$;

-- =====================================================================
-- ACCIONES DE LA APP (lo único que puede escribir datos)
-- =====================================================================

-- Crear hogar (quien lo crea entra como admin).
create or replace function public.create_household(p_name text, p_kind text)
returns uuid language plpgsql security definer set search_path = public as $$
declare h uuid;
begin
  if auth.uid() is null then raise exception 'Tienes que iniciar sesión'; end if;
  insert into households (name, kind, created_by) values (trim(p_name), p_kind, auth.uid())
  returning id into h;
  insert into household_members (household_id, user_id, role) values (h, auth.uid(), 'admin');
  return h;
end $$;

-- Ver a qué hogar lleva un enlace de invitación (antes de unirse).
create or replace function public.invite_preview(p_code text)
returns table (household_id uuid, name text, kind text, members int)
language sql stable security definer set search_path = public as $$
  select h.id, h.name, h.kind,
         (select count(*)::int from household_members m where m.household_id = h.id and m.left_at is null)
    from households h where h.invite_code = p_code and h.status = 'activo';
$$;

-- Unirse con el enlace de invitación.
create or replace function public.join_household(p_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare h record; n int;
begin
  if auth.uid() is null then raise exception 'Tienes que iniciar sesión'; end if;
  select * into h from households where invite_code = p_code;
  if h.id is null then raise exception 'El enlace de invitación no es válido'; end if;
  if h.status <> 'activo' then raise exception 'Este hogar ya no admite miembros'; end if;
  if exists (select 1 from household_members where household_id = h.id and user_id = auth.uid() and left_at is null) then
    return h.id;  -- ya estaba dentro
  end if;
  select count(*) into n from household_members where household_id = h.id and left_at is null;
  if h.kind = 'pareja' and n >= 2 then raise exception 'Este hogar de pareja ya está completo'; end if;
  insert into household_members (household_id, user_id) values (h.id, auth.uid())
  on conflict (household_id, user_id) do update set left_at = null, joined_at = now();
  return h.id;
end $$;

-- Generar un enlace de invitación nuevo (invalida el anterior).
create or replace function public.rotate_invite_code(p_household uuid)
returns text language plpgsql security definer set search_path = public as $$
declare c text;
begin
  perform assert_can_edit(p_household);
  update households set invite_code = translate(encode(extensions.gen_random_bytes(9), 'base64'), '+/', '-_')
   where id = p_household returning invite_code into c;
  return c;
end $$;

-- Añadir un bien. Quien lo añade, si participa, queda confirmado automáticamente.
create or replace function public.create_asset(
  p_household uuid, p_name text, p_total_cents bigint, p_purchase_date date,
  p_shares jsonb, p_visibility text default 'hogar',
  p_receipt_path text default null, p_photo_path text default null,
  p_category text default null, p_notes text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare a uuid;
begin
  perform assert_can_edit(p_household);
  perform validate_shares(p_household, p_shares, p_total_cents);
  insert into assets (household_id, name, total_cents, purchase_date, visibility,
                      receipt_path, photo_path, category, notes, created_by)
  values (p_household, trim(p_name), p_total_cents, coalesce(p_purchase_date, current_date),
          coalesce(p_visibility, 'hogar'), p_receipt_path, p_photo_path, p_category, p_notes, auth.uid())
  returning id into a;
  insert into asset_participants (asset_id, user_id, amount_cents)
  select a, (e->>'user_id')::uuid, (e->>'amount_cents')::bigint from jsonb_array_elements(p_shares) e;
  if exists (select 1 from asset_participants where asset_id = a and user_id = auth.uid()) then
    insert into confirmations (household_id, subject_type, subject_id, subject_version, user_id, decision)
    values (p_household, 'asset', a, 1, auth.uid(), 'confirmar');
  end if;
  insert into change_log (household_id, subject_type, subject_id, version, action, actor_id)
  values (p_household, 'asset', a, 1, 'creado', auth.uid());
  perform recompute_status('asset', a);
  return a;
end $$;

-- Editar un bien: guarda la versión anterior, sube la versión
-- y vuelve a "pendiente" para que todos los implicados reconfirmen.
create or replace function public.update_asset(
  p_asset uuid, p_name text, p_total_cents bigint, p_purchase_date date,
  p_shares jsonb, p_visibility text,
  p_receipt_path text, p_photo_path text,
  p_category text default null, p_notes text default null)
returns void language plpgsql security definer set search_path = public as $$
declare x assets; snap jsonb;
begin
  select * into x from assets where id = p_asset;
  if x.id is null or not can_see_asset(p_asset) then raise exception 'Bien no encontrado'; end if;
  perform assert_can_edit(x.household_id);
  perform validate_shares(x.household_id, p_shares, p_total_cents);
  snap := to_jsonb(x) || jsonb_build_object('participants',
            (select jsonb_agg(jsonb_build_object('user_id', user_id, 'amount_cents', amount_cents))
               from asset_participants where asset_id = p_asset));
  insert into change_log (household_id, subject_type, subject_id, version, action, snapshot, actor_id)
  values (x.household_id, 'asset', p_asset, x.version, 'editado', snap, auth.uid());

  update assets set name = trim(p_name), total_cents = p_total_cents,
         purchase_date = coalesce(p_purchase_date, purchase_date),
         visibility = coalesce(p_visibility, visibility),
         receipt_path = p_receipt_path, photo_path = p_photo_path,
         category = p_category, notes = p_notes,
         version = version + 1, status = 'pendiente', updated_at = now()
   where id = p_asset;
  delete from asset_participants where asset_id = p_asset;
  insert into asset_participants (asset_id, user_id, amount_cents)
  select p_asset, (e->>'user_id')::uuid, (e->>'amount_cents')::bigint from jsonb_array_elements(p_shares) e;
  if exists (select 1 from asset_participants where asset_id = p_asset and user_id = auth.uid()) then
    insert into confirmations (household_id, subject_type, subject_id, subject_version, user_id, decision)
    values (x.household_id, 'asset', p_asset, x.version + 1, auth.uid(), 'confirmar');
  end if;
  perform recompute_status('asset', p_asset);
end $$;

-- Borrar un bien: solo quien lo creó y solo si aún no está confirmado.
create or replace function public.delete_asset(p_asset uuid)
returns void language plpgsql security definer set search_path = public as $$
declare x assets;
begin
  select * into x from assets where id = p_asset;
  if x.id is null or not can_see_asset(p_asset) then raise exception 'Bien no encontrado'; end if;
  perform assert_can_edit(x.household_id);
  if x.created_by <> auth.uid() then raise exception 'Solo quien lo añadió puede borrarlo'; end if;
  if x.status = 'confirmado' then
    raise exception 'Un bien confirmado no se puede borrar';
  end if;
  insert into change_log (household_id, subject_type, subject_id, version, action, snapshot, actor_id)
  values (x.household_id, 'asset', p_asset, x.version, 'borrado', to_jsonb(x), auth.uid());
  delete from assets where id = p_asset;
end $$;

-- Confirmar o "No es así" sobre cualquier cosa.
create or replace function public.respond(
  p_subject_type text, p_subject_id uuid, p_decision text, p_comment text default null)
returns text language plpgsql security definer set search_path = public as $$
declare h uuid; v int; st text; hs text;
begin
  if auth.uid() is null then raise exception 'Tienes que iniciar sesión'; end if;
  if p_decision = 'rechazar' and coalesce(trim(p_comment), '') = '' then
    raise exception 'Cuéntales qué no está bien (el comentario es obligatorio)';
  end if;
  case p_subject_type
    when 'asset'          then select household_id, version, status into h, v, st from assets where id = p_subject_id;
    when 'recurring_plan' then select household_id, version, status into h, v, st from recurring_plans where id = p_subject_id;
    when 'installment'    then select household_id, version, status into h, v, st from installments where id = p_subject_id;
    when 'dissolution'    then select household_id, version, status into h, v, st from dissolutions where id = p_subject_id;
    else raise exception 'Tipo desconocido';
  end case;
  if h is null then raise exception 'No encontrado'; end if;
  if not exists (select 1 from subject_participants(p_subject_type, p_subject_id) u where u = auth.uid()) then
    raise exception 'No participas en esto, así que no te toca confirmarlo';
  end if;
  select status into hs from households where id = h;
  if hs = 'disuelto' then raise exception 'El hogar ya está disuelto'; end if;
  if p_subject_type = 'dissolution' and st = 'cancelado' then raise exception 'Esta disolución se canceló'; end if;

  insert into confirmations (household_id, subject_type, subject_id, subject_version, user_id, decision, comment)
  values (h, p_subject_type, p_subject_id, v, auth.uid(), p_decision, nullif(trim(p_comment), ''))
  on conflict (subject_type, subject_id, subject_version, user_id)
  do update set decision = excluded.decision, comment = excluded.comment, created_at = now();

  return recompute_status(p_subject_type, p_subject_id);
end $$;

-- ---------------------------------------------------------------------
-- Pagos recurrentes
-- ---------------------------------------------------------------------
create or replace function public.create_recurring_plan(
  p_household uuid, p_concept text, p_monthly_cents bigint, p_start_date date,
  p_installments_count int, p_shares jsonb,
  p_visibility text default 'hogar', p_asset uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare pl uuid;
begin
  perform assert_can_edit(p_household);
  perform validate_shares(p_household, p_shares, p_monthly_cents);
  if p_asset is not null and not exists (
      select 1 from assets where id = p_asset and household_id = p_household) then
    raise exception 'El bien enlazado no es de este hogar';
  end if;
  insert into recurring_plans (household_id, asset_id, concept, monthly_cents, start_date,
                               installments_count, visibility, created_by)
  values (p_household, p_asset, trim(p_concept), p_monthly_cents,
          date_trunc('month', p_start_date)::date, p_installments_count,
          coalesce(p_visibility, 'hogar'), auth.uid())
  returning id into pl;
  insert into recurring_plan_shares (plan_id, user_id, amount_cents)
  select pl, (e->>'user_id')::uuid, (e->>'amount_cents')::bigint from jsonb_array_elements(p_shares) e;
  if exists (select 1 from recurring_plan_shares where plan_id = pl and user_id = auth.uid()) then
    insert into confirmations (household_id, subject_type, subject_id, subject_version, user_id, decision)
    values (p_household, 'recurring_plan', pl, 1, auth.uid(), 'confirmar');
  end if;
  insert into change_log (household_id, subject_type, subject_id, version, action, actor_id)
  values (p_household, 'recurring_plan', pl, 1, 'creado', auth.uid());
  perform recompute_status('recurring_plan', pl);
  return pl;
end $$;

-- Borrar un pago recurrente: solo quien lo creó y solo si aún no está confirmado.
create or replace function public.delete_recurring_plan(p_plan uuid)
returns void language plpgsql security definer set search_path = public as $$
declare x recurring_plans;
begin
  select * into x from recurring_plans where id = p_plan;
  if x.id is null or not can_see_plan(p_plan) then raise exception 'Pago no encontrado'; end if;
  perform assert_can_edit(x.household_id);
  if x.created_by <> auth.uid() then raise exception 'Solo quien lo creó puede borrarlo'; end if;
  if x.status not in ('pendiente', 'rechazado') then
    raise exception 'Un pago recurrente confirmado no se puede borrar';
  end if;
  insert into change_log (household_id, subject_type, subject_id, version, action, snapshot, actor_id)
  values (x.household_id, 'recurring_plan', p_plan, x.version, 'borrado', to_jsonb(x), auth.uid());
  delete from recurring_plans where id = p_plan;
end $$;

-- Genera las cuotas que falten hasta el mes actual (la app lo llama al abrir).
create or replace function public.sync_installments(p_household uuid)
returns int language plpgsql security definer set search_path = public as $$
declare pl record; m date; n int := 0; k int; inst uuid;
begin
  if not is_member(p_household) then raise exception 'No eres miembro de este hogar'; end if;
  if (select status from households where id = p_household) <> 'activo' then return 0; end if;
  for pl in select * from recurring_plans where household_id = p_household and status = 'confirmado' loop
    m := pl.start_date; k := 1;
    while m <= date_trunc('month', current_date)::date
          and (pl.installments_count is null or k <= pl.installments_count) loop
      insert into installments (plan_id, household_id, period, seq, amount_cents)
      values (pl.id, p_household, m, k, pl.monthly_cents)
      on conflict (plan_id, period) do nothing
      returning id into inst;
      if inst is not null then
        insert into installment_payments (installment_id, user_id, amount_cents)
        select inst, user_id, amount_cents from recurring_plan_shares where plan_id = pl.id;
        n := n + 1; inst := null;
      end if;
      m := (m + interval '1 month')::date; k := k + 1;
    end loop;
    if pl.installments_count is not null and k > pl.installments_count then
      update recurring_plans set status = 'finalizado' where id = pl.id;
    end if;
  end loop;
  return n;
end $$;

-- Marcar una cuota como excepción (alguien no pagó o pagó distinto).
create or replace function public.set_installment_exception(
  p_installment uuid, p_payments jsonb, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare i installments; total bigint;
begin
  select * into i from installments where id = p_installment;
  if i.id is null or not can_see_plan(i.plan_id) then raise exception 'Cuota no encontrada'; end if;
  perform assert_can_edit(i.household_id);
  if not exists (select 1 from subject_participants('installment', p_installment) u where u = auth.uid()) then
    raise exception 'No participas en este pago';
  end if;
  select coalesce(sum((e->>'amount_cents')::bigint), 0) into total from jsonb_array_elements(p_payments) e;
  perform validate_shares(i.household_id, p_payments, total);
  insert into change_log (household_id, subject_type, subject_id, version, action, snapshot, actor_id)
  values (i.household_id, 'installment', p_installment, i.version, 'excepcion',
          to_jsonb(i) || jsonb_build_object('payments',
            (select jsonb_agg(to_jsonb(ip)) from installment_payments ip where ip.installment_id = p_installment)),
          auth.uid());
  update installments set amount_cents = total, is_exception = true, exception_note = p_note,
         version = version + 1, status = 'pendiente'
   where id = p_installment;
  delete from installment_payments where installment_id = p_installment;
  insert into installment_payments (installment_id, user_id, amount_cents)
  select p_installment, (e->>'user_id')::uuid, (e->>'amount_cents')::bigint from jsonb_array_elements(p_payments) e;
  insert into confirmations (household_id, subject_type, subject_id, subject_version, user_id, decision, comment)
  values (i.household_id, 'installment', p_installment, i.version + 1, auth.uid(), 'confirmar', p_note);
  perform recompute_status('installment', p_installment);
end $$;

-- "¿Se pagaron los pagos de noviembre?" -> confirma de un toque todas mis cuotas pendientes del mes.
create or replace function public.confirm_month(p_household uuid, p_period date)
returns int language plpgsql security definer set search_path = public as $$
declare i record; n int := 0;
begin
  if not is_member(p_household) then raise exception 'No eres miembro de este hogar'; end if;
  for i in
    select ins.id from installments ins
     where ins.household_id = p_household
       and ins.period = date_trunc('month', p_period)::date
       and ins.status = 'pendiente'
       and exists (select 1 from subject_participants('installment', ins.id) u where u = auth.uid())
       and not exists (select 1 from confirmations c
                        where c.subject_type = 'installment' and c.subject_id = ins.id
                          and c.subject_version = ins.version and c.user_id = auth.uid())
  loop
    perform respond('installment', i.id, 'confirmar');
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- Disolver (total) o salida de un miembro (parcial)
-- ---------------------------------------------------------------------
create or replace function public.start_dissolution(p_household uuid, p_leaving_user uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare d uuid; k text;
begin
  perform assert_can_edit(p_household);
  if exists (select 1 from dissolutions where household_id = p_household and status = 'pendiente') then
    raise exception 'Ya hay una disolución en marcha';
  end if;
  k := case when p_leaving_user is null then 'total' else 'parcial' end;
  if k = 'parcial' and not exists (
      select 1 from household_members where household_id = p_household
        and user_id = p_leaving_user and left_at is null) then
    raise exception 'Esa persona no es miembro activo';
  end if;
  insert into dissolutions (household_id, kind, leaving_user_id, created_by)
  values (p_household, k, p_leaving_user, auth.uid()) returning id into d;
  if k = 'total' then
    update households set status = 'disolviendo' where id = p_household;  -- congela el inventario
  end if;
  insert into confirmations (household_id, subject_type, subject_id, subject_version, user_id, decision)
  values (p_household, 'dissolution', d, 1, auth.uid(), 'confirmar');
  perform recompute_status('dissolution', d);
  return d;
end $$;

create or replace function public.cancel_dissolution(p_dissolution uuid)
returns void language plpgsql security definer set search_path = public as $$
declare d dissolutions;
begin
  select * into d from dissolutions where id = p_dissolution;
  if d.id is null or not is_member(d.household_id) then raise exception 'No encontrada'; end if;
  if d.status <> 'pendiente' and d.status <> 'rechazado' then raise exception 'Ya no se puede cancelar'; end if;
  update dissolutions set status = 'cancelado' where id = p_dissolution;
  update households set status = 'activo' where id = d.household_id and status = 'disolviendo';
end $$;

-- ---------------------------------------------------------------------
-- Mis avisos: todo lo que espera mi confirmación en un hogar.
-- ---------------------------------------------------------------------
create or replace function public.my_pending(p_household uuid)
returns table (subject_type text, subject_id uuid, title text, amount_cents bigint, period date, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select 'asset', a.id, a.name, a.total_cents, null::date, a.updated_at
    from assets a
   where a.household_id = p_household and a.status = 'pendiente'
     and exists (select 1 from asset_participants p where p.asset_id = a.id and p.user_id = auth.uid())
     and not exists (select 1 from confirmations c where c.subject_type = 'asset' and c.subject_id = a.id
                      and c.subject_version = a.version and c.user_id = auth.uid())
  union all
  select 'recurring_plan', r.id, r.concept, r.monthly_cents, r.start_date, r.updated_at
    from recurring_plans r
   where r.household_id = p_household and r.status = 'pendiente'
     and exists (select 1 from recurring_plan_shares s where s.plan_id = r.id and s.user_id = auth.uid())
     and not exists (select 1 from confirmations c where c.subject_type = 'recurring_plan' and c.subject_id = r.id
                      and c.subject_version = r.version and c.user_id = auth.uid())
  union all
  select 'installment', i.id, r.concept, i.amount_cents, i.period, i.created_at
    from installments i join recurring_plans r on r.id = i.plan_id
   where i.household_id = p_household and i.status = 'pendiente'
     and exists (select 1 from subject_participants('installment', i.id) u where u = auth.uid())
     and not exists (select 1 from confirmations c where c.subject_type = 'installment' and c.subject_id = i.id
                      and c.subject_version = i.version and c.user_id = auth.uid())
  union all
  select 'dissolution', d.id, case d.kind when 'total' then 'Disolver el hogar' else 'Salida de un miembro' end,
         null::bigint, null::date, d.created_at
    from dissolutions d
   where d.household_id = p_household and d.status = 'pendiente'
     and exists (select 1 from subject_participants('dissolution', d.id) u where u = auth.uid())
     and not exists (select 1 from confirmations c where c.subject_type = 'dissolution' and c.subject_id = d.id
                      and c.subject_version = d.version and c.user_id = auth.uid())
  order by 6 desc;
$$;

-- =====================================================================
-- PERMISOS (RLS): la app solo puede LEER lo que le toca ver
-- =====================================================================
alter table public.profiles              enable row level security;
alter table public.households            enable row level security;
alter table public.household_members     enable row level security;
alter table public.assets                enable row level security;
alter table public.asset_participants    enable row level security;
alter table public.recurring_plans       enable row level security;
alter table public.recurring_plan_shares enable row level security;
alter table public.installments          enable row level security;
alter table public.installment_payments  enable row level security;
alter table public.dissolutions          enable row level security;
alter table public.confirmations         enable row level security;
alter table public.change_log            enable row level security;

create policy "ver mi perfil y el de mis compañeros" on public.profiles for select to authenticated
  using (id = auth.uid() or exists (
    select 1 from household_members a join household_members b on a.household_id = b.household_id
     where a.user_id = auth.uid() and b.user_id = profiles.id));
create policy "editar mi perfil" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy "ver mis hogares" on public.households for select to authenticated
  using (is_or_was_member(id));
create policy "ver miembros de mis hogares" on public.household_members for select to authenticated
  using (is_or_was_member(household_id));
create policy "ver bienes visibles" on public.assets for select to authenticated
  using (can_see_asset(id));
create policy "ver aportaciones de bienes visibles" on public.asset_participants for select to authenticated
  using (can_see_asset(asset_id));
create policy "ver pagos recurrentes visibles" on public.recurring_plans for select to authenticated
  using (can_see_plan(id));
create policy "ver reparto de pagos visibles" on public.recurring_plan_shares for select to authenticated
  using (can_see_plan(plan_id));
create policy "ver cuotas visibles" on public.installments for select to authenticated
  using (can_see_plan(plan_id));
create policy "ver pagos de cuotas visibles" on public.installment_payments for select to authenticated
  using (exists (select 1 from installments i where i.id = installment_id and can_see_plan(i.plan_id)));
create policy "ver disoluciones" on public.dissolutions for select to authenticated
  using (is_or_was_member(household_id));
create policy "ver confirmaciones visibles" on public.confirmations for select to authenticated
  using (can_see_subject(subject_type, subject_id));
create policy "ver historial visible" on public.change_log for select to authenticated
  using (case when action = 'borrado' then is_or_was_member(household_id)
                                         and (snapshot->>'visibility' = 'hogar' or actor_id = auth.uid())
              else can_see_subject(subject_type, subject_id) end);

-- Las funciones solo las pueden usar usuarios con sesión iniciada.
revoke execute on all functions in schema public from public, anon, authenticated;
grant  execute on function
  public.create_household(text, text),
  public.invite_preview(text),
  public.join_household(text),
  public.rotate_invite_code(uuid),
  public.create_asset(uuid, text, bigint, date, jsonb, text, text, text, text, text),
  public.update_asset(uuid, text, bigint, date, jsonb, text, text, text, text, text),
  public.delete_asset(uuid),
  public.respond(text, uuid, text, text),
  public.create_recurring_plan(uuid, text, bigint, date, int, jsonb, text, uuid),
  public.sync_installments(uuid),
  public.delete_recurring_plan(uuid),
  public.set_installment_exception(uuid, jsonb, text),
  public.confirm_month(uuid, date),
  public.start_dissolution(uuid, uuid),
  public.cancel_dissolution(uuid),
  public.my_pending(uuid),
  public.is_member(uuid), public.is_or_was_member(uuid),
  public.can_see_asset(uuid), public.can_see_plan(uuid), public.can_see_subject(text, uuid)
to authenticated;
-- La vista previa de invitación también la puede ver alguien sin sesión.
grant execute on function public.invite_preview(text) to anon;

-- =====================================================================
-- FOTOS (tickets y objetos) en un almacén privado
-- Ruta de cada archivo: <id del hogar>/<nombre-aleatorio>.jpg
-- =====================================================================
insert into storage.buckets (id, name, public)
values ('fotos', 'fotos', false)
on conflict (id) do nothing;

create policy "subir fotos a mis hogares" on storage.objects for insert to authenticated
  with check (bucket_id = 'fotos' and public.is_member(((storage.foldername(name))[1])::uuid));

create policy "ver fotos que me tocan" on storage.objects for select to authenticated
  using (bucket_id = 'fotos' and (
    owner = auth.uid()
    or exists (select 1 from public.assets a
                where (a.receipt_path = storage.objects.name or a.photo_path = storage.objects.name)
                  and public.can_see_asset(a.id))));
