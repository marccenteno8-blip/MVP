import { SALON_NAME, SALON_ADDRESS } from "../config";

export default function Footer() {
  return (
    <footer className="ce-footer">
      <p>
        Plataforma de reservas para {SALON_NAME} ({SALON_ADDRESS}). Los datos de estilistas,
        horario y precios se gestionan en Supabase y pueden editarse ahí en cualquier momento.
      </p>
    </footer>
  );
}
