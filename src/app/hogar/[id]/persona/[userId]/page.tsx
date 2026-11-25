"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase, errorText } from "@/lib/supabase";
import { useRequireUser } from "@/lib/useSession";
import { formatEuros } from "@/lib/money";
import { loadMembers, type Member } from "@/lib/members";
import { Card, ErrorBox, Header, Loading } from "@/components/ui";

type Asset = {
  id: string; name: string; total_cents: number; status: string; visibility: string;
  gone_reason?: string | null; gone_to?: string | null;
  asset_participants: { user_id: string; amount_cents: number }[];
};
type Row = { a: Asset; share: number; cents: number };

/** El inventario de una persona: lo que es suyo al 100 % y las partes que tiene. */
export default function Persona() {
  const { id, userId } = useParams<{ id: string; userId: string }>();
  const user = useRequireUser();
  const [members, setMembers] = useState<Member[]>([]);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user) return;
    const db = supabase();
    (async () => {
      try {
        const ms = await loadMembers(id, user.id);
        setMembers(ms);
        const active = new Set(ms.filter((m) => m.active).map((m) => m.user_id));
        const { data, error } = await db.from("assets").select("*, asset_participants(user_id, amount_cents)").eq("household_id", id);
        if (error) throw error;
        const list = (data ?? []) as unknown as Asset[];
        const ow = list.length ? await db.from("asset_owners").select("asset_id, user_id, share").in("asset_id", list.map((a) => a.id)) : { data: [] };
        const owners: Record<string, Record<string, number>> = {};
        for (const r of (ow.data ?? []) as { asset_id: string; user_id: string; share: number }[]) (owners[r.asset_id] ??= {})[r.user_id] = Number(r.share);
        const out: Row[] = [];
        for (const a of list) {
          if (a.status !== "confirmado") continue;
          if (a.gone_reason === "vendido" || a.gone_reason === "baja") continue;
          if ((a.gone_reason === "llevado" || a.gone_reason === "propio") && a.gone_to !== userId) continue;
          let share: number;
          if (a.gone_reason) share = 1;
          else if (owners[a.id]) share = owners[a.id][userId] ?? 0;
          else {
            // % de lo que puso, entre los que siguen en el piso
            const live = a.asset_participants.filter((p) => active.has(p.user_id));
            const tot = live.reduce((s, p) => s + p.amount_cents, 0);
            share = tot > 0 ? (live.find((p) => p.user_id === userId)?.amount_cents ?? 0) / tot : 0;
          }
          if (share > 0.0005) out.push({ a, share, cents: Math.round(a.total_cents * share) });
        }
        out.sort((x, y) => y.share - x.share || y.cents - x.cents);
        setRows(out);
      } catch (e) { setError(errorText(e)); }
    })();
  }, [user, id, userId]);

  if (error) return <main><Header title="Inventario" back={`/hogar/${id}`} /><ErrorBox>{error}</ErrorBox></main>;
  if (!rows || !user) return <Loading />;
  const name = userId === user.id ? "Tu inventario" : `Inventario de ${members.find((m) => m.user_id === userId)?.name ?? "?"}`;
  const full = rows.filter((r) => r.share >= 0.9995);
  const parts = rows.filter((r) => r.share < 0.9995);
  const total = rows.reduce((s, r) => s + r.cents, 0);

  const Item = ({ r }: { r: Row }) => (
    <Link href={`/hogar/${id}/bien/${r.a.id}`} className="block">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <span className="min-w-0">
          <span className="block truncate font-medium">{r.a.name}{r.a.visibility === "implicados" ? " 🔒" : ""}</span>
          <span className="block text-xs text-muted">
            {r.share >= 0.9995 ? "100 %" : `${Math.round(r.share * 100)} % de ${formatEuros(r.a.total_cents)}`}
            {r.a.gone_reason === "llevado" ? " · se lo llevó" : r.a.gone_reason === "propio" ? " · quedó a su nombre" : ""}
          </span>
        </span>
        <span className="shrink-0 font-semibold tabular-nums">{formatEuros(r.cents)}</span>
      </div>
    </Link>
  );

  return (
    <main className="pb-10">
      <Header title={name} back={`/hogar/${id}`} />
      <Card className="mb-5 text-center">
        <p className="text-sm text-muted">{userId === user.id ? "Lo que te corresponde" : "Lo que le corresponde"} (según lo que costó)</p>
        <p className="text-3xl font-bold tracking-tight">{formatEuros(total)}</p>
      </Card>
      {rows.length === 0 && <p className="py-10 text-center text-muted">{userId === user.id ? "Todavía no tienes nada a tu nombre." : "Todavía no tiene nada a su nombre."}</p>}
      {full.length > 0 && (<>
        <h2 className="mb-2 text-sm font-semibold text-muted">{userId === user.id ? "Tuyo" : "Suyo"} al 100 % ({full.length})</h2>
        <Card className="mb-5 divide-y divide-line !p-0">{full.map((r) => <Item key={r.a.id} r={r} />)}</Card>
      </>)}
      {parts.length > 0 && (<>
        <h2 className="mb-2 text-sm font-semibold text-muted">Partes de cosas compartidas ({parts.length})</h2>
        <Card className="divide-y divide-line !p-0">{parts.map((r) => <Item key={r.a.id} r={r} />)}</Card>
      </>)}
      <p className="mt-4 text-xs text-muted">Solo cuenta lo confirmado. Los importes son lo que costó cada cosa por su %, no lo que vale hoy.</p>
    </main>
  );
}
