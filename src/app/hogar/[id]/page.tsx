"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useRequireUser } from "@/lib/useSession";
import { formatEuros } from "@/lib/money";
import { signedUrls } from "@/lib/photos";
import { Button, Card, Header, Loading } from "@/components/ui";

type Asset = {
  id: string; name: string; total_cents: number; status: string; receipt_path: string | null; photo_path: string | null;
  purchase_date: string; visibility: string;
  asset_participants: { user_id: string; amount_cents: number; profiles: { display_name: string } | null }[];
};

const STATUS: Record<string, { text: string; cls: string }> = {
  pendiente: { text: "Pendiente de confirmar", cls: "bg-warn-bg text-warn" },
  confirmado: { text: "Confirmado", cls: "bg-ok-bg text-ok" },
  rechazado: { text: "No es así", cls: "bg-bad-bg text-bad" },
};

export default function Hogar() {
  const { id } = useParams<{ id: string }>();
  const user = useRequireUser();
  const [home, setHome] = useState<{ name: string; status: string } | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!user) return;
    const db = supabase();
    db.from("households").select("name, status").eq("id", id).single().then(({ data }) => setHome(data));
    db.rpc("sync_installments", { p_household: id });
    db.from("assets")
      .select("id, name, total_cents, status, receipt_path, photo_path, purchase_date, visibility, asset_participants(user_id, amount_cents, profiles(display_name))")
      .eq("household_id", id).order("purchase_date", { ascending: false })
      .then(({ data }) => {
        const list = (data as unknown as Asset[]) ?? [];
        setAssets(list);
        signedUrls(list.map((a) => a.photo_path ?? a.receipt_path ?? "")).then(setUrls);
      });
  }, [user, id]);

  if (!home) return <Loading />;
  const total = assets.reduce((s, a) => s + a.total_cents, 0);

  return (
    <main>
      <Header title={home.name} back="/" right={
        <Link href={`/hogar/${id}/invitar`} className="rounded-full border border-line px-3 py-1 text-sm">+ Invitar</Link>} />

      <Card className="mb-5 text-center">
        <p className="text-sm text-muted">Total registrado</p>
        <p className="text-3xl font-bold tracking-tight">{formatEuros(total)}</p>
      </Card>

      <div className="mb-6 grid grid-cols-2 gap-3">
        <Link href={`/hogar/${id}/anadir`}><Button>+ Añadir</Button></Link>
        <Button variant="secondary" disabled title="Próximamente">Reporte</Button>
      </div>

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
                <Card className="flex gap-3">
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
                    </div>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
