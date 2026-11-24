"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase, errorText } from "@/lib/supabase";
import { useRequireUser } from "@/lib/useSession";
import { formatEuros } from "@/lib/money";
import { signedUrls } from "@/lib/photos";
import { STATUS, formatDateTime } from "@/lib/status";
import { loadMembers, type Member } from "@/lib/members";
import { AppBar, Button, Card, ErrorBox, Loading } from "@/components/ui";

type Asset = {
  id: string; name: string; total_cents: number; status: string; receipt_path: string | null; photo_path: string | null;
  purchase_date: string; visibility: string; created_at: string;
  asset_participants: { user_id: string; amount_cents: number; profiles: { display_name: string } | null }[];
};


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
  const [pendingPays, setPendingPays] = useState(0);
  const [planCount, setPlanCount] = useState<number | null>(null);

  useEffect(() => {
    if (!user) return;
    const db = supabase();
    db.from("households").select("name, kind, status").eq("id", id).single().then(({ data, error }) => (error ? setLoadError(errorText(error)) : setHome(data)));
    db.from("household_members").select("joined_at, left_at").eq("household_id", id).eq("user_id", user.id).single()
      .then(({ data }) => setMe(data));
    db.from("dissolutions").select("id, leaving_user_id").eq("household_id", id).eq("kind", "parcial").eq("status", "pendiente")
      .limit(1).then(({ data }) => setExit(data?.[0] ?? null));
    loadMembers(id, user.id).then(setMembers).catch(() => {});
    db.from("recurring_plans").select("id", { count: "exact", head: true }).eq("household_id", id)
      .then(({ count }) => setPlanCount(count ?? 0));
    db.rpc("sync_installments", { p_household: id }).then(() =>
      db.rpc("my_pending", { p_household: id }).then(({ data }) => {
        const rows = (data ?? []) as { subject_type: string; subject_id: string }[];
        setPending(new Set(rows.filter((r) => r.subject_type === "asset").map((r) => r.subject_id)));
        setPendingPays(rows.filter((r) => r.subject_type === "installment" || r.subject_type === "recurring_plan").length);
      }));
    db.from("assets")
      .select("id, name, total_cents, status, receipt_path, photo_path, purchase_date, visibility, created_at, asset_participants(user_id, amount_cents, profiles(display_name))")
      .eq("household_id", id).order("purchase_date", { ascending: false })
      .then(({ data }) => {
        const list = (data as unknown as Asset[]) ?? [];
        setAssets(list);
        signedUrls(list.map((a) => a.photo_path ?? a.receipt_path ?? "")).then(setUrls);
      });
  }, [user, id]);

  if (loadError) return <main className="pt-10"><ErrorBox>No se pudo cargar el hogar: {loadError}</ErrorBox></main>;
  if (!home) return <Loading />;
  const total = assets.reduce((s, a) => s + a.total_cents, 0);
  const iLeft = !!me?.left_at;
  const canEdit = home.status === "activo" && !iLeft;
  const leaverName = exit ? (exit.leaving_user_id === user?.id ? "Tú" : members.find((m) => m.user_id === exit.leaving_user_id)?.name ?? "Alguien") : "";

  return (
    <main>
      <AppBar right={canEdit ? (
        <Link href={`/hogar/${id}/invitar`} className="rounded-full border border-line px-3 py-1 text-sm">+ Invitar</Link>) : undefined} />
      <Link href="/" className="mb-3 block text-sm text-muted">‹ Tus hogares</Link>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h1 className="min-w-0 truncate text-2xl font-bold tracking-tight">{home.name}</h1>
        <Link href={`/hogar/${id}/reporte`} className="shrink-0 rounded-full border border-line bg-card px-3 py-1 text-sm font-medium">Ver reporte</Link>
      </div>
      {home.status !== "activo" && (
        <Link href={`/hogar/${id}/disolver`} className="mb-4 block rounded-xl bg-warn-bg px-4 py-3 text-sm font-medium text-warn">
          {home.status === "disuelto" ? "📦 Este hogar está disuelto. Toca para descargar el PDF final." : "🧊 Disolución en marcha: el inventario está congelado. Toca para confirmar."}
        </Link>
      )}

      {iLeft && me?.left_at && (
        <Link href={`/hogar/${id}/salida`} className="mb-4 block rounded-xl bg-line px-4 py-3 text-sm font-medium text-muted">
          🚪 Saliste de este hogar el {formatDateTime(me.left_at)}. Puedes consultarlo y bajarte tu reporte de salida, pero ya no añadir ni confirmar.
        </Link>
      )}
      {exit && !iLeft && (
        <Link href={`/hogar/${id}/salida`} className="mb-4 block rounded-xl bg-warn-bg px-4 py-3 text-sm font-medium text-warn">
          🚪 {leaverName === "Tú" ? "Te vas del piso" : `${leaverName} se va del piso`}. Toca para ver el reporte de salida y confirmar.
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

      <div className="mb-3">
        {canEdit
          ? <Link href={`/hogar/${id}/anadir`}><Button className="!bg-logo !text-white">+ Añadir</Button></Link>
          : <Button disabled className="!bg-logo !text-white">+ Añadir</Button>}
      </div>
      <Link href={planCount === 0 && canEdit ? `/hogar/${id}/pagos/nuevo?desde=hogar` : `/hogar/${id}/pagos`} className="mb-6 block">
        <Button variant="secondary" className={pendingPays > 0 ? "!border-warn" : ""}>
          Pagos recurrentes{pendingPays > 0 ? ` · ${pendingPays} por confirmar` : ""}
        </Button>
      </Link>

      {assets.length === 0 ? (
        <p className="py-10 text-center text-muted">Aún no hay nada apuntado.<br />Empieza por lo más caro: el sofá, la nevera…</p>
      ) : (
        <ul className="space-y-3">
          {assets.map((a) => {
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
                      {!a.receipt_path && <span className="rounded-full bg-line px-2 py-0.5 text-muted">Sin ticket</span>}
                      {pending.has(a.id) && <span className="rounded-full bg-warn px-2 py-0.5 text-white">Te toca confirmar</span>}
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
          {home.kind !== "pareja" && !exit && (
            <Link href={`/hogar/${id}/salida`} className="block"><Button variant="secondary">Alguien se va del piso</Button></Link>)}
          <Link href={`/hogar/${id}/disolver`} className="block"><Button variant="secondary" className="!text-bad">Disolver este hogar</Button></Link>
        </div>
      )}
    </main>
  );
}
