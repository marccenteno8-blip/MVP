import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { Stylist, Service } from "../types";
import { formatSlot } from "../lib/format";
import { SALON_NAME, WHATSAPP_PHONE, WHATSAPP_DISPLAY } from "../config";

// Cuántos huecos próximos se enseñan por estilista. 3 da opción real de
// elegir sin saturar la tarjeta; súbelo si tu agenda tiene mucho hueco y
// quieres enseñar más alternativas de un vistazo.
const SLOTS_PER_STYLIST = 3;

type Row = { stylist: Stylist; slots: string[] };

const WHATSAPP_PREFILL = "Hola, quiero reservar una cita";
const WHATSAPP_LINK = `https://wa.me/${WHATSAPP_PHONE}?text=${encodeURIComponent(WHATSAPP_PREFILL)}`;

export default function ReservarView({ stylists, services }: { stylists: Stylist[]; services: Service[] }) {
  const [serviceId, setServiceId] = useState(services[0]?.id ?? "");
  const [rows, setRows] = useState<Row[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [picked, setPicked] = useState<{ stylistId: string; slot: string } | null>(null);
  const [name, setName] = useState("");
  const [success, setSuccess] = useState<{ stylistName: string; slot: string } | null>(null);

  const service = services.find((s) => s.id === serviceId);

  useEffect(() => {
    if (!service) return;
    let cancelled = false;
    setLoadingSlots(true);
    fetchRows(service).then((result) => {
      if (cancelled) return;
      setRows(result);
      setLoadingSlots(false);
    });
    return () => {
      cancelled = true;
    };
  }, [serviceId, stylists, service]);

  async function fetchRows(svc: Service): Promise<Row[]> {
    const result = await Promise.all(
      stylists.map(async (stylist) => {
        const { data, error } = await supabase.rpc("next_available_slots", {
          p_stylist_id: stylist.id,
          p_duration_min: svc.duration_min,
          p_count: SLOTS_PER_STYLIST,
        });
        if (error) console.error(error);
        const slots = ((data as { slot_start: string }[] | null) ?? []).map((r) => r.slot_start);
        return { stylist, slots };
      })
    );
    result.sort((a, b) => {
      if (a.slots.length === 0) return 1;
      if (b.slots.length === 0) return -1;
      return a.slots[0] < b.slots[0] ? -1 : 1;
    });
    return result;
  }

  async function confirm(stylist: Stylist, slot: string) {
    if (!service) return;
    const startsAt = new Date(slot);
    const endsAt = new Date(startsAt.getTime() + service.duration_min * 60000);
    const { error } = await supabase.from("bookings").insert({
      stylist_id: stylist.id,
      service_id: service.id,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      customer_name: name || "Cliente web",
      source: "web",
    });
    if (error) {
      console.error(error);
      return;
    }
    setSuccess({ stylistName: stylist.name, slot });
    setPicked(null);
    setName("");
    if (service) {
      setLoadingSlots(true);
      fetchRows(service).then((result) => {
        setRows(result);
        setLoadingSlots(false);
      });
    }
  }

  return (
    <main className="ce-main">
      <section className="ce-hero ce-hero-compact">
        <p className="ce-kicker">Reservas online</p>
        <h1>Reserva tu cita en {SALON_NAME} en menos de un minuto</h1>
        <p className="ce-hero-p">
          Elige el servicio y verás, al segundo, las próximas horas libres de cada estilista —
          calculadas en directo desde la agenda real del salón.
        </p>
      </section>

      <section className="ce-section">
        <a className="ce-wa-card" href={WHATSAPP_LINK} target="_blank" rel="noopener noreferrer">
          <span className="ce-wa-icon" aria-hidden="true">💬</span>
          <span className="ce-wa-text">
            <span className="ce-wa-title">¿Prefieres reservar hablando?</span>
            <span className="ce-wa-sub">
              Escríbenos y un asistente te dice al momento qué horas y con qué estilista tienes libres.
            </span>
          </span>
          <span className="ce-wa-btn">
            <span className="ce-wa-btn-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.9 9.9 0 0 0 4.74 1.21h.01c5.46 0 9.91-4.45 9.91-9.91C21.96 6.45 17.5 2 12.04 2zm5.8 14.19c-.24.68-1.4 1.3-1.94 1.38-.5.08-1.12.11-1.81-.11-.42-.13-.95-.31-1.64-.6-2.88-1.24-4.76-4.13-4.9-4.32-.14-.19-1.17-1.56-1.17-2.98s.73-2.11.99-2.4c.26-.28.56-.35.75-.35.19 0 .38 0 .54.01.17.01.4-.07.63.48.24.57.81 1.98.88 2.12.07.14.12.31.02.5-.09.19-.14.31-.28.48-.14.17-.29.37-.42.5-.14.14-.28.29-.12.57.16.28.71 1.17 1.53 1.9 1.05.94 1.94 1.23 2.22 1.37.28.14.44.12.6-.07.16-.19.68-.79.87-1.06.19-.28.37-.23.63-.14.26.1 1.65.78 1.94.92.28.14.47.21.54.33.07.12.07.68-.17 1.36z" />
              </svg>
            </span>
            {WHATSAPP_DISPLAY}
          </span>
        </a>
      </section>

      <section className="ce-section">
        <h2 className="ce-h2">1. Elige el servicio</h2>
        <div className="ce-chip-row">
          {services.map((s) => (
            <button
              key={s.id}
              className={`ce-chip ${serviceId === s.id ? "is-active" : ""}`}
              onClick={() => {
                setServiceId(s.id);
                setPicked(null);
              }}
            >
              {s.name}
              <span className="ce-chip-meta">
                {s.duration_min} min{s.price_cents ? ` · ${(s.price_cents / 100).toFixed(0)}€` : ""}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="ce-section">
        <h2 className="ce-h2">2. Elige hora y estilista</h2>
        <div className="ce-stylist-list">
          {rows.map(({ stylist, slots }) => (
            <div className="ce-stylist-card" key={stylist.id}>
              <div className="ce-stylist-top">
                <div className="ce-stylist-id">
                  <span className="ce-avatar">{stylist.name[0]}</span>
                  <div>
                    <div className="ce-stylist-name">{stylist.name}</div>
                    <div className="ce-stylist-role">{stylist.role}</div>
                  </div>
                </div>

                {slots.length > 0 ? (
                  <div className="ce-slot-chip-row">
                    {slots.map((slot) => (
                      <button
                        key={slot}
                        className={`ce-slot-chip ${
                          picked?.stylistId === stylist.id && picked.slot === slot ? "is-active" : ""
                        }`}
                        onClick={() =>
                          setPicked(
                            picked?.stylistId === stylist.id && picked.slot === slot
                              ? null
                              : { stylistId: stylist.id, slot }
                          )
                        }
                      >
                        {formatSlot(slot)}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="ce-slot-empty">{loadingSlots ? "Calculando…" : "Sin hueco próximo"}</div>
                )}
              </div>

              {picked?.stylistId === stylist.id && (
                <div className="ce-confirm-row">
                  <input
                    className="ce-input"
                    placeholder="Tu nombre"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                  <button className="ce-btn ce-btn-primary" onClick={() => confirm(stylist, picked.slot)}>
                    Confirmar
                  </button>
                  <button className="ce-btn ce-btn-ghost" onClick={() => setPicked(null)}>
                    Cancelar
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {success && (
        <div className="ce-toast">
          Cita confirmada con {success.stylistName} · {formatSlot(success.slot)}
        </div>
      )}
    </main>
  );
}
