"use client";
import { formatEuros, parseEuros } from "@/lib/money";

export type ShareRow = { user_id: string; name: string; involved: boolean; amount: string };

export function centsToInput(c: number) {
  return (c / 100).toFixed(2).replace(".", ",").replace(",00", "");
}

function splitEqual(total: number, n: number): number[] {
  const base = Math.floor(total / n);
  return Array.from({ length: n }, (_, i) => base + (i < total - base * n ? 1 : 0));
}

/** Resultado de comprobar que las aportaciones cuadran con el total. */
export function sharesCheck(rows: ShareRow[], total: number | null) {
  const involved = rows.filter((r) => r.involved);
  const sum = involved.reduce((s, r) => s + (parseEuros(r.amount) ?? 0), 0);
  const bad = involved.some((r) => r.amount.trim() !== "" && parseEuros(r.amount) === null);
  const diff = total === null ? null : total - sum;
  const ok = total !== null && total > 0 && diff === 0 && !bad && involved.length > 0;
  let text = "";
  if (total !== null && total > 0) {
    if (bad) text = "Hay una cantidad que no se entiende";
    else if (diff === 0) text = "Cuadra con el total";
    else if (diff! > 0) text = `Faltan ${formatEuros(diff!)} por repartir`;
    else text = `Sobran ${formatEuros(-diff!)}: la suma pasa del total`;
  }
  return { ok, text, involved, shares: involved.map((r) => ({ user_id: r.user_id, amount_cents: parseEuros(r.amount) ?? 0 })) };
}

export function SharesEditor({ rows, setRows, total, me, canToggle, title }: {
  rows: ShareRow[]; setRows: (r: ShareRow[]) => void; total: number | null; me: string; canToggle: boolean; title: string;
}) {
  const check = sharesCheck(rows, total);
  const update = (i: number, patch: Partial<ShareRow>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <section>
      <p className="mb-2 text-sm font-medium text-muted">{title}</p>
      <div className="mb-3 flex gap-2">
        <button type="button" disabled={total === null}
          onClick={() => setRows(rows.map((r) => (r.user_id === me ? { ...r, involved: true, amount: centsToInput(total!) } : { ...r, amount: "" })))}
          className="rounded-full border border-line bg-card px-3 py-1.5 text-sm disabled:opacity-40">Lo pago yo todo</button>
        <button type="button" disabled={total === null}
          onClick={() => { const all = check.involved.length <= 1; const parts = splitEqual(total!, all ? rows.length : check.involved.length); let k = 0;
            setRows(rows.map((r) => (all || r.involved ? { ...r, involved: true, amount: centsToInput(parts[k++]) } : r))); }}
          className="rounded-full border border-line bg-card px-3 py-1.5 text-sm disabled:opacity-40">A partes iguales</button>
      </div>
      <div className="divide-y divide-line rounded-2xl border border-line bg-card">
        {rows.map((r, i) => (
          <div key={r.user_id} className={`flex items-center gap-3 px-4 py-2.5 ${r.involved ? "" : "opacity-50"}`}>
            {canToggle && (
              <input type="checkbox" checked={r.involved} aria-label={`${r.name} participa`}
                onChange={(e) => update(i, { involved: e.target.checked, amount: e.target.checked ? r.amount : "" })}
                className="h-5 w-5 accent-[var(--brand)]" />
            )}
            <span className="flex-1 truncate">{r.name}{r.user_id === me ? " (tú)" : ""}</span>
            <input value={r.amount} onChange={(e) => update(i, { amount: e.target.value, involved: r.involved || e.target.value.trim() !== "" })}
              inputMode="decimal" placeholder="0" aria-label={`Cuánto pone ${r.name}`}
              className="w-24 rounded-lg border border-line bg-bg px-2 py-1.5 text-right outline-none focus:border-brand" />
            <span className="text-muted">€</span>
          </div>
        ))}
      </div>
      {check.text && (
        <p className={`mt-2 rounded-xl px-3 py-2 text-sm ${check.ok ? "bg-ok-bg text-ok" : "bg-warn-bg text-warn"}`}>
          {check.ok ? "✓ " : ""}{check.text}
        </p>
      )}
    </section>
  );
}
