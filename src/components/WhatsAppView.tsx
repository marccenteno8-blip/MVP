import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { Stylist, Service } from "../types";
import { formatSlot } from "../lib/format";

type Msg = { from: "bot" | "user"; text: string };
type Stage = "service" | "stylist" | "confirm" | "done";

export default function WhatsAppView({ stylists, services }: { stylists: Stylist[]; services: Service[] }) {
  const [messages, setMessages] = useState<Msg[]>([
    { from: "bot", text: "¡Hola! Soy el asistente de Chic Estilistes 💇 ¿Qué te gustaría reservar?" },
  ]);
  const [stage, setStage] = useState<Stage>("service");
  const [chosenService, setChosenService] = useState<Service | null>(null);
  const [chosenStylist, setChosenStylist] = useState<Stylist | null>(null);
  const [chosenSlot, setChosenSlot] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function say(from: Msg["from"], text: string) {
    setMessages((prev) => [...prev, { from, text }]);
  }

  function pickService(s: Service) {
    say("user", s.name);
    setChosenService(s);
    setTimeout(() => {
      say("bot", "¿Con quién prefieres? Si no tienes preferencia, te propongo el primer hueco libre.");
      setStage("stylist");
    }, 300);
  }

  async function pickStylist(stylistOrAny: Stylist | "any") {
    if (!chosenService) return;
    say("user", stylistOrAny === "any" ? "Cualquiera" : stylistOrAny.name);

    let best: { stylist: Stylist; slot: string } | null = null;
    const candidates = stylistOrAny === "any" ? stylists : [stylistOrAny];
    for (const st of candidates) {
      const { data } = await supabase.rpc("next_available_slot", {
        p_stylist_id: st.id,
        p_duration_min: chosenService.duration_min,
      });
      const slot = data as string | null;
      if (slot && (!best || slot < best.slot)) best = { stylist: st, slot };
    }

    if (!best) {
      say("bot", "No encuentro hueco en los próximos días. Te paso con el salón directamente.");
      setStage("done");
      return;
    }
    setChosenStylist(best.stylist);
    setChosenSlot(best.slot);
    say("bot", `${best.stylist.name} tiene hueco ${formatSlot(best.slot).toLowerCase()}. ¿Te va bien?`);
    setStage("confirm");
  }

  async function confirmBooking() {
    if (!chosenService || !chosenStylist || !chosenSlot) return;
    say("user", "Confirmar");
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
    if (error) {
      console.error(error);
      say("bot", "Ha habido un problema al confirmar, inténtalo de nuevo.");
      return;
    }
    say("bot", `¡Reservado! Te esperamos ${formatSlot(chosenSlot).toLowerCase()} con ${chosenStylist.name}.`);
    setStage("done");
  }

  function restart() {
    setMessages([{ from: "bot", text: "¡Hola de nuevo! ¿Qué te gustaría reservar?" }]);
    setStage("service");
    setChosenService(null);
    setChosenStylist(null);
    setChosenSlot(null);
  }

  return (
    <main className="ce-main">
      <section className="ce-section">
        <p className="ce-kicker">Simulador de WhatsApp</p>
        <h2 className="ce-h2">La misma disponibilidad, en el canal donde ya está la clienta</h2>
        <div className="ce-phone">
          <div className="ce-phone-bar">Chic Estilistes</div>
          <div className="ce-chat">
            {messages.map((m, i) => (
              <div key={i} className={`ce-bubble ce-bubble-${m.from}`}>
                {m.text}
              </div>
            ))}
            <div ref={endRef} />
          </div>
          <div className="ce-quick-replies">
            {stage === "service" &&
              services.map((s) => (
                <button key={s.id} className="ce-chip ce-chip-sm" onClick={() => pickService(s)}>
                  {s.name}
                </button>
              ))}
            {stage === "stylist" && (
              <>
                {stylists.map((st) => (
                  <button key={st.id} className="ce-chip ce-chip-sm" onClick={() => pickStylist(st)}>
                    {st.name}
                  </button>
                ))}
                <button className="ce-chip ce-chip-sm" onClick={() => pickStylist("any")}>
                  Cualquiera
                </button>
              </>
            )}
            {stage === "confirm" && (
              <button className="ce-btn ce-btn-primary" onClick={confirmBooking}>
                Confirmar
              </button>
            )}
            {stage === "done" && (
              <button className="ce-btn ce-btn-ghost" onClick={restart}>
                Probar otra conversación
              </button>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
