"use client";
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase, errorText } from "@/lib/supabase";
import { useRequireUser } from "@/lib/useSession";
import { formatEuros, parseEuros } from "@/lib/money";
import { loadMembers, type Member } from "@/lib/members";
import { STATUS, formatDateTime, formatMonth } from "@/lib/status";
import { SharesEditor, centsToInput, sharesCheck, type ShareRow } from "@/components/SharesEditor";
import { Button, Card, ErrorBox, Header, Loading } from "@/components/ui";

type Plan = {
  id: string; household_id: string; concept: string; monthly_cents: number; start_date: string; installments_count: number | null;
  status: string; version: number; visibility: string; created_by: string; created_at: string; asset_id: string | null;
  recurring_plan_shares: { user_id: string; amount_cents: number }[];
  assets: { name: string } | null;
};
type Inst = {
  id: string; period: string; seq: number; amount_cents: number; status: string; version: number;
  is_exception: boolean; exception_note: string | null;
  installment_payments: { user_id: string; amount_cents: number }[];
};
type Conf = { subject_type: string; subject_id: string; subject_version: number; user_id: string; decision: string; comment: string | null; created_at: string };

const ST: Record<string, { text: string; cls: string }> = { ...STATUS, finalizado: { text: "Terminado", cls: "bg-line text-muted" } };

