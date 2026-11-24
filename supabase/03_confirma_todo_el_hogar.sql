-- =====================================================================
-- HO-DIAPP · v1.2: nadie se confirma a sí mismo
-- (vale para bienes y para pagos recurrentes)
-- Si un bien lo pagó (o participa) UNA sola persona, lo tienen que
-- confirmar los demás miembros del hogar. Si participan varios,
-- confirman solo los que participan (como antes).
-- Pegar en Supabase > SQL Editor > New query > Run.
-- =====================================================================

create or replace function public.subject_participants(t text, s uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  -- Bienes con 2 o más participantes: confirman los participantes
  select user_id from asset_participants
   where t = 'asset' and asset_id = s
     and (select count(*) from asset_participants where asset_id = s) >= 2
  union
  -- Bienes con un solo participante: confirma todo el hogar (miembros activos)
  select m.user_id from assets a join household_members m on m.household_id = a.household_id
   where t = 'asset' and a.id = s and m.left_at is null
     and (select count(*) from asset_participants where asset_id = s) = 1
  union
  -- Pagos recurrentes: misma regla (si participa uno solo, confirma todo el hogar)
  select user_id from recurring_plan_shares
   where t = 'recurring_plan' and plan_id = s
     and (select count(*) from recurring_plan_shares where plan_id = s) >= 2
  union
  select m.user_id from recurring_plans r join household_members m on m.household_id = r.household_id
   where t = 'recurring_plan' and r.id = s and m.left_at is null
     and (select count(*) from recurring_plan_shares where plan_id = s) = 1
  union
  -- Cuotas: confirman los del pago recurrente (con la misma regla) y quien aparezca pagando
  select sh.user_id from installments i join recurring_plan_shares sh on sh.plan_id = i.plan_id
   where t = 'installment' and i.id = s
     and (select count(*) from recurring_plan_shares where plan_id = i.plan_id) >= 2
  union
  select m.user_id from installments i join household_members m on m.household_id = i.household_id
   where t = 'installment' and i.id = s and m.left_at is null
     and (select count(*) from recurring_plan_shares where plan_id = i.plan_id) = 1
  union
  select ip.user_id from installment_payments ip where t = 'installment' and ip.installment_id = s
  union
  select m.user_id from dissolutions d join household_members m on m.household_id = d.household_id
   where t = 'dissolution' and d.id = s and m.left_at is null;
$$;

-- Un bien privado necesita al menos 2 participantes (si no, nadie podría validarlo).
create or replace function public.check_private_asset()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.visibility = 'implicados'
     and (select count(*) from asset_participants where asset_id = new.id) < 2 then
    raise exception 'Un bien privado tiene que tener al menos 2 personas implicadas, para que alguien más lo pueda confirmar';
  end if;
  return null;
end $$;

drop trigger if exists private_asset_check on public.assets;
create constraint trigger private_asset_check
  after insert or update on public.assets
  deferrable initially deferred
  for each row execute function public.check_private_asset();

-- Avisos: usar la misma regla.
create or replace function public.my_pending(p_household uuid)
returns table (subject_type text, subject_id uuid, title text, amount_cents bigint, period date, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select 'asset', a.id, a.name, a.total_cents, null::date, a.updated_at
    from assets a
   where a.household_id = p_household and a.status = 'pendiente'
     and exists (select 1 from subject_participants('asset', a.id) u where u = auth.uid())
     and not exists (select 1 from confirmations c where c.subject_type = 'asset' and c.subject_id = a.id
                      and c.subject_version = a.version and c.user_id = auth.uid())
  union all
  select 'recurring_plan', r.id, r.concept, r.monthly_cents, r.start_date, r.updated_at
    from recurring_plans r
   where r.household_id = p_household and r.status = 'pendiente'
     and exists (select 1 from subject_participants('recurring_plan', r.id) u where u = auth.uid())
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

-- Recalcular los bienes que ya existían (los de una sola persona vuelven a "pendiente").
do $$
declare a record;
begin
  for a in select id from public.assets loop
    perform public.recompute_status('asset', a.id);
  end loop;
  for a in select id from public.recurring_plans where status <> 'finalizado' loop
    perform public.recompute_status('recurring_plan', a.id);
  end loop;
  for a in select id from public.installments loop
    perform public.recompute_status('installment', a.id);
  end loop;
end $$;
