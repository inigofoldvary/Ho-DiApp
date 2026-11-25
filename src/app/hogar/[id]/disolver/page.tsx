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
  type Assignment, type Dissolution, type SplitState, type SplitItem,
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
      const [c, s] = await Promise.all([
        db.from("confirmations").select("user_id, decision, comment, created_at, subject_version")
          .eq("subject_type", "dissolution").eq("subject_id", shown.id).order("created_at"),
        loadSplit(id, shown).catch((e) => { setError(errorText(e)); return null; }),
      ]);
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
          {isExit && split && <p className="mb-3 text-sm text-muted">Se {split.leavers.length > 1 ? "van" : "va"} <b className="text-ink">{leaverNames(split.leavers)}</b>. El resto sigue en el piso.</p>}
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
                <li><b>Acuerdo:</b> la app propone dos repartos. Cada cosa va a alguien, se vende{allLeave ? "" : " o se queda en el piso"}. Uno lo envía y los demás lo aprueban o lo devuelven con cambios.</li>
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
            <p className="rounded-xl bg-bad-bg px-4 py-3 text-sm text-bad">{nameOf(rejection.user_id)} dice que falta algo: “{rejection.comment}”</p>
          )}
          {phase === "valores" && <PhaseValues split={split} people={people} me={user.id} nameOf={nameOf} urls={urls} busy={busy} call={call} />}
          {phase === "elegir" && <PhasePick split={split} people={people} me={user.id} nameOf={nameOf} urls={urls} busy={busy} call={call} />}
          {phase === "acuerdo" && <PhaseDeal key={split.offers.at(-1)?.id ?? "ninguna"} split={split} people={people} stayers={stayers} me={user.id} nameOf={nameOf} busy={busy} call={call} />}

          <MissingSomething dissId={diss.id} busy={busy} call={call} />
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

