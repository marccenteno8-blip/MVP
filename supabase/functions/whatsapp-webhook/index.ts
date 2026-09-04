// Edge Function: whatsapp-webhook
// Punto de entrada real de WhatsApp Business (Meta Cloud API).
// Esqueleto funcional: la verificación GET y la forma de llamar a
// next_available_slot ya están listas; falta conectar tus credenciales
// de Meta y, si quieres respuestas más naturales, un modelo de lenguaje.
//
// Despliegue: supabase functions deploy whatsapp-webhook
// Secrets necesarios (supabase secrets set ...):
//   WHATSAPP_VERIFY_TOKEN   -> token que tú eliges, lo repites en Meta
//   WHATSAPP_ACCESS_TOKEN   -> token de la app de Meta
//   WHATSAPP_PHONE_ID       -> id del número de WhatsApp Business
//   SUPABASE_SERVICE_ROLE_KEY (ya disponible por defecto en Edge Functions)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // 1) Verificación del webhook (Meta hace un GET la primera vez)
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && token === Deno.env.get("WHATSAPP_VERIFY_TOKEN")) {
      return new Response(challenge, { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }

  // 2) Mensajes entrantes
  if (req.method === "POST") {
    const body = await req.json();
    // TODO: adapta esto al formato real del payload de Meta:
    // body.entry[0].changes[0].value.messages[0]
    const message = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!message) return new Response("ok", { status: 200 });

    const from = message.from as string; // número del cliente
    const text = message.text?.body?.trim().toLowerCase() ?? "";

    // Aquí iría tu máquina de estados por número (tabla `conversations`),
    // igual que el simulador del demo pero persistida en Supabase.
    // Ejemplo mínimo: si el texto coincide con un servicio, se busca el
    // primer hueco de cualquier estilista y se responde.

    const { data: services } = await supabase.from("services").select("*");
    const service = services?.find((s) => text.includes(s.name.toLowerCase()));

    if (service) {
      const { data: stylists } = await supabase.from("stylists").select("*");
      let best: { name: string; slot: string } | null = null;
      for (const st of stylists ?? []) {
        const { data: slot } = await supabase.rpc("next_available_slot", {
          p_stylist_id: st.id,
          p_duration_min: service.duration_min,
        });
        if (slot && (!best || slot < best.slot)) best = { name: st.name, slot };
      }
      const reply = best
        ? `${best.name} tiene hueco el ${new Date(best.slot).toLocaleString("es-ES")}. ¿Confirmas?`
        : "No encuentro hueco en los próximos días, te paso con el salón.";
      await sendWhatsAppMessage(from, reply);
    } else {
      await sendWhatsAppMessage(from, "¿Qué te gustaría reservar? Corte, peinado, tratamiento o color.");
    }

    return new Response("ok", { status: 200 });
  }

  return new Response("Method not allowed", { status: 405 });
});

async function sendWhatsAppMessage(to: string, text: string) {
  const phoneId = Deno.env.get("WHATSAPP_PHONE_ID");
  const accessToken = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
  await fetch(`https://graph.facebook.com/v19.0/${phoneId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      text: { body: text },
    }),
  });
}
