// Edge Function: whatsapp-webhook
// Punto de entrada real de WhatsApp Business (Meta Cloud API).
// Lleva la misma conversación por pasos que el simulador de la web
// (servicio -> estilista -> confirmar) pero con estado persistido en
// Supabase, porque cada mensaje entrante llega como una petición HTTP
// independiente sin memoria propia.
//
// Despliegue: supabase functions deploy whatsapp-webhook
// Secrets necesarios (supabase secrets set ...):
//   WHATSAPP_VERIFY_TOKEN      -> token que tú eliges, lo repites en Meta
//   WHATSAPP_ACCESS_TOKEN      -> token de la app de Meta (o del BSP que uses)
//   WHATSAPP_PHONE_ID          -> id del número de WhatsApp Business
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY -> ya disponibles por defecto

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

type Conversation = {
  phone: string;
  stage: "service" | "stylist" | "confirm" | "done";
  service_id: string | null;
  stylist_id: string | null;
  slot: string | null;
};

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
    const message = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!message) return new Response("ok", { status: 200 });

    const from = message.from as string; // número del cliente, formato E.164 sin '+'
    const text: string =
      message.text?.body?.trim() ??
      message.interactive?.button_reply?.title?.trim() ??
      message.interactive?.list_reply?.title?.trim() ??
      "";

    await handleMessage(from, text);
    return new Response("ok", { status: 200 });
  }

  return new Response("Method not allowed", { status: 405 });
});

async function handleMessage(from: string, text: string) {
  const lower = text.toLowerCase();

  // Reinicio manual en cualquier momento
  if (["hola", "reiniciar", "empezar", "menu", "menú"].includes(lower)) {
    await resetConversation(from);
    await askService(from);
    return;
  }

  let convo = await getConversation(from);
  if (!convo) {
    convo = await resetConversation(from);
    await askService(from);
    return;
  }

  if (convo.stage === "service") {
    const services = await getServices();
    const chosen = matchByNumberOrName(text, services);
    if (!chosen) {
      await sendWhatsAppMessage(from, "No he reconocido ese servicio. Responde con el número de la lista.");
      await askService(from);
      return;
    }
    await supabase
      .from("whatsapp_conversations")
      .update({ service_id: chosen.id, stage: "stylist", updated_at: new Date().toISOString() })
      .eq("phone", from);
    await askStylist(from);
    return;
  }

  if (convo.stage === "stylist") {
    const stylists = await getStylists();
    const options = [...stylists, { id: "any", name: "Cualquiera" }];
    const chosen = matchByNumberOrName(text, options);
    if (!chosen) {
      await sendWhatsAppMessage(from, "No he reconocido esa opción. Responde con el número de la lista.");
      await askStylist(from);
      return;
    }

    const service = await getServiceById(convo.service_id!);
    if (!service) {
      await resetConversation(from);
      await askService(from);
      return;
    }

    const candidates = chosen.id === "any" ? stylists : stylists.filter((s) => s.id === chosen.id);
    let best: { stylist: { id: string; name: string }; slot: string } | null = null;
    for (const st of candidates) {
      const { data: slot } = await supabase.rpc("next_available_slot", {
        p_stylist_id: st.id,
        p_duration_min: service.duration_min,
      });
      if (slot && (!best || slot < best.slot)) best = { stylist: st, slot: slot as string };
    }

    if (!best) {
      await sendWhatsAppMessage(from, "No encuentro hueco en los próximos días. Te paso con el salón directamente.");
      await resetConversation(from);
      return;
    }

    await supabase
      .from("whatsapp_conversations")
      .update({
        stylist_id: best.stylist.id,
        slot: best.slot,
        stage: "confirm",
        updated_at: new Date().toISOString(),
      })
      .eq("phone", from);

    await sendWhatsAppMessage(
      from,
      `${best.stylist.name} tiene hueco el ${formatSlot(best.slot)}. Responde *sí* para confirmar o *no* para cancelar.`
    );
    return;
  }

  if (convo.stage === "confirm") {
    if (["si", "sí", "vale", "confirmar", "ok"].includes(lower)) {
      const service = await getServiceById(convo.service_id!);
      if (!service || !convo.stylist_id || !convo.slot) {
        await resetConversation(from);
        await askService(from);
        return;
      }
      const startsAt = new Date(convo.slot);
      const endsAt = new Date(startsAt.getTime() + service.duration_min * 60000);
      const { error } = await supabase.from("bookings").insert({
        stylist_id: convo.stylist_id,
        service_id: service.id,
        starts_at: startsAt.toISOString(),
        ends_at: endsAt.toISOString(),
        customer_name: `WhatsApp ${from}`,
        source: "whatsapp",
      });
      if (error) {
        await sendWhatsAppMessage(from, "Ha habido un problema al confirmar, inténtalo de nuevo escribiendo *hola*.");
        console.error(error);
        return;
      }
      await sendWhatsAppMessage(from, `¡Reservado! Te esperamos el ${formatSlot(convo.slot)}. Escribe *hola* si quieres reservar otra cita.`);
      await supabase.from("whatsapp_conversations").update({ stage: "done", updated_at: new Date().toISOString() }).eq("phone", from);
      return;
    }
    if (["no", "cancelar"].includes(lower)) {
      await sendWhatsAppMessage(from, "Vale, no he reservado nada. Escribe *hola* para volver a empezar.");
      await resetConversation(from);
      return;
    }
    await sendWhatsAppMessage(from, "Responde *sí* para confirmar o *no* para cancelar.");
    return;
  }

  // stage === "done" u otro estado inesperado: reinicia
  await resetConversation(from);
  await askService(from);
}