export default function PlanDetail() {
  const { id, planId } = useParams<{ id: string; planId: string }>();
  const router = useRouter();
  const user = useRequireUser();
  const [plan, setPlan] = useState<Plan | null>(null);
  const [insts, setInsts] = useState<Inst[]>([]);
  const [confs, setConfs] = useState<Conf[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [frozen, setFrozen] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [comment, setComment] = useState("");
  const [exceptionFor, setExceptionFor] = useState<Inst | null>(null);
  const [excRows, setExcRows] = useState<ShareRow[]>([]);
  const [excNote, setExcNote] = useState("");
  const [confirmersDb, setConfirmersDb] = useState<Record<string, string[]> | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    const db = supabase();
    const [p, i, h] = await Promise.all([
      db.from("recurring_plans").select("*, recurring_plan_shares(user_id, amount_cents), assets(name)").eq("id", planId).single(),
      db.from("installments").select("id, period, seq, amount_cents, status, version, is_exception, exception_note, installment_payments(user_id, amount_cents)")
        .eq("plan_id", planId).order("period", { ascending: false }),
      db.from("households").select("status").eq("id", id).single(),
    ]);
    if (p.error) return setError(p.error.code === "PGRST116" ? "Este pago no existe o no tienes acceso." : errorText(p.error));
    const instList = (i.data as unknown as Inst[]) ?? [];
    const ids = [planId, ...instList.map((x) => x.id)];
    const [k1, k2] = await Promise.all([
      db.rpc("subject_confirmers", { p_type: "recurring_plan", p_ids: [planId] }),
      db.rpc("subject_confirmers", { p_type: "installment", p_ids: instList.map((x) => x.id) }),
    ]);
    if (!k1.error && !k2.error) {
      const map: Record<string, string[]> = {};
      for (const r of [...(k1.data ?? []), ...(k2.data ?? [])] as { subject_id: string; user_id: string }[]) {
        (map[r.subject_id] ??= []).push(r.user_id);
      }
      setConfirmersDb(map);
    }
    const c = await db.from("confirmations").select("subject_type, subject_id, subject_version, user_id, decision, comment, created_at")
      .in("subject_id", ids).order("created_at");
    setPlan(p.data as unknown as Plan);
    setInsts(instList);
    setConfs((c.data as Conf[]) ?? []);
    setFrozen(h.data?.status !== "activo");
    setMembers(await loadMembers(id, user.id));
  }, [planId, id, user]);

  useEffect(() => { load(); }, [load]);

  if (error && !plan) return <main><Header title="Pago" back={`/hogar/${id}/pagos`} /><ErrorBox>{error}</ErrorBox></main>;
  if (!plan || !user) return <Loading />;

  const nameOf = (u: string) => (u === user.id ? "Tú" : members.find((m) => m.user_id === u)?.name ?? "Antiguo miembro");
  const active = members.filter((m) => m.active).map((m) => m.user_id);
  const shareUsers = plan.recurring_plan_shares.map((s) => s.user_id);
  const planConfirmers = confirmersDb?.[plan.id] ?? (shareUsers.length === 1 ? active : shareUsers);
  const answerOf = (type: string, sid: string, v: number, u: string) =>
    confs.find((c) => c.subject_type === type && c.subject_id === sid && c.subject_version === v && c.user_id === u);
  const myPlanAnswer = answerOf("recurring_plan", plan.id, plan.version, user.id);
  const canAnswerPlan = plan.status === "pendiente" && planConfirmers.includes(user.id) && !myPlanAnswer && !frozen;
  const st = ST[plan.status] ?? ST.pendiente;

  async function call(fn: string, args: Record<string, unknown>) {
    setBusy(true); setError("");
    const { error } = await supabase().rpc(fn, args);
    setBusy(false);
    if (error) { setError(errorText(error)); return false; }
    await load();
    return true;
  }

  function openException(i: Inst) {
    setExceptionFor(i);
    setExcNote("");
    setExcRows(members.filter((m) => m.active || i.installment_payments.some((p) => p.user_id === m.user_id)).map((m) => {
      const p = i.installment_payments.find((x) => x.user_id === m.user_id);
      return { user_id: m.user_id, name: m.name, involved: !!p, amount: p && p.amount_cents > 0 ? centsToInput(p.amount_cents) : "" };
    }));
  }

  const excTotal = excRows.filter((r) => r.involved).reduce((s, r) => s + (parseEuros(r.amount) ?? 0), 0);
  const excCheck = sharesCheck(excRows, excTotal || null);

  return (
    <main className="pb-28">
      <Header title={plan.concept} back={`/hogar/${id}/pagos`} />
      <ErrorBox>{error}</ErrorBox>

      <Card className="mb-4">
        <p className="text-3xl font-bold tracking-tight">{formatEuros(plan.monthly_cents)}<span className="text-base font-normal text-muted"> /mes</span></p>
        <p className="text-sm text-muted">
          Desde {formatMonth(plan.start_date).toLowerCase()} · {plan.installments_count ? `${plan.installments_count} cuotas` : "sin fin"}
          {plan.assets ? ` · para: ${plan.assets.name}` : ""}
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5 text-xs font-medium">
          <span className={`rounded-full px-2 py-0.5 ${st.cls}`}>{st.text}</span>
          {plan.visibility === "implicados" && <span className="rounded-full bg-line px-2 py-0.5 text-muted">🔒 Privado</span>}
        </div>
      </Card>

      <h2 className="mb-2 text-sm font-semibold text-muted">Cuánto pone cada uno al mes</h2>
      <Card className="mb-4 divide-y divide-line !p-0">
        {plan.recurring_plan_shares.map((s) => (
          <div key={s.user_id} className="flex justify-between px-4 py-3">
            <span className="font-medium">{nameOf(s.user_id)}</span><span className="font-semibold">{formatEuros(s.amount_cents)}</span>
          </div>
        ))}
      </Card>

      <h2 className="mb-2 text-sm font-semibold text-muted">Confirmación del pago</h2>
      <Card className="mb-4 divide-y divide-line !p-0">
        {planConfirmers.map((u) => {
          const a = answerOf("recurring_plan", plan.id, plan.version, u);
          return (
            <div key={u} className="px-4 py-3">
              <span className="font-medium">{nameOf(u)}</span>
              <p className={`text-sm ${a?.decision === "confirmar" ? "text-ok" : a?.decision === "rechazar" ? "text-bad" : "text-muted"}`}>
                {a?.decision === "confirmar" ? `✓ Confirmado · ${formatDateTime(a.created_at)}`
                  : a?.decision === "rechazar" ? `✗ No es así · ${formatDateTime(a.created_at)}` : "⏳ Falta que confirme"}
              </p>
              {a?.comment && <p className="mt-1 rounded-lg bg-bad-bg px-3 py-2 text-sm text-bad">“{a.comment}”</p>}
            </div>
          );
        })}
      </Card>

      {plan.created_by === user.id && (plan.status === "pendiente" || plan.status === "rechazado") && !frozen && (
        <div className="mb-5">
          <Button variant="secondary" className="!text-bad" disabled={busy} onClick={async () => {
            if (!confirm("¿Borrar este pago recurrente?")) return;
            if (await call("delete_recurring_plan", { p_plan: plan.id })) router.replace(`/hogar/${id}/pagos`);
          }}>Borrar pago</Button>
          {plan.status === "rechazado" && <p className="mt-2 text-xs text-muted">Alguien dijo que no es así. Bórralo y créalo de nuevo con los datos correctos.</p>}
        </div>
      )}

      {insts.length > 0 && (
        <>
          <h2 className="mb-2 text-sm font-semibold text-muted">Cuotas</h2>
          <ul className="mb-6 space-y-3">
            {insts.map((i) => {
              const ist = STATUS[i.status];
              const confirmers = confirmersDb?.[i.id] ?? [...new Set([...planConfirmers, ...i.installment_payments.map((p) => p.user_id)])];
              const mine = answerOf("installment", i.id, i.version, user.id);
              const canAnswer = i.status === "pendiente" && confirmers.includes(user.id) && !mine && !frozen;
              const missing = confirmers.filter((u) => !answerOf("installment", i.id, i.version, u));
              return (
                <li key={i.id}>
                  <Card>
                    <div className="flex items-baseline justify-between">
                      <span className="font-semibold">{formatMonth(i.period)}</span>
                      <span className="font-semibold">{formatEuros(i.amount_cents)}</span>
                    </div>
                    <p className="text-xs text-muted">
                      Cuota {i.seq} · {i.installment_payments.filter((p) => p.amount_cents > 0).map((p) => `${nameOf(p.user_id)} ${formatEuros(p.amount_cents)}`).join(" · ") || "nadie pagó"}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5 text-xs font-medium">
                      <span className={`rounded-full px-2 py-0.5 ${ist.cls}`}>{ist.text}</span>
                      {i.is_exception && <span className="rounded-full bg-warn-bg px-2 py-0.5 text-warn">Excepción</span>}
                    </div>
                    {i.exception_note && <p className="mt-2 text-sm text-muted">“{i.exception_note}”</p>}
                    {i.status === "pendiente" && missing.length > 0 && (
                      <p className="mt-1 text-xs text-muted">Falta: {missing.map(nameOf).join(", ")}</p>
                    )}
                    {canAnswer && (
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <Button variant="secondary" onClick={() => openException(i)} disabled={busy}>Fue distinto</Button>
                        <Button onClick={() => call("respond", { p_subject_type: "installment", p_subject_id: i.id, p_decision: "confirmar" })} disabled={busy}>Pagado ✓</Button>
                      </div>
                    )}
                  </Card>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {exceptionFor && (
        <div className="fixed inset-0 z-20 flex items-end bg-black/40" onClick={() => setExceptionFor(null)}>
          <div className="mx-auto max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-3xl bg-bg p-4" onClick={(e) => e.stopPropagation()}>
            <p className="mb-1 text-lg font-semibold">{formatMonth(exceptionFor.period)}: ¿qué pasó?</p>
            <p className="mb-4 text-sm text-muted">Pon lo que pagó de verdad cada uno este mes. Los demás tendrán que confirmarlo.</p>
            <SharesEditor rows={excRows} setRows={setExcRows} total={excTotal || null}
              me={user.id} canToggle title="Lo que pagó cada uno" />
            <textarea value={excNote} onChange={(e) => setExcNote(e.target.value)} rows={2}
              placeholder="Ej. Pepe no pagó este mes, lo pagué yo todo"
              className="mt-3 w-full rounded-xl border border-line bg-card px-4 py-3 outline-none focus:border-brand" />
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Button variant="secondary" onClick={() => setExceptionFor(null)}>Cancelar</Button>
              <Button disabled={busy || !excNote.trim() || !excCheck.ok} onClick={async () => {
                if (await call("set_installment_exception", { p_installment: exceptionFor.id, p_payments: excCheck.shares, p_note: excNote })) setExceptionFor(null);
              }}>Guardar</Button>
            </div>
          </div>
        </div>
      )}

      {canAnswerPlan && (
        <div className="fixed inset-x-0 bottom-0 border-t border-line bg-bg/95 px-4 py-3 backdrop-blur">
          <div className="mx-auto max-w-md space-y-2">
            {rejecting ? (
              <>
                <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} autoFocus
                  placeholder="¿Qué no está bien?" className="w-full rounded-xl border border-line bg-card px-4 py-3 outline-none focus:border-brand" />
                <div className="grid grid-cols-2 gap-3">
                  <Button variant="secondary" onClick={() => setRejecting(false)}>Cancelar</Button>
                  <Button className="!bg-bad" disabled={busy || !comment.trim()}
                    onClick={async () => { if (await call("respond", { p_subject_type: "recurring_plan", p_subject_id: plan.id, p_decision: "rechazar", p_comment: comment })) setRejecting(false); }}>Enviar</Button>
                </div>
              </>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <Button variant="secondary" onClick={() => setRejecting(true)} disabled={busy}>No es así</Button>
                <Button onClick={() => call("respond", { p_subject_type: "recurring_plan", p_subject_id: plan.id, p_decision: "confirmar" })} disabled={busy}>Confirmar ✓</Button>
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
