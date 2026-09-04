import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { Stylist, Booking, Service } from "../types";
import { formatSlot } from "../lib/format";

export default function PanelView({ stylists }: { stylists: Stylist[] }) {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [nextSlots, setNextSlots] = useState<Record<string, string | null>>({});

  useEffect(() => {
    supabase
      .from("bookings")
      .select("*")
      .order("starts_at")
      .then(({ data }) => setBookings(data ?? []));

    supabase
      .from("services")
      .select("*")
      .then(({ data }) => setServices(data ?? []));

    const channel = supabase
      .channel("bookings-changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "bookings" }, (payload) => {
        if (payload.eventType === "INSERT") {
          setBookings((prev) => [...prev, payload.new as Booking].sort((a, b) => (a.starts_at < b.starts_at ? -1 : 1)));
        } else if (payload.eventType === "DELETE") {
          setBookings((prev) => prev.filter((b) => b.id !== (payload.old as Booking).id));
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    Promise.all(
      stylists.map(async (st) => {
        const { data } = await supabase.rpc("next_available_slot", { p_stylist_id: st.id, p_duration_min: 30 });
        return [st.id, (data as string | null) ?? null] as const;
      })
    ).then((entries) => setNextSlots(Object.fromEntries(entries)));
  }, [stylists, bookings]);

  async function blockNext(stylist: Stylist) {
    const slot = nextSlots[stylist.id];
    if (!slot) return;
    const startsAt = new Date(slot);
    const endsAt = new Date(startsAt.getTime() + 30 * 60000);
    await supabase.from("blocked_slots").insert({
      stylist_id: stylist.id,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      reason: "Bloqueado desde el panel",
    });
    const { data } = await supabase.rpc("next_available_slot", { p_stylist_id: stylist.id, p_duration_min: 30 });
    setNextSlots((prev) => ({ ...prev, [stylist.id]: (data as string | null) ?? null }));
  }

  async function removeBooking(id: string) {
    await supabase.from("bookings").delete().eq("id", id);
  }

  function serviceName(id: string) {
    return services.find((s) => s.id === id)?.name ?? "";
  }
  function stylistName(id: string) {
    return stylists.find((s) => s.id === id)?.name ?? "";
  }

  return (
    <main className="ce-main">
      <section className="ce-section">
        <p className="ce-kicker">Vista del salón</p>
        <h2 className="ce-h2">Lo que verían Marta y el equipo al llegar</h2>
        <p className="ce-hero-p">
          Las reservas hechas desde la web o el WhatsApp aparecen aquí al instante gracias a
          Supabase Realtime, y bloquear un hueco desde aquí también lo hace desaparecer de los
          otros dos canales.
        </p>
      </section>

      <section className="ce-section">
        <div className="ce-panel-grid">
          {stylists.map((st) => (
            <div className="ce-panel-card" key={st.id}>
              <div className="ce-stylist-id">
                <span className="ce-avatar">{st.name[0]}</span>
                <div>
                  <div className="ce-stylist-name">{st.name}</div>
                  <div className="ce-stylist-role">{st.role}</div>
                </div>
              </div>
              <div className="ce-panel-next">
                {nextSlots[st.id] ? (
                  <>Próximo hueco: <strong>{formatSlot(nextSlots[st.id]!)}</strong></>
                ) : (
                  "Sin huecos próximos"
                )}
              </div>
              <button className="ce-btn ce-btn-ghost ce-btn-sm" onClick={() => blockNext(st)}>
                Bloquear este hueco
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="ce-section">
        <h2 className="ce-h2">Reservas registradas</h2>
        {bookings.length === 0 ? (
          <div className="ce-slot-empty">Todavía no hay reservas.</div>
        ) : (
          <div className="ce-booking-list">
            {bookings.map((b) => (
              <div className="ce-booking-row" key={b.id}>
                <span className="ce-booking-source">{b.source}</span>
                <span>{formatSlot(b.starts_at)}</span>
                <span>{stylistName(b.stylist_id)}</span>
                <span>{serviceName(b.service_id)}</span>
                <span>{b.customer_name}</span>
                <button className="ce-btn ce-btn-ghost ce-btn-sm" onClick={() => removeBooking(b.id)}>
                  Cancelar
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
