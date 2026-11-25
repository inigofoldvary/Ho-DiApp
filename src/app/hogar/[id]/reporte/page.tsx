"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { errorText } from "@/lib/supabase";
import { useRequireUser } from "@/lib/useSession";
import { formatEuros } from "@/lib/money";
import { LEGAL_NOTE, loadReport, type Report } from "@/lib/report";
import { formatDate } from "@/lib/status";
import { Button, Card, ErrorBox, Header, Loading } from "@/components/ui";

export default function Reporte() {
  const { id } = useParams<{ id: string }>();
  const user = useRequireUser();
  const [r, setR] = useState<Report | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [cat, setCat] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    loadReport(id).then(setR).catch((e) => setError(errorText(e)));
  }, [user, id]);

  async function download() {
    if (!r) return;
    setBusy(true);
    try {
      const { buildPdf, pdfFileName } = await import("@/lib/pdf");
      buildPdf(r, { final: r.household.status === "disuelto" }).save(pdfFileName(r, r.household.status === "disuelto"));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  if (error) return <main><Header title="Reporte" back={`/hogar/${id}`} /><ErrorBox>{error}</ErrorBox></main>;
  if (!r) return <Loading />;

  const totalConfirmed = r.people.reduce((s, p) => s + p.assets + p.recurring, 0);
  const totalPending = r.people.reduce((s, p) => s + p.pending, 0);
  const allConfirmed = r.assets.filter((a) => a.status === "confirmado");
  const catOf = (a: { category: string | null }) => a.category || "Sin tipo";
  const cats = [...new Set(allConfirmed.map(catOf))].sort((x, y) => (x === "Sin tipo" ? 1 : y === "Sin tipo" ? -1 : x.localeCompare(y, "es")));
  const confirmed = cat ? allConfirmed.filter((a) => catOf(a) === cat) : allConfirmed;
  const catTotal = confirmed.reduce((s, a) => s + a.total_cents, 0);
  const maxPerson = Math.max(1, ...r.people.map((p) => p.assets + p.recurring));

  return (
    <main className="pb-24">
      <Header title="Reporte" back={`/hogar/${id}`} />

      <Card className="mb-4">
        <p className="text-sm text-muted">Total confirmado</p>
        <p className="text-3xl font-bold tracking-tight">{formatEuros(totalConfirmed)}</p>
        {totalPending > 0 && <p className="mt-1 text-sm text-warn">+ {formatEuros(totalPending)} pendientes de confirmar (no cuentan)</p>}
      </Card>

      <h2 className="mb-2 text-sm font-semibold text-muted">Cuánto ha aportado cada uno</h2>
      <Card className="mb-5 space-y-4">
        {r.people.map((p) => {
          const t = p.assets + p.recurring;
          return (
            <div key={p.user_id}>
              <div className="flex items-baseline justify-between">
                <span className="font-medium">{p.user_id === user?.id ? `${p.name} (tú)` : p.name}</span>
                <span className="font-semibold">{formatEuros(t)}</span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-line">
                <div className="h-full rounded-full bg-brand" style={{ width: `${(t / maxPerson) * 100}%` }} />
              </div>
              <p className="mt-1 text-xs text-muted">
                Bienes {formatEuros(p.assets)} · Pagos recurrentes {formatEuros(p.recurring)}
              </p>
            </div>
          );
        })}
      </Card>

      <h2 className="mb-2 text-sm font-semibold text-muted">Bienes confirmados ({confirmed.length}{cat ? ` de ${cat}` : ""} · {formatEuros(catTotal)})</h2>
      {cats.length > 1 && (
        <div className="mb-3 flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Filtrar por tipo">
          {[null, ...cats].map((c) => (
            <button key={c ?? "todos"} type="button" onClick={() => setCat(c)} aria-pressed={cat === c}
              className={`shrink-0 rounded-full border px-3 py-1 text-sm ${cat === c ? "border-brand bg-brand font-semibold text-brand-ink" : "border-line bg-card text-muted"}`}>
              {c ?? "Todos"}{c ? ` (${allConfirmed.filter((a) => catOf(a) === c).length})` : ""}
            </button>
          ))}
        </div>
      )}
      {confirmed.length === 0 ? (
        <p className="mb-5 text-sm text-muted">Aún no hay bienes confirmados por todos.</p>
      ) : (
        <Card className="mb-5 divide-y divide-line !p-0">
          {confirmed.map((a) => (
            <div key={a.id} className="px-4 py-3">
              <div className="flex justify-between gap-2">
                <span className="font-medium">{a.name}{a.category && <span className="ml-2 rounded-full bg-line px-2 py-0.5 text-xs font-normal text-muted">{a.category}</span>}</span>
                <span className="font-semibold">{formatEuros(a.total_cents)}</span>
              </div>
              <p className="text-xs text-muted">
                {formatDate(a.purchase_date)} · {a.participants.filter((p) => p.amount_cents > 0).map((p) => `${p.name} ${formatEuros(p.amount_cents)}`).join(" · ")}
              </p>
            </div>
          ))}
        </Card>
      )}

      <p className="mb-4 text-xs text-muted">{LEGAL_NOTE}</p>

      <div className="fixed inset-x-0 bottom-0 border-t border-line bg-bg/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto max-w-md">
          <Button onClick={download} disabled={busy}>{busy ? "Preparando PDF…" : "Descargar PDF"}</Button>
        </div>
      </div>
    </main>
  );
}
