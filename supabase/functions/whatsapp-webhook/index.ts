// Edge Function: whatsapp-webhook
// Punto de entrada real de WhatsApp Business (Meta Cloud API).
// Lleva la misma conversación por pasos que el simulador de la web
// (servicio -> estilista -> confirmar) pero con estado persistido en
// Supabase, porque cada mensaje entrante llega como una petición HTTP
// independiente sin memoria propia.
//
// Detecta automáticamente si el cliente escribe en catalán, castellano o
// inglés (por palabras características, sin llamar a ningún servicio
// externo) y responde en ese mismo idioma. Ver detectLang() más abajo.
//
// Despliegue: supabase functions deploy whatsapp-webhook
// Secrets necesarios (supabase secrets set ...):
//   WHATSAPP_VERIFY_TOKEN      -> token que tú eliges, lo repites en Meta
//   WHATSAPP_ACCESS_TOKEN      -> token de la app de Meta (o del BSP que uses)
//   WHATSAPP_PHONE_ID          -> id del número de WhatsApp Business
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY -> ya disponibles por defecto

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendWhatsAppMessage } from "../_shared/whatsapp.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

type Lang = "es" | "ca" | "en";

// Nombre del salón para los mensajes del bot. Deno no puede importar
// src/config.ts (vive en el bundle de React), así que este backend tiene
// su propia constante: al clonar la plantilla para un salón nuevo, cambia
// este valor además del de src/config.ts.
const SALON_NAME = "Tu Salón";


type Conversation = {
  phone: string;
  stage: "service" | "stylist" | "confirm" | "done";
  service_id: string | null;
  stylist_id: string | null;
  slot: string | null;
  lang: Lang;
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
  const convo = await getConversation(from);
  // Si el mensaje tiene palabras claramente de un idioma, manda; si no
  // (p.ej. el cliente solo escribe "2"), seguimos con el idioma que ya
  // tuviera la conversación, o castellano si es la primera vez.
  const lang: Lang = detectLang(text) ?? convo?.lang ?? "es";

  const n = normalize(text);
  if (RESET_WORDS.includes(n)) {
    await resetConversation(from, lang);
    await askService(from, lang);
    return;
  }

  if (!convo) {
    await resetConversation(from, lang);
    await askService(from, lang);
    return;
  }

  // Si el idioma detectado en este mensaje difiere del guardado, lo
  // actualizamos para que los próximos mensajes automáticos (incluidos
  // los recordatorios) también salgan en el idioma correcto.
  if (lang !== convo.lang) {
    await supabase.from("whatsapp_conversations").update({ lang }).eq("phone", from);
    convo.lang = lang;
  }

  if (convo.stage === "service") {
    const services = await getServices();
    const chosen = matchByNumberOrName(text, services);
    if (!chosen) {
      await sendWhatsAppMessage(from, T[lang].unknownService);
      await askService(from, lang);
      return;
    }
    await supabase
      .from("whatsapp_conversations")
      .update({ service_id: chosen.id, stage: "stylist", updated_at: new Date().toISOString() })
      .eq("phone", from);
    await askStylist(from, lang);
    return;
  }

  if (convo.stage === "stylist") {
    const stylists = await getStylists();
    const options = [...stylists, { id: "any", name: T[lang].anyone }];
    const chosen = matchByNumberOrName(text, options);
    if (!chosen) {
      await sendWhatsAppMessage(from, T[lang].unknownOption);
      await askStylist(from, lang);
      return;
    }

    const service = await getServiceById(convo.service_id!);
    if (!service) {
      await resetConversation(from, lang);
      await askService(from, lang);
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
      await sendWhatsAppMessage(from, T[lang].noSlot);
      await resetConversation(from, lang);
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

    await sendWhatsAppMessage(from, T[lang].confirmAsk(best.stylist.name, formatSlot(best.slot, lang)));
    return;
  }

  if (convo.stage === "confirm") {
    if (YES_WORDS.includes(n)) {
      const service = await getServiceById(convo.service_id!);
      if (!service || !convo.stylist_id || !convo.slot) {
        await resetConversation(from, lang);
        await askService(from, lang);
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
        customer_phone: from,
        source: "whatsapp",
      });
      if (error) {
        await sendWhatsAppMessage(from, T[lang].bookingError);
        console.error(error);
        return;
      }
      await sendWhatsAppMessage(from, T[lang].booked(formatSlot(convo.slot, lang)));
      await supabase.from("whatsapp_conversations").update({ stage: "done", updated_at: new Date().toISOString() }).eq("phone", from);
      return;
    }
    if (NO_WORDS.includes(n)) {
      await sendWhatsAppMessage(from, T[lang].cancelled);
      await resetConversation(from, lang);
      return;
    }
    await sendWhatsAppMessage(from, T[lang].confirmRetry);
    return;
  }

  // stage === "done" u otro estado inesperado: reinicia
  await resetConversation(from, lang);
  await askService(from, lang);
}

