"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase, errorText } from "@/lib/supabase";
import { useRequireUser } from "@/lib/useSession";
import { loadMembers, type Member } from "@/lib/members";
import { loadReport } from "@/lib/report";
import { formatEuros, parseEuros } from "@/lib/money";
import { formatDateTime } from "@/lib/status";
import { signedUrls } from "@/lib/photos";
import {
  loadSplit, proposalBalanced, proposalByPaid, balances, transfers, saleSplit, shareOf, sameAssignment, explain, chosenAssignment,
  type Assignment, type Dissolution, type SplitState, type SplitItem, type Offer,
} from "@/lib/split";
import { Button, Card, ErrorBox, Header, Loading } from "@/components/ui";

type Household = { name: string; kind: string; status: string; dissolved_at: string | null };
type Conf = { user_id: string; decision: string; comment: string | null; created_at: string; subject_version: number };

const PHASES = [
  { id: "valores", label: "Valores" },
  { id: "elegir", label: "Elegir" },
  { id: "acuerdo", label: "Acuerdo" },
  { id: "cerrado", label: "Reporte" },
];

export default function Disolver() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const user = useRequireUser();
  const [home, setHome] = useState<Household | null>(null);
  const [diss, setDiss] = useState<Dissolution | null>(null);
  const [rejected, setRejected] = useState(false);
  const [pastExits, setPastExits] = useState<Dissolution[]>([]);
  const [confs, setConfs] = useState<Conf[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [split, setSplit] = useState<SplitState | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [pendingCount, setPendingCount] = useState(0);
  const [leaving, setLeaving] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sure, setSure] = useState(false);
  const [added, setAdded] = useState<{ id: string; name: string; status: string }[]>([]);

  const load = useCallback(async () => {
    if (!user) return;
    const db = supabase();
    const ver = new URLSearchParams(window.location.search).get("ver");
    const [h, d, a, i] = await Promise.all([
      db.from("households").select("name, kind, status, dissolved_at").eq("id", id).single(),
      db.from("dissolutions").select("id, kind, status, phase, values_version, version, created_by, created_at, completed_at")
        .eq("household_id", id).order("created_at", { ascending: false }),
      db.from("assets").select("id", { count: "exact", head: true }).eq("household_id", id).eq("status", "pendiente"),
      db.from("installments").select("id", { count: "exact", head: true }).eq("household_id", id).eq("status", "pendiente"),
    ]);
    if (h.error) return setError(errorText(h.error));
    setHome(h.data);
    const all = (d.data ?? []) as Dissolution[];
    const ms = await loadMembers(id, user.id);
    setMembers(ms);
    const iLeft = !ms.find((m) => m.user_id === user.id)?.active;
    const exits = all.filter((x) => x.kind === "parcial" && x.status === "confirmado" && x.phase === "cerrado");
    setPastExits(exits);
    const shown =
      h.data.status === "disuelto" ? all.find((x) => x.kind === "total" && x.status === "confirmado") ?? null
      : all.find((x) => x.status === "pendiente")
        ?? (ver ? all.find((x) => x.id === ver) : null)
        ?? (iLeft ? exits[0] : null) ?? null;
    setDiss(shown);
    setRejected(!shown && all[0]?.status === "rechazado");
    setPendingCount((a.count ?? 0) + (i.count ?? 0));
    if (shown) {
      const [c, s, ad] = await Promise.all([
        db.from("confirmations").select("user_id, decision, comment, created_at, subject_version")
          .eq("subject_type", "dissolution").eq("subject_id", shown.id).order("created_at"),
        loadSplit(id, shown).catch((e) => { setError(errorText(e)); return null; }),
        db.from("assets").select("id, name, status").eq("added_in", shown.id).order("created_at"),
      ]);
      setAdded(ad.error ? [] : (ad.data as { id: string; name: string; status: string }[]));
      setConfs((c.data as Conf[]) ?? []);
      setSplit(s);
      if (s) signedUrls(s.items.map((it) => it.photo_path ?? it.receipt_path ?? "")).then(setUrls);
    } else {
      setSplit(null);
    }
  }, [id, user]);

  useEffect(() => { load(); }, [load]);

  async function call(fn: string, args: Record<string, unknown>) {
    setBusy(true); setError("");
    const { error } = await supabase().rpc(fn, args);
    setBusy(false);
    if (error) { setError(errorText(error)); return false; }
    await load();
    return true;
  }

  if (!home || !user) return error ? <main className="pt-10"><ErrorBox>{error}</ErrorBox></main> : <Loading />;
  const active = members.filter((m) => m.active);
  const nameOf = (u: string) => (u === user.id ? "Tú" : members.find((m) => m.user_id === u)?.name ?? "Antiguo miembro");
  const realName = (u: string) => members.find((m) => m.user_id === u)?.name ?? "Antiguo miembro";
  const closed = diss?.phase === "cerrado" || home.status === "disuelto";
  // Quiénes estaban: al cerrar, los que dieron el OK a los valores (todos los que había entonces).
  const people = closed && split ? split.valueOks : active.map((m) => m.user_id);
  const isExit = diss?.kind === "parcial";
  const stayers = isExit && split ? people.filter((u) => !split.leavers.includes(u)) : [];
  const inProgress = home.status === "disolviendo" && diss?.status === "pendiente";
  const phase = closed ? "cerrado" : diss?.phase ?? "valores";
  const current = diss ? confs.filter((c) => c.subject_version === diss.version) : [];
  const rejection = current.find((c) => c.decision === "rechazar");
  const isPareja = home.kind === "pareja";
  const allLeave = isPareja || (leaving.size > 0 && active.every((m) => leaving.has(m.user_id)));
  const leaverNames = (us: string[]) => us.map(realName).join(" y ");
  const title = isExit ? "Salida del piso" : "Disolver hogar";

  return (
    <main className="pb-10">
      <Header title={title} back={`/hogar/${id}`} />
      <ErrorBox>{error}</ErrorBox>

      {(inProgress || closed) && diss && (
        <>
          {isExit && split && <p className="mb-3 text-sm text-muted">{split.leavers.includes(user.id) ? (split.leavers.length > 1 ? <>Os vais <b className="text-ink">{leaverNames(split.leavers.filter((u) => u !== user.id))} y tú</b>.</> : <>Te vas <b className="text-ink">tú</b>.</>) : <>Se {split.leavers.length > 1 ? "van" : "va"} <b className="text-ink">{leaverNames(split.leavers)}</b>.</>} El resto sigue en la casa.</p>}
          <ol className="mb-4 grid grid-cols-4 gap-1.5 text-center text-xs font-semibold">
            {PHASES.map((p, i) => {
              const idx = PHASES.findIndex((x) => x.id === phase);
              const state = i < idx ? "done" : i === idx ? "now" : "next";
              return (
                <li key={p.id} className={`rounded-full px-1 py-1.5 ${state === "now" ? "bg-brand text-brand-ink" : state === "done" ? "bg-ok-bg text-ok" : "border border-line text-muted"}`}>
                  {state === "done" ? "✓ " : `${i + 1} · `}{p.label}
                </li>
              );
            })}
          </ol>
        </>
      )}

      {closed && diss && (
        <Closed home={home} diss={diss} split={split} people={people} stayers={stayers} nameOf={nameOf} realName={realName} me={user.id} id={id} setError={setError} />
      )}

      {home.status === "activo" && !closed && (
        <div className="space-y-4">
          {rejected && (
            <p className="rounded-xl bg-bad-bg px-4 py-3 text-sm text-bad">
              El último intento se paró porque alguien dijo que faltaba algo. Revisad el inventario antes de volver a intentarlo.
            </p>
          )}

          {!isPareja && (
            <section>
              <h2 className="text-lg font-semibold">¿Quién se va?</h2>
              <p className="mb-2 text-sm text-muted">Marca a una persona, a varias o a todas. Si os vais todos, se disuelve el hogar.</p>
              <Card className="divide-y divide-line !p-0">
                {active.map((m) => (
                  <label key={m.user_id} className="flex items-center gap-3 px-4 py-3">
                    <input type="checkbox" checked={leaving.has(m.user_id)} className="h-5 w-5 accent-[var(--brand)]"
                      onChange={(e) => setLeaving((s) => { const n = new Set(s); if (e.target.checked) n.add(m.user_id); else n.delete(m.user_id); return n; })} />
                    <span className="font-medium">{nameOf(m.user_id)}</span>
                  </label>
                ))}
              </Card>
              <button type="button" onClick={() => setLeaving(new Set(active.map((m) => m.user_id)))}
                className="mt-2 text-sm font-medium text-brand">Nos vamos todos</button>
            </section>
          )}

          {(isPareja || leaving.size > 0) && (
            <Card className="space-y-3">
              <p className="font-semibold">{allLeave ? "Se disuelve el hogar entero" : `Se ${leaving.size > 1 ? "van" : "va"} ${leaverNames([...leaving])}`}</p>
              <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
                <li>El inventario se <b>congela</b> mientras dura el reparto.</li>
                <li><b>Valores:</b> os ponéis todos de acuerdo en cuánto vale hoy cada cosa.</li>
                <li><b>Elegir:</b> cada uno marca, por separado, lo que quiere.</li>
                <li><b>Acuerdo:</b> la app propone dos repartos. Cada cosa va a alguien, se vende o se queda en la casa. Uno lo envía y los demás lo aprueban o lo devuelven con cambios.</li>
                {!allLeave && <li>Lo que <b>se queda en el piso</b>, los que siguen se lo pagan a quien se va, según lo que puso.</li>}
                <li>Cuando todos aprobáis, sale el <b>PDF</b>: quién se queda qué y quién paga a quién.</li>
              </ol>
              <p className="text-sm text-muted">Hasta que aprobéis el reparto, se puede cancelar y todo vuelve a la normalidad.</p>
            </Card>
          )}
          {pendingCount > 0 && (
            <p className="rounded-xl bg-warn-bg px-4 py-3 text-sm text-warn">
              Ojo: hay {pendingCount} {pendingCount === 1 ? "cosa pendiente" : "cosas pendientes"} de confirmar. Solo entra en el reparto lo confirmado.
            </p>
          )}
          {(isPareja || leaving.size > 0) && (
            <>
              <label className="flex items-start gap-3 rounded-2xl border border-line bg-card p-4">
                <input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} className="mt-0.5 h-5 w-5 accent-[var(--brand)]" />
                <span className="text-sm">Entiendo que el inventario de <b>{home.name}</b> se congelará mientras dure el reparto.</span>
              </label>
              <Button className="!bg-bad" disabled={!sure || busy}
                onClick={() => call("start_split", { p_household: id, p_leavers: isPareja ? active.map((m) => m.user_id) : [...leaving] })}>
                {allLeave ? "Empezar a disolver" : "Empezar el reparto de la salida"}
              </Button>
            </>
          )}

          {pastExits.length > 0 && (
            <section className="pt-4">
              <h2 className="mb-2 text-sm font-semibold text-muted">Salidas anteriores</h2>
              <div className="space-y-2">
                {pastExits.map((x) => (
                  <a key={x.id} href={`/hogar/${id}/disolver?ver=${x.id}`} className="block">
                    <Card className="flex items-center justify-between text-sm">
                      <span>{formatDateTime(x.completed_at ?? x.created_at)}</span><span className="text-muted">Ver reparto y PDF ›</span>
                    </Card>
                  </a>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {inProgress && diss && !split && !error && <Loading />}

      {inProgress && diss && split && (
        <div className="space-y-4">
          {rejection && (
            <p className="rounded-xl bg-bad-bg px-4 py-3 text-sm text-bad">{rejection.user_id === user.id ? "Has dicho" : `${nameOf(rejection.user_id)} dice`} que falta algo: “{rejection.comment}”</p>
          )}
          {phase === "valores" && <PhaseValues split={split} people={people} me={user.id} nameOf={nameOf} urls={urls} busy={busy} call={call} />}
          {phase === "elegir" && <PhasePick split={split} people={people} me={user.id} nameOf={nameOf} urls={urls} busy={busy} call={call} />}
          {(phase === "elegir" || phase === "acuerdo") && <BackToStart split={split} people={people} me={user.id} nameOf={nameOf} busy={busy} call={call} />}
          {phase === "acuerdo" && <PhaseDeal split={split} people={people} stayers={stayers} me={user.id} nameOf={nameOf} busy={busy} call={call} />}

          <MissingSomething homeId={id} dissId={diss.id} added={added} />
          <Button variant="ghost" disabled={busy} onClick={async () => {
            if (!window.confirm(isExit ? "¿Cancelar la salida? El piso volverá a funcionar con normalidad." : "¿Cancelar la disolución? El hogar volverá a funcionar con normalidad.")) return;
            if (await call("cancel_dissolution", { p_dissolution: diss.id })) router.replace(`/hogar/${id}`);
          }}>{isExit ? "Cancelar la salida" : "Cancelar la disolución"}</Button>
        </div>
      )}
    </main>
  );
}

type CallFn = (fn: string, args: Record<string, unknown>) => Promise<boolean>;

function Thumb({ it, urls, big = false }: { it: SplitItem; urls: Record<string, string>; big?: boolean }) {
  const src = urls[it.photo_path ?? it.receipt_path ?? ""];
  return (
    <div className={`flex shrink-0 items-center justify-center overflow-hidden rounded-xl bg-bg ${big ? "h-24 w-full text-4xl" : "h-12 w-12 text-2xl"}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {src ? <img src={src} alt="" className="h-full w-full object-cover" /> : "📦"}
    </div>
  );
}

function WhoList({ people, ok, nameOf, yes, no }: { people: string[]; ok: string[]; nameOf: (u: string) => string; yes: string; no: string }) {
  return (
    <Card className="divide-y divide-line !p-0">
      {people.map((u) => (
        <div key={u} className="flex items-center justify-between px-4 py-2.5 text-sm">
          <span className="font-medium">{nameOf(u)}</span>
          <span className={ok.includes(u) ? "text-ok" : "text-muted"}>{ok.includes(u) ? `✓ ${yes}` : `⏳ ${no}`}</span>
        </div>
      ))}
    </Card>
  );
}

/* ---------- Confirmar un paso sin marcha atrás ---------- */
type Ask = { title: string; text: string; ok: string; run: () => void };
function ConfirmBox({ ask, onClose }: { ask: Ask | null; onClose: () => void }) {
  if (!ask) return null;
  return (
    <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center" onClick={onClose}>
      <div className="w-full max-w-md space-y-3 rounded-2xl bg-card p-5" onClick={(e) => e.stopPropagation()}>
        <p className="text-lg font-semibold">{ask.title}</p>
        <p className="text-sm text-muted">{ask.text}</p>
        <div className="grid grid-cols-2 gap-3">
          <Button variant="secondary" onClick={onClose}>Todavía no</Button>
          <Button onClick={() => { onClose(); ask.run(); }}>{ask.ok}</Button>
        </div>
      </div>
    </div>
  );
}

/* ---------- Fase 1: valores ---------- */
function PhaseValues({ split, people, me, nameOf, urls, busy, call }:
  { split: SplitState; people: string[]; me: string; nameOf: (u: string) => string; urls: Record<string, string>; busy: boolean; call: CallFn }) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [ask, setAsk] = useState<Ask | null>(null);
  const decidersOf = (it: SplitItem) => (it.is_private ? it.deciders ?? [] : people);
  const missing = split.items.flatMap((it) => decidersOf(it).filter((u) => !(it.is_set && it.itemOks?.includes(u))).map((u) => ({ it, u })));
  const myMissing = missing.filter((m) => m.u === me).length;

  async function save(it: SplitItem) {
    const raw = draft[it.id];
    if (raw === undefined) return;
    const cents = parseEuros(raw);
    const clear = () => setDraft((d) => { const n = { ...d }; delete n[it.id]; return n; });
    if (cents === null || (it.is_set && cents === it.value_cents)) return clear();
    if (await call("dissolution_set_value", { p_dissolution: split.diss.id, p_asset: it.id, p_value_cents: cents })) clear();
  }
  function agree(it: SplitItem) {
    const rest = missing.filter((m) => !(m.u === me && m.it.id === it.id));
    const run = () => { call("dissolution_agree_item", { p_dissolution: split.diss.id, p_asset: it.id }); };
    if (rest.length === 0) setAsk({ title: "¿Pasamos al paso 2?", ok: "Sí, de acuerdo",
      text: "Con tu OK, todos estáis de acuerdo en todos los valores y se pasa a elegir. Solo se podrá volver a los valores si todos lo aceptáis.", run });
    else run();
  }

  const myLast = split.valueLog.map((l) => l.user_id).lastIndexOf(me);
  const news = split.valueLog.slice(myLast + 1).filter((l) => l.user_id && l.user_id !== me).slice(-4);
  const nameOfItem = (aid: string) => split.items.find((i) => i.id === aid)?.name ?? "algo";

  return (
    <>
      <ConfirmBox ask={ask} onClose={() => setAsk(null)} />
      {news.length > 0 && (
        <div className="rounded-2xl border-2 border-bad bg-bad-bg px-4 py-3 text-sm text-bad">
          <p className="font-semibold">✏️ Han cambiado valores desde la última vez:</p>
          <ul className="mt-1 space-y-0.5">
            {news.map((l, i) => (
              <li key={i}>{nameOf(l.user_id!)}: {nameOfItem(l.asset_id)} {l.old_cents !== null ? `${formatEuros(l.old_cents)} → ` : ""}<b>{formatEuros(l.new_cents)}</b></li>
            ))}
          </ul>
          <p className="mt-1 text-xs">Revisa y da tu OK otra vez a lo que haya cambiado.</p>
        </div>
      )}
      <div>
        <h2 className="text-lg font-semibold">¿Cuánto vale hoy cada cosa?</h2>
        <p className="text-sm text-muted">Poned el valor de mercado de hoy (puede ser más o menos de lo que costó). Cada uno da su OK cosa a cosa. Si alguien cambia un valor, los demás tienen que volver a darle el OK.</p>
      </div>
      {split.items.length === 0 ? (
        <>
          <Card className="text-sm text-muted">No hay bienes confirmados que repartir.</Card>
          <Button disabled={busy} onClick={() => call("dissolution_agree_values", { p_dissolution: split.diss.id })}>Seguir</Button>
        </>
      ) : (
        <div className="space-y-2">
          {split.items.map((it) => {
            const log = split.valueLog.filter((l) => l.asset_id === it.id);
            const byUser = new Map<string, number>();
            for (const l of log) if (l.user_id) byUser.set(l.user_id, l.new_cents);
            const last = log.at(-1);
            const red = !!last && last.user_id !== me && !it.itemOks?.includes(me);
            const deciders = decidersOf(it);
            const iOk = !!it.is_set && !!it.itemOks?.includes(me);
            const iDecide = deciders.includes(me);
            return (
              <Card key={it.id} className={`!p-3 ${red ? "!border-2 !border-bad" : iOk ? "!border-ok" : ""}`}>
                <div className="flex items-center gap-3">
                  <Thumb it={it} urls={urls} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{it.name}{it.is_private ? " 🔒" : ""}</p>
                    <p className="text-xs text-muted">Costó {formatEuros(it.price_cents)} · {new Date(it.purchase_date + "T00:00:00").getFullYear()}</p>
                  </div>
                  <div className="flex w-28 items-center gap-1">
                    <input id={`valor-${it.id}`} inputMode="decimal" aria-label={`Valor hoy de ${it.name}`} placeholder="¿Hoy?"
                      value={draft[it.id] ?? (it.is_set ? (it.value_cents / 100).toLocaleString("es-ES", { maximumFractionDigits: 2 }) : "")}
                      onChange={(e) => setDraft((d) => ({ ...d, [it.id]: e.target.value }))}
                      onBlur={() => save(it)} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                      disabled={busy || !iDecide}
                      className="w-full rounded-lg border border-line bg-bg px-2 py-1.5 text-right font-semibold tabular-nums outline-none focus:border-brand" />
                    <span className="text-muted">€</span>
                  </div>
                </div>
                {log.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                    {[...byUser.entries()].map(([u, c]) => (
                      <span key={u} className={`rounded-full px-2 py-0.5 ${u === last?.user_id && u !== me ? "bg-bad text-white" : "bg-line text-muted"}`}>
                        {u === me ? "Tú propusiste" : `${nameOf(u)} propuso`} {formatEuros(c)}
                      </span>
                    ))}
                  </div>
                )}
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-muted">
                    {deciders.map((u) => `${u === me ? "Tú" : nameOf(u)} ${it.is_set && it.itemOks?.includes(u) ? "✓" : "⏳"}`).join(" · ")}
                  </span>
                  {iDecide && it.is_set && !iOk && draft[it.id] === undefined && (
                    <button type="button" disabled={busy} onClick={() => agree(it)}
                      className="rounded-full bg-brand px-3 py-1 text-xs font-semibold text-brand-ink">OK a {formatEuros(it.value_cents)} ✓</button>
                  )}
                  {iOk && <span className="text-xs font-semibold text-ok">✓ Tienes OK</span>}
                  {!it.is_set && <span className="text-xs text-warn">Falta que alguien ponga cuánto vale hoy</span>}
                </div>
              </Card>
            );
          })}
        </div>
      )}
      {split.items.length > 0 && (
        <p className="rounded-xl bg-line/60 px-4 py-3 text-sm text-muted">
          {missing.length === 0 ? "Todo de acuerdo." : myMissing > 0 ? `Te faltan ${myMissing} OK. En total faltan ${missing.length}.` : `Ya has dado todos tus OK. Faltan ${missing.length} de los demás.`}
        </p>
      )}
    </>
  );
}

/* ---------- Fase 2: elegir ---------- */
function PhasePick({ split, people, me, nameOf, urls, busy, call }:
  { split: SplitState; people: string[]; me: string; nameOf: (u: string) => string; urls: Record<string, string>; busy: boolean; call: CallFn }) {
  const done = split.picksDone.includes(me);
  const [sel, setSel] = useState<Set<string>>(() => new Set(split.wants[me] ?? []));
  const [ask, setAsk] = useState<Ask | null>(null);
  const mine = done ? new Set(split.wants[me] ?? []) : sel;
  return (
    <>
      <ConfirmBox ask={ask} onClose={() => setAsk(null)} />
      <div>
        <h2 className="text-lg font-semibold">¿Qué te quieres quedar?</h2>
        <p className="text-sm text-muted">Toca lo que quieras. Cada uno elige por separado: no verás lo de los demás hasta que todos terminéis.</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {split.items.map((it) => {
          const on = mine.has(it.id);
          const pct = Math.round(shareOf(it, me) * 100);
          return (
            <button key={it.id} type="button" disabled={done || busy} aria-pressed={on}
              onClick={() => setSel((s) => { const n = new Set(s); if (n.has(it.id)) n.delete(it.id); else n.add(it.id); return n; })}
              className={`relative flex min-w-0 flex-col gap-1 rounded-2xl border-2 bg-card p-2.5 text-left transition ${on ? "border-brand bg-ok-bg" : "border-line"} ${done ? "cursor-default" : ""}`}>
              <Thumb it={it} urls={urls} big />
              {on && <span className="absolute right-2 top-2 rounded-full bg-brand px-2 py-0.5 text-xs font-bold text-brand-ink">✓ Lo quiero</span>}
              <span className="truncate font-semibold">{it.name}{it.is_private ? " 🔒" : ""}</span>
              <span className="font-bold tabular-nums">{formatEuros(it.value_cents)}</span>
              <span className="text-xs text-muted">{pct > 0 ? `Pusiste el ${pct} %` : "No pusiste nada"}</span>
            </button>
          );
        })}
      </div>
      <WhoList people={people} ok={split.picksDone} nameOf={nameOf} yes="Ya ha elegido" no="Eligiendo…" />
      {!done ? (
        <Button disabled={busy} onClick={() => setAsk({
          title: "¿Envías lo que quieres?", ok: "Sí, enviar",
          text: sel.size ? `Pides ${sel.size} ${sel.size === 1 ? "cosa" : "cosas"}. Después no podrás cambiarlo (solo si todos aceptáis volver al paso 1).` : "No pides nada. Después no podrás cambiarlo (solo si todos aceptáis volver al paso 1).",
          run: () => { call("dissolution_submit_wants", { p_dissolution: split.diss.id, p_assets: [...sel] }); },
        })}>
          {sel.size ? `Enviar lo que quiero (${sel.size})` : "No quiero nada, enviar"}
        </Button>
      ) : (
        <p className="rounded-xl bg-line/60 px-4 py-3 text-sm text-muted">Ya has enviado lo tuyo. Cuando todos terminéis, veréis las propuestas.</p>
      )}
    </>
  );
}

/* ---------- Volver al paso 1 ---------- */
function BackToStart({ split, people, me, nameOf, busy, call }:
  { split: SplitState; people: string[]; me: string; nameOf: (u: string) => string; busy: boolean; call: CallFn }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const b = split.back;
  if (b) {
    const iOk = b.oks.includes(me);
    return (
      <div className="rounded-2xl border-2 border-warn bg-warn-bg px-4 py-3 text-sm text-warn">
        <p className="font-semibold">↩️ {b.from_user === me ? "Has pedido" : `${nameOf(b.from_user)} pide`} volver al paso 1 (valores)</p>
        {b.reason && <p className="mt-1">“{b.reason}”</p>}
        <p className="mt-1 text-xs">Si todos aceptáis, se borra lo elegido y las propuestas, y se vuelve a los valores. {people.map((u) => `${u === me ? "Tú" : nameOf(u)} ${b.oks.includes(u) ? "✓" : "⏳"}`).join(" · ")}</p>
        {!iOk && (
          <div className="mt-2 grid grid-cols-2 gap-2">
            <Button variant="secondary" disabled={busy} onClick={() => call("dissolution_answer_back", { p_request: b.id, p_accept: false })}>No</Button>
            <Button disabled={busy} onClick={() => call("dissolution_answer_back", { p_request: b.id, p_accept: true })}>Acepto volver</Button>
          </div>
        )}
      </div>
    );
  }
  if (!open) return <Button variant="secondary" disabled={busy} onClick={() => setOpen(true)}>Volver al paso 1 (valores)</Button>;
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted">Se lo enviaremos a todos. Solo se vuelve si todos lo aceptan.</p>
      <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} autoFocus placeholder="¿Por qué? Ej. el coche vale más de lo que pusimos"
        className="w-full rounded-xl border border-line bg-card px-4 py-3 text-sm outline-none focus:border-brand" />
      <div className="grid grid-cols-2 gap-3">
        <Button variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
        <Button disabled={busy} onClick={async () => { if (await call("dissolution_request_back", { p_dissolution: split.diss.id, p_reason: reason })) setOpen(false); }}>Pedirlo</Button>
      </div>
    </div>
  );
}

/* ---------- Fase 3: acuerdo ---------- */
type Opt = "a" | "b";
const OPT_LABEL: Record<Opt, string> = { a: "Opción A", b: "Opción B" };

function keeperLabel(v: string | undefined, nameOf: (u: string) => string) {
  return !v || v === "vender" ? "Vender" : v === "piso" ? "Se queda en la casa" : nameOf(v);
}

function PhaseDeal({ split, people, stayers, me, nameOf, busy, call }:
  { split: SplitState; people: string[]; stayers: string[]; me: string; nameOf: (u: string) => string; busy: boolean; call: CallFn }) {
  const pending = split.offers.filter((o) => o.status === "pendiente");
  const accepted = split.offers.find((o) => o.status === "aceptada") ?? null;
  const mine = pending.find((o) => o.from_user === me) ?? null;
  const others = pending.filter((o) => o.from_user !== me);
  const [sel, setSel] = useState<string>(() => others[0]?.id ?? mine?.id ?? "nueva");
  const selected = sel === "nueva" ? null : pending.find((o) => o.id === sel) ?? null;
  const privs = split.items.filter((i) => i.is_private);
  const pub = split.items.filter((i) => !i.is_private);

  return (
    <>
      {others.filter((o) => !(split.offerOks[o.id] ?? []).some((k) => k.user_id === me)).map((o) => (
        <div key={o.id} className="rounded-2xl border-2 border-bad bg-bad-bg px-4 py-3 text-sm text-bad">
          <p className="font-semibold">📩 {nameOf(o.from_user)} ha enviado una propuesta</p>
          {o.note && <p className="mt-1 text-base">“{o.note}”</p>}
          {sel !== o.id && <button type="button" onClick={() => setSel(o.id)} className="mt-1 text-xs font-semibold underline">Verla</button>}
        </div>
      ))}

      {accepted ? (
        <div className="rounded-2xl bg-ok-bg px-4 py-3 text-sm text-ok">
          <p className="font-semibold">✅ Lo común está acordado: propuesta de {nameOf(accepted.from_user)}, {OPT_LABEL[(accepted.chosen ?? "a") as Opt]}.</p>
          {privs.length > 0 && <p className="mt-1">Falta que los de dentro decidan los privados 🔒 (abajo).</p>}
        </div>
      ) : (
        <>
          <div>
            <h2 className="text-lg font-semibold">Propuestas</h2>
            <p className="text-sm text-muted">Cada uno puede enviar la suya (con opción A y B). Aprueba la que te convenza: se cierra cuando todos aprobáis la misma.</p>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {pending.map((o) => {
              const oks = split.offerOks[o.id] ?? [];
              return (
                <button key={o.id} type="button" onClick={() => setSel(o.id)} aria-pressed={sel === o.id}
                  className={`shrink-0 rounded-xl border-2 bg-card px-3 py-2 text-left text-sm font-semibold ${sel === o.id ? "border-brand bg-ok-bg" : "border-line"}`}>
                  {o.from_user === me ? "La tuya" : `De ${nameOf(o.from_user)}`}
                  <span className="block text-xs font-normal text-muted">{oks.length} de {people.length} la aprueban</span>
                </button>
              );
            })}
            {!mine && (
              <button type="button" onClick={() => setSel("nueva")} aria-pressed={sel === "nueva"}
                className={`shrink-0 rounded-xl border-2 border-dashed bg-card px-3 py-2 text-left text-sm font-semibold ${sel === "nueva" ? "border-brand" : "border-line"}`}>
                + Hacer la mía
                <span className="block text-xs font-normal text-muted">La app te prepara dos</span>
              </button>
            )}
          </div>
          {pub.length > 0 && <OfferView key={sel} offer={selected} split={split} items={pub} people={people} stayers={stayers} me={me} nameOf={nameOf} busy={busy} call={call} />}
          {pub.length === 0 && !accepted && (
            <OfferView key={sel} offer={selected} split={split} items={pub} people={people} stayers={stayers} me={me} nameOf={nameOf} busy={busy} call={call} />
          )}
        </>
      )}
      {accepted && <SplitSummary items={pub} assign={chosenAssignment(accepted)} people={people} stayers={stayers} nameOf={nameOf} me={me} />}

      {privs.length > 0 && <PrivateDeals split={split} items={privs} people={people} stayers={stayers} me={me} nameOf={nameOf} busy={busy} call={call} />}
    </>
  );
}

function OfferView({ offer, split, items, people, stayers, me, nameOf, busy, call }:
  { offer: Offer | null; split: SplitState; items: SplitItem[]; people: string[]; stayers: string[]; me: string; nameOf: (u: string) => string; busy: boolean; call: CallFn }) {
  const oks = offer ? split.offerOks[offer.id] ?? [] : [];
  const myOk = oks.find((k) => k.user_id === me);
  const isMine = !!offer && offer.from_user === me;
  const nobody = stayers.length ? "piso" : "vender";
  const p1 = useMemo(() => proposalByPaid(items, split.wants, people, nobody), [items, split.wants, people, nobody]);
  const p2 = useMemo(() => proposalBalanced(items, split.wants, people, nobody, stayers), [items, split.wants, people, nobody, stayers]);
  // Comparar con mi última propuesta, para marcar en rojo lo que han cambiado los demás
  const myLastOffer = [...split.offers].reverse().find((o) => o.from_user === me && (!offer || o.created_at < offer.created_at)) ?? null;
  const prev = offer && !isMine ? myLastOffer : null;

  const firstPick = offer ? oks.find((k) => k.choice && k.user_id !== offer.from_user) ?? null : null;
  const hasB = !offer || !!offer.assignment_b;
  const discarded: Opt | null = !hasB ? "b" : firstPick ? (firstPick.choice === "a" ? "b" : "a") : null;
  const base: Record<Opt, Assignment> = offer ? { a: offer.assignment, b: offer.assignment_b ?? offer.assignment } : { a: p1, b: p2 };
  const [tab, setTab] = useState<Opt>(firstPick?.choice ?? "a");
  const [draft, setDraft] = useState<Record<Opt, Assignment | null>>({ a: null, b: null });
  const [note, setNote] = useState("");
  const [ask, setAsk] = useState<Ask | null>(null);
  const cur: Record<Opt, Assignment> = { a: draft.a ?? base.a, b: draft.b ?? base.b };
  const changedByMe = (o: Opt, itemId: string) => !!draft[o] && draft[o]![itemId] !== base[o][itemId];
  const anyChange = (["a", "b"] as Opt[]).some((o) => o !== discarded && draft[o] && !sameAssignment(draft[o]!, base[o]));
  const prevOf = (o: Opt) => (prev ? (o === "b" ? prev.assignment_b ?? prev.assignment : prev.assignment) : null);
  const changedByOthers = (o: Opt, itemId: string) => !!prevOf(o) && prevOf(o)![itemId] !== base[o][itemId];

  function cycle(itemId: string) {
    const order = [...people, "piso", "vender"];
    const now = cur[tab][itemId] ?? nobody;
    setDraft((d) => ({ ...d, [tab]: { ...cur[tab], [itemId]: order[(order.indexOf(now) + 1) % order.length] } }));
  }
  async function send() {
    const live = discarded ? (discarded === "a" ? cur.b : cur.a) : null;
    const args = live ? { p_assignment: live, p_assignment_b: null } : { p_assignment: cur.a, p_assignment_b: cur.b };
    if (await call("dissolution_send_offer", { p_dissolution: split.diss.id, ...args, p_note: note })) { setDraft({ a: null, b: null }); setNote(""); }
  }
  function approve() {
    if (!offer) return;
    const others = people.filter((u) => u !== me);
    const allOthers = others.every((u) => oks.some((k) => k.user_id === u && (k.choice === null || k.choice === tab)));
    const run = () => { call("dissolution_accept_offer", { p_offer: offer.id, p_choice: tab }); };
    setAsk({
      title: allOthers ? "¿Cerramos el reparto?" : `¿Apruebas la ${OPT_LABEL[tab]}?`,
      text: allOthers ? "Todos los demás ya la aprueban. Con tu OK queda cerrado y sale el PDF. No hay marcha atrás." : "Si la aprueba alguien más, la otra opción queda descartada. Puedes cambiar de idea mientras no la aprobéis todos.",
      ok: allOthers ? "Sí, cerrar" : "Sí, aprobar", run,
    });
  }

  const nChanges = prev ? items.filter((it) => (["a", "b"] as Opt[]).some((o) => changedByOthers(o, it.id))).length : 0;
  const pickedBy = firstPick && firstPick.user_id !== me ? firstPick : null;

  return (
    <>
      <ConfirmBox ask={ask} onClose={() => setAsk(null)} />
      {prev && nChanges > 0 && (
        <p className="rounded-xl bg-bad-bg px-3 py-2 text-sm text-bad">Respecto a tu propuesta, {nameOf(offer!.from_user)} ha cambiado {nChanges} {nChanges === 1 ? "cosa" : "cosas"} (en rojo).</p>
      )}
      {pickedBy && (
        <p className="rounded-xl bg-ok-bg px-3 py-2 text-sm text-ok">✅ {nameOf(pickedBy.user_id)} ha aprobado la {OPT_LABEL[pickedBy.choice!]}. La otra queda descartada.</p>
      )}
      {offer?.note && <p className="rounded-xl bg-line/60 px-3 py-2 text-sm">“{offer.note}”</p>}

      <div className="grid grid-cols-2 gap-2">
        {(["a", "b"] as Opt[]).map((o) => (
          <button key={o} type="button" onClick={() => setTab(o)} aria-pressed={tab === o} disabled={o === discarded}
            className={`rounded-xl border-2 bg-card px-3 py-2 text-left text-sm font-semibold disabled:opacity-40 ${tab === o ? "border-brand bg-ok-bg" : "border-line"}`}>
            {OPT_LABEL[o]}
            <span className="block text-xs font-normal text-muted">
              {o === discarded ? (hasB ? "Descartada" : "Esta vez solo hay una") : items.some((it) => changedByOthers(o, it.id)) ? <span className="text-bad">Con cambios</span>
                : !offer ? (o === "a" ? "Manda quien más pagó" : "Se mueve menos dinero") : "Toca para verla"}
            </span>
          </button>
        ))}
      </div>

      <SplitSummary items={items} assign={cur[tab]} people={people} stayers={stayers} nameOf={nameOf} me={me} />

      <Card className="overflow-x-auto !p-3">
        <p className="mb-2 font-semibold">Mapa: quién quiere qué ({OPT_LABEL[tab]})</p>
        <table className="w-full text-center text-xs">
          <thead>
            <tr className="text-muted">
              <th className="py-1 text-left font-medium">Objeto</th>
              {people.map((u) => <th key={u} className="px-1 py-1 font-medium">{nameOf(u)}</th>)}
              <th className="px-1 py-1 font-medium">Casa</th><th className="px-1 py-1 font-medium">Vender</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => {
              const k = cur[tab][it.id] ?? nobody;
              return (
                <tr key={it.id} className={`border-t border-line ${changedByOthers(tab, it.id) ? "bg-bad-bg" : ""}`}>
                  <td className="max-w-[7rem] truncate py-1.5 text-left font-medium">{it.name}</td>
                  {people.map((u) => {
                    const w = split.wants[u]?.includes(it.id);
                    const pct = Math.round(shareOf(it, u, people) * 100);
                    return (
                      <td key={u} className={`px-1 ${k === u ? "bg-ok-bg font-bold text-ok" : ""}`}>
                        {k === u ? "✓" : w ? "✋" : "·"}<span className="block text-[10px] font-normal text-muted">{pct} %</span>
                      </td>
                    );
                  })}
                  <td className={k === "piso" ? "bg-ok-bg font-bold text-ok" : "text-muted"}>{k === "piso" ? "✓" : "·"}</td>
                  <td className={k === "vender" ? "bg-line font-bold" : "text-muted"}>{k === "vender" ? "✓" : "·"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-muted">✓ = se lo queda en esta opción · ✋ = lo pidió · % = lo que puso cada uno.</p>
      </Card>

      <div className="space-y-2">
        <p className="font-semibold">Objeto a objeto</p>
        {items.map((it) => {
          const red = changedByOthers("a", it.id) || changedByOthers("b", it.id);
          return (
            <Card key={it.id} className={`!p-3 ${red ? "!border-2 !border-bad" : ""}`}>
              <div className="flex items-baseline justify-between gap-2">
                <p className="truncate font-semibold">{it.name}</p>
                <p className="shrink-0 font-semibold tabular-nums">{formatEuros(it.value_cents)}</p>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5 text-xs">
                {people.map((u) => {
                  const pct = Math.round(shareOf(it, u, people) * 100);
                  const wants = split.wants[u]?.includes(it.id);
                  return (
                    <span key={u} className={`rounded-full px-2 py-0.5 ${wants ? "bg-accent text-white" : "bg-line text-muted"}`}>
                      {nameOf(u)} {pct} %{wants ? " · lo quiere ✋" : ""}
                    </span>
                  );
                })}
              </div>
              <div className={`mt-2 grid gap-2 ${discarded ? "grid-cols-1" : "grid-cols-2"}`}>
                {(["a", "b"] as Opt[]).filter((o) => o !== discarded).map((o) => {
                  const v = cur[o][it.id] ?? nobody;
                  const mineChanged = changedByMe(o, it.id);
                  const othersChanged = changedByOthers(o, it.id);
                  return (
                    <button key={o} type="button" disabled={busy || tab !== o} onClick={() => cycle(it.id)}
                      className={`rounded-xl border-2 px-2 py-1.5 text-left text-xs disabled:cursor-default ${othersChanged ? "border-bad" : mineChanged ? "border-warn" : tab === o ? "border-brand" : "border-line opacity-60"}`}>
                      <span className="block text-muted">{o.toUpperCase()}{othersChanged && prevOf(o) ? ` · en la tuya: ${keeperLabel(prevOf(o)![it.id], nameOf)}` : mineChanged ? " · cambiado por ti" : ""}</span>
                      <span className="block font-semibold">{keeperLabel(v, nameOf)}</span>
                    </button>
                  );
                })}
              </div>
            </Card>
          );
        })}
        <p className="text-xs text-muted">Toca la casilla de la opción que estás viendo ({tab.toUpperCase()}) para cambiar quién se lo queda.</p>
      </div>

      {(anyChange || !offer) && (
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} id="nota-reparto"
          placeholder="Mensaje para los demás (opcional). Ej. te dejo la tele si me quedo el sofá"
          className="w-full rounded-xl border border-line bg-card px-4 py-3 text-sm outline-none focus:border-brand" />
      )}
      {!offer && <Button disabled={busy} onClick={send}>Enviar mi propuesta (A y B)</Button>}
      {offer && anyChange && (
        <div className="grid grid-cols-2 gap-3">
          <Button variant="secondary" disabled={busy} onClick={() => setDraft({ a: null, b: null })}>Deshacer cambios</Button>
          <Button disabled={busy} onClick={send}>{isMine ? "Actualizar la mía" : "Enviar como mi propuesta"}</Button>
        </div>
      )}
      {offer && !anyChange && !isMine && (
        <Button disabled={busy || myOk?.choice === tab || tab === discarded} onClick={approve}>
          {myOk?.choice === tab ? `Ya apruebas la ${OPT_LABEL[tab]} ✓` : `Aprobar la ${OPT_LABEL[tab]} ✓`}
        </Button>
      )}
      {offer && (
        <Card className="divide-y divide-line !p-0">
          {people.map((u) => {
            const k = oks.find((x) => x.user_id === u);
            return (
              <div key={u} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <span className="font-medium">{nameOf(u)}</span>
                <span className={k ? "text-ok" : "text-muted"}>
                  {!k ? "⏳ Aún no la aprueba" : k.choice ? `✓ Aprueba la ${OPT_LABEL[k.choice]}` : "✓ Es suya (vale A o B)"}
                </span>
              </div>
            );
          })}
        </Card>
      )}
    </>
  );
}

/* ---------- Privados: solo los de dentro ---------- */
function PrivateDeals({ split, items, people, stayers, me, nameOf, busy, call }:
  { split: SplitState; items: SplitItem[]; people: string[]; stayers: string[]; me: string; nameOf: (u: string) => string; busy: boolean; call: CallFn }) {
  const [pick, setPick] = useState<Record<string, string>>({});
  const assign: Assignment = Object.fromEntries(items.map((it) => [it.id, pick[it.id] ?? split.privateDeals[it.id]?.keeper ?? "vender"]));
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold">Privados 🔒</h2>
      <p className="text-sm text-muted">Solo los veis y decidís quienes estáis dentro de cada uno. Los demás no los ven.</p>
      {items.map((it) => {
        const deal = split.privateDeals[it.id];
        const ins = it.deciders ?? [];
        const iIn = ins.includes(me);
        const choice = pick[it.id] ?? deal?.keeper ?? "vender";
        const order = [...ins, "piso", "vender"];
        const iOk = !!deal && deal.keeper === choice && deal.oks.includes(me);
        return (
          <Card key={it.id} className={`!p-3 ${deal && !deal.oks.includes(me) ? "!border-2 !border-bad" : ""}`}>
            <div className="flex items-baseline justify-between gap-2">
              <p className="truncate font-semibold">{it.name} 🔒</p>
              <p className="shrink-0 font-semibold tabular-nums">{formatEuros(it.value_cents)}</p>
            </div>
            <p className="text-xs text-muted">
              {ins.map((u) => `${nameOf(u)} ${Math.round(shareOf(it, u, ins) * 100)} %${split.wants[u]?.includes(it.id) ? " ✋" : ""}`).join(" · ")}
            </p>
            {deal && <p className="mt-1 text-xs">{deal.set_by === me ? "Propusiste" : `${nameOf(deal.set_by)} propone`}: <b>{keeperLabel(deal.keeper, nameOf)}</b> · {ins.map((u) => `${nameOf(u)} ${deal.oks.includes(u) ? "✓" : "⏳"}`).join(" · ")}</p>}
            {iIn && (
              <div className="mt-2 flex items-center gap-2">
                <button type="button" disabled={busy} onClick={() => setPick((p) => ({ ...p, [it.id]: order[(order.indexOf(choice) + 1) % order.length] }))}
                  className="flex-1 rounded-xl border-2 border-brand px-3 py-1.5 text-left text-sm font-semibold">{keeperLabel(choice, nameOf)} <span className="text-xs font-normal text-muted">· toca para cambiar</span></button>
                <button type="button" disabled={busy || iOk} onClick={async () => { if (await call("dissolution_private_set", { p_dissolution: split.diss.id, p_asset: it.id, p_keeper: choice })) setPick((p) => { const n = { ...p }; delete n[it.id]; return n; }); }}
                  className="rounded-xl bg-brand px-3 py-2 text-sm font-semibold text-brand-ink disabled:opacity-40">
                  {iOk ? "✓" : deal && deal.keeper === choice ? "Aprobar" : "Proponer"}
                </button>
              </div>
            )}
          </Card>
        );
      })}
      <SplitSummary items={items} assign={assign} people={people} stayers={stayers} nameOf={nameOf} me={me} />
    </section>
  );
}

function SplitSummary({ items, assign, people, stayers, nameOf, me }:
  { items: SplitItem[]; assign: Assignment; people: string[]; stayers: string[]; nameOf: (u: string) => string; me: string }) {
  const t = transfers(balances(items, assign, people, stayers));
  const home = items.filter((it) => assign[it.id] === "piso");
  const sale = saleSplit(items, assign, people);
  const rows = explain(items, assign, people, stayers);
  const pay = (x: { from: string; to: string; cents: number }) =>
    x.from === me ? `Pagas ${formatEuros(x.cents)} a ${nameOf(x.to)}`
      : x.to === me ? `${nameOf(x.from)} te paga ${formatEuros(x.cents)}`
      : `${nameOf(x.from)} paga ${formatEuros(x.cents)} a ${nameOf(x.to)}`;
  const list = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} y ${xs.at(-1)}`);
  return (
    <>
      <div className="rounded-2xl bg-brand px-4 py-4 text-center text-brand-ink">
        <p className="text-sm opacity-90">Para quedar en paz</p>
        {t.length === 0 ? <p className="text-2xl font-bold">Estáis en paz</p> : t.map((x, i) => <p key={i} className="text-xl font-bold">{pay(x)}</p>)}
      </div>
      <Card className="space-y-3 !p-4 text-sm">
        <p className="font-semibold">Por qué</p>
        {rows.map((r) => {
          const things = [...r.mine.map((it) => it.name), ...r.fromHome.map((x) => `su parte de ${x.it.name}`)];
          return (
            r.user === me ? (
              <p key={r.user} className="rounded-xl bg-ok-bg/60 px-3 py-2">
                <b>Tú</b>{" "}
                {things.length ? <>te quedas {list(things.map((t) => t.replace(/^su parte/, "tu parte")))} (<b>{formatEuros(r.gets)}</b>).</> : <>no te quedas nada.</>}{" "}
                <span className="text-muted">Por lo que pusiste, te corresponden {formatEuros(r.due)} de lo que se reparte.</span>{" "}
                {r.balance >= 100 ? <b>Pagas {formatEuros(r.balance)}.</b> : r.balance <= -100 ? <b>Cobras {formatEuros(-r.balance)}.</b> : <b>Quedas en paz.</b>}
              </p>
            ) : (
            <p key={r.user}>
              <b>{nameOf(r.user)}</b>{" "}
              {things.length ? <>se queda {list(things)} (<b>{formatEuros(r.gets)}</b>).</> : <>no se queda nada.</>}{" "}
              <span className="text-muted">Por lo que puso, le corresponden {formatEuros(r.due)} de lo que se reparte.</span>{" "}
              {r.balance >= 100 ? <b>Paga {formatEuros(r.balance)}.</b> : r.balance <= -100 ? <b>Cobra {formatEuros(-r.balance)}.</b> : <b>Queda en paz.</b>}
            </p>
            )
          );
        })}
        {home.length > 0 && (
          stayers.length
            ? <p><b>Se queda en la casa:</b> {list(home.map((it) => it.name))} ({formatEuros(home.reduce((s, it) => s + it.value_cents, 0))}). Lo pagan {list(stayers.map(nameOf))}, cada uno según lo que puso, y así quien se va recibe su parte.</p>
            : <p><b>Se queda en la casa, como está:</b> {list(home.map((it) => it.name))}. Sigue siendo de quien lo pagó, con los mismos %. No se mueve dinero por esto.</p>
        )}
        {sale.sold.length > 0 && (
          <p><b>Se vende:</b> {list(sale.sold.map((it) => it.name))} (≈ {formatEuros(sale.total)}). Con lo que se saque, cada uno cobra según lo que puso:{" "}
            {list(Object.entries(sale.per).filter(([, v]) => v >= 100).map(([u, v]) => `${nameOf(u)} ${formatEuros(Math.round(v))}`)) || "—"}.
            {" "}Si se vende por más o por menos, se reparte con los mismos %.</p>
        )}
      </Card>
    </>
  );
}

/* ---------- Cerrado ---------- */
function Closed({ home, diss, split, people, stayers, nameOf, realName, me, id, setError }:
  { home: Household; diss: Dissolution; split: SplitState | null; people: string[]; stayers: string[]; nameOf: (u: string) => string; realName: (u: string) => string; me: string; id: string; setError: (e: string) => void }) {
  const [busy, setBusy] = useState(false);
  const accepted = split?.offers.find((o) => o.status === "aceptada") ?? null;
  const assignment = accepted
    ? { ...chosenAssignment(accepted), ...Object.fromEntries(Object.values(split!.privateDeals).map((d) => [d.asset_id, d.keeper])) }
    : null;
  const isExit = diss.kind === "parcial";
  const leavers = split?.leavers ?? [];
  const keeperName = (v: string) => (v === "vender" ? "Para vender" : v === "piso" ? "Se queda en la casa" : realName(v));
  const others = leavers.filter((u) => u !== me).map(realName);
  const iLeft = leavers.includes(me);
  const exitText = iLeft
    ? (others.length ? `${others.join(", ")} y tú habéis salido del piso` : "Has salido del piso")
    : `${others.join(" y ")} ${others.length > 1 ? "han salido" : "ha salido"} del piso`;

  async function finalPdf() {
    setBusy(true);
    try {
      const r = await loadReport(id);
      const { buildPdf, pdfFileName } = await import("@/lib/pdf");
      let splitPdf;
      if (split && assignment) {
        const a = assignment;
        const sale = saleSplit(split.items, a, people);
        splitPdf = {
          rows: split.items.map((it) => ({ name: it.name, price: it.price_cents, value: it.value_cents, keeper: keeperName(a[it.id]) })),
          transfers: transfers(balances(split.items, a, people, stayers)).map((t) => ({ from: realName(t.from), to: realName(t.to), cents: t.cents })),
          sale: sale.sold.length ? { total: sale.total, per: Object.entries(sale.per).filter(([, v]) => v > 0).map(([u, v]) => ({ name: realName(u), cents: Math.round(v) })) } : null,
        };
      }
      const names = leavers.map(realName).join(" y ");
      buildPdf(r, { final: !isExit, split: splitPdf, title: isExit ? `Salida de ${names}` : undefined })
        .save(isExit ? pdfFileName(r, false, names) : pdfFileName(r, true));
    } catch (e) { setError(errorText(e)); }
    setBusy(false);
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-2 text-center">
        <p className="text-4xl">🤝</p>
        {isExit ? (
          <>
            <p className="text-lg font-semibold">{exitText}</p>
            {diss.completed_at && <p className="text-sm text-muted">El {formatDateTime(diss.completed_at)}.</p>}
          </>
        ) : (
          <>
            <p className="text-lg font-semibold">{home.name} está disuelto</p>
            {home.dissolved_at && <p className="text-sm text-muted">Desde el {formatDateTime(home.dissolved_at)}. El inventario ya no se puede cambiar.</p>}
          </>
        )}
      </Card>
      {split && assignment && <SplitSummary items={split.items} assign={assignment} people={people} stayers={stayers} nameOf={nameOf} me={me} />}
      {split && assignment && (
        <Card className="divide-y divide-line !p-0 text-sm">
          {split.items.map((it) => (
            <div key={it.id} className="flex items-baseline justify-between gap-2 px-4 py-2.5">
              <span className="truncate">{it.name} <span className="text-muted">{formatEuros(it.value_cents)}</span></span>
              <span className="shrink-0 font-semibold">{keeperLabel(assignment[it.id], nameOf)}</span>
            </div>
          ))}
        </Card>
      )}
      <Button onClick={finalPdf} disabled={busy}>{busy ? "Preparando…" : isExit ? "📄 Descargar PDF de la salida" : "📄 Descargar PDF final"}</Button>
    </div>
  );
}

/* ---------- Falta algo ---------- */
function MissingSomething({ homeId, dissId, added }: { homeId: string; dissId: string; added: { id: string; name: string; status: string }[] }) {
  const waiting = added.filter((x) => x.status === "pendiente");
  const rejected = added.filter((x) => x.status === "rechazado");
  return (
    <section className="space-y-2">
      {waiting.length > 0 && (
        <div className="rounded-2xl border-2 border-warn bg-warn-bg px-4 py-3 text-sm text-warn">
          <p className="font-semibold">🧩 Se ha apuntado algo que faltaba. Confirmadlo para que entre en el reparto:</p>
          <ul className="mt-1 space-y-0.5">
            {waiting.map((x) => <li key={x.id}><a href={`/hogar/${homeId}/bien/${x.id}`} className="font-semibold underline">{x.name} ›</a></li>)}
          </ul>
          <p className="mt-1 text-xs">Mientras no se confirme o se rechace, el reparto no se puede cerrar.</p>
        </div>
      )}
      {rejected.length > 0 && (
        <p className="text-xs text-muted">No entran (rechazados): {rejected.map((x) => x.name).join(", ")}</p>
      )}
      <Button variant="secondary" type="button" onClick={() => { window.location.href = `/hogar/${homeId}/anadir?reparto=${dissId}`; }}>🧩 Falta algo en el inventario</Button>
      <p className="text-xs text-muted">El reparto no se cancela: lo apuntas, los demás lo confirman y entra en el reparto.</p>
    </section>
  );
}
