import { useEffect, useState } from "react";
import { supabase } from "./lib/supabaseClient";
import { Stylist, Service } from "./types";
import Header from "./components/Header";
import Footer from "./components/Footer";
import ReservarView from "./components/ReservarView";
import WhatsAppView from "./components/WhatsAppView";
import PanelView from "./components/PanelView";

export default function App() {
  const [view, setView] = useState<"reservar" | "whatsapp" | "panel">("reservar");
  const [stylists, setStylists] = useState<Stylist[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const [{ data: st, error: stErr }, { data: sv, error: svErr }] = await Promise.all([
        supabase.from("stylists").select("*").order("name"),
        supabase.from("services").select("*").order("duration_min"),
      ]);
      if (stErr || svErr) {
        setError((stErr ?? svErr)!.message);
      } else {
        setStylists(st ?? []);
        setServices(sv ?? []);
      }
      setLoading(false);
    }
    load();
  }, []);

  return (
    <div className="ce-root">
      <Header view={view} setView={setView} />
      {loading && <main className="ce-main"><p className="ce-hero-p">Cargando…</p></main>}
      {error && (
        <main className="ce-main">
          <p className="ce-hero-p">
            No se ha podido conectar con Supabase ({error}). Revisa tu archivo .env.
          </p>
        </main>
      )}
      {!loading && !error && (
        <>
          {view === "reservar" && <ReservarView stylists={stylists} services={services} />}
          {view === "whatsapp" && <WhatsAppView stylists={stylists} services={services} />}
          {view === "panel" && <PanelView stylists={stylists} />}
        </>
      )}
      <Footer />
    </div>
  );
}
