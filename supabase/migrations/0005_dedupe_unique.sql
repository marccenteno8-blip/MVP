-- Chic Estilistes / plantilla multi-local — corrige estilistas y servicios
-- duplicados y evita que vuelva a pasar.
--
-- Por qué pasó: los INSERT de datos de ejemplo (en 0001_init.sql y también
-- en schema_completo.sql) no tenían ninguna restricción de unicidad sobre
-- el nombre, así que si se ejecutaron dos veces (por ejemplo, una vez cada
-- archivo) cada fila se insertó dos veces con id distinto. Este archivo:
--   1) reasigna cualquier reserva/bloqueo/conversación que apuntara a la
--      fila duplicada hacia la fila "original" (la más antigua),
--   2) borra las filas duplicadas,
--   3) añade una restricción unique(name) para que un futuro re-insert
--      con el mismo nombre no cree una fila nueva, sino que no haga nada.
--
-- Ejecuta esto en Supabase > SQL Editor después de las migraciones
-- anteriores. Es seguro ejecutarlo aunque no tengas duplicados: en ese
-- caso simplemente no borra ni reasigna nada.

-- ---------- Estilistas ----------

with ranked as (
  select id, name,
         row_number() over (partition by name order by created_at asc, id asc) as rn
  from stylists
),
keepers as (
  select r.name, r.id as keep_id
  from ranked r
  where r.rn = 1
),
dupes as (
  select r.id as dupe_id, k.keep_id
  from ranked r
  join keepers k on k.name = r.name
  where r.rn > 1
)
update bookings b set stylist_id = d.keep_id
from dupes d
where b.stylist_id = d.dupe_id;

with ranked as (
  select id, name,
         row_number() over (partition by name order by created_at asc, id asc) as rn
  from stylists
),
keepers as (
  select r.name, r.id as keep_id
  from ranked r
  where r.rn = 1
),
dupes as (
  select r.id as dupe_id, k.keep_id
  from ranked r
  join keepers k on k.name = r.name
  where r.rn > 1
)
update blocked_slots bs set stylist_id = d.keep_id
from dupes d
where bs.stylist_id = d.dupe_id;

with ranked as (
  select id, name,
         row_number() over (partition by name order by created_at asc, id asc) as rn
  from stylists
),
keepers as (
  select r.name, r.id as keep_id
  from ranked r
  where r.rn = 1
),
dupes as (
  select r.id as dupe_id, k.keep_id
  from ranked r
  join keepers k on k.name = r.name
  where r.rn > 1
)
update whatsapp_conversations wc set stylist_id = d.keep_id
from dupes d
where wc.stylist_id = d.dupe_id;

delete from stylists s
using (
  select id,
         row_number() over (partition by name order by created_at asc, id asc) as rn
  from stylists
) r
where s.id = r.id and r.rn > 1;

do $$
begin
  alter table stylists add constraint stylists_name_key unique (name);
exception when duplicate_object then
  raise notice 'stylists ya tenía restricción unique(name), no se toca';
end $$;

-- ---------- Servicios ----------

with ranked as (
  select id, name,
         row_number() over (partition by name order by created_at asc, id asc) as rn
  from services
),
keepers as (
  select r.name, r.id as keep_id
  from ranked r
  where r.rn = 1
),
dupes as (
  select r.id as dupe_id, k.keep_id
  from ranked r
  join keepers k on k.name = r.name
  where r.rn > 1
)
update bookings b set service_id = d.keep_id
from dupes d
where b.service_id = d.dupe_id;

with ranked as (
  select id, name,
         row_number() over (partition by name order by created_at asc, id asc) as rn
  from services
),
keepers as (
  select r.name, r.id as keep_id
  from ranked r
  where r.rn = 1
),
dupes as (
  select r.id as dupe_id, k.keep_id
  from ranked r
  join keepers k on k.name = r.name
  where r.rn > 1
)
update whatsapp_conversations wc set service_id = d.keep_id
from dupes d
where wc.service_id = d.dupe_id;

delete from services s
using (
  select id,
         row_number() over (partition by name order by created_at asc, id asc) as rn
  from services
) r
where s.id = r.id and r.rn > 1;

do $$
begin
  alter table services add constraint services_name_key unique (name);
exception when duplicate_object then
  raise notice 'services ya tenía restricción unique(name), no se toca';
end $$;

-- Comprueba el resultado:
--   select name, count(*) from stylists group by name having count(*) > 1;
--   select name, count(*) from services group by name having count(*) > 1;
-- Ambas deberían devolver 0 filas.
