-- Chic Estilistes — esquema inicial
-- Ejecuta este archivo en Supabase > SQL Editor (o con `supabase db push`)

create extension if not exists "pgcrypto";

-- ---------- Tablas ----------

create table if not exists stylists (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  role text,
  created_at timestamptz not null default now()
);

create table if not exists services (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  duration_min int not null,
  price_cents int,
  created_at timestamptz not null default now()
);

-- Horario del salón. day_of_week: 0=domingo ... 6=sábado (igual que extract(dow from ...))
create table if not exists business_hours (
  day_of_week int primary key,
  is_closed boolean not null default false,
  open_min int,
  close_min int
);

create table if not exists bookings (
  id uuid primary key default gen_random_uuid(),
  stylist_id uuid not null references stylists(id) on delete cascade,
  service_id uuid not null references services(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  customer_name text,
  source text not null default 'web' check (source in ('web', 'whatsapp', 'phone', 'panel')),
  created_at timestamptz not null default now()
);

create table if not exists blocked_slots (
  id uuid primary key default gen_random_uuid(),
  stylist_id uuid not null references stylists(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists bookings_stylist_time_idx on bookings (stylist_id, starts_at);
create index if not exists blocked_stylist_time_idx on blocked_slots (stylist_id, starts_at);

-- ---------- RLS ----------
-- Nota: estas políticas son deliberadamente abiertas para que la demo
-- funcione de extremo a extremo sin login. Antes de lanzar a producción:
--   1) añade Supabase Auth para el panel del salón,
--   2) restringe el SELECT/DELETE de `bookings` a usuarios autenticados
--      (o expón una vista sin `customer_name` para los canales públicos),
--   3) revisa si el INSERT público en `bookings` necesita más validación.

alter table stylists enable row level security;
create policy "public read stylists" on stylists for select using (true);

alter table services enable row level security;
create policy "public read services" on services for select using (true);

alter table business_hours enable row level security;
create policy "public read business_hours" on business_hours for select using (true);

alter table bookings enable row level security;
create policy "public read bookings" on bookings for select using (true);
create policy "public insert bookings" on bookings for insert with check (true);
create policy "public delete bookings" on bookings for delete using (true);

alter table blocked_slots enable row level security;
create policy "public read blocked_slots" on blocked_slots for select using (true);
create policy "public insert blocked_slots" on blocked_slots for insert with check (true);

-- ---------- Función compartida: "primer hueco libre" ----------
-- La usan por igual la web, el simulador de WhatsApp y (más adelante)
-- el webhook real de WhatsApp/teléfono, para que los tres canales
-- vean siempre la misma disponibilidad.

create or replace function next_available_slot(
  p_stylist_id uuid,
  p_duration_min int,
  p_from timestamptz default now()
)
returns timestamptz
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
    select slot_start, slot_start + (p_duration_min * interval '1 minute') as slot_end
    from slots
    where slot_start >= p_from + interval '30 minutes'
  ),
  free as (
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
  )
  select slot_start from free order by slot_start asc limit 1;
$$;

grant execute on function next_available_slot(uuid, int, timestamptz) to anon, authenticated;

-- Para producción: evita dobles reservas por condición de carrera con una
-- restricción de exclusión (requiere la extensión btree_gist):
--   create extension if not exists btree_gist;
--   alter table bookings add constraint bookings_no_overlap
--     exclude using gist (
--       stylist_id with =,
--       tstzrange(starts_at, ends_at) with &&
--     );

-- ---------- Datos de ejemplo ----------
-- Sustitúyelos por el equipo, servicios y horario reales de Chic Estilistes.

insert into business_hours (day_of_week, is_closed, open_min, close_min) values
  (0, true, null, null),   -- domingo cerrado
  (1, true, null, null),   -- lunes cerrado
  (2, false, 540, 1140),   -- martes 9:00-19:00
  (3, false, 540, 1140),
  (4, false, 540, 1140),
  (5, false, 540, 1140),
  (6, false, 540, 1140)
on conflict (day_of_week) do nothing;

insert into stylists (name, role) values
  ('Laia', 'Colorista'),
  ('Berta', 'Estilista'),
  ('Roser', 'Estilista sénior')
on conflict do nothing;

insert into services (name, duration_min, price_cents) values
  ('Corte', 30, 2200),
  ('Peinado', 45, 2800),
  ('Tratamiento capilar', 45, 3500),
  ('Color / Mechas', 90, 6800)
on conflict do nothing;
