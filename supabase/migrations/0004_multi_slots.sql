-- Chic Estilistes / plantilla multi-local — varios huecos por estilista
-- Ejecuta esto en Supabase > SQL Editor después de las migraciones anteriores.
--
-- La página de reservas ahora quiere enseñar, por cada peluquero, sus
-- próximos N huecos libres (no solo el primero) para que el cliente pueda
-- elegir hora directamente sin pasos extra. Esta función es una variante
-- de next_available_slot() que devuelve varias filas en vez de una.

create or replace function next_available_slots(
  p_stylist_id uuid,
  p_duration_min int,
  p_count int default 3,
  p_from timestamptz default now()
)
returns table (slot_start timestamptz)
language sql
stable
as $$
  with days as (
    select generate_series(
      date_trunc('day', p_from),
      date_trunc('day', p_from) + interval '13 days',
      interval '1 day'
    ) as day
  ),
  hours as (
    select d.day, bh.open_min, bh.close_min
    from days d
    join business_hours bh
      on bh.day_of_week = extract(dow from d.day)::int
     and bh.is_closed = false
  ),
  slots as (
    select h.day + ((h.open_min + g.n * 15) * interval '1 minute') as slot_start
    from hours h,
      lateral generate_series(0, ((h.close_min - h.open_min - p_duration_min) / 15)) as g(n)
    where h.close_min - h.open_min >= p_duration_min
  ),
  candidate as (
    select s.slot_start, s.slot_start + (p_duration_min * interval '1 minute') as slot_end
    from slots s
    where s.slot_start >= p_from + interval '30 minutes'
  )
  select c.slot_start
  from candidate c
  where not exists (
    select 1 from bookings b
    where b.stylist_id = p_stylist_id
      and b.starts_at < c.slot_end
      and b.ends_at > c.slot_start
  )
  and not exists (
    select 1 from blocked_slots bs
    where bs.stylist_id = p_stylist_id
      and bs.starts_at < c.slot_end
      and bs.ends_at > c.slot_start
  )
  order by c.slot_start asc
  limit p_count;
$$;

grant execute on function next_available_slots(uuid, int, int, timestamptz) to anon, authenticated;
