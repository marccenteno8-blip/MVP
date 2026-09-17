-- Chic Estilistes — soporte para recordatorios automáticos por WhatsApp
-- Ejecuta este archivo en Supabase > SQL Editor (o con `supabase db push`)
-- después del 0001_init.sql.

-- Teléfono del cliente en formato E.164 sin '+' (el mismo formato que usa
-- la Cloud API de WhatsApp). Se rellena solo en las reservas que llegan
-- por WhatsApp; las reservas web/panel lo dejan en null y simplemente no
-- reciben recordatorio por este canal.
alter table bookings add column if not exists customer_phone text;

-- Marca de cuándo se envió el recordatorio, para no enviarlo dos veces.
-- Si es null, todavía no se ha enviado (o la reserva no tiene teléfono).
alter table bookings add column if not exists reminder_sent_at timestamptz;

create index if not exists bookings_reminder_pending_idx
  on bookings (starts_at)
  where reminder_sent_at is null and customer_phone is not null;

-- ---------- Programar el envío automático ----------
-- La función whatsapp-reminders no se ejecuta sola: hay que decirle a
-- Supabase que la llame cada hora. La forma más simple es el Dashboard
-- (Database > Cron Jobs > "Create job" > tipo "Edge Function"), sin tocar
-- SQL. Si prefieres hacerlo por SQL/CLI, esto es el equivalente:
--
--   create extension if not exists pg_cron;
--   create extension if not exists pg_net;
--
--   select cron.schedule(
--     'whatsapp-reminders-hourly',
--     '0 * * * *', -- cada hora en punto
--     $$
--     select net.http_post(
--       url := 'https://TU-PROYECTO.supabase.co/functions/v1/whatsapp-reminders',
--       headers := jsonb_build_object(
--         'Authorization', 'Bearer TU_SERVICE_ROLE_KEY',
--         'Content-Type', 'application/json'
--       )
--     );
--     $$
--   );
--
-- Sustituye TU-PROYECTO y TU_SERVICE_ROLE_KEY (Settings > API > service_role,
-- no la anon key) por los tuyos. Para revisar que se ejecuta:
--   select * from cron.job_run_details order by start_time desc limit 5;
