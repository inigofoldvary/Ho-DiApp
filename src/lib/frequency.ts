export type Frequency = "semana" | "mes" | "año";
export const FREQS: Frequency[] = ["semana", "mes", "año"];

/** "/semana", "/mes", "/año" para poner detrás de la cuota. */
export function perFreq(f?: string | null) {
  return `/${f === "semana" || f === "año" ? f : "mes"}`;
}

/** Cómo se llama una cuota según la frecuencia: "Semana del 3 nov 2026", "Noviembre de 2026", "2026". */
export function formatPeriod(d: string, f?: string | null) {
  const date = new Date(d.slice(0, 10) + "T00:00:00");
  if (f === "semana") return "Semana del " + date.toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" });
  if (f === "año") return "Año " + date.toLocaleDateString("es-ES", { year: "numeric" }) + " (" + date.toLocaleDateString("es-ES", { day: "numeric", month: "short" }) + ")";
  const s = date.toLocaleDateString("es-ES", { month: "long", year: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}
