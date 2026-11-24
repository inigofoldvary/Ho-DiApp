"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase, errorText } from "@/lib/supabase";
import { useRequireUser } from "@/lib/useSession";
import { formatEuros } from "@/lib/money";
import { signedUrls } from "@/lib/photos";
import { STATUS } from "@/lib/status";
import { AppBar, Button, Card, ErrorBox, Loading } from "@/components/ui";

type Asset = {
  id: string; name: string; total_cents: number; status: string; receipt_path: string | null; photo_path: string | null;
  purchase_date: string; visibility: string;
  asset_participants: { user_id: string; amount_cents: number; profiles: { display_name: string } | null }[];
};


export default function Hogar() {
  const { id } = useParams<{ id: string }>();
  const user = useRequireUser();
  const [home, setHome] = useState<{ name: string; status: string } | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState("");
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [pendingPays, setPendingPays] = useState(0);

  useEffect(() => {
    if (!user) return;
    const db = supabase();
    db.from("households").select("name, status").eq("id", id).single().then(({ data, error }) => (error ? setLoadError(errorText(error)) : setHome(data)));
    db.rpc("sync_installments", { p_household: id }).then(() =>
      db.rpc("my_pending", { p_household: id }).then(({ data }) => {
        const rows = (data ?? []) as { subject_type: string; subject_id: string }[];
        setPending(new Set(rows.filter((r) => r.subject_type === "asset").map((r) => r.subject_id)));
        setPendingPays(rows.filter((r) => r.subject_type === "installment" || r.subject_type === "recurring_plan").length);
      }));
    db.from("assets")
      .select("id, name, total_cents, status, receipt_path, photo_path, purchase_date, visibility, asset_participants(user_id, amount_cents, profiles(display_name))")
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

  return (
    <main>
      <AppBar right={
        <Link href={`/hogar/${id}/invitar`} className="rounded-full border border-line px-3 py-1 text-sm">+ Invitar</Link>} />
      <Link href="/" className="mb-3 block text-sm text-muted">‹ Tus hogares</Link>
      <h1 className="mb-3 text-2xl font-bold tracking-tight">{home.name}</h1>

      <Card className="mb-5 text-center">
        <p className="text-sm text-muted">Total registrado</p>
        <p className="text-3xl font-bold tracking-tight">{formatEuros(total)}</p>
      </Card>

      {pending.size > 0 && (
        <p className="mb-4 rounded-xl bg-warn-bg px-4 py-3 text-sm font-medium text-warn">
          🔔 Tienes {pending.size} {pending.size === 1 ? "cosa" : "cosas"} por confirmar. Están marcadas abajo.
        </p>
      )}

      <div className="mb-3 grid grid-cols-2 gap-3">
        <Link href={`/hogar/${id}/anadir`}><Button>+ Añadir</Button></Link>
        <Link href={`/hogar/${id}/reporte`}><Button variant="secondary">Reporte</Button></Link>
      </div>
      <Link href={`/hogar/${id}/pagos`} className="mb-6 block">
        <Button variant="secondary" className={pendingPays > 0 ? "!border-warn" : ""}>
          🔁 Pagos recurrentes{pendingPays > 0 ? ` · ${pendingPays} por confirmar` : ""}
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
                    </div>
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