/* ---------- Fase 1: valores ---------- */
function PhaseValues({ split, people, me, nameOf, urls, busy, call }:
  { split: SplitState; people: string[]; me: string; nameOf: (u: string) => string; urls: Record<string, string>; busy: boolean; call: CallFn }) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const iAgreed = split.valueOks.includes(me);
  const others = people.filter((u) => u !== me && !split.valueOks.includes(u));

  async function save(it: SplitItem) {
    const raw = draft[it.id];
    if (raw === undefined) return;
    const cents = parseEuros(raw);
    if (cents === null || cents === it.value_cents) { setDraft((d) => { const n = { ...d }; delete n[it.id]; return n; }); return; }
    if (await call("dissolution_set_value", { p_dissolution: split.diss.id, p_asset: it.id, p_value_cents: cents })) {
      setDraft((d) => { const n = { ...d }; delete n[it.id]; return n; });
    }
  }

  return (
    <>
      <div>
        <h2 className="text-lg font-semibold">¿Cuánto vale hoy cada cosa?</h2>
        <p className="text-sm text-muted">La app propone un valor (pierde un 15 % por cada año). Cambiadlo si no cuadra: puede valer más o menos de lo que costó. Debajo de cada cosa verás qué precio ha puesto cada uno; en rojo, lo último que ha cambiado otra persona.</p>
      </div>
      {split.items.length === 0 ? (
        <Card className="text-sm text-muted">No hay bienes confirmados que repartir. Dad el OK y pasaréis directamente al final.</Card>
      ) : (
        <Card className="divide-y divide-line !p-0">
          {split.items.map((it) => {
            const diff = it.value_cents - it.price_cents;
            const log = split.valueLog.filter((l) => l.asset_id === it.id);
            const appValue = log[0]?.old_cents ?? it.value_cents;
            const byUser = new Map<string, number>();
            for (const l of log) if (l.user_id) byUser.set(l.user_id, l.new_cents);
            const last = log.at(-1);
            const red = !!last && last.user_id !== me;
            return (
              <div key={it.id} className={`px-3 py-2.5 ${red ? "border-l-4 !border-l-bad bg-bad-bg/40" : ""}`}>
              <div className="flex items-center gap-3">
                <Thumb it={it} urls={urls} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{it.name}</p>
                  <p className="text-xs text-muted">
                    Costó {formatEuros(it.price_cents)} · {new Date(it.purchase_date + "T00:00:00").getFullYear()}
                    {diff !== 0 && <span className={diff > 0 ? " text-ok" : " text-warn"}> · {diff > 0 ? "+" : ""}{formatEuros(diff)}</span>}
                  </p>
                </div>
                <div className="flex w-28 items-center gap-1">
                  <input id={`valor-${it.id}`} inputMode="decimal" aria-label={`Valor hoy de ${it.name}`}
                    value={draft[it.id] ?? (it.value_cents / 100).toLocaleString("es-ES", { maximumFractionDigits: 2 })}
                    onChange={(e) => setDraft((d) => ({ ...d, [it.id]: e.target.value }))}
                    onBlur={() => save(it)} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                    disabled={busy}
                    className="w-full rounded-lg border border-line bg-bg px-2 py-1.5 text-right font-semibold tabular-nums outline-none focus:border-brand" />
                  <span className="text-muted">€</span>
                </div>
              </div>
              {log.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1.5 pl-[3.75rem] text-xs">
                  <span className="rounded-full bg-line px-2 py-0.5 text-muted">La app: {formatEuros(appValue)}</span>
                  {[...byUser.entries()].map(([u, c]) => (
                    <span key={u} className={`rounded-full px-2 py-0.5 ${u === last?.user_id && u !== me ? "bg-bad text-white" : "bg-line text-muted"}`}>
                      {nameOf(u)}: {formatEuros(c)}
                    </span>
                  ))}
                </div>
              )}
              </div>
            );
          })}
        </Card>
      )}
      <WhoList people={people} ok={split.valueOks} nameOf={nameOf} yes="De acuerdo" no="Falta que confirme" />
      {!iAgreed ? (
        <Button disabled={busy || Object.keys(draft).length > 0} onClick={() => call("dissolution_agree_values", { p_dissolution: split.diss.id })}>
          Estoy de acuerdo con estos valores
        </Button>
      ) : (
        <p className="rounded-xl bg-line/60 px-4 py-3 text-sm text-muted">
          Falta que {others.map(nameOf).join(" y ")} {others.length === 1 ? "confirme" : "confirmen"}. Si alguien cambia un valor, tendréis que volver a dar el OK.
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
  const mine = done ? new Set(split.wants[me] ?? []) : sel;
  return (
    <>
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
              <span className="truncate font-semibold">{it.name}</span>
              <span className="font-bold tabular-nums">{formatEuros(it.value_cents)}</span>
              <span className="text-xs text-muted">{pct > 0 ? `Pusiste el ${pct} %` : "No pusiste nada"}</span>
            </button>
          );
        })}
      </div>
      <WhoList people={people} ok={split.picksDone} nameOf={nameOf} yes="Ya ha elegido" no="Eligiendo…" />
      {!done ? (
        <Button disabled={busy} onClick={() => call("dissolution_submit_wants", { p_dissolution: split.diss.id, p_assets: [...sel] })}>
          {sel.size ? `Enviar lo que quiero (${sel.size})` : "No quiero nada, enviar"}
        </Button>
      ) : (
        <p className="rounded-xl bg-line/60 px-4 py-3 text-sm text-muted">Ya has enviado lo tuyo. Cuando todos terminéis, veréis las propuestas.</p>
      )}
    </>
  );
}

/* ---------- Fase 3: acuerdo ---------- */
type Opt = "a" | "b";
const OPT_LABEL: Record<Opt, string> = { a: "Opción A", b: "Opción B" };

function keeperLabel(v: string | undefined, nameOf: (u: string) => string) {
  return !v || v === "vender" ? "Vender" : v === "piso" ? "Se queda en el piso" : nameOf(v);
}

