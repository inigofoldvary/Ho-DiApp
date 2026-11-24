export const STATUS: Record<string, { text: string; cls: string }> = {
  pendiente: { text: "Pendiente de confirmar", cls: "bg-warn-bg text-warn" },
  confirmado: { text: "Confirmado", cls: "bg-ok-bg text-ok" },
  rechazado: { text: "No es así", cls: "bg-bad-bg text-bad" },
};

export function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("es-ES", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function formatDate(d: string) {
  return new Date(d + "T00:00:00").toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" });
}
