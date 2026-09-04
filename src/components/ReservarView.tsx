import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { Stylist, Service } from "../types";
import { formatSlot } from "../lib/format";

type Row = { stylist: Stylist; slot: string | null };

export default function ReservarView({ stylists, services }: { stylists: Stylist[]; services: Service[] }) {
  const [serviceId, setServiceId] = useState(services[0]?.id ?? "");
  const [rows, setRows] = useState<Row[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [success, setSuccess] = useState<{ stylistName: string; slot: string } | null>(null);

  const service = services.find((s) => s.id === serviceId);

  useEffect(() => {
    if (!service) return;
    let cancelled = false;
    setLoadingSlots(true);
    Promise.all(
      stylists.map(async (stylist) => {
        const { data, error } = await supabase.rpc("next_available_slot", {
          p_stylist_id: stylist.id,
          p_duration_min: service.duration_min,
        });
        if (error) console.error(error);
        return { stylist, slot: (data as string | null) ?? null };
      })
    ).then((result) => {
      if (cancelled) return;
      result.sort((a, b) => {
        if (!a.slot) return 1;
        if (!b.slot) return -1;
        return a.slot < b.slot ? -1 : 1;
      });
      setRows(result);
      setLoadingSlots(false);
    });
    return () => {
      cancelled = true;
    };
  }, [serviceId, stylists, service]);

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
    setConfirmingId(null);
    setName("");
    refetch();
  }

  async function refetch() {
    if (!service) return;
    setLoadingSlots(true);
    const result = await Promise.all(
      stylists.map(async (stylist) => {
        const { data } = await supabase.rpc("next_available_slot", {
          p_stylist_id: stylist.id,
          p_duration_min: service.duration_min,
        });
        return { stylist, slot: (data as string | null) ?? null };
      })
    );
    result.sort((a, b) => {
      if (!a.slot) return 1;
      if (!b.slot) return -1;
      return a.slot < b.slot ? -1 : 1;
    });
    setRows(result);
    setLoadingSlots(false);
  }

  const earliest = rows.find((r) => r.slot);

  return (
    <main className="ce-main">
      <section className="ce-hero">
        <div className="ce-hero-text">
          <p className="ce-kicker">Reservas online</p>
          <h1>En El Masnou, cuando el pelo no puede esperar, tampoco debería esperar la respuesta.</h1>
          <p className="ce-hero-p">
            Elige el servicio y verás, al segundo, el primer hueco libre de cada estilista —
            calculado en directo desde la agenda real del salón.
          </p>
        </div>
        <div className="ce-hero-card">
          <div className="ce-hero-card-label">Disponibilidad en directo</div>
          {earliest?.slot ? (
            <>
              <div className="ce-hero-card-big">{formatSlot(earliest.slot)}</div>
              <div className="ce-hero-card-sub">con {earliest.stylist.name} · {service?.name}</div>
            </>
          ) : (
            <div className="ce-hero-card-sub">{loadingSlots ? "Calculando…" : "Sin huecos próximos"}</div>
          )}
        </div>
      </section>

      <section className="ce-section">
        <h2 className="ce-h2">1. Elige el servicio</h2>
        <div className="ce-chip-row">
          {services.map((s) => (
            <button
              key={s.id}
              className={`ce-chip ${serviceId === s.id ? "is-active" : ""}`}
              onClick={() => setServiceId(s.id)}
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
        <h2 className="ce-h2">2. Elige el primer hueco de cada estilista</h2>
        <div className="ce-stylist-list">
          {rows.map(({ stylist, slot }) => (
            <div className="ce-stylist-card" key={stylist.id}>
              <div className="ce-stylist-id">
                <span className="ce-avatar">{stylist.name[0]}</span>
                <div>
                  <div className="ce-stylist-name">{stylist.name}</div>
                  <div className="ce-stylist-role">{stylist.role}</div>
                </div>
              </div>

              {slot ? (
                <div className="ce-slot-block">
                  <div className="ce-slot-when">
                    <span className="ce-slot-time">{formatSlot(slot)}</span>
                  </div>
                  {confirmingId === stylist.id ? (
                    <div className="ce-confirm-row">
                      <input
                        className="ce-input"
                        placeholder="Tu nombre"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                      />
                      <button className="ce-btn ce-btn-primary" onClick={() => confirm(stylist, slot)}>
                        Confirmar
                      </button>
                      <button className="ce-btn ce-btn-ghost" onClick={() => setConfirmingId(null)}>
                        Cancelar
                      </button>
                    </div>
                  ) : (
                    <button className="ce-btn ce-btn-primary" onClick={() => setConfirmingId(stylist.id)}>
                      Reservar este hueco
                    </button>
                  )}
                </div>
              ) : (
                <div className="ce-slot-empty">{loadingSlots ? "Calculando…" : "Sin hueco próximo"}</div>
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
