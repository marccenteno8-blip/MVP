type View = "reservar" | "whatsapp" | "panel";

export default function Header({ view, setView }: { view: View; setView: (v: View) => void }) {
  const tabs: { id: View; label: string }[] = [
    { id: "reservar", label: "Reservar" },
    { id: "whatsapp", label: "WhatsApp" },
    { id: "panel", label: "Panel del salón" },
  ];
  return (
    <header className="ce-header">
      <div className="ce-header-inner">
        <div className="ce-brand">
          <span className="ce-brand-mark">CE</span>
          <div>
            <div className="ce-brand-name">Chic Estilistes</div>
            <div className="ce-brand-sub">Carrer dels Ametllers, 8 · El Masnou</div>
          </div>
        </div>
        <nav className="ce-nav">
          {tabs.map((t) => (
            <button
              key={t.id}
              className={`ce-nav-btn ${view === t.id ? "is-active" : ""}`}
              onClick={() => setView(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>
    </header>
  );
}