function PhaseDeal({ split, people, stayers, me, nameOf, busy, call }:
  { split: SplitState; people: string[]; stayers: string[]; me: string; nameOf: (u: string) => string; busy: boolean; call: CallFn }) {
  const offers = split.offers;
  const open = [...offers].reverse().find((o) => o.status === "pendiente") ?? null;
  const prev = open ? offers[offers.indexOf(open) - 1] ?? null : null;
  const oks = open ? split.offerOks[open.id] ?? [] : [];
  const myOk = oks.find((k) => k.user_id === me);
  const iSent = !!open && open.from_user === me;
  const nobody = stayers.length ? "piso" : "vender";
  const p1 = useMemo(() => proposalByPaid(split.items, split.wants, people, nobody), [split, people, nobody]);
  const p2 = useMemo(() => proposalBalanced(split.items, split.wants, people, nobody, stayers), [split, people, nobody, stayers]);

  const base: Record<Opt, Assignment> = open
    ? { a: open.assignment, b: open.assignment_b ?? open.assignment }
    : { a: p1, b: p2 };
  const [tab, setTab] = useState<Opt>("a");
  const [draft, setDraft] = useState<Record<Opt, Assignment | null>>({ a: null, b: null });
  const [note, setNote] = useState("");
  const cur: Record<Opt, Assignment> = { a: draft.a ?? base.a, b: draft.b ?? base.b };
  const changedByMe = (o: Opt, itemId: string) => !!draft[o] && draft[o]![itemId] !== base[o][itemId];
  const anyChange = (["a", "b"] as Opt[]).some((o) => draft[o] && !sameAssignment(draft[o]!, base[o]));
  // Cambiado por otra persona respecto a la propuesta anterior
  const prevOf = (o: Opt) => (prev ? (o === "b" ? prev.assignment_b ?? prev.assignment : prev.assignment) : null);
  const changedByOthers = (o: Opt, itemId: string) => !!open && !iSent && !!prevOf(o) && prevOf(o)![itemId] !== base[o][itemId];
  const canEdit = !iSent;

  function cycle(itemId: string) {
    if (!canEdit) return;
    const order = [...people, ...(stayers.length ? ["piso"] : []), "vender"];
    const now = cur[tab][itemId] ?? nobody;
    setDraft((d) => ({ ...d, [tab]: { ...cur[tab], [itemId]: order[(order.indexOf(now) + 1) % order.length] } }));
  }
  async function send() {
    if (await call("dissolution_send_offer", { p_dissolution: split.diss.id, p_assignment: cur.a, p_assignment_b: cur.b, p_note: note })) {
      setDraft({ a: null, b: null }); setNote("");
    }
  }

  const approvals = (
    <Card className="divide-y divide-line !p-0">
      {people.map((u) => {
        const k = oks.find((x) => x.user_id === u);
        return (
          <div key={u} className="flex items-center justify-between px-4 py-2.5 text-sm">
            <span className="font-medium">{nameOf(u)}</span>
            <span className={k ? "text-ok" : "text-muted"}>
              {!k ? "⏳ Falta que elija" : k.choice ? `✓ Aprueba la ${OPT_LABEL[k.choice]}` : "✓ La ha enviado (vale A o B)"}
            </span>
          </div>
        );
      })}
    </Card>
  );

  const history = offers.length > 0 && (
    <Card className="space-y-1.5 !p-3 text-sm">
      <p className="font-semibold">Historial</p>
      {offers.map((o, i) => (
        <p key={o.id} className="text-muted">
          {formatDateTime(o.created_at)} · {nameOf(o.from_user)} {i === 0 ? "envió las opciones" : "las devolvió con cambios"}
          {o.note ? `: “${o.note}”` : ""}
        </p>
      ))}
    </Card>
  );

  return (
    <>
      <div>
        {!open && <><h2 className="text-lg font-semibold">Dos opciones para enviar</h2>
          <p className="text-sm text-muted">La app prepara la A (manda quien más pagó) y la B (se mueve menos dinero). Cámbialas si quieres tocando un objeto, y envía las dos.</p></>}
        {open && !iSent && <><h2 className="text-lg font-semibold">{nameOf(open.from_user)} os envía dos opciones</h2>
          <p className="text-sm text-muted">Aprueba la A o la B. Si ninguna te convence, toca un objeto para cambiarla y devuélvelas.</p>
          {open.note && <p className="mt-2 rounded-xl bg-line/60 px-3 py-2 text-sm">“{open.note}”</p>}</>}
        {open && iSent && <><h2 className="text-lg font-semibold">Opciones enviadas</h2>
          <p className="text-sm text-muted">Falta que los demás aprueben una. Pueden devolvértelas con cambios.</p></>}
      </div>

      <div className="grid grid-cols-2 gap-2">
        {(["a", "b"] as Opt[]).map((o) => (
          <button key={o} type="button" onClick={() => setTab(o)} aria-pressed={tab === o}
            className={`rounded-xl border-2 bg-card px-3 py-2 text-left text-sm font-semibold ${tab === o ? "border-brand bg-ok-bg" : "border-line"}`}>
            {OPT_LABEL[o]}
            <span className="block text-xs font-normal text-muted">
              {split.items.some((it) => changedByOthers(o, it.id)) ? <span className="text-bad">Con cambios de otros</span>
                : !open ? (o === "a" ? "Manda quien más pagó" : "Se mueve menos dinero") : "Toca para verla"}
            </span>
          </button>
        ))}
      </div>

      <SplitSummary items={split.items} assign={cur[tab]} people={people} stayers={stayers} nameOf={nameOf} me={me} />

      <div className="space-y-2">
        <p className="font-semibold">Objeto a objeto</p>
        {split.items.map((it) => {
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
              <div className="mt-2 grid grid-cols-2 gap-2">
                {(["a", "b"] as Opt[]).map((o) => {
                  const v = cur[o][it.id] ?? nobody;
                  const mineChanged = changedByMe(o, it.id);
                  const othersChanged = changedByOthers(o, it.id);
                  return (
                    <button key={o} type="button" disabled={!canEdit || busy || tab !== o} onClick={() => cycle(it.id)}
                      className={`rounded-xl border-2 px-2 py-1.5 text-left text-xs disabled:cursor-default ${othersChanged ? "border-bad" : mineChanged ? "border-warn" : tab === o ? "border-brand" : "border-line opacity-60"}`}>
                      <span className="block text-muted">{o.toUpperCase()}{othersChanged && prevOf(o) ? ` · antes: ${keeperLabel(prevOf(o)![it.id], nameOf)}` : mineChanged ? " · cambiado por ti" : ""}</span>
                      <span className="block font-semibold">{keeperLabel(v, nameOf)}</span>
                    </button>
                  );
                })}
              </div>
            </Card>
          );
        })}
        {canEdit && <p className="text-xs text-muted">Toca la casilla de la opción que estás viendo ({tab.toUpperCase()}) para cambiar quién se lo queda. En rojo, lo que han cambiado los demás.</p>}
      </div>

      {canEdit && (anyChange || !open) && (
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} id="nota-reparto"
          placeholder="Mensaje opcional. Ej. te dejo la tele si me quedo el sofá"
          className="w-full rounded-xl border border-line bg-card px-4 py-3 text-sm outline-none focus:border-brand" />
      )}
      {!open && <Button disabled={busy} onClick={send}>Enviar las dos opciones</Button>}
      {open && !iSent && (anyChange ? (
        <div className="grid grid-cols-2 gap-3">
          <Button variant="secondary" disabled={busy} onClick={() => setDraft({ a: null, b: null })}>Deshacer cambios</Button>
          <Button disabled={busy} onClick={send}>Devolver con cambios</Button>
        </div>
      ) : (
        <Button disabled={busy || myOk?.choice === tab} onClick={() => call("dissolution_accept_offer", { p_offer: open.id, p_choice: tab })}>
          {myOk?.choice === tab ? `Ya apruebas la ${OPT_LABEL[tab]} ✓` : `Aprobar la ${OPT_LABEL[tab]} ✓`}
        </Button>
      ))}
      {open && approvals}
      {history}
    </>
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
            <p key={r.user}>
              <b>{nameOf(r.user)}</b>{" "}
              {things.length ? <>se queda {list(things)} (<b>{formatEuros(r.gets)}</b>).</> : <>no se queda nada.</>}{" "}
              <span className="text-muted">Por lo que puso, le corresponden {formatEuros(r.due)} de lo que se reparte.</span>{" "}
              {r.balance >= 100 ? <b>Paga {formatEuros(r.balance)}.</b> : r.balance <= -100 ? <b>Cobra {formatEuros(-r.balance)}.</b> : <b>Queda en paz.</b>}
            </p>
          );
        })}
        {home.length > 0 && (
          <p><b>Se queda en el piso:</b> {list(home.map((it) => it.name))} ({formatEuros(home.reduce((s, it) => s + it.value_cents, 0))}). Lo pagan {list(stayers.map(nameOf))}, cada uno según lo que puso, y así quien se va recibe su parte.</p>
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
  const assignment = accepted ? chosenAssignment(accepted) : null;
  const isExit = diss.kind === "parcial";
  const leavers = split?.leavers ?? [];
  const keeperName = (v: string) => (v === "vender" ? "Para vender" : v === "piso" ? "Se queda en el piso" : realName(v));
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
function MissingSomething({ dissId, busy, call }: { dissId: string; busy: boolean; call: CallFn }) {
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState("");
  if (!open) return <Button variant="secondary" disabled={busy} onClick={() => setOpen(true)}>Falta algo en el inventario</Button>;
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted">Esto para la disolución y descongela el hogar, para que lo podáis completar.</p>
      <textarea id="falta-algo" value={comment} onChange={(e) => setComment(e.target.value)} rows={2} autoFocus
        placeholder="¿Qué falta? Ej. no está apuntada la lavadora"
        className="w-full rounded-xl border border-line bg-card px-4 py-3 outline-none focus:border-brand" />
      <div className="grid grid-cols-2 gap-3">
        <Button variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
        <Button className="!bg-bad" disabled={busy || !comment.trim()}
          onClick={() => call("respond", { p_subject_type: "dissolution", p_subject_id: dissId, p_decision: "rechazar", p_comment: comment })}>Enviar</Button>
      </div>
    </div>
  );
}
