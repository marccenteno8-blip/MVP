// Edge Function: whatsapp-reminders
// No responde a nadie: la ejecuta un cron (ver README, sección 8) una vez
// por hora. Busca reservas que empiecen dentro de ~24h, con teléfono de
// WhatsApp guardado y sin recordatorio enviado todavía, y les manda un
// mensaje de plantilla (obligatorio para escribir primero, fuera de la
// ventana de 24h de conversación) en el mismo idioma (ca/es/en) que el
// bot detectó durante la conversación de reserva.
//
// Requiere, además de los secrets de whatsapp-webhook:
//   WHATSAPP_TEMPLATE_NAME   -> nombre exacto de la plantilla aprobada en Meta
//                                (debe tener versión aprobada en los 3 idiomas:
//                                 es, ca y en, con el mismo nombre)
//
// Despliegue: supabase functions deploy whatsapp-reminders --no-verify-jwt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendWhatsAppTemplate } from "../_shared/whatsapp.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

type Lang = "es" | "ca" | "en";

// Debe coincidir con el código de idioma con el que aprobaste cada
// versión de la plantilla en Meta (WhatsApp > Message Templates).
const TEMPLATE_LOCALE: Record<Lang, string> = { es: "es", ca: "ca", en: "en_GB" };

// Ventana en la que se avisa: entre 23h y 25h antes de la cita. Con un
// cron horario esto garantiza que cada reserva cae en la ventana una sola
// vez, sin dejar huecos ni duplicar avisos.
const REMINDER_FROM_HOURS = 23;
const REMINDER_TO_HOURS = 25;

Deno.serve(async (req) => {
  // Protección simple: solo acepta la llamada si trae el secret del propio
  // proyecto (evita que cualquiera en internet dispare recordatorios).
  const auth = req.headers.get("Authorization");
  const expected = `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`;
  if (auth !== expected) {
    return new Response("Unauthorized", { status: 401 });
  }

  const from = new Date(Date.now() + REMINDER_FROM_HOURS * 3600_000).toISOString();
  const to = new Date(Date.now() + REMINDER_TO_HOURS * 3600_000).toISOString();

  const { data: bookings, error } = await supabase
    .from("bookings")
    .select("id, starts_at, customer_phone, stylists(name), services(name)")
    .is("reminder_sent_at", null)
    .not("customer_phone", "is", null)
    .gte("starts_at", from)
    .lt("starts_at", to);

  if (error) {
    console.error(error);
    return new Response("error", { status: 500 });
  }

  // Idioma con el que el bot habló con cada teléfono, para mandar el
  // recordatorio en el mismo idioma. Si no hay conversación guardada
  // (p.ej. se borró, o la reserva vino por otro canal), usamos castellano.
  const phones = [...new Set((bookings ?? []).map((b) => b.customer_phone as string))];
  const { data: convos } = await supabase
    .from("whatsapp_conversations")
    .select("phone, lang")
    .in("phone", phones.length > 0 ? phones : [""]);
  const langByPhone = new Map<string, Lang>((convos ?? []).map((c) => [c.phone, c.lang as Lang]));

  const templateName = Deno.env.get("WHATSAPP_TEMPLATE_NAME")!;

  let sent = 0;
  for (const b of bookings ?? []) {
    const lang = langByPhone.get(b.customer_phone as string) ?? "es";
    const serviceName = (b as any).services?.name ?? "tu cita";
    const stylistName = (b as any).stylists?.name ?? "el equipo";
    const time = new Date(b.starts_at).toLocaleString(
      lang === "ca" ? "ca-ES" : lang === "en" ? "en-GB" : "es-ES",
      { weekday: "long", hour: "2-digit", minute: "2-digit" }
    );

    // El orden de los parámetros debe coincidir exactamente con las
    // variables {{1}} {{2}} {{3}} definidas en la plantilla de Meta.
    const res = await sendWhatsAppTemplate(b.customer_phone as string, templateName, TEMPLATE_LOCALE[lang], [
      serviceName,
      stylistName,
      time,
    ]);

    if (res.ok) {
      await supabase.from("bookings").update({ reminder_sent_at: new Date().toISOString() }).eq("id", b.id);
      sent++;
    }
  }

  return new Response(JSON.stringify({ checked: bookings?.length ?? 0, sent }), {
    headers: { "Content-Type": "application/json" },
  });
});
