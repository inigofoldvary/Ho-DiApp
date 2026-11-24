/** Lee una foto de ticket en el propio móvil (gratis, sin enviar nada fuera) y saca total y fecha. */

export type TicketGuess = { totalCents: number | null; date: string | null };

const AMOUNT = /(\d{1,3}(?:[.\s]\d{3})*|\d+)[,.](\d{2})(?!\d)/g;

function toCents(intPart: string, dec: string) {
  return parseInt(intPart.replace(/[.\s]/g, ""), 10) * 100 + parseInt(dec, 10);
}

function amountsIn(line: string): number[] {
  return [...line.matchAll(AMOUNT)].map((m) => toCents(m[1], m[2]));
}

export function parseTicket(text: string, today = new Date()): TicketGuess {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const norm = (l: string) => l.toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

  // Total: líneas con TOTAL / A PAGAR / IMPORTE (sin SUBTOTAL ni BASE/IVA). Nos quedamos el mayor.
  let total: number | null = null;
  lines.forEach((l, i) => {
    const u = norm(l);
    if (!/(TOTAL|A PAGAR|IMPORTE|TARJETA|EFECTIVO)/.test(u) || /(SUBTOTAL|SUB TOTAL|BASE|CUOTA|I\.?V\.?A|IMPUESTO|CAMBIO|DEVOL|ARTICULOS|UNIDADES)/.test(u)) return;
    let found = amountsIn(l);
    if (found.length === 0 && lines[i + 1]) found = amountsIn(lines[i + 1]);
    for (const c of found) if (c > 0 && (total === null || c > total)) total = c;
  });
  // Si no hay línea de total, el importe más alto del ticket.
  if (total === null) {
    const all = lines.flatMap(amountsIn).filter((c) => c > 0 && c < 10_000_000);
    if (all.length) total = Math.max(...all);
  }

  // Fecha: dd/mm/aaaa, dd-mm-aa, dd.mm.aaaa
  let date: string | null = null;
  for (const m of text.matchAll(/\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})\b/g)) {
    const d = +m[1], mo = +m[2];
    let y = +m[3];
    if (y < 100) y += 2000;
    if (d < 1 || d > 31 || mo < 1 || mo > 12 || y < 2000) continue;
    const dt = new Date(y, mo - 1, d);
    if (dt.getMonth() !== mo - 1 || dt > today) continue;
    date = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    break;
  }
  return { totalCents: total, date };
}

export async function readTicket(file: File): Promise<TicketGuess> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("spa");
  try {
    const { data } = await worker.recognize(file);
    return parseTicket(data.text);
  } finally {
    await worker.terminate();
  }
}
