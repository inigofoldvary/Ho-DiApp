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
  loadSplit, proposalBalanced, proposalByPaid, balances, transfers, saleSplit, shareOf, sameAssignment,
  type Assignment, type Dissolution, type SplitState, type SplitItem,
} from "@/lib/split";
import { Button, Card, ErrorBox, Header, Loading } from "@/components/ui";

type Household = { name: string; status: string; dissolved_at: string | null };
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
  const [confs, setConfs] = useState<Conf[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [split, setSplit] = useState<SplitState | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [pendingCount, setPendingCount] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sure, setSure] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    const db = supabase();
    const [h, d, a, i] = await Promise.all([
      db.from("households").select("name, status, dissolved_at").eq("id", id).single(),
      db.from("dissolutions").select("id, status, phase, values_version, version, created_by, created_at, completed_at")
        .eq("household_id", id).eq("kind", "total")
        .in("status", ["pendiente", "confirmado", "rechazado"]).order("created_at", { ascending: false }).limit(1),
      db.from("assets").select("id", { count: "exact", head: true }).eq("household_id", id).eq("status", "pendiente"),
      db.from("installments").select("id", { count: "exact", head: true }).eq("household_id", id).eq("status", "pendiente"),
    ]);
    if (h.error) return setError(errorText(h.error));
    setHome(h.data);
    const last = (d.data?.[0] as Dissolution) ?? null;
    setDiss(last);
    setPendingCount((a.count ?? 0) + (i.count ?? 0));
    setMembers(await loadMembers(id, user.id));
    if (last && last.status !== "rechazado") {
      const [c, s] = await Promise.all([
        db.from("confirmations").select("user_id, decision, comment, created_at, subject_version")
          .eq("subject_type", "dissolution").eq("subject_id", last.id).order("created_at"),
        loadSplit(id, last).catch((e) => { setError(errorText(e)); return null; }),
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
  const people = active.map((m) => m.user_id);
  const nameOf = (u: string) => (u === user.id ? "Tú" : members.find((m) => m.user_id === u)?.name ?? "Antiguo miembro");
  const realName = (u: string) => members.find((m) => m.user_id === u)?.name ?? "Antiguo miembro";
  const inProgress = home.status === "disolviendo" && diss?.status === "pendiente";
  const phase = home.status === "disuelto" ? "cerrado" : diss?.phase ?? "valores";
  const current = diss ? confs.filter((c) => c.subject_version === diss.version) : [];
  const rejection = current.find((c) => c.decision === "rechazar");

  return (
    <main className="pb-10">
      <Header title="Disolver hogar" back={`/hogar/${id}`} />
      <ErrorBox>{error}</ErrorBox>

      {(inProgress || home.status === "disuelto") && (
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
      )}

      {home.status === "disuelto" && (
        <Closed home={home} split={split} people={people} nameOf={nameOf} realName={realName} id={id} setError={setError} />
      )}

      {home.status === "activo" && (
        <div className="space-y-4">
          {diss?.status === "rechazado" && (
            <p className="rounded-xl bg-bad-bg px-4 py-3 text-sm text-bad">
              El último intento de disolver se paró porque alguien dijo que faltaba algo. Revisad el inventario antes de volver a intentarlo.
            </p>
          )}
          <Card className="space-y-3">
            <p className="font-semibold">¿Cómo funciona?</p>
            <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
              <li>El inventario se <b>congela</b>: nadie puede añadir ni cambiar nada.</li>
              <li><b>Valores:</b> os ponéis de acuerdo en cuánto vale hoy cada cosa.</li>
              <li><b>Elegir:</b> cada uno marca, por separado, lo que se quiere quedar.</li>
              <li><b>Acuerdo:</b> la app propone dos repartos. Uno lo envía y los demás lo aprueban o lo devuelven con cambios.</li>
              <li>Cuando todos aprobáis, sale el <b>PDF final</b>: quién se queda qué y quién paga a quién.</li>
            </ol>
            <p className="text-sm text-muted">Mientras no aprobéis el reparto, se puede cancelar y el hogar vuelve a la normalidad.</p>
          </Card>
          {pendingCount > 0 && (
            <p className="rounded-xl bg-warn-bg px-4 py-3 text-sm text-warn">
              Ojo: hay {pendingCount} {pendingCount === 1 ? "cosa pendiente" : "cosas pendientes"} de confirmar. Solo entra en el reparto lo confirmado.
            </p>
          )}
          <label className="flex items-start gap-3 rounded-2xl border border-line bg-card p-4">
            <input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} className="mt-0.5 h-5 w-5 accent-[var(--brand)]" />
            <span className="text-sm">Entiendo que el inventario de <b>{home.name}</b> se congelará.</span>
          </label>
          <Button className="!bg-bad" disabled={!sure || busy} onClick={() => call("start_dissolution", { p_household: id })}>
            Empezar a disolver
          </Button>
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
          {phase === "acuerdo" && <PhaseDeal key={split.offers.at(-1)?.id ?? "ninguna"} split={split} people={people} me={user.id} nameOf={nameOf} busy={busy} call={call} />}

          <MissingSomething dissId={diss.id} busy={busy} call={call} />
          <Button variant="ghost" disabled={busy} onClick={async () => {
            if (!window.confirm("¿Cancelar la disolución? El hogar volverá a funcionar con normalidad.")) return;
            if (await call("cancel_dissolution", { p_dissolution: diss.id })) router.replace(`/hogar/${id}`);
          }}>Cancelar la disolución</Button>
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
        <p className="text-sm text-muted">La app propone un valor (pierde un 15 % por cada año). Cambiadlo si no cuadra: puede valer más o menos de lo que costó.</p>
      </div>
      {split.items.length === 0 ? (
        <Card className="text-sm text-muted">No hay bienes confirmados que repartir. Dad el OK y pasaréis directamente al final.</Card>
      ) : (
        <Card className="divide-y divide-line !p-0">
          {split.items.map((it) => {
            const diff = it.value_cents - it.price_cents;
            return (
              <div key={it.id} className="flex items-center gap-3 px-3 py-2.5">
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
function PhaseDeal({ split, people, me, nameOf, busy, call }:
  { split: SplitState; people: string[]; me: string; nameOf: (u: string) => string; busy: boolean; call: CallFn }) {
  const open = [...split.offers].reverse().find((o) => o.status === "pendiente") ?? null;
  const oks = open ? split.offerOks[open.id] ?? [] : [];
  const iApproved = !!open && oks.includes(me);
  const p1 = useMemo(() => proposalByPaid(split.items, split.wants, people), [split, people]);
  const p2 = useMemo(() => proposalBalanced(split.items, split.wants, people), [split, people]);
  const [opt, setOpt] = useState<1 | 2>(1);
  const [edited, setEdited] = useState<Assignment | null>(null);
  const [note, setNote] = useState("");

  const baseAssign: Assignment = open ? open.assignment : opt === 1 ? p1 : p2;
  const assign = edited ?? baseAssign;
  const changed = !!edited && !sameAssignment(edited, baseAssign);

  function cycle(itemId: string) {
    const order = [...people, "vender"];
    const cur = assign[itemId] ?? "vender";
    setEdited({ ...assign, [itemId]: order[(order.indexOf(cur) + 1) % order.length] });
  }

  const wantTable = (
    <Card className="overflow-x-auto !p-3">
      <p className="mb-2 font-semibold">Lo que ha pedido cada uno</p>
      <table className="w-full text-sm">
        <thead><tr className="text-left text-muted"><th className="py-1 font-medium">Bien</th>{people.map((u) => <th key={u} className="px-1 py-1 text-center font-medium">{nameOf(u)}</th>)}</tr></thead>
        <tbody>
          {split.items.map((it) => (
            <tr key={it.id} className="border-t border-line">
              <td className="py-1.5">{it.name}</td>
              {people.map((u) => <td key={u} className="text-center">{split.wants[u]?.includes(it.id) ? "✋" : <span className="text-muted">·</span>}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-muted">✋ = lo quiere. Si no lo quiere nadie, se propone venderlo.</p>
    </Card>
  );

  const history = split.offers.length > 0 && (
    <Card className="space-y-1.5 !p-3 text-sm">
      <p className="font-semibold">Historial</p>
      {split.offers.map((o, i) => (
        <p key={o.id} className="text-muted">
          {formatDateTime(o.created_at)} · {nameOf(o.from_user)} {i === 0 ? "propuso un reparto" : "lo devolvió con cambios"}
          {o.note ? `: “${o.note}”` : ""}
        </p>
      ))}
    </Card>
  );

  return (
    <>
      {!open && (
        <>
          {wantTable}
          <div>
            <h2 className="text-lg font-semibold">Dos propuestas de la app</h2>
            <p className="text-sm text-muted">Elige una, cámbiala si quieres (toca un objeto) y envíala a los demás.</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {([1, 2] as const).map((o) => (
              <button key={o} type="button" onClick={() => { setOpt(o); setEdited(null); }} aria-pressed={opt === o}
                className={`rounded-xl border-2 bg-card px-3 py-2 text-left text-sm font-semibold ${opt === o ? "border-brand bg-ok-bg" : "border-line"}`}>
                Opción {o}
                <span className="block text-xs font-normal text-muted">{o === 1 ? "Manda quien más pagó" : "Se mueve menos dinero"}</span>
              </button>
            ))}
          </div>
        </>
      )}
      {open && !iApproved && (
        <div>
          <h2 className="text-lg font-semibold">{nameOf(open.from_user)} propone este reparto</h2>
          <p className="text-sm text-muted">Apruébalo tal cual, o toca un objeto para cambiarlo y devuélveselo.</p>
          {open.note && <p className="mt-2 rounded-xl bg-line/60 px-3 py-2 text-sm">“{open.note}”</p>}
        </div>
      )}
      {open && iApproved && (
        <div>
          <h2 className="text-lg font-semibold">Reparto enviado</h2>
          <p className="text-sm text-muted">Falta que lo aprueben los demás. Pueden aprobarlo o devolvértelo con cambios.</p>
        </div>
      )}

      <SplitSummary items={split.items} assign={assign} people={people} nameOf={nameOf} />

      <Card className="!p-3">
        <p className="mb-2 font-semibold">Quién se queda qué</p>
        <ul className="space-y-1.5">
          {split.items.map((it) => {
            const who = assign[it.id] ?? "vender";
            const wanters = people.filter((u) => split.wants[u]?.includes(it.id));
            const canEdit = !iApproved;
            return (
              <li key={it.id}>
                <button type="button" disabled={!canEdit || busy} onClick={() => cycle(it.id)}
                  className="flex w-full items-center gap-3 rounded-xl border border-line bg-bg px-3 py-2 text-left disabled:cursor-default">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{it.name} · <span className="tabular-nums">{formatEuros(it.value_cents)}</span></span>
                    <span className="block truncate text-xs text-muted">
                      {people.filter((u) => shareOf(it, u) > 0).map((u) => `${nameOf(u)} ${Math.round(shareOf(it, u) * 100)} %`).join(" · ") || "—"}
                      {" · lo quiere: "}{wanters.map(nameOf).join(" y ") || "nadie"}
                    </span>
                  </span>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${who === "vender" ? "bg-line text-muted" : who === me ? "bg-brand text-brand-ink" : "bg-accent text-white"}`}>
                    {who === "vender" ? "Vender" : nameOf(who)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {!iApproved && <p className="mt-2 text-xs text-muted">Toca un objeto para cambiar quién se lo queda.</p>}
      </Card>

      {!iApproved && (changed || !open) && (
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} id="nota-reparto"
          placeholder="Mensaje opcional. Ej. te dejo la tele si me quedo el sofá"
          className="w-full rounded-xl border border-line bg-card px-4 py-3 text-sm outline-none focus:border-brand" />
      )}

      {!open && (
        <Button disabled={busy} onClick={async () => {
          if (await call("dissolution_send_offer", { p_dissolution: split.diss.id, p_assignment: assign, p_note: note })) { setEdited(null); setNote(""); }
        }}>Enviar este reparto a los demás</Button>
      )}
      {open && !iApproved && (changed ? (
        <div className="grid grid-cols-2 gap-3">
          <Button variant="secondary" disabled={busy} onClick={() => setEdited(null)}>Deshacer cambios</Button>
          <Button disabled={busy} onClick={async () => {
            if (await call("dissolution_send_offer", { p_dissolution: split.diss.id, p_assignment: assign, p_note: note })) { setEdited(null); setNote(""); }
          }}>Devolver con cambios</Button>
        </div>
      ) : (
        <Button disabled={busy} onClick={() => call("dissolution_accept_offer", { p_offer: open.id })}>Aprobar este reparto ✓</Button>
      ))}
      {open && <WhoList people={people} ok={oks} nameOf={nameOf} yes="Lo aprueba" no="Falta que lo apruebe" />}
      {open && wantTable}
      {history}
    </>
  );
}

function SplitSummary({ items, assign, people, nameOf }: { items: SplitItem[]; assign: Assignment; people: string[]; nameOf: (u: string) => string }) {
  const t = transfers(balances(items, assign, people));
  const sale = saleSplit(items, assign, people);
  return (
    <>
      <div className="rounded-2xl bg-brand px-4 py-4 text-center text-brand-ink">
        <p className="text-sm opacity-90">Para quedar en paz</p>
        {t.length === 0 ? <p className="text-2xl font-bold">Estáis en paz</p>
          : t.map((x, i) => <p key={i} className="text-xl font-bold">{nameOf(x.from)} paga {formatEuros(x.cents)} a {nameOf(x.to) === "Tú" ? "ti" : nameOf(x.to)}</p>)}
      </div>
      <Card className="divide-y divide-line !p-0">
        {people.map((u) => {
          const got = items.filter((it) => assign[it.id] === u);
          return (
            <div key={u} className="flex items-baseline justify-between gap-3 px-4 py-2.5">
              <span className="min-w-0"><b>{nameOf(u)}</b> <span className="text-sm text-muted">se queda {got.length ? got.map((g) => g.name).join(", ") : "nada"}</span></span>
              <span className="shrink-0 font-semibold tabular-nums">{formatEuros(got.reduce((s, it) => s + it.value_cents, 0))}</span>
            </div>
          );
        })}
      </Card>
      {sale.sold.length > 0 && (
        <Card className="overflow-x-auto !p-3">
          <div className="mb-2 flex items-baseline justify-between">
            <p className="font-semibold">Para vender</p>
            <p className="font-semibold tabular-nums">≈ {formatEuros(sale.total)}</p>
          </div>
          <table className="w-full text-sm">
            <thead><tr className="text-muted"><th className="py-1 text-left font-medium">Bien</th>{people.map((u) => <th key={u} className="py-1 text-right font-medium">{nameOf(u)}</th>)}</tr></thead>
            <tbody>
              {sale.sold.map((it) => (
                <tr key={it.id} className="border-t border-line">
                  <td className="py-1.5">{it.name} <span className="text-muted">{formatEuros(it.value_cents)}</span></td>
                  {people.map((u) => <td key={u} className="text-right tabular-nums">{shareOf(it, u) ? formatEuros(Math.round(it.value_cents * shareOf(it, u))) : "–"}</td>)}
                </tr>
              ))}
              <tr className="border-t border-line font-semibold"><td className="py-1.5">Total</td>{people.map((u) => <td key={u} className="text-right tabular-nums">{formatEuros(Math.round(sale.per[u] ?? 0))}</td>)}</tr>
            </tbody>
          </table>
          <p className="mt-2 text-xs text-muted">Cada uno cobra según lo que puso en ese objeto. Si se vende por más o por menos, se reparte con los mismos %.</p>
        </Card>
      )}
    </>
  );
}

/* ---------- Cerrado ---------- */
function Closed({ home, split, people, nameOf, realName, id, setError }:
  { home: Household; split: SplitState | null; people: string[]; nameOf: (u: string) => string; realName: (u: string) => string; id: string; setError: (e: string) => void }) {
  const [busy, setBusy] = useState(false);
  const accepted = split?.offers.find((o) => o.status === "aceptada") ?? null;
  // En un hogar disuelto ya no hay "activos": usamos quienes aparecen en el reparto.
  const everyone = accepted
    ? [...new Set([...people, ...Object.values(accepted.assignment).filter((v) => v !== "vender"), ...split!.items.flatMap((it) => Object.keys(it.paid))])]
    : people;

  async function finalPdf() {
    setBusy(true);
    try {
      const r = await loadReport(id);
      const { buildPdf, pdfFileName } = await import("@/lib/pdf");
      let splitPdf;
      if (split && accepted) {
        const a = accepted.assignment;
        const sale = saleSplit(split.items, a, everyone);
        splitPdf = {
          rows: split.items.map((it) => ({ name: it.name, price: it.price_cents, value: it.value_cents, keeper: a[it.id] === "vender" ? "Para vender" : realName(a[it.id]) })),
          transfers: transfers(balances(split.items, a, everyone)).map((t) => ({ from: realName(t.from), to: realName(t.to), cents: t.cents })),
          sale: sale.sold.length ? { total: sale.total, per: Object.entries(sale.per).filter(([, v]) => v > 0).map(([u, v]) => ({ name: realName(u), cents: Math.round(v) })) } : null,
        };
      }
      buildPdf(r, { final: true, split: splitPdf }).save(pdfFileName(r, true));
    } catch (e) { setError(errorText(e)); }
    setBusy(false);
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-2 text-center">
        <p className="text-4xl">🤝</p>
        <p className="text-lg font-semibold">{home.name} está disuelto</p>
        {home.dissolved_at && <p className="text-sm text-muted">Desde el {formatDateTime(home.dissolved_at)}. El inventario ya no se puede cambiar.</p>}
      </Card>
      {split && accepted && <SplitSummary items={split.items} assign={accepted.assignment} people={everyone} nameOf={nameOf} />}
      <Button onClick={finalPdf} disabled={busy}>{busy ? "Preparando…" : "📄 Descargar PDF final"}</Button>
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
