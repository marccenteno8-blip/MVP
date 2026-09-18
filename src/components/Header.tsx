import { SALON_NAME, SALON_ADDRESS } from "../config";

type View = "reservar" | "panel";

export default function Header({ view, setView }: { view: View; setView: (v: View) => void }) {
  const tabs: { id: View; label: string }[] = [
    { id: "reservar", label: "Reservar" },
    { id: "panel", label: "Panel del salón" },
  ];
  return (
    <header className="ce-header">
      <div className="ce-header-inner">
        <div className="ce-brand">
          <span className="ce-brand-mark" aria-hidden="true">
            {SALON_NAME[0]}
          </span>
          <div>
            <div className="ce-brand-name">{SALON_NAME}</div>
            <div className="ce-brand-sub">{SALON_ADDRESS}</div>
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
