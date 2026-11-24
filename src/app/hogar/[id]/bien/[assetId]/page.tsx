"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase, errorText } from "@/lib/supabase";
import { useRequireUser } from "@/lib/useSession";
import { formatEuros } from "@/lib/money";
import { signedUrls } from "@/lib/photos";
import { STATUS, formatDate, formatDateTime } from "@/lib/status";
import { Button, Card, ErrorBox, Header, Loading } from "@/components/ui";

type Asset = {
  id: string; household_id: string; name: string; total_cents: number; status: string; version: number;
  receipt_path: string | null; photo_path: string | null; purchase_date: string; visibility: string;
  created_by: string; created_at: string; notes: string | null;
  asset_participants: { user_id: string; amount_cents: number; profiles: { display_name: string } | null }[];
};
type Confirmation = { user_id: string; decision: string; comment: string | null; created_at: string; subject_version: number };

export default function Bien() {
  const { id, assetId } = useParams<{ id: string; assetId: string }>();
  const router = useRouter();
  const user = useRequireUser();
  const [asset, setAsset] = useState<Asset | null>(null);
  const [confs, setConfs] = useState<Confirmation[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [frozen, setFrozen] = useState(false);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const db = supabase();
    const [a, c, m, h] = await Promise.all([
      db.from("assets").select("*, asset_participants(user_id, amount_cents, profiles(display_name))").eq("id", assetId).single(),
      db.from("confirmations").select("user_id, decision, comment, created_at, subject_version")
        .eq("subject_type", "asset").eq("subject_id", assetId).order("created_at"),
      db.from("household_members").select("user_id, profiles(display_name)").eq("household_id", id),
      db.from("households").select("status").eq("id", id).single(),
    ]);
    if (a.error) return setLoadError(a.error.code === "PGRST116" ? "Este bien no existe o no tienes acceso." : errorText(a.error));
    const as = a.data as unknown as Asset;
    setAsset(as);
    setConfs((c.data as Confirmation[]) ?? []);
    const n: Record<string, string> = {};
    for (const r of (m.data ?? []) as unknown as { user_id: string; profiles: { display_name: string } | null }[]) n[r.user_id] = r.profiles?.display_name ?? "?";
    setNames(n);
    setFrozen(h.data?.status !== "activo");
    signedUrls([as.receipt_path ?? "", as.photo_path ?? ""]).then(setUrls);
  }, [assetId, id]);

  useEffect(() => { if (user) load(); }, [user, load]);

  async function respond(decision: "confirmar" | "rechazar") {
    setBusy(true); setError("");
    const { error } = await supabase().rpc("respond", {
      p_subject_type: "asset", p_subject_id: assetId, p_decision: decision, p_comment: decision === "rechazar" ? comment : null,
    });
    setBusy(false);
    if (error) return setError(errorText(error));
    setRejecting(false); setComment("");
    load();
  }

  async function remove() {
    if (!confirm("¿Borrar este bien? No se puede deshacer.")) return;
    setBusy(true);
    const { error } = await supabase().rpc("delete_asset", { p_asset: assetId });
    setBusy(false);
    if (error) return setError(errorText(error));
    router.replace(`/hogar/${id}`);
  }

  if (loadError) return <main><Header title="Bien" back={`/hogar/${id}`} /><ErrorBox>{loadError}</ErrorBox></main>;
  if (!asset || !user) return <Loading />;

  const st = STATUS[asset.status];
  const current = confs.filter((c) => c.subject_version === asset.version);
  const myAnswer = current.find((c) => c.user_id === user.id);
  const iParticipate = asset.asset_participants.some((p) => p.user_id === user.id);
  const canAnswer = iParticipate && !myAnswer && !frozen;
  const isCreator = asset.created_by === user.id;
  const nameOf = (uid: string, fallback?: string | null) => (uid === user.id ? "Tú" : names[uid] ?? fallback ?? "?");

  return (
    <main className="pb-28">
      <Header title={asset.name} back={`/hogar/${id}`} />

      {(urls[asset.photo_path ?? ""] || urls[asset.receipt_path ?? ""]) && (
        <div className="mb-4 grid grid-cols-2 gap-3">
          {[["Objeto", asset.photo_path], ["Ticket", asset.receipt_path]].map(([label, p]) =>
            p && urls[p] ? (
              <a key={label} href={urls[p]} target="_blank" rel="noreferrer" className="relative block aspect-square overflow-hidden rounded-2xl bg-card">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={urls[p]} alt={label!} className="h-full w-full object-cover" />
                <span className="absolute bottom-2 left-2 rounded-full bg-black/60 px-2 py-0.5 text-xs text-white">{label}</span>
              </a>
            ) : null)}
        </div>
      )}

      <Card className="mb-4">
        <p className="text-3xl font-bold tracking-tight">{formatEuros(asset.total_cents)}</p>
        <p className="text-sm text-muted">Comprado el {formatDate(asset.purchase_date)}</p>
        <div className="mt-3 flex flex-wrap gap-1.5 text-xs font-medium">
          <span className={`rounded-full px-2 py-0.5 ${st.cls}`}>{st.text}</span>
          {!asset.receipt_path && <span className="rounded-full bg-line px-2 py-0.5 text-muted">Sin ticket</span>}
          {asset.visibility === "implicados" && <span className="rounded-full bg-line px-2 py-0.5 text-muted">🔒 Privado</span>}
          {asset.version > 1 && <span className="rounded-full bg-line px-2 py-0.5 text-muted">Editado</span>}
        </div>
      </Card>

      <h2 className="mb-2 text-sm font-semibold text-muted">Quién puso cuánto</h2>
      <Card className="mb-4 divide-y divide-line !p-0">
        {asset.asset_participants.map((p) => {
          const ans = current.find((c) => c.user_id === p.user_id);
          return (
            <div key={p.user_id} className="px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{nameOf(p.user_id, p.profiles?.display_name)}</span>
                <span className="font-semibold">{formatEuros(p.amount_cents)}</span>
              </div>
              <p className={`text-sm ${ans?.decision === "confirmar" ? "text-ok" : ans?.decision === "rechazar" ? "text-bad" : "text-muted"}`}>
                {ans?.decision === "confirmar" ? `✓ Confirmado · ${formatDateTime(ans.created_at)}`
                  : ans?.decision === "rechazar" ? `✗ No es así · ${formatDateTime(ans.created_at)}`
                  : "⏳ Falta que confirme"}
              </p>
              {ans?.comment && <p className="mt-1 rounded-lg bg-bad-bg px-3 py-2 text-sm text-bad">“{ans.comment}”</p>}
            </div>
          );
        })}
      </Card>

      {asset.status === "rechazado" && isCreator && !frozen && (
        <p className="mb-4 rounded-xl bg-warn-bg px-4 py-3 text-sm text-warn">
          Alguien dice que esto no es así. Edítalo para corregirlo y se volverá a pedir confirmación.
        </p>
      )}

      {!frozen && (isCreator || iParticipate) && (
        <div className="mb-6 grid grid-cols-2 gap-3">
          <Link href={`/hogar/${id}/anadir?editar=${asset.id}`}><Button variant="secondary">Editar</Button></Link>
          {isCreator && asset.status !== "confirmado"
            ? <Button variant="secondary" className="!text-bad" onClick={remove} disabled={busy}>Borrar</Button>
            : <span />}
        </div>
      )}
      {!frozen && asset.status === "confirmado" && (
        <p className="-mt-3 mb-6 text-xs text-muted">Si lo editas, volverá a “pendiente” hasta que lo confirmen todos los implicados.</p>
      )}

      <h2 className="mb-2 text-sm font-semibold text-muted">Historial</h2>
      <ol className="mb-6 space-y-2 border-l-2 border-line pl-4 text-sm">
        <li><span className="font-medium">{nameOf(asset.created_by)}</span> lo añadió · <span className="text-muted">{formatDateTime(asset.created_at)}</span></li>
        {confs.map((c, i) => (
          <li key={i}>
            <span className="font-medium">{nameOf(c.user_id)}</span>{" "}
            {c.decision === "confirmar" ? "confirmó" : "dijo que no es así"}
            {c.subject_version > 1 ? ` (versión ${c.subject_version})` : ""} · <span className="text-muted">{formatDateTime(c.created_at)}</span>
            {c.comment && <span className="block text-muted">“{c.comment}”</span>}
          </li>
        ))}
      </ol>

      {canAnswer && (
        <div className="fixed inset-x-0 bottom-0 border-t border-line bg-bg/95 px-4 py-3 backdrop-blur">
          <div className="mx-auto max-w-md space-y-2">
            <ErrorBox>{error}</ErrorBox>
            {rejecting ? (
              <>
                <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} autoFocus
                  placeholder="¿Qué no está bien? Ej. yo puse 700 €"
                  className="w-full rounded-xl border border-line bg-card px-4 py-3 outline-none focus:border-brand" />
                <div className="grid grid-cols-2 gap-3">
                  <Button variant="secondary" onClick={() => setRejecting(false)}>Cancelar</Button>
                  <Button className="!bg-bad" onClick={() => respond("rechazar")} disabled={busy || !comment.trim()}>Enviar</Button>
                </div>
              </>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <Button variant="secondary" onClick={() => setRejecting(true)} disabled={busy}>No es así</Button>
                <Button onClick={() => respond("confirmar")} disabled={busy}>{busy ? "…" : "Confirmar ✓"}</Button>
              </div>
            )}
          </div>
        </div>
      )}
      {!canAnswer && error && <ErrorBox>{error}</ErrorBox>}
    </main>
  );
}