// ---------- Conversación ----------

async function getConversation(phone: string): Promise<Conversation | null> {
  const { data } = await supabase.from("whatsapp_conversations").select("*").eq("phone", phone).maybeSingle();
  return (data as Conversation) ?? null;
}

async function resetConversation(phone: string, lang: Lang): Promise<Conversation> {
  const row = {
    phone,
    stage: "service" as const,
    service_id: null,
    stylist_id: null,
    slot: null,
    lang,
    updated_at: new Date().toISOString(),
  };
  await supabase.from("whatsapp_conversations").upsert(row);
  return row;
}

// ---------- Detección de idioma ----------
// Heurística ligera basada en palabras características de cada idioma
// (sin llamar a ningún servicio externo). No es perfecta con mensajes muy
// cortos ("2", "sí"), pero para esos casos mantenemos el idioma que ya
// tuviera la conversación en vez de adivinar. Si el volumen de mensajes
// ambiguos o mezclados creciera mucho, esto se podría sustituir por una
// llamada a un LLM para detectar el idioma con más precisión.

const LANG_WORDS: Record<Lang, string[]> = {
  ca: [
    "vull", "voldria", "gracies", "merci", "sisplau", "quan", "avui", "dema",
    "adeu", "perque", "tambe", "amb", "hores", "disponible", "estilista",
    "reservar", "bones", "quina", "quin", "aquesta", "aquest", "necessito",
    "puc", "podria", "hola",
  ],
  es: [
    "quiero", "quisiera", "gracias", "porfavor", "cuando", "hoy", "manana",
    "adios", "porque", "tambien", "con", "horas", "disponible", "estilista",
    "reservar", "buenas", "cual", "esta", "este", "necesito", "puedo",
    "podria", "hola",
  ],
  en: [
    "want", "would", "thanks", "thank", "please", "when", "today",
    "tomorrow", "bye", "because", "also", "with", "hours", "available",
    "stylist", "book", "which", "this", "need", "can", "could", "hi",
    "hello", "yes",
  ],
};

function detectLang(text: string): Lang | null {
  const words = normalize(text).split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;

  const scores: Record<Lang, number> = { es: 0, ca: 0, en: 0 };
  for (const w of words) {
    for (const lang of Object.keys(LANG_WORDS) as Lang[]) {
      if (LANG_WORDS[lang].includes(w)) scores[lang]++;
    }
  }

  const best = (Object.entries(scores) as [Lang, number][]).sort((a, b) => b[1] - a[1])[0];
  return best[1] > 0 ? best[0] : null;
}

const RESET_WORDS = ["hola", "reiniciar", "empezar", "menu", "comença", "comencem", "inici", "hi", "hello", "restart", "start"].map(normalize);

const YES_WORDS = ["si", "vale", "confirmar", "ok", "val", "dacord", "yes", "confirm", "okay", "sure"].map(normalize);
const NO_WORDS = ["no", "cancelar", "cancellar", "cancel"].map(normalize);

// Palabras habituales que un cliente real escribiría en vez del nombre
// exacto del servicio (en cualquiera de los tres idiomas), para entender
// lenguaje natural y no solo números exactos de una lista.
const SERVICE_SYNONYMS: Record<string, string[]> = {
  corte: ["corte", "cortar", "recortar", "puntas", "flequillo", "tall", "tallar", "retallar", "serrell", "cut", "haircut", "trim", "fringe", "bangs"],
  peinado: ["peinado", "recogido", "evento", "photocall", "pentinat", "recollit", "styling", "updo"],
  tratamiento: ["tratamiento", "hidratacion", "mascarilla", "keratina", "capilar", "tractament", "hidratacio", "mascareta", "queratina", "treatment", "hydration", "mask", "keratin"],
  color: ["color", "mechas", "tinte", "balayage", "reflejos", "colorear", "ratlles", "tint", "highlights", "dye"],
};

