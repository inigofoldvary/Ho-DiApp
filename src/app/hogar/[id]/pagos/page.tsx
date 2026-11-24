"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase, errorText } from "@/lib/supabase";
import { useRequireUser } from "@/lib/useSession";
import { formatEuros } from "@/lib/money";
import { STATUS, formatMonth } from "@/lib/status";
import { Button, Card, ErrorBox, Header, Loading } from "@/components/ui";

type Plan = {
  id: string; concept: string; monthly_cents: number; start_date: string; installments_count: number | null;
  status: string; visibility: string; installments: { status: string }[];
};
type Pending = { subject_type: string; subject_id: string; title: string; amount_cents: number | null; period: string | null };

const PLAN_STATUS: Record<string, { text: string; cls: string }> = {
  ...STATUS,
  finalizado: { text: "Terminado", cls: "bg-line text-muted" },
};

export default function Pagos() {
  const { id } = useParams<{ id: string }>();
  const user = useRequireUser();
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    const db = supabase();
    await db.rpc("sync_installments", { p_household: id });
    const [p, m] = await Promise.all([
      db.from("recurring_plans").select("id, concept, monthly_cents, start_date, installments_count, status, visibility, installments(status)")
        .eq("household_id", id).order("created_at", { ascending: false }),
      db.rpc("my_pending", { p_household: id }),
    ]);
    if (p.error) return setError(errorText(p.error));
    setPlans((p.data as unknown as Plan[]) ?? []);
    setPending(((m.data ?? []) as Pending[]).filter((x) => x.subject_type === "installment" || x.subject_type === "recurring_plan"));
  }, [id]);

  useEffect(() => { if (user) load(); }, [user, load]);

  async function confirmMonth(period: string) {
    setBusy(period); setError("");
    const { error } = await supabase().rpc("confirm_month", { p_household: id, p_period: period });
    setBusy("");
    if (error) return setError(errorText(error));
    load();
  }

  if (!plans) return error ? <main className="pt-10"><ErrorBox>{error}</ErrorBox></main> : <Loading />;

  const months = new Map<string, Pending[]>();
  for (const x of pending.filter((x) => x.subject_type === "installment")) {
    const k = x.period!;
    months.set(k, [...(months.get(k) ?? []), x]);
  }
  const pendingPlans = new Set(pending.filter((x) => x.subject_type === "recurring_plan").map((x) => x.subject_id));

  return (
    <main>
      <Header title="Pagos recurrentes" back={`/hogar/${id}`} />
      <ErrorBox>{error}</ErrorBox>

      {[...months.entries()].sort().map(([period, items]) => (
        <Card key={period} className="mb-4 !border-warn">
          <p className="font-semibold">🔔 ¿Se pagaron los pagos de {formatMonth(period).toLowerCase()}?</p>
          <ul className="my-3 space-y-1 text-sm">
            {items.map((x) => (
              <li key={x.subject_id} className="flex justify-between">
                <span>{x.title}</span><span className="font-medium">{formatEuros(x.amount_cents ?? 0)}</span>
              </li>
            ))}
          </ul>
          <Button onClick={() => confirmMonth(period)} disabled={busy === period}>
            {busy === period ? "Confirmando…" : "Sí, todo pagado ✓"}
          </Button>
          <p className="mt-2 text-xs text-muted">¿Alguno fue distinto? Entra en ese pago y márcalo como excepción.</p>
        </Card>
      ))}

      <Link href={`/hogar/${id}/pagos/nuevo`} className="mb-5 block"><Button>+ Nuevo pago recurrente</Button></Link>

      {plans.length === 0 ? (
        <p className="py-10 text-center text-muted">Aquí van las cosas que se pagan a plazos:<br />el coche, la hipoteca, un préstamo…</p>
      ) : (
        <ul className="space-y-3">
          {plans.map((p) => {
            const st = PLAN_STATUS[p.status] ?? PLAN_STATUS.pendiente;
            const done = p.installments.filter((i) => i.status === "confirmado").length;
            return (
              <li key={p.id}>
                <Link href={`/hogar/${id}/pagos/${p.id}`} className="block">
                  <Card className={pendingPlans.has(p.id) ? "!border-warn" : ""}>
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="truncate font-semibold">{p.concept}{p.visibility === "implicados" ? " 🔒" : ""}</p>
                      <p className="shrink-0 font-semibold">{formatEuros(p.monthly_cents)}<span className="text-sm font-normal text-muted">/mes</span></p>
                    </div>
                    <p className="text-sm text-muted">
                      Desde {formatMonth(p.start_date).toLowerCase()} · {p.installments_count ? `${done} de ${p.installments_count} cuotas confirmadas` : `${done} cuotas confirmadas · sin fin`}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5 text-xs font-medium">
                      <span className={`rounded-full px-2 py-0.5 ${st.cls}`}>{st.text}</span>
                      {pendingPlans.has(p.id) && <span className="rounded-full bg-warn px-2 py-0.5 text-white">Te toca confirmar</span>}
                    </div>
                  </Card>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
