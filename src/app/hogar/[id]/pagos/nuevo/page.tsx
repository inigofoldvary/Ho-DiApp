"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase, errorText } from "@/lib/supabase";
import { useRequireUser } from "@/lib/useSession";
import { parseEuros } from "@/lib/money";
import { loadMembers } from "@/lib/members";
import { SharesEditor, sharesCheck, type ShareRow } from "@/components/SharesEditor";
import { Button, ErrorBox, Field, Header, Loading } from "@/components/ui";

function thisMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default function NuevoPago() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const user = useRequireUser();
  const [rows, setRows] = useState<ShareRow[] | null>(null);
  const [kind, setKind] = useState("");
  const [assets, setAssets] = useState<{ id: string; name: string }[]>([]);
  const [concept, setConcept] = useState("");
  const [monthly, setMonthly] = useState("");
  const [start, setStart] = useState(thisMonth());
  const [endless, setEndless] = useState(false);
  const [count, setCount] = useState("");
  const [assetId, setAssetId] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    const db = supabase();
    loadMembers(id, user.id).then((ms) =>
      setRows(ms.filter((m) => m.active).map((m) => ({ user_id: m.user_id, name: m.name, involved: true, amount: "" }))))
      .catch((e) => setError(errorText(e)));
    db.from("households").select("kind").eq("id", id).single().then(({ data }) => setKind(data?.kind ?? ""));
    db.from("assets").select("id, name").eq("household_id", id).order("name").then(({ data }) => setAssets(data ?? []));
  }, [user, id]);

  const total = parseEuros(monthly);
  const check = sharesCheck(rows ?? [], total);
  const n = parseInt(count, 10);
  const countOk = endless || (Number.isInteger(n) && n > 0 && n <= 1200);
  const canSave = !!concept.trim() && check.ok && countOk && /^\d{4}-\d{2}$/.test(start) && !busy;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    setBusy(true); setError("");
    const priv = isPrivate && check.involved.length >= 2;
    const { data, error } = await supabase().rpc("create_recurring_plan", {
      p_household: id, p_concept: concept, p_monthly_cents: total, p_start_date: `${start}-01`,
      p_installments_count: endless ? null : n, p_shares: check.shares,
      p_visibility: priv ? "implicados" : "hogar", p_asset: assetId || null,
    });
    setBusy(false);
    if (error) return setError(errorText(error));
    router.replace(`/hogar/${id}/pagos/${data}`);
  }

  if (!rows || !user) return error ? <main className="pt-10"><ErrorBox>{error}</ErrorBox></main> : <Loading />;
  const isPiso = kind === "piso";

  return (
    <main>
      <Header title="Nuevo pago recurrente" back={`/hogar/${id}/pagos`} />
      <form onSubmit={save} className="space-y-5">
        <Field label="Concepto" value={concept} onChange={(e) => setConcept(e.target.value)} required maxLength={120}
          placeholder="Letra del coche, hipoteca…" autoFocus />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Cuota al mes (€)" value={monthly} onChange={(e) => setMonthly(e.target.value)} inputMode="decimal" placeholder="0,00" required />
          <Field label="Primer mes" type="month" value={start} onChange={(e) => setStart(e.target.value)} required />
        </div>

        <div>
          <span className="mb-1 block text-sm font-medium text-muted">¿Cuántas cuotas?</span>
          <div className="flex items-center gap-3">
            <input value={endless ? "" : count} onChange={(e) => setCount(e.target.value)} disabled={endless} inputMode="numeric"
              placeholder="Ej. 48" aria-label="Número de cuotas"
              className="w-28 rounded-xl border border-line bg-card px-4 py-3 outline-none focus:border-brand disabled:opacity-40" />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={endless} onChange={(e) => setEndless(e.target.checked)} className="h-5 w-5 accent-[var(--brand)]" />
              Sin fin
            </label>
          </div>
        </div>

        <SharesEditor rows={rows} setRows={setRows} total={total} me={user.id} canToggle={isPiso} title="¿Cuánto pone cada uno al mes?" />

        {assets.length > 0 && (
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-muted">¿Es para pagar un bien? (opcional)</span>
            <select value={assetId} onChange={(e) => setAssetId(e.target.value)}
              className="w-full rounded-xl border border-line bg-card px-4 py-3 outline-none focus:border-brand">
              <option value="">No, ninguno</option>
              {assets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <span className="mt-1 block text-xs text-muted">Ej. el coche: la entrada va como bien y las cuotas aquí.</span>
          </label>
        )}

        {isPiso && (
          <label className="flex items-start gap-3 rounded-2xl border border-line bg-card p-4">
            <input type="checkbox" checked={isPrivate && check.involved.length >= 2} disabled={check.involved.length < 2}
              onChange={(e) => setIsPrivate(e.target.checked)} className="mt-0.5 h-5 w-5 accent-[var(--brand)]" />
            <span>
              <span className="block font-medium">Privado 🔒</span>
              <span className="block text-sm text-muted">Solo lo verán las personas que participan.</span>
            </span>
          </label>
        )}

        <p className="text-xs text-muted">Todos los que participan tienen que confirmar este pago. Después, cada mes se crea la cuota y también se confirma.</p>
        <ErrorBox>{error}</ErrorBox>
        <div className="sticky bottom-0 -mx-4 bg-bg/95 px-4 py-3 backdrop-blur">
          <Button type="submit" disabled={!canSave}>{busy ? "Guardando…" : "Guardar"}</Button>
        </div>
      </form>
    </main>
  );
}
