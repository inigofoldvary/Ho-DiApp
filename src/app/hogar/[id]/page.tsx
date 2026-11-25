"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase, errorText } from "@/lib/supabase";
import { useRequireUser } from "@/lib/useSession";
import { formatEuros } from "@/lib/money";
import { signedUrls } from "@/lib/photos";
import { STATUS, formatDateTime, formatMonth } from "@/lib/status";
import { perFreq } from "@/lib/frequency";
import { loadMembers, type Member } from "@/lib/members";
import { AppBar, Button, Card, ErrorBox, Loading } from "@/components/ui";

type Asset = {
  id: string; name: string; total_cents: number; status: string; receipt_path: string | null; photo_path: string | null;
  purchase_date: string; visibility: string; created_at: string; gone_reason?: string | null; gone_to?: string | null;
  asset_participants: { user_id: string; amount_cents: number; profiles: { display_name: string } | null }[];
};
type Plan = {
  id: string; asset_id: string | null; concept: string; monthly_cents: number; start_date: string; installments_count: number | null;
  status: string; visibility: string; frequency?: string; created_at: string; installments: { status: string }[];
};
type PendingRow = { subject_type: string; subject_id: string; title: string; amount_cents: number | null; period: string | null };

const PLAN_STATUS: Record<string, { text: string; cls: string }> = { ...STATUS, finalizado: { text: "Terminado", cls: "bg-line text-muted" } };

