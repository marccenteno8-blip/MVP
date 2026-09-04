export function formatSlot(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);

  const time = d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });

  if (isSameDay(d, now)) return `Hoy, ${time}`;
  if (isSameDay(d, tomorrow)) return `Mañana, ${time}`;

  const day = d.toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short" });
  return `${day}, ${time}`;
}
