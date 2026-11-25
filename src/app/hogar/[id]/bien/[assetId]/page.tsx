"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase, errorText } from "@/lib/supabase";
import { useRequireUser } from "@/lib/useSession";
import { formatEuros } from "@/lib/money";
import { isPdf, signedUrls } from "@/lib/photos";
import { STATUS, formatDate, formatDateTime } from "@/lib/status";
import { perFreq } from "@/lib/frequency";
import { parseEuros } from "@/lib/money";
import { Button, Card, ErrorBox, Header, Loading } from "@/components/ui";

type Asset = {
  id: string; household_id: string; name: string; total_cents: number; status: string; version: number;
  receipt_path: string | null; photo_path: string | null; purchase_date: string; visibility: string;
  created_by: string; created_at: string; notes: string | null;
  gone_reason?: string | null; gone_to?: string | null; gone_at?: string | null; gone_dissolution?: string | null; value_cents?: number | null;
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
  const [active, setActive] = useState<string[]>([]);
  const [frozen, setFrozen] = useState(false);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [zoom, setZoom] = useState<string | null>(null);
  const [goneValue, setGoneValue] = useState<number | null>(null);
  const [plans, setPlans] = useState<{ id: string; concept: string; monthly_cents: number; frequency?: string; status: string }[]>([]);
  const [confirmersDb, setConfirmers] = useState<string[] | null>(null);

  const load = useCallback(async () => {
    const db = supabase();
    const [a, c, m, h, k] = await Promise.all([
      db.from("assets").select("*, asset_participants(user_id, amount_cents, profiles(display_name))").eq("id", assetId).single(),
      db.from("confirmations").select("user_id, decision, comment, created_at, subject_version")
        .eq("subject_type", "asset").eq("subject_id", assetId).order("created_at"),
      db.from("household_members").select("user_id, left_at, profiles(display_name)").eq("household_id", id),
      db.from("households").select("status").eq("id", id).single(),
      db.rpc("subject_confirmers", { p_type: "asset", p_ids: [assetId] }),
    ]);
    if (a.error) return setLoadError(a.error.code === "PGRST116" ? "Este bien no existe o no tienes acceso." : errorText(a.error));
    const as = a.data as unknown as Asset;
    setAsset(as);
    setConfs((c.data as Confirmation[]) ?? []);
    const n: Record<string, string> = {};
    const mem = (m.data ?? []) as unknown as { user_id: string; left_at: string | null; profiles: { display_name: string } | null }[];
    for (const r of mem) n[r.user_id] = r.profiles?.display_name ?? "?";
    setNames(n);
    setActive(mem.filter((r) => !r.left_at).map((r) => r.user_id));
    setConfirmers(k.error ? null : ((k.data ?? []) as { user_id: string }[]).map((r) => r.user_id));
    setFrozen(h.data?.status !== "activo");
    signedUrls([as.receipt_path ?? "", as.photo_path ?? ""]).then(setUrls);
    if (as.gone_dissolution) {
      const { data: dv } = await db.from("dissolution_values").select("value_cents").eq("asset_id", as.id).eq("dissolution_id", as.gone_dissolution).maybeSingle();
      setGoneValue(dv ? (dv as { value_cents: number }).value_cents : null);
    } else setGoneValue(null);
  }, [assetId, id]);

  useEffect(() => { if (user) load(); }, [user, load]);
  useEffect(() => {
    if (!user) return;
    supabase().from("recurring_plans").select("*").eq("asset_id", assetId).then(({ data }) => setPlans(data ?? []));
  }, [user, assetId]);

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
  // Si solo participa una persona, lo confirma todo el hogar (nadie se confirma a sí mismo).
  const soloOne = asset.asset_participants.length === 1;
  // Quién confirma lo decide la base de datos (si aún no tiene la función, regla aproximada).
  const confirmersAll = confirmersDb ?? (soloOne ? active : asset.asset_participants.map((p) => p.user_id));
  const partIds = asset.asset_participants.map((p) => p.user_id);
  // ¿Confirman otros además de (o en vez de) los participantes? Entonces lo enseñamos aparte.
  const wholeHome = soloOne || confirmersAll.length !== partIds.length || confirmersAll.some((u) => !partIds.includes(u));
  // En un bien ya confirmado, enseñamos quién lo confirmó (no quién entraría hoy).
  const confirmers = asset.status === "confirmado" && wholeHome
    ? confirmersAll.filter((u) => current.some((c) => c.user_id === u)) : confirmersAll;
  const iConfirm = confirmersAll.includes(user.id);
  const canAnswer = iConfirm && !myAnswer && (!frozen || !!(asset as { added_in?: string | null }).added_in);
  const isCreator = asset.created_by === user.id;
  const nameOf = (uid: string, fallback?: string | null) => (uid === user.id ? "Tú" : names[uid] ?? fallback ?? "?");

  return (
    <main className="pb-28">
      <Header title={asset.name} back={`/hogar/${id}`} />
      {zoom && (
        <div role="dialog" aria-modal="true" onClick={() => setZoom(null)}
          className="fixed inset-0 z-50 flex flex-col bg-black/95">
          <button type="button" onClick={() => setZoom(null)}
            className="m-3 self-start rounded-full bg-white/15 px-4 py-2 text-sm font-medium text-white">‹ Volver</button>
          {zoom === urls[asset.receipt_path ?? ""] && isPdf(asset.receipt_path) ? (
            <>
              <iframe src={zoom} title="Documento adjunto" className="min-h-0 w-full flex-1 bg-white" onClick={(e) => e.stopPropagation()} />
              <a href={zoom} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="m-3 self-center text-sm text-white underline">Si no se ve bien, ábrelo aquí</a>
            </>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={zoom} alt="" className="min-h-0 flex-1 object-contain p-2" />
          )}
        </div>
      )}

      {(urls[asset.photo_path ?? ""] || urls[asset.receipt_path ?? ""]) && (
        <div className="mb-4 grid grid-cols-2 gap-3">
          {[["Objeto", asset.photo_path], ["Adjunto", asset.receipt_path]].map(([label, p]) =>
            p && urls[p] && isPdf(p) ? (
              <button type="button" key={label} onClick={() => setZoom(urls[p])} className="flex aspect-square flex-col items-center justify-center gap-1 rounded-2xl bg-card text-sm">
                <span className="text-4xl">📄</span><span className="font-medium">Ver documento (PDF)</span>
              </button>
            ) : p && urls[p] ? (
              <button type="button" key={label} onClick={() => setZoom(urls[p])} className="relative block aspect-square overflow-hidden rounded-2xl bg-card">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={urls[p]} alt={label!} className="h-full w-full object-cover" />
                <span className="absolute bottom-2 left-2 rounded-full bg-black/60 px-2 py-0.5 text-xs text-white">{label}</span>
              </button>
            ) : null)}
        </div>
      )}

      <Card className="mb-4">
        <p className="text-3xl font-bold tracking-tight">{formatEuros(asset.total_cents)}</p>
        <p className="text-sm text-muted">Comprado el {formatDate(asset.purchase_date)}</p>
        {asset.gone_reason && (
          <p className="mt-2 rounded-xl bg-line/60 px-3 py-2 text-sm">
            {asset.gone_reason === "baja" ? "Dado de baja de acuerdo entre todos. Ya no está en el hogar (el motivo, abajo)."
              : asset.gone_reason === "vendido" ? "En el reparto se decidió venderlo. No cuenta en el hogar mientras no se reactive."
              : `${asset.gone_to === user.id ? (asset.gone_reason === "llevado" ? "Te lo llevaste" : "Te lo quedaste") : `${asset.gone_reason === "llevado" ? "Se lo llevó" : "Se lo quedó"} ${names[asset.gone_to ?? ""] ?? "alguien"}`}${goneValue !== null ? ` por ${formatEuros(goneValue)}` : ""} en el reparto. Ya no está en el hogar.`}
            {asset.gone_at && <span className="block text-xs text-muted">{formatDate(asset.gone_at.slice(0, 10))}</span>}
          </p>
        )}
        {!asset.gone_reason && asset.value_cents != null && (
          <p className="mt-1 text-sm">Valor acordado al reactivarlo: <b>{formatEuros(asset.value_cents)}</b></p>
        )}
        <div className="mt-3 flex flex-wrap gap-1.5 text-xs font-medium">
          <span className={`rounded-full px-2 py-0.5 ${st.cls}`}>{st.text}</span>
          {!asset.receipt_path && <span className="rounded-full bg-line px-2 py-0.5 text-muted">Sin adjunto</span>}
          {asset.visibility === "implicados" && <span className="rounded-full bg-line px-2 py-0.5 text-muted">🔒 Privado</span>}
          {asset.version > 1 && <span className="rounded-full bg-line px-2 py-0.5 text-muted">Editado</span>}
        </div>
      </Card>

      {plans.length > 0 && (
        <>
          <h2 className="mb-2 text-sm font-semibold text-muted">Se sigue pagando</h2>
          <div className="mb-4 space-y-2">
            {plans.map((p) => (
              <Link key={p.id} href={`/hogar/${id}/pagos/${p.id}`} className="block">
                <Card className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">🔁 {p.concept}</span>
                  <span className="shrink-0 font-semibold">{formatEuros(p.monthly_cents)}<span className="text-sm font-normal text-muted">{perFreq(p.frequency)}</span> ›</span>
                </Card>
              </Link>
            ))}
          </div>
        </>
      )}

      <h2 className="mb-2 text-sm font-semibold text-muted">{plans.length > 0 ? "Entrada: quién puso cuánto" : "Quién puso cuánto"}</h2>
      <Card className="mb-4 divide-y divide-line !p-0">
        {asset.asset_participants.map((p) => {
          const ans = current.find((c) => c.user_id === p.user_id);
          return (
            <div key={p.user_id} className="px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{nameOf(p.user_id, p.profiles?.display_name)}</span>
                <span className="font-semibold">{formatEuros(p.amount_cents)}</span>
              </div>
              {!wholeHome && (<>
              <p className={`text-sm ${ans?.decision === "confirmar" ? "text-ok" : ans?.decision === "rechazar" ? "text-bad" : "text-muted"}`}>
                {ans?.decision === "confirmar" ? `✓ Confirmado · ${formatDateTime(ans.created_at)}`
                  : ans?.decision === "rechazar" ? `✗ No es así · ${formatDateTime(ans.created_at)}`
                  : "⏳ Falta que confirme"}
              </p>
              {ans?.comment && <p className="mt-1 rounded-lg bg-bad-bg px-3 py-2 text-sm text-bad">“{ans.comment}”</p>}
              </>)}
            </div>
          );
        })}
      </Card>

      {asset.gone_reason === "vendido" && !frozen && active.includes(user.id) && (
        <Reactivate asset={asset} me={user.id} names={names} active={active} onDone={load} />
      )}

      <Removal asset={asset} me={user.id} names={names} frozen={frozen} onDone={load} />

      <Ownership asset={asset} me={user!.id} names={names} active={active} frozen={frozen || !!asset.gone_reason} />

      {wholeHome && (
        <>
          <h2 className="mb-2 text-sm font-semibold text-muted">{asset.status === "confirmado" ? "Lo confirmaron" : "Lo tiene que confirmar el hogar"}</h2>
          <Card className="mb-4 divide-y divide-line !p-0">
            {confirmers.map((u) => {
              const ans = current.find((c) => c.user_id === u);
              return (
                <div key={u} className="px-4 py-3">
                  <span className="font-medium">{nameOf(u)}</span>
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
        </>
      )}

      {asset.status === "rechazado" && isCreator && !frozen && (
        <p className="mb-4 rounded-xl bg-warn-bg px-4 py-3 text-sm text-warn">
          Alguien dice que esto no es así. Edítalo para corregirlo y se volverá a pedir confirmación.
        </p>
      )}

      {!frozen && !asset.gone_reason && (isCreator || iParticipate || iConfirm) && (
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

type Buyin = { id: string; buyer: string; share: number; price_cents: number; status: string; comment: string | null; created_at: string; sellers: { user_id: string; cents: number }[] | null };

/** De quién es ahora y comprar una parte (p. ej. quien entra nuevo en el piso). */
function Ownership({ asset, me, names, active, frozen }: { asset: Asset; me: string; names: Record<string, string>; active: string[]; frozen: boolean }) {
  const [shares, setShares] = useState<{ user_id: string; share: number }[] | null>(null);
  const [buyins, setBuyins] = useState<Buyin[]>([]);
  const [oks, setOks] = useState<Record<string, string[]>>({});
  const [open, setOpen] = useState(false);
  const [pct, setPct] = useState("");
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const nm = (u: string) => (u === me ? "Tú" : names[u] ?? "Antiguo miembro");

  const load = useCallback(async () => {
    const db = supabase();
    const [s, b] = await Promise.all([
      db.rpc("asset_current_shares", { p_asset: asset.id }),
      db.from("asset_buyins").select("*").eq("asset_id", asset.id).order("created_at", { ascending: false }),
    ]);
    if (s.error) { setShares(null); return; } // aún sin el SQL 09
    setShares(((s.data ?? []) as { user_id: string; share: number }[]).map((r) => ({ user_id: r.user_id, share: Number(r.share) })));
    const list = (b.data ?? []) as Buyin[];
    setBuyins(list);
    const pend = list.filter((x) => x.status === "pendiente");
    if (pend.length) {
      const k = await db.from("asset_buyin_oks").select("buyin_id, user_id").in("buyin_id", pend.map((x) => x.id));
      const by: Record<string, string[]> = {};
      for (const r of (k.data ?? []) as { buyin_id: string; user_id: string }[]) (by[r.buyin_id] ??= []).push(r.user_id);
      setOks(by);
    }
  }, [asset.id]);
  useEffect(() => { load(); }, [load]);

  async function rpc(fn: string, args: Record<string, unknown>) {
    setBusy(true); setError("");
    const { error } = await supabase().rpc(fn, args);
    setBusy(false);
    if (error) { setError(errorText(error)); return false; }
    await load();
    return true;
  }

  if (!shares || !shares.length) return null;
  const pending = buyins.find((b) => b.status === "pendiente");
  const done = buyins.filter((b) => b.status === "aceptada");
  const iOwn = shares.some((s) => s.user_id === me);
  const myShare = shares.find((s) => s.user_id === me)?.share ?? 0;
  const canBuy = !frozen && active.includes(me) && asset.status === "confirmado" && myShare < 0.995 && !pending;
  const years = Math.max(0, Math.floor((Date.now() - new Date(asset.purchase_date + "T00:00:00").getTime()) / (365.25 * 86400000)));
  const valueNow = Math.round((asset.total_cents * Math.pow(0.85, years)) / 1000) * 1000;
  const p = parseFloat(pct.replace(",", "."));
  const pctOk = Number.isFinite(p) && p >= 1 && p <= 99;
  const priceCents = parseEuros(price);

  return (
    <>
      <h2 className="mb-2 text-sm font-semibold text-muted">De quién es ahora</h2>
      <Card className="mb-4 space-y-3">
        <div className="flex flex-wrap gap-1.5 text-sm">
          {[...shares].sort((a, b) => b.share - a.share).map((s) => (
            <span key={s.user_id} className="rounded-full bg-ok-bg px-2.5 py-1 font-medium text-ok">{nm(s.user_id)} {Math.round(s.share * 100)} %</span>
          ))}
        </div>
        {done.map((b) => (
          <p key={b.id} className="text-xs text-muted">
            {formatDateTime(b.created_at)} · {nm(b.buyer)} compró el {Math.round(b.share * 100)} % por {formatEuros(b.price_cents)}
            {b.sellers?.length ? ` (${b.sellers.map((x) => `a ${nm(x.user_id)} ${formatEuros(x.cents)}`).join(", ")})` : ""}.
          </p>
        ))}

        {pending && (
          <div className="rounded-xl bg-warn-bg px-3 py-3 text-sm text-warn">
            <p className="font-semibold">{nm(pending.buyer)} quiere comprar el {Math.round(pending.share * 100)} % por {formatEuros(pending.price_cents)}</p>
            {pending.comment && <p className="mt-1">“{pending.comment}”</p>}
            <p className="mt-1 text-xs">Tienen que aceptar los dueños: {shares.filter((s) => s.user_id !== pending.buyer).map((s) => `${nm(s.user_id)} ${(oks[pending.id] ?? []).includes(s.user_id) ? "✓" : "⏳"}`).join(" · ")}</p>
            {iOwn && pending.buyer !== me && !(oks[pending.id] ?? []).includes(me) && !frozen && (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Button variant="secondary" disabled={busy} onClick={() => rpc("answer_buyin", { p_buyin: pending.id, p_accept: false })}>No</Button>
                <Button disabled={busy} onClick={() => rpc("answer_buyin", { p_buyin: pending.id, p_accept: true })}>Aceptar ✓</Button>
              </div>
            )}
            {pending.buyer === me && (
              <Button variant="ghost" disabled={busy} onClick={() => rpc("answer_buyin", { p_buyin: pending.id, p_accept: false })}>Retirar mi propuesta</Button>
            )}
          </div>
        )}

        {canBuy && !open && (
          <Button variant="secondary" onClick={() => { setOpen(true); setPrice(""); setPct(""); }}>{iOwn ? "Comprar más parte" : "Quiero comprar una parte"}</Button>
        )}
        {canBuy && open && (
          <div className="space-y-2">
            <p className="text-sm text-muted">Propón qué % quieres y cuánto pagas. Los dueños tienen que aceptar. Hoy vale unos {formatEuros(valueNow)} (pierde un 15 % por año).</p>
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-sm"><span className="mb-1 block text-muted">% que compras</span>
                <input value={pct} inputMode="decimal" placeholder="Ej. 25"
                  onChange={(e) => { setPct(e.target.value); const v = parseFloat(e.target.value.replace(",", ".")); if (Number.isFinite(v)) setPrice(String(Math.round(valueNow * v / 100) / 100).replace(".", ",")); }}
                  className="w-full rounded-xl border border-line bg-bg px-3 py-2 outline-none focus:border-brand" /></label>
              <label className="block text-sm"><span className="mb-1 block text-muted">Pagas (€)</span>
                <input value={price} inputMode="decimal" onChange={(e) => setPrice(e.target.value)}
                  className="w-full rounded-xl border border-line bg-bg px-3 py-2 outline-none focus:border-brand" /></label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button disabled={busy || !pctOk || priceCents === null} onClick={async () => {
                if (await rpc("propose_buyin", { p_asset: asset.id, p_share: p / 100, p_price_cents: priceCents })) setOpen(false);
              }}>Enviar</Button>
            </div>
          </div>
        )}
        <ErrorBox>{error}</ErrorBox>
      </Card>
    </>
  );
}

/* Reactivar algo que era para vender y al final no se vendió */
function Reactivate({ asset, me, names, active, onDone }:
  { asset: Asset; me: string; names: Record<string, string>; active: string[]; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const eq = active.length ? Math.floor(100 / active.length) : 0;
  const [pcts, setPcts] = useState<Record<string, string>>(() =>
    Object.fromEntries(active.map((u, i) => [u, String(i === 0 ? 100 - eq * (active.length - 1) : eq)])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const cents = parseEuros(value);
  const sum = active.reduce((s, u) => s + (Number((pcts[u] ?? "0").replace(",", ".")) || 0), 0);
  const ok = cents !== null && cents > 0 && Math.abs(sum - 100) < 0.5;
  async function save() {
    setBusy(true); setError("");
    const { error } = await supabase().rpc("reactivate_asset", {
      p_asset: asset.id, p_value_cents: cents,
      p_owners: active.map((u) => ({ user_id: u, pct: Number((pcts[u] ?? "0").replace(",", ".")) || 0 })),
    });
    setBusy(false);
    if (error) return setError(errorText(error));
    setOpen(false); onDone();
  }
  if (!open) return (
    <div className="mb-4">
      <Button onClick={() => setOpen(true)}>Al final no se vendió: reactivar</Button>
    </div>
  );
  return (
    <Card className="mb-4 space-y-3">
      <p className="font-semibold">Reactivar en el hogar</p>
      <p className="text-sm text-muted">Pon lo que vale hoy y de quién es ahora. Los demás lo tendrán que confirmar.</p>
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-muted">Valor de hoy (€)</span>
        <input value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" placeholder={`Costó ${formatEuros(asset.total_cents)}`}
          className="w-full rounded-xl border border-line bg-bg px-4 py-3 outline-none focus:border-brand" />
      </label>
      <div className="space-y-2">
        <p className="text-sm font-medium text-muted">¿De quién es ahora? (%)</p>
        {active.map((u) => (
          <div key={u} className="flex items-center justify-between gap-3">
            <span className="font-medium">{u === me ? "Tú" : names[u] ?? "?"}</span>
            <span className="flex w-28 items-center gap-1">
              <input value={pcts[u] ?? ""} onChange={(e) => setPcts((p) => ({ ...p, [u]: e.target.value }))} inputMode="decimal" aria-label={`Porcentaje de ${names[u] ?? "?"}`}
                className="w-full rounded-lg border border-line bg-bg px-2 py-1.5 text-right tabular-nums outline-none focus:border-brand" />
              <span className="text-muted">%</span>
            </span>
          </div>
        ))}
        <p className={`text-sm ${Math.abs(sum - 100) < 0.5 ? "text-ok" : "text-warn"}`}>
          {Math.abs(sum - 100) < 0.5 ? "✓ Suma 100 %" : `Suma ${Math.round(sum * 10) / 10} %: tiene que ser 100 %`}
        </p>
      </div>
      {error && <ErrorBox>{error}</ErrorBox>}
      <div className="grid grid-cols-2 gap-3">
        <Button variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
        <Button disabled={!ok || busy} onClick={save}>{busy ? "Guardando…" : "Reactivar"}</Button>
      </div>
    </Card>
  );
}

/* Dar de baja (se rompió, se perdió…): lo tienen que aceptar todos */
type RemovalRow = { id: string; requested_by: string; reason: string; status: string; created_at: string; decided_at: string | null };
type RemovalAnswer = { removal_id: string; user_id: string; accept: boolean; comment: string | null };
function Removal({ asset, me, names, frozen, onDone }:
  { asset: Asset; me: string; names: Record<string, string>; frozen: boolean; onDone: () => void }) {
  const [rows, setRows] = useState<RemovalRow[]>([]);
  const [answers, setAnswers] = useState<RemovalAnswer[]>([]);
  const [deciders, setDeciders] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [saying, setSaying] = useState<"no" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const reload = useCallback(async () => {
    const db = supabase();
    const [r, d] = await Promise.all([
      db.from("asset_removals").select("id, requested_by, reason, status, created_at, decided_at").eq("asset_id", asset.id).order("created_at", { ascending: false }),
      db.rpc("asset_removal_deciders", { p_asset: asset.id }),
    ]);
    const list = (r.data ?? []) as RemovalRow[];
    setRows(list);
    setDeciders(((d.data ?? []) as unknown[]).map((x) => (typeof x === "string" ? x : (x as { asset_removal_deciders: string }).asset_removal_deciders)));
    if (list.length) {
      const { data } = await db.from("asset_removal_answers").select("removal_id, user_id, accept, comment").in("removal_id", list.map((x) => x.id));
      setAnswers((data ?? []) as RemovalAnswer[]);
    }
  }, [asset.id]);
  useEffect(() => { reload(); }, [reload, asset.version, asset.gone_reason]);
  async function run(fn: string, args: Record<string, unknown>) {
    setBusy(true); setError("");
    const { error } = await supabase().rpc(fn, args);
    setBusy(false);
    if (error) { setError(errorText(error)); return false; }
    setOpen(false); setSaying(null); setText("");
    await reload(); onDone();
    return true;
  }
  const who = (u: string) => (u === me ? "Tú" : names[u] ?? "?");
  const pending = rows.find((r) => r.status === "pendiente");
  const done = rows.find((r) => r.status === "aceptada");
  const lastNo = rows.find((r) => r.status === "rechazada");
  const ans = (rid: string, u: string) => answers.find((a) => a.removal_id === rid && a.user_id === u);

  if (done) return (
    <Card className="mb-4 text-sm">
      <p className="font-semibold">🗑️ Dado de baja</p>
      <p className="mt-1">“{done.reason}” · lo pidió {who(done.requested_by)}{done.decided_at ? ` · aceptado el ${formatDate(done.decided_at.slice(0, 10))}` : ""}</p>
    </Card>
  );
  if (pending) {
    const mine = ans(pending.id, me);
    const iDecide = deciders.includes(me);
    return (
      <div className="mb-4 rounded-2xl border-2 border-warn bg-warn-bg px-4 py-3 text-sm text-warn">
        <p className="font-semibold">🗑️ {pending.requested_by === me ? "Has pedido" : `${who(pending.requested_by)} pide`} dar esto de baja</p>
        <p className="mt-1 text-base">“{pending.reason}”</p>
        <p className="mt-1 text-xs">Se da de baja cuando lo aceptáis todos: {deciders.map((u) => `${who(u)} ${ans(pending.id, u)?.accept ? "✓" : "⏳"}`).join(" · ")}</p>
        {error && <div className="mt-2"><ErrorBox>{error}</ErrorBox></div>}
        {!frozen && iDecide && !mine && (saying === "no" ? (
          <div className="mt-2 space-y-2">
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} autoFocus placeholder="¿Por qué no? Ej. se puede arreglar"
              className="w-full rounded-xl border border-line bg-card px-3 py-2 text-ink outline-none focus:border-brand" />
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" onClick={() => setSaying(null)}>Cancelar</Button>
              <Button className="!bg-bad" disabled={busy || !text.trim()} onClick={() => run("answer_asset_removal", { p_removal: pending.id, p_accept: false, p_comment: text })}>No estoy de acuerdo</Button>
            </div>
          </div>
        ) : (
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Button variant="secondary" disabled={busy} onClick={() => setSaying("no")}>No</Button>
            <Button disabled={busy} onClick={() => run("answer_asset_removal", { p_removal: pending.id, p_accept: true })}>Sí, darlo de baja</Button>
          </div>
        ))}
        {pending.requested_by === me && (
          <button type="button" disabled={busy} onClick={() => run("withdraw_asset_removal", { p_removal: pending.id })} className="mt-2 text-xs font-semibold underline">Retirar la petición</button>
        )}
      </div>
    );
  }
  if (frozen || asset.gone_reason || asset.status !== "confirmado" || !deciders.includes(me)) return null;
  return (
    <div className="mb-4">
      {lastNo && (
        <p className="mb-2 rounded-xl bg-line/60 px-3 py-2 text-xs text-muted">
          La última petición de baja (“{lastNo.reason}”) no salió adelante
          {answers.filter((a) => a.removal_id === lastNo.id && !a.accept).map((a) => `: ${who(a.user_id)} dijo “${a.comment ?? "no"}”`).join("")}.
        </p>
      )}
      {!open ? (
        <Button variant="secondary" onClick={() => setOpen(true)}>🗑️ Dar de baja (se rompió, se perdió…)</Button>
      ) : (
        <Card className="space-y-2">
          <p className="font-semibold">Dar de baja</p>
          <p className="text-sm text-muted">Se lo pediremos a todos. Cuando todos acepten, saldrá del hogar y quedará en el historial.</p>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} autoFocus placeholder="¿Qué ha pasado? Ej. la tele se rompió y no tiene arreglo"
            className="w-full rounded-xl border border-line bg-bg px-3 py-2 outline-none focus:border-brand" />
          {error && <ErrorBox>{error}</ErrorBox>}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button disabled={busy || !text.trim()} onClick={() => run("request_asset_removal", { p_asset: asset.id, p_reason: text })}>Pedir la baja</Button>
          </div>
        </Card>
      )}
    </div>
  );
}