export default function Hogar() {
  const { id } = useParams<{ id: string }>();
  const user = useRequireUser();
  const [home, setHome] = useState<{ name: string; kind: string; status: string } | null>(null);
  const [me, setMe] = useState<{ joined_at: string; left_at: string | null } | null>(null);
  const [exit, setExit] = useState<{ id: string; leaving_user_id: string } | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState("");
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [plans, setPlans] = useState<Plan[]>([]);
  const [pendingPlans, setPendingPlans] = useState<Set<string>>(new Set());
  const [dues, setDues] = useState<PendingRow[]>([]);
  const [busy, setBusy] = useState("");
  const [payError, setPayError] = useState("");

  const loadPays = useCallback(async () => {
    const db = supabase();
    await db.rpc("sync_installments", { p_household: id });
    const [m, p] = await Promise.all([
      db.rpc("my_pending", { p_household: id }),
      db.from("recurring_plans").select("*, installments(status)").eq("household_id", id).order("start_date", { ascending: false }),
    ]);
    const rows = (m.data ?? []) as PendingRow[];
    setPending(new Set(rows.filter((r) => r.subject_type === "asset").map((r) => r.subject_id)));
    setPendingPlans(new Set(rows.filter((r) => r.subject_type === "recurring_plan").map((r) => r.subject_id)));
    setDues(rows.filter((r) => r.subject_type === "installment" && r.period));
    setPlans((p.data as unknown as Plan[]) ?? []);
  }, [id]);

  async function confirmMonth(period: string) {
    setBusy(period); setPayError("");
    const { error } = await supabase().rpc("confirm_month", { p_household: id, p_period: period });
    setBusy("");
    if (error) return setPayError(errorText(error));
    loadPays();
  }

  useEffect(() => {
    if (!user) return;
    const db = supabase();
    db.from("households").select("name, kind, status").eq("id", id).single().then(({ data, error }) => (error ? setLoadError(errorText(error)) : setHome(data)));
    db.from("household_members").select("joined_at, left_at").eq("household_id", id).eq("user_id", user.id).single()
      .then(({ data }) => setMe(data));
    db.from("dissolutions").select("id, leaving_user_id").eq("household_id", id).eq("kind", "parcial").eq("status", "pendiente")
      .limit(1).then(({ data }) => setExit(data?.[0] ?? null));
    loadMembers(id, user.id).then(setMembers).catch(() => {});
    loadPays();
    db.from("assets")
      .select("*, asset_participants(user_id, amount_cents, profiles(display_name))")
      .eq("household_id", id).order("purchase_date", { ascending: false })
      .then(({ data }) => {
        const list = (data as unknown as Asset[]) ?? [];
        setAssets(list);
        signedUrls(list.map((a) => a.photo_path ?? a.receipt_path ?? "")).then(setUrls);
      });
  }, [user, id, loadPays]);

  if (loadError) return <main className="pt-10"><ErrorBox>No se pudo cargar el hogar: {loadError}</ErrorBox></main>;
  if (!home) return <Loading />;
  const total = assets.filter((a) => !a.gone_reason).reduce((s, a) => s + a.total_cents, 0);
  const iLeft = !!me?.left_at;
  const canEdit = home.status === "activo" && !iLeft;
  // Cuotas pendientes agrupadas por mes (las semanales de un mismo mes van juntas).
  const months = new Map<string, PendingRow[]>();
  for (const d of dues) { const k = d.period!.slice(0, 7) + "-01"; months.set(k, [...(months.get(k) ?? []), d]); }
  const plansOf = (assetId: string) => plans.filter((p) => p.asset_id === assetId);
  const loosePlans = plans.filter((p) => !p.asset_id || !assets.some((a) => a.id === p.asset_id));
  type Entry = { kind: "asset"; a: Asset; date: string } | { kind: "plan"; p: Plan; date: string };
  const entries: Entry[] = [
    ...assets.map((a) => ({ kind: "asset" as const, a, date: a.purchase_date })),
    ...loosePlans.map((p) => ({ kind: "plan" as const, p, date: p.start_date })),
  ].sort((x, y) => y.date.localeCompare(x.date));
  const nameOf = (u?: string | null) => (u === user?.id ? "ti" : members.find((m) => m.user_id === u)?.name ?? "alguien");

  return (
    <main>
      <AppBar right={canEdit ? (
        <Link href={`/hogar/${id}/invitar`} className="rounded-full border border-line px-3 py-1 text-sm">+ Invitar</Link>) : undefined} />
      <Link href="/" className="mb-3 block text-sm text-muted">‹ Tus hogares</Link>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h1 className="min-w-0 truncate text-2xl font-bold tracking-tight">{home.name}</h1>
        <Link href={`/hogar/${id}/reporte`} className="shrink-0 rounded-full border border-line bg-card px-3 py-1 text-sm font-medium">Ver reporte</Link>
      </div>
      {home.status !== "activo" && !exit && (
        <Link href={`/hogar/${id}/disolver`} className="mb-4 block rounded-xl bg-warn-bg px-4 py-3 text-sm font-medium text-warn">
          {home.status === "disuelto" ? "📦 Este hogar está disuelto. Toca para descargar el PDF final." : "🧊 Disolución en marcha: el inventario está congelado. Toca para confirmar."}
        </Link>
      )}

      {iLeft && me?.left_at && (
        <Link href={`/hogar/${id}/disolver`} className="mb-4 block rounded-xl bg-line px-4 py-3 text-sm font-medium text-muted">
          🚪 Saliste de este hogar el {formatDateTime(me.left_at)}. Puedes consultarlo y bajarte el PDF de la salida, pero ya no añadir ni confirmar.
        </Link>
      )}
      {exit && !iLeft && (
        <Link href={`/hogar/${id}/disolver`} className="mb-4 block rounded-xl bg-warn-bg px-4 py-3 text-sm font-medium text-warn">
          🚪 Salida del piso en marcha: el inventario está congelado. Toca para seguir con el reparto.
        </Link>
      )}

      <Card className="mb-5 text-center">
        <p className="text-sm text-muted">Total registrado</p>
        <p className="text-3xl font-bold tracking-tight">{formatEuros(total)}</p>
      </Card>

      {pending.size > 0 && (
        <p className="mb-4 rounded-xl bg-warn-bg px-4 py-3 text-sm font-medium text-warn">
          🔔 Tienes {pending.size} {pending.size === 1 ? "cosa" : "cosas"} por confirmar. Están marcadas abajo.
        </p>
      )}

      {[...months.entries()].sort().map(([period, items]) => (
        <Card key={period} className="mb-4 !border-warn">
          <p className="font-semibold">🔔 ¿Se pagaron los pagos de {formatMonth(period).toLowerCase()}?</p>
          <ul className="my-3 space-y-1 text-sm">
            {items.map((x) => (
              <li key={x.subject_id} className="flex justify-between gap-2">
                <span className="truncate">{x.title}</span><span className="shrink-0 font-medium">{formatEuros(x.amount_cents ?? 0)}</span>
              </li>
            ))}
          </ul>
          <Button onClick={() => confirmMonth(period)} disabled={busy === period}>
            {busy === period ? "Confirmando…" : "Sí, todo pagado ✓"}
          </Button>
          <p className="mt-2 text-xs text-muted">¿Alguno fue distinto? Entra en ese pago y márcalo como excepción.</p>
        </Card>
      ))}
      <ErrorBox>{payError}</ErrorBox>

      <div className="mb-6">
        {canEdit
          ? <Link href={`/hogar/${id}/anadir`}><Button className="!bg-logo !text-white">+ Añadir</Button></Link>
          : <Button disabled className="!bg-logo !text-white">+ Añadir</Button>}
      </div>

      {entries.length === 0 ? (
        <p className="py-10 text-center text-muted">Aún no hay nada apuntado.<br />Empieza por lo más caro: el sofá, la nevera…</p>
      ) : (
        <ul className="space-y-3">
          {entries.map((e) => {
            if (e.kind === "plan") return <PlanCard key={e.p.id} p={e.p} href={`/hogar/${id}/pagos/${e.p.id}`} mine={pendingPlans.has(e.p.id)} />;
            const a = e.a;
            const st = STATUS[a.status];
            const payers = a.asset_participants.filter((p) => p.amount_cents > 0)
              .map((p) => `${p.profiles?.display_name ?? "?"} ${formatEuros(p.amount_cents)}`).join(" · ");
            return (
              <li key={a.id}>
                <Link href={`/hogar/${id}/bien/${a.id}`} className="block">
                <Card className={`flex gap-3 ${pending.has(a.id) ? "!border-warn" : ""}`}>
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-bg text-2xl">
                    {urls[a.photo_path ?? a.receipt_path ?? ""]
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={urls[a.photo_path ?? a.receipt_path ?? ""]} alt="" className="h-full w-full object-cover" />
                      : "📦"}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="truncate font-semibold">{a.name}{a.visibility === "implicados" ? " 🔒" : ""}</p>
                      <p className="shrink-0 font-semibold">{formatEuros(a.total_cents)}</p>
                    </div>
                    <p className="truncate text-sm text-muted">{payers}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5 text-xs font-medium">
                      <span className={`rounded-full px-2 py-0.5 ${st.cls}`}>{st.text}</span>
                      {a.gone_reason && (
                        <span className="rounded-full bg-line px-2 py-0.5 text-muted">
                          {a.gone_reason === "vendido" ? "Para vender" : a.gone_reason === "llevado" ? `Se lo llevó ${nameOf(a.gone_to)}` : `Ahora es de ${nameOf(a.gone_to)}`}
                        </span>)}
                      {!a.receipt_path && <span className="rounded-full bg-line px-2 py-0.5 text-muted">Sin ticket</span>}
                      {pending.has(a.id) && <span className="rounded-full bg-warn px-2 py-0.5 text-white">Te toca confirmar</span>}
                      {plansOf(a.id).map((p) => (
                        <span key={p.id} className={`rounded-full px-2 py-0.5 ${pendingPlans.has(p.id) ? "bg-warn text-white" : "bg-line text-muted"}`}>
                          🔁 {formatEuros(p.monthly_cents)}{perFreq(p.frequency)}{pendingPlans.has(p.id) ? " · confirmar" : ""}
                        </span>))}
                      {me && new Date(a.created_at) < new Date(me.joined_at) && (
                        <span className="rounded-full bg-line px-2 py-0.5 text-muted">De antes de que llegaras</span>)}
                    </div>
                  </div>
                </Card>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {canEdit && (
        <div className="mt-10 space-y-3">
          <Link href={`/hogar/${id}/disolver`} className="block">
            <Button variant="secondary" className="!text-bad">{home.kind === "pareja" ? "Disolver este hogar" : "Alguien se va / disolver el piso"}</Button>
          </Link>
        </div>
      )}
    </main>
  );
}

function PlanCard({ p, href, mine }: { p: Plan; href: string; mine: boolean }) {
  const st = PLAN_STATUS[p.status] ?? PLAN_STATUS.pendiente;
  const done = p.installments.filter((i) => i.status === "confirmado").length;
  return (
    <li>
      <Link href={href} className="block">
        <Card className={`flex gap-3 ${mine ? "!border-warn" : ""}`}>
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-bg text-2xl">🔁</div>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <p className="truncate font-semibold">{p.concept}{p.visibility === "implicados" ? " 🔒" : ""}</p>
              <p className="shrink-0 font-semibold">{formatEuros(p.monthly_cents)}<span className="text-sm font-normal text-muted">{perFreq(p.frequency)}</span></p>
            </div>
            <p className="truncate text-sm text-muted">
              {p.installments_count ? `${done} de ${p.installments_count} cuotas confirmadas` : `${done} cuotas confirmadas · sin fin`}
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5 text-xs font-medium">
              <span className={`rounded-full px-2 py-0.5 ${st.cls}`}>{st.text}</span>
              {mine && <span className="rounded-full bg-warn px-2 py-0.5 text-white">Te toca confirmar</span>}
            </div>
          </div>
        </Card>
      </Link>
    </li>
  );
}
