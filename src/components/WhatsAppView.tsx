import { FormEvent, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { Stylist, Service } from "../types";
import { formatSlot } from "../lib/format";

type Msg = { from: "bot" | "user"; text: string };
type Stage = "service" | "stylist" | "confirm" | "done";

function normalize(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

// Palabras habituales que un cliente real escribiría en vez del nombre
// exacto del servicio, para que el bot entienda lenguaje natural.
const SERVICE_SYNONYMS: Record<string, string[]> = {
  corte: ["corte", "cortar", "recortar", "puntas", "flequillo"],
  peinado: ["peinado", "recogido", "evento", "photocall"],
  tratamiento: ["tratamiento", "hidratacion", "mascarilla", "keratina", "capilar"],
  color: ["color", "mechas", "tinte", "balayage", "reflejos", "colorear"],
};

const ANY_WORDS = ["cualquiera", "cualquier", "me da igual", "no tengo preferencia", "quien sea", "la que sea", "el que sea"];
const YES_WORDS = ["si", "sí", "vale", "confirmo", "confirmar", "perfecto", "genial", "dale", "de acuerdo", "ok", "correcto"];
const NO_WORDS = ["no", "cancelar", "mejor no", "otro dia", "paso", "cancela"];
const GREETING_WORDS = ["hola", "buenas", "reiniciar", "empezar de nuevo", "menu", "menú", "otra cita", "otra reserva"];

function matchService(text: string, services: Service[]): Service | null {
  const n = normalize(text);
  const asIndex = parseInt(n, 10);
  if (!isNaN(asIndex) && asIndex >= 1 && asIndex <= services.length) return services[asIndex - 1];

  const direct = services.find((s) => n.includes(normalize(s.name)) || normalize(s.name).includes(n));
  if (direct) return direct;

  for (const [key, words] of Object.entries(SERVICE_SYNONYMS)) {
    if (words.some((w) => n.includes(w))) {
      const found = services.find((s) => normalize(s.name).includes(key));
      if (found) return found;
    }
  }
  return null;
}

function matchStylist(text: string, stylists: Stylist[]): Stylist | "any" | null {
  const n = normalize(text);
  if (ANY_WORDS.some((w) => n.includes(w))) return "any";

  const asIndex = parseInt(n, 10);
  if (!isNaN(asIndex)) {
    if (asIndex >= 1 && asIndex <= stylists.length) return stylists[asIndex - 1];
    if (asIndex === stylists.length + 1) return "any";
  }

  return stylists.find((s) => n.includes(normalize(s.name))) ?? null;
}

const isYes = (text: string) => YES_WORDS.some((w) => normalize(text) === w || normalize(text).includes(w));
const isNo = (text: string) => NO_WORDS.some((w) => normalize(text) === w || normalize(text).includes(w));
const isGreeting = (text: string) => GREETING_WORDS.some((w) => normalize(text).includes(w));

export default function WhatsAppView({ stylists, services }: { stylists: Stylist[]; services: Service[] }) {
  const [messages, setMessages] = useState<Msg[]>([
    {
      from: "bot",
      text:
        "¡Hola! Soy el asistente de Chic Estilistes 💇 Cuéntame qué te gustaría reservar, por ejemplo \"quiero unas mechas\" o \"necesito cortarme el pelo\".",
    },
  ]);
  const [stage, setStage] = useState<Stage>("service");
  const [chosenService, setChosenService] = useState<Service | null>(null);
  const [chosenStylist, setChosenStylist] = useState<Stylist | null>(null);
  const [chosenSlot, setChosenSlot] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function say(from: Msg["from"], text: string) {
    setMessages((prev) => [...prev, { from, text }]);
  }

  function sayBotDelayed(text: string, delay = 350) {
    setTimeout(() => say("bot", text), delay);
  }

  function servicesList() {
    return services.map((s, i) => `${i + 1}. ${s.name} (${s.duration_min} min)`).join("\n");
  }

  function stylistsList() {
    const list = stylists.map((s, i) => `${i + 1}. ${s.name}`).join("\n");
    return `${list}\n${stylists.length + 1}. Cualquiera`;
  }

  function resetState() {
    setStage("service");
    setChosenService(null);
    setChosenStylist(null);
    setChosenSlot(null);
  }

  async function handleStylistChoice(res: Stylist | "any") {
    if (!chosenService) return;
    setSending(true);

    const candidates = res === "any" ? stylists : [res];
    let best: { stylist: Stylist; slot: string } | null = null;
    for (const st of candidates) {
      const { data } = await supabase.rpc("next_available_slot", {
        p_stylist_id: st.id,
        p_duration_min: chosenService.duration_min,
      });
      const slot = data as string | null;
      if (slot && (!best || slot < best.slot)) best = { stylist: st, slot };
    }
    setSending(false);

    if (!best) {
      sayBotDelayed("No encuentro hueco en los próximos días. Te paso con el salón directamente.");
      resetState();
      setStage("done");
      return;
    }
    setChosenStylist(best.stylist);
    setChosenSlot(best.slot);
    sayBotDelayed(
      `${best.stylist.name} tiene hueco ${formatSlot(best.slot).toLowerCase()}. Responde "sí" para confirmar o "no" para cancelar.`
    );
    setStage("confirm");
  }

  async function confirmBooking() {
    if (!chosenService || !chosenStylist || !chosenSlot) return;
    setSending(true);
    const startsAt = new Date(chosenSlot);
    const endsAt = new Date(startsAt.getTime() + chosenService.duration_min * 60000);
    const { error } = await supabase.from("bookings").insert({
      stylist_id: chosenStylist.id,
      service_id: chosenService.id,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      customer_name: "Cliente WhatsApp",
      source: "whatsapp",
    });
    setSending(false);
    if (error) {
      console.error(error);
      sayBotDelayed("Ha habido un problema al confirmar, inténtalo de nuevo.");
      return;
    }
    sayBotDelayed(
      `¡Reservado! Te esperamos ${formatSlot(chosenSlot).toLowerCase()} con ${chosenStylist.name}. Escríbeme "hola" si quieres reservar otra cita.`
    );
    resetState();
    setStage("done");
  }

  async function handleUserText(raw: string) {
    const text = raw.trim();
    if (!text || sending) return;
    say("user", text);
    setDraft("");

    if (isGreeting(text)) {
      resetState();
      sayBotDelayed(`¿Qué te gustaría reservar? Estos son nuestros servicios:\n${servicesList()}`);
      return;
    }

    if (stage === "service") {
      const svc = matchService(text, services);
      if (!svc) {
        sayBotDelayed(
          `No he entendido bien qué servicio quieres. Puedes escribirlo con tus palabras (por ejemplo "unas mechas") o elegir un número:\n${servicesList()}`
        );
        return;
      }
      setChosenService(svc);
      sayBotDelayed(`Perfecto, ${svc.name}. ¿Con quién prefieres? Dime un nombre o escribe "cualquiera".\n${stylistsList()}`);
      setStage("stylist");
      return;
    }

    if (stage === "stylist") {
      const res = matchStylist(text, stylists);
      if (!res) {
        sayBotDelayed(`No he reconocido a esa persona. Nuestro equipo es: ${stylists.map((s) => s.name).join(", ")}. También puedes escribir "cualquiera".`);
        return;
      }
      await handleStylistChoice(res);
      return;
    }

    if (stage === "confirm") {
      if (isYes(text)) {
        await confirmBooking();
        return;
      }
      if (isNo(text)) {
        sayBotDelayed('Vale, no he reservado nada. Escríbeme "hola" cuando quieras volver a empezar.');
        resetState();
        setStage("done");
        return;
      }
      sayBotDelayed('No te he entendido. Responde "sí" para confirmar o "no" para cancelar.');
      return;
    }

    // stage === "done": cualquier mensaje relanza la conversación
    resetState();
    sayBotDelayed(`¿Qué te gustaría reservar? Estos son nuestros servicios:\n${servicesList()}`);
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    handleUserText(draft);
    inputRef.current?.focus();
  }

  return (
    <main className="ce-main">
      <section className="ce-section">
        <p className="ce-kicker">Simulador de WhatsApp</p>
        <h2 className="ce-h2">La misma disponibilidad, en el canal donde ya está la clienta</h2>
        <p className="ce-hero-p">
          Escribe con tus propias palabras, como lo haría una clienta de verdad por WhatsApp.
          El bot te va guiando en cada paso.
        </p>
        <div className="ce-phone">
          <div className="ce-phone-bar">Chic Estilistes</div>
          <div className="ce-chat">
            {messages.map((m, i) => (
              <div key={i} className={`ce-bubble ce-bubble-${m.from}`} style={{ whiteSpace: "pre-line" }}>
                {m.text}
              </div>
            ))}
            {sending && <div className="ce-bubble ce-bubble-bot ce-bubble-typing">Escribiendo…</div>}
            <div ref={endRef} />
          </div>
          <form className="ce-chat-input-row" onSubmit={onSubmit}>
            <input
              ref={inputRef}
              className="ce-chat-input"
              placeholder={stage === "done" ? 'Escribe "hola" para otra cita…' : "Escribe tu mensaje…"}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={sending}
            />
            <button type="submit" className="ce-btn ce-btn-primary ce-btn-sm" disabled={sending || !draft.trim()}>
              Enviar
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
