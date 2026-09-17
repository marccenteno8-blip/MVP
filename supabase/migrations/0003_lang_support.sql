-- Chic Estilistes — soporte multi-idioma (ca/es/en) para el bot de WhatsApp
-- Ejecuta este archivo en Supabase > SQL Editor después del 0002_reminders.sql.
--
-- Nota: la tabla whatsapp_conversations la usa supabase/functions/whatsapp-webhook
-- desde el principio pero no estaba en ninguna migración (se habrá creado a
-- mano, o esto la crea ahora si todavía no existe, sin tocar datos existentes).

create table if not exists whatsapp_conversations (
  phone text primary key,
  stage text not null default 'service',
  service_id uuid references services(id),
  stylist_id uuid references stylists(id),
  slot timestamptz,
  lang text not null default 'es' check (lang in ('es', 'ca', 'en')),
  updated_at timestamptz not null default now()
);

alter table whatsapp_conversations add column if not exists lang text not null default 'es';
alter table whatsapp_conversations drop constraint if exists whatsapp_conversations_lang_check;
alter table whatsapp_conversations add constraint whatsapp_conversations_lang_check check (lang in ('es', 'ca', 'en'));

alter table whatsapp_conversations enable row level security;
-- Solo la función (con la service role key) necesita acceso; nadie más.
