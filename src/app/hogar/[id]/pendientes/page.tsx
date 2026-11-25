"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase, errorText } from "@/lib/supabase";
import { useRequireUser } from "@/lib/useSession";
import { formatEuros } from "@/lib/money";
import { formatMonth } from "@/lib/status";
import { Card, ErrorBox, Header, Loading } from "@/components/ui";

type Row = { subject_type: string; subject_id: string; title: string; amount_cents: number | null; period: string | null };

/** Todo lo que me toca confirmar en este hogar. */
export default function Pendientes() {
  const { id } = useParams<{ id: string }>();
  const user = useRequireUser();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [plans, setPlans] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) return;
    const db = supabase();
    db.rpc("my_pending", { p_household: id }).then(async ({ data, error }) => {
      if (error) return setError(errorText(error));
      const list = (data ?? []) as Row[];
      setRows(list);
      const inst = list.filter((r) => r.subject_type === "installment").map((r) => r.subject_id);
      if (inst.length) {
        const { data: i } = await db.from("installments").select("id, plan_id").in("id", inst);
        setPlans(Object.fromEntries(((i ?? []) as { id: string; plan_id: string }[]).map((x) => [x.id, x.plan_id])));
      }
    });
  }, [user, id]);

  if (error) return <main><Header title="Por confirmar" back={`/hogar/${id}`} /><ErrorBox>{error}</ErrorBox></main>;
  if (!rows) return <Loading />;
  const href = (r: Row) =>
    r.subject_type === "asset" ? `/hogar/${id}/bien/${r.subject_id}`
      : r.subject_type === "recurring_plan" ? `/hogar/${id}/pagos/${r.subject_id}`
      : r.subject_type === "installment" && plans[r.subject_id] ? `/hogar/${id}/pagos/${plans[r.subject_id]}`
      : `/hogar/${id}/disolver`;
  const label = (r: Row) =>
    r.subject_type === "asset" ? "Bien" : r.subject_type === "recurring_plan" ? "Pago que se repite"
      : r.subject_type === "installment" ? `Cuota de ${r.period ? formatMonth(r.period).toLowerCase() : ""}` : "Reparto";

  return (
    <main className="pb-10">
      <Header title="Te toca confirmar" back={`/hogar/${id}`} />
      {rows.length === 0 ? (
        <p className="py-10 text-center text-muted">¡Nada pendiente! Lo tienes todo al día ✓</p>
      ) : (
        <Card className="divide-y divide-line !p-0">
          {rows.map((r) => (
            <Link key={r.subject_type + r.subject_id} href={href(r)} className="flex items-center justify-between gap-3 px-4 py-3">
              <span className="min-w-0">
                <span className="block truncate font-medium">{r.title}</span>
                <span className="block text-xs text-muted">{label(r)}</span>
              </span>
              <span className="shrink-0 font-semibold tabular-nums">{r.amount_cents !== null ? formatEuros(r.amount_cents) : ""} ›</span>
            </Link>
          ))}
        </Card>
      )}
      <p className="mt-4 text-xs text-muted">Toca cada cosa para revisarla y confirmarla, o decir que no es así.</p>
    </main>
  );
}