function normalize(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[·'’]/g, "")
    .trim();
}

const ANY_WORDS = [
  "cualquiera", "cualquier", "me da igual", "no tengo preferencia", "quien sea", "la que sea", "el que sea",
  "qualsevol", "mes es igual", "no tinc preferencia", "qui sigui", "la que sigui", "el que sigui",
  "anyone", "any", "no preference", "dont mind", "doesnt matter", "whoever",
];

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

// ---------- Textos localizados ----------

const T: Record<Lang, {
  greeting: (list: string) => string;
  unknownService: string;
  askStylist: (list: string, n: number) => string;
  anyone: string;
  unknownOption: string;
  noSlot: string;
  confirmAsk: (stylist: string, slot: string) => string;
  bookingError: string;
  booked: (slot: string) => string;
  cancelled: string;
  confirmRetry: string;
  locale: string;
}> = {
  es: {
    greeting: (list) => `¡Hola! Soy el asistente de ${SALON_NAME} 💇\n¿Qué te gustaría reservar? Responde con el número:\n\n${list}`,
    unknownService: "No he reconocido ese servicio. Responde con el número de la lista.",
    askStylist: (list, n) => `¿Con quién prefieres? Responde con el número, o "${n}" si no tienes preferencia:\n\n${list}\n${n}. Cualquiera`,
    anyone: "Cualquiera",
    unknownOption: "No he reconocido esa opción. Responde con el número de la lista.",
    noSlot: "No encuentro hueco en los próximos días. Te paso con el salón directamente.",
    confirmAsk: (stylist, slot) => `${stylist} tiene hueco el ${slot}. Responde *sí* para confirmar o *no* para cancelar.`,
    bookingError: "Ha habido un problema al confirmar, inténtalo de nuevo escribiendo *hola*.",
    booked: (slot) => `¡Reservado! Te esperamos el ${slot}. Escribe *hola* si quieres reservar otra cita.`,
    cancelled: "Vale, no he reservado nada. Escribe *hola* para volver a empezar.",
    confirmRetry: "Responde *sí* para confirmar o *no* para cancelar.",
    locale: "es-ES",
  },
  ca: {
    greeting: (list) => `Hola! Sóc l'assistent de ${SALON_NAME} 💇\nQuè t'agradaria reservar? Respon amb el número:\n\n${list}`,
    unknownService: "No he reconegut aquest servei. Respon amb el número de la llista.",
    askStylist: (list, n) => `Amb qui prefereixes? Respon amb el número, o "${n}" si no tens preferència:\n\n${list}\n${n}. Qualsevol`,
    anyone: "Qualsevol",
    unknownOption: "No he reconegut aquesta opció. Respon amb el número de la llista.",
    noSlot: "No trobo cap forat els pròxims dies. Et passo directament amb el saló.",
    confirmAsk: (stylist, slot) => `${stylist} té un forat el ${slot}. Respon *sí* per confirmar o *no* per cancel·lar.`,
    bookingError: "Hi ha hagut un problema en confirmar, torna-ho a provar escrivint *hola*.",
    booked: (slot) => `Reservat! T'esperem el ${slot}. Escriu *hola* si vols reservar una altra cita.`,
    cancelled: "D'acord, no he reservat res. Escriu *hola* per tornar a començar.",
    confirmRetry: "Respon *sí* per confirmar o *no* per cancel·lar.",
    locale: "ca-ES",
  },
  en: {
    greeting: (list) => `Hi! I'm the ${SALON_NAME} assistant 💇\nWhat would you like to book? Reply with the number:\n\n${list}`,
    unknownService: "I didn't recognize that service. Reply with the number from the list.",
    askStylist: (list, n) => `Who would you prefer? Reply with the number, or "${n}" if you have no preference:\n\n${list}\n${n}. Anyone`,
    anyone: "Anyone",
    unknownOption: "I didn't recognize that option. Reply with the number from the list.",
    noSlot: "I can't find a free slot in the coming days. I'll put you through to the salon directly.",
    confirmAsk: (stylist, slot) => `${stylist} has an opening on ${slot}. Reply *yes* to confirm or *no* to cancel.`,
    bookingError: "There was a problem confirming, please try again by writing *hi*.",
    booked: (slot) => `Booked! We'll see you on ${slot}. Write *hi* if you want to book another appointment.`,
    cancelled: "Okay, I haven't booked anything. Write *hi* to start over.",
    confirmRetry: "Reply *yes* to confirm or *no* to cancel.",
    locale: "en-GB",
  },
};

// ---------- Preguntas ----------

async function askService(phone: string, lang: Lang) {
  const services = await getServices();
  const list = services.map((s, i) => `${i + 1}. ${s.name} (${s.duration_min} min)`).join("\n");
  await sendWhatsAppMessage(phone, T[lang].greeting(list));
}

async function askStylist(phone: string, lang: Lang) {
  const stylists = await getStylists();
  const list = stylists.map((s, i) => `${i + 1}. ${s.name}`).join("\n");
  await sendWhatsAppMessage(phone, T[lang].askStylist(list, stylists.length + 1));
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

function formatSlot(iso: string, lang: Lang) {
  return new Date(iso).toLocaleString(T[lang].locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ---------- Envío de mensajes ----------
// (sendWhatsAppMessage vive en ../_shared/whatsapp.ts, reutilizado también
// por whatsapp-reminders)
