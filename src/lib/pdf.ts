import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { LEGAL_NOTE, type Report } from "./report";
import { formatEuros } from "./money";

const fmtDate = (d: string) => new Date(d.length === 10 ? d + "T00:00:00" : d).toLocaleDateString("es-ES");
const fmtDateTime = (d: string) => new Date(d).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" });
const fmtMonth = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("es-ES", { month: "long", year: "numeric" });
const eur = (c: number) => formatEuros(c).replace(/ /g, " ");

export type SplitPdf = {
  rows: { name: string; price: number; value: number; keeper: string }[];
  transfers: { from: string; to: string; cents: number }[];
  sale: { total: number; per: { name: string; cents: number }[] } | null;
};

export function buildPdf(r: Report, opts: { final?: boolean; leaving?: { user_id: string; name: string }; split?: SplitPdf; title?: string } = {}): jsPDF {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const green: [number, number, number] = [47, 111, 94];
  let y = 18;

  doc.setFont("helvetica", "bold").setFontSize(18).text(opts.title ? opts.title : opts.leaving ? `Salida de ${opts.leaving.name}` : opts.final ? "Inventario final del hogar" : "Resumen del hogar", 14, y);
  y += 7;
  doc.setFont("helvetica", "normal").setFontSize(11).setTextColor(90)
    .text(`${r.household.name} · ${r.household.kind === "pareja" ? "Pareja" : "Compañeros de piso"}`, 14, y);
  y += 5;
  doc.text(`Generado el ${fmtDateTime(r.generatedAt.toISOString())} con Ho-DiApp`, 14, y);
  doc.setTextColor(0);
  y += 8;

  // 1. Totales por persona
  doc.setFont("helvetica", "bold").setFontSize(13).text("Cuánto ha aportado cada persona", 14, y);
  autoTable(doc, {
    startY: y + 3,
    head: [["Persona", "Bienes", "Pagos recurrentes", "Total confirmado"]],
    body: r.people.map((p) => [p.name, eur(p.assets), eur(p.recurring), eur(p.assets + p.recurring)]),
    foot: [["Total", ...[sum(r.people.map((p) => p.assets)), sum(r.people.map((p) => p.recurring)),
      sum(r.people.map((p) => p.assets + p.recurring))].map((v) => ({ content: eur(v), styles: { halign: "right" as const } }))]],
    headStyles: { fillColor: green }, footStyles: { fillColor: [235, 235, 235], textColor: 20 },
    columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right", fontStyle: "bold" } },
    styles: { fontSize: 10 }, margin: { bottom: 24 },
  });
  y = lastY(doc) + 4;
  const pendingTotal = sum(r.people.map((p) => p.pending));
  if (pendingTotal > 0) {
    doc.setFontSize(9).setTextColor(120)
      .text(`Además hay ${eur(pendingTotal)} pendientes de confirmar, que no se incluyen en los totales.`, 14, y);
    doc.setTextColor(0);
    y += 6;
  }

  // 1a. Reparto acordado al disolver
  if (opts.split) {
    const sp = opts.split;
    y += 4;
    y = room(doc, y);
    doc.setFont("helvetica", "bold").setFontSize(13).text("Reparto acordado", 14, y);
    autoTable(doc, {
      startY: y + 3,
      head: [["Bien", "Costó", "Valor acordado", "Se lo queda"]],
      body: sp.rows.map((x) => [x.name, eur(x.price), eur(x.value), x.keeper]),
      headStyles: { fillColor: green },
      columnStyles: { 1: { halign: "right" }, 2: { halign: "right", fontStyle: "bold" } },
      styles: { fontSize: 9 }, margin: { bottom: 24 },
    });
    y = lastY(doc) + 6;
    y = room(doc, y);
    doc.setFont("helvetica", "bold").setFontSize(11).text("Pagos para quedar en paz", 14, y);
    y += 6;
    doc.setFont("helvetica", "normal").setFontSize(10);
    if (sp.transfers.length === 0) { doc.text("Nadie tiene que pagar a nadie.", 14, y); y += 6; }
    for (const t of sp.transfers) { doc.text(`${t.from} paga ${eur(t.cents)} a ${t.to}`, 14, y); y += 6; }
    if (sp.sale) {
      y += 2;
      y = room(doc, y);
      doc.setFont("helvetica", "bold").setFontSize(11).text(`Para vender (valor aproximado ${eur(sp.sale.total)})`, 14, y);
      y += 6;
      doc.setFont("helvetica", "normal").setFontSize(10);
      for (const p of sp.sale.per) { doc.text(`${p.name}: ${eur(p.cents)} (según lo que puso en cada objeto)`, 14, y); y += 6; }
    }
    y += 4;
  }

  // 1b. Salida: lo que ha aportado quien se va
  if (opts.leaving) {
    const who = opts.leaving;
    const mine = r.assets.filter((a) => a.status === "confirmado")
      .map((a) => ({ a, amt: a.participants.find((p) => p.user_id === who.user_id)?.amount_cents ?? 0 }))
      .filter((x) => x.amt > 0);
    y += 4;
    y = room(doc, y);
    doc.setFont("helvetica", "bold").setFontSize(13).text(`Bienes en los que ha puesto dinero ${who.name} (${mine.length})`, 14, y);
    autoTable(doc, {
      startY: y + 3,
      head: [["Bien", "Fecha", "Precio total", `Puso ${who.name}`]],
      body: mine.map(({ a, amt }) => [a.name, fmtDate(a.purchase_date), eur(a.total_cents), eur(amt)]),
      foot: [["Total", "", "", { content: eur(sum(mine.map((x) => x.amt))), styles: { halign: "right" as const } }]],
      headStyles: { fillColor: green }, footStyles: { fillColor: [235, 235, 235], textColor: 20 },
      columnStyles: { 2: { halign: "right" }, 3: { halign: "right", fontStyle: "bold" } },
      styles: { fontSize: 9 }, margin: { bottom: 24 },
    });
    y = lastY(doc) + 4;
    doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(120)
      .text(doc.splitTextToSize("Cómo se reparte su parte (si se la compráis, se lleva cosas, etc.) lo decidís entre vosotros. Este resumen solo muestra lo registrado.", 182), 14, y);
    doc.setTextColor(0);
    y += 10;
  }

  // 2. Bienes confirmados
  const confirmed = r.assets.filter((a) => a.status === "confirmado");
  y += 4;
  y = room(doc, y);
  doc.setFont("helvetica", "bold").setFontSize(13).text(`Bienes confirmados (${confirmed.length})`, 14, y);
  autoTable(doc, {
    startY: y + 3,
    head: [["Bien", "Fecha", "Precio", "Quién pagó", "Confirmado por"]],
    body: confirmed.map((a) => [
      a.name + (a.receipt_path ? "" : "\n(sin ticket)"),
      fmtDate(a.purchase_date),
      eur(a.total_cents),
      a.participants.filter((p) => p.amount_cents > 0).map((p) => `${p.name}: ${eur(p.amount_cents)}`).join("\n"),
      a.confirmations.map((k) => `${k.name} · ${fmtDateTime(k.at)}`).join("\n"),
    ]),
    headStyles: { fillColor: green },
    columnStyles: { 0: { cellWidth: 38 }, 1: { cellWidth: 22 }, 2: { halign: "right", cellWidth: 24 } },
    styles: { fontSize: 9, valign: "top" }, margin: { bottom: 24 },
  });
  y = lastY(doc) + 8;

  // 3. Cuotas confirmadas
  const inst = r.installments.filter((i) => i.status === "confirmado");
  if (inst.length > 0) {
    y = room(doc, y);
    doc.setFont("helvetica", "bold").setFontSize(13).text(`Pagos recurrentes confirmados (${inst.length} cuotas)`, 14, y);
    autoTable(doc, {
      startY: y + 3,
      head: [["Concepto", "Mes", "Importe", "Quién pagó"]],
      body: inst.map((i) => [
        i.concept + (i.is_exception ? "\n(excepción)" : ""),
        fmtMonth(i.period),
        eur(i.amount_cents),
        i.payments.filter((p) => p.amount_cents > 0).map((p) => `${p.name}: ${eur(p.amount_cents)}`).join("\n"),
      ]),
      headStyles: { fillColor: green },
      columnStyles: { 2: { halign: "right" } },
      styles: { fontSize: 9, valign: "top" }, margin: { bottom: 24 },
    });
    y = lastY(doc) + 8;
  }

  // Nota final en cada página
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(120);
    const lines = doc.splitTextToSize(LEGAL_NOTE, 182);
    doc.text(lines, 14, 284);
    doc.text(`${p} / ${pages}`, 196, 292, { align: "right" });
  }
  return doc;
}

function room(doc: jsPDF, y: number) {
  if (y > 240) { doc.addPage(); return 18; }
  return y;
}
function sum(xs: number[]) { return xs.reduce((a, b) => a + b, 0); }
function lastY(doc: jsPDF) { return (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY; }

export function pdfFileName(r: Report, final = false, leaving?: string) {
  const slug = slugify(r.household.name);
  const kind = leaving ? `salida-${slugify(leaving)}` : final ? "inventario-final" : "resumen";
  return `ho-diapp-${kind}-${slug}-${r.generatedAt.toISOString().slice(0, 10)}.pdf`;
}

function slugify(t: string) {
  return t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
}