// ---------- Helpers de conversación ----------

async function getConversation(phone: string): Promise<Conversation | null> {
  const { data } = await supabase.from("whatsapp_conversations").select("*").eq("phone", phone).maybeSingle();
  return (data as Conversation) ?? null;
}

async function resetConversation(phone: string): Promise<Conversation> {
  const row = { phone, stage: "service" as const, service_id: null, stylist_id: null, slot: null, updated_at: new Date().toISOString() };
  await supabase.from("whatsapp_conversations").upsert(row);
  return row;
}

// Palabras habituales que un cliente real escribiría en vez del nombre
// exacto del servicio, para entender lenguaje natural y no solo números
// exactos de una lista (igual que el simulador de la web).
const SERVICE_SYNONYMS: Record<string, string[]> = {
  corte: ["corte", "cortar", "recortar", "puntas", "flequillo"],
  peinado: ["peinado", "recogido", "evento", "photocall"],
  tratamiento: ["tratamiento", "hidratacion", "mascarilla", "keratina", "capilar"],
  color: ["color", "mechas", "tinte", "balayage", "reflejos", "colorear"],
};

function normalize(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

const ANY_WORDS = ["cualquiera", "cualquier", "me da igual", "no tengo preferencia", "quien sea", "la que sea", "el que sea"];

function matchByNumberOrName<T extends { id: string; name: string }>(text: string, options: T[]): T | null {
  const n = normalize(text);
  const anyOption = options.find((o) => o.id === "any");
  if (anyOption && ANY_WORDS.some((w) => n.includes(w))) return anyOption;

  const asIndex = parseInt(n, 10);
  if (!isNaN(asIndex) && asIndex >= 1 && asIndex <= options.length) return options[asIndex - 1];

  const direct = options.find((o) => n.includes(normalize(o.name)) || normalize(o.name).includes(n));
  if (direct) return direct;

  for (const [key, words] of Object.entries(SERVICE_SYNONYMS)) {
    if (words.some((w) => n.includes(w))) {
      const found = options.find((o) => normalize(o.name).includes(key));
      if (found) return found;
    }
  }
  return null;
}

// ---------- Preguntas ----------

async function askService(phone: string) {
  const services = await getServices();
  const list = services.map((s, i) => `${i + 1}. ${s.name} (${s.duration_min} min)`).join("\n");
  await sendWhatsAppMessage(
    phone,
    `¡Hola! Soy el asistente de Chic Estilistes 💇\n¿Qué te gustaría reservar? Responde con el número:\n\n${list}`
  );
}

async function askStylist(phone: string) {
  const stylists = await getStylists();
  const list = stylists.map((s, i) => `${i + 1}. ${s.name}`).join("\n");
  await sendWhatsAppMessage(
    phone,
    `¿Con quién prefieres? Responde con el número, o "${stylists.length + 1}" si no tienes preferencia:\n\n${list}\n${stylists.length + 1}. Cualquiera`
  );
}

async function getServices() {
  const { data } = await supabase.from("services").select("*").order("duration_min");
  return (data ?? []) as { id: string; name: string; duration_min: number }[];
}

async function getServiceById(id: string) {
  const { data } = await supabase.from("services").select("*").eq("id", id).maybeSingle();
  return data as { id: string; name: string; duration_min: number } | null;
}

async function getStylists() {
  const { data } = await supabase.from("stylists").select("*").order("name");
  return (data ?? []) as { id: string; name: string }[];
}

function formatSlot(iso: string) {
  return new Date(iso).toLocaleString("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ---------- Envío de mensajes ----------

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
