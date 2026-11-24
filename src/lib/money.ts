/** El dinero se guarda en céntimos. 1150,50 € = 115050. */
export function formatEuros(cents: number): string {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(cents / 100);
}

/** Convierte lo que escribe la persona ("1.150,5" o "1150.50") a céntimos. Null si no es válido. */
export function parseEuros(input: string): number | null {
  let s = input.trim().replace(/\s|€/g, "");
  if (!s) return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(parseFloat(s) * 100);
}
