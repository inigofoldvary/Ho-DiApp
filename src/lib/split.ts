import { supabase } from "./supabase";

/** Un bien del reparto: su valor de hoy y cuánto puso cada persona (bien + cuotas confirmadas vinculadas). */
export type SplitItem = {
  id: string; name: string; price_cents: number; purchase_date: string; photo_path: string | null; receipt_path: string | null;
  value_cents: number;
  paid: Record<string, number>; // céntimos puestos por cada persona
};
export type Assignment = Record<string, string>; // asset_id -> user_id | "vender"
export type Transfer = { from: string; to: string; cents: number };

export type Dissolution = {
  id: string; status: string; phase: string; values_version: number; version: number;
  created_by: string; created_at: string; completed_at: string | null;
};
export type Offer = { id: string; from_user: string; assignment: Assignment; note: string | null; status: string; created_at: string };

export type SplitState = {
  diss: Dissolution;
  items: SplitItem[];
  valueOks: string[];          // quién ha dado el OK a los valores actuales
  picksDone: string[];
  wants: Record<string, string[]>; // user -> assets
  offers: Offer[];             // de la más antigua a la más nueva
  offerOks: Record<string, string[]>; // offer -> users
};

/** % de cada persona en un bien (0..1). Si nadie consta como pagador, a partes iguales entre quienes aparezcan. */
export function shareOf(it: SplitItem, user: string): number {
  const total = Object.values(it.paid).reduce((s, v) => s + v, 0);
  if (total <= 0) return 0;
  return (it.paid[user] ?? 0) / total;
}

export async function loadSplit(householdId: string, diss: Dissolution): Promise<SplitState> {
  const db = supabase();
  const [v, ok, pd, w, of] = await Promise.all([
    db.from("dissolution_values").select("asset_id, value_cents, assets(name, total_cents, purchase_date, photo_path, receipt_path, asset_participants(user_id, amount_cents))")
      .eq("dissolution_id", diss.id),
    db.from("dissolution_value_oks").select("user_id").eq("dissolution_id", diss.id).eq("values_version", diss.values_version),
    db.from("dissolution_picks_done").select("user_id").eq("dissolution_id", diss.id),
    db.from("dissolution_wants").select("user_id, asset_id").eq("dissolution_id", diss.id),
    db.from("dissolution_offers").select("id, from_user, assignment, note, status, created_at").eq("dissolution_id", diss.id).order("created_at"),
  ]);
  for (const r of [v, ok, pd, w, of]) if (r.error) throw r.error;

  type Row = { asset_id: string; value_cents: number; assets: { name: string; total_cents: number; purchase_date: string; photo_path: string | null; receipt_path: string | null; asset_participants: { user_id: string; amount_cents: number }[] } | null };
  const rows = ((v.data ?? []) as unknown as Row[]).filter((r) => r.assets);
  const items: SplitItem[] = rows.map((r) => {
    const paid: Record<string, number> = {};
    for (const p of r.assets!.asset_participants) paid[p.user_id] = (paid[p.user_id] ?? 0) + p.amount_cents;
    return {
      id: r.asset_id, name: r.assets!.name, price_cents: r.assets!.total_cents, purchase_date: r.assets!.purchase_date,
      photo_path: r.assets!.photo_path, receipt_path: r.assets!.receipt_path, value_cents: r.value_cents, paid,
    };
  });

  // Cuotas confirmadas de pagos recurrentes vinculados a estos bienes: cuentan como dinero puesto.
  if (items.length) {
    const inst = await db.from("installments")
      .select("status, recurring_plans!inner(asset_id), installment_payments(user_id, amount_cents)")
      .eq("household_id", householdId).eq("status", "confirmado").in("recurring_plans.asset_id", items.map((i) => i.id));
    if (!inst.error) {
      for (const r of (inst.data ?? []) as unknown as { recurring_plans: { asset_id: string } | { asset_id: string }[]; installment_payments: { user_id: string; amount_cents: number }[] }[]) {
        const rp = Array.isArray(r.recurring_plans) ? r.recurring_plans[0] : r.recurring_plans;
        const it = items.find((i) => i.id === rp?.asset_id);
        if (!it) continue;
        for (const p of r.installment_payments) it.paid[p.user_id] = (it.paid[p.user_id] ?? 0) + p.amount_cents;
      }
    }
  }
  items.sort((a, b) => b.value_cents - a.value_cents || a.name.localeCompare(b.name));

  const wants: Record<string, string[]> = {};
  for (const r of (w.data ?? []) as { user_id: string; asset_id: string }[]) (wants[r.user_id] ??= []).push(r.asset_id);
  const offers = (of.data ?? []) as Offer[];
  const offerOks: Record<string, string[]> = {};
  if (offers.length) {
    const k = await db.from("dissolution_offer_oks").select("offer_id, user_id").in("offer_id", offers.map((o) => o.id));
    for (const r of (k.data ?? []) as { offer_id: string; user_id: string }[]) (offerOks[r.offer_id] ??= []).push(r.user_id);
  }
  return {
    diss, items,
    valueOks: ((ok.data ?? []) as { user_id: string }[]).map((r) => r.user_id),
    picksDone: ((pd.data ?? []) as { user_id: string }[]).map((r) => r.user_id),
    wants, offers, offerOks,
  };
}

/** Lo que se lleva cada uno menos lo que le corresponde de lo que se reparte. >0 debe pagar, <0 debe cobrar. */
export function balances(items: SplitItem[], a: Assignment, people: string[]): Record<string, number> {
  const b: Record<string, number> = Object.fromEntries(people.map((p) => [p, 0]));
  for (const it of items) {
    const who = a[it.id];
    if (!who || who === "vender") continue;
    b[who] = (b[who] ?? 0) + it.value_cents;
    for (const p of people) b[p] -= it.value_cents * shareOf(it, p);
    // Si pagó alguien que ya no está en el hogar, su parte se reparte entre quien se lo queda (no hay a quién pagar).
    const gone = Object.keys(it.paid).filter((u) => !people.includes(u));
    for (const u of gone) b[who] -= it.value_cents * shareOf(it, u);
  }
  return b;
}

/** Pagos mínimos para quedar en paz (redondeado a céntimos). */
export function transfers(b: Record<string, number>): Transfer[] {
  const debt = Object.entries(b).map(([u, v]) => ({ u, v: Math.round(v) })).filter((x) => x.v > 0).sort((x, y) => y.v - x.v);
  const cred = Object.entries(b).map(([u, v]) => ({ u, v: -Math.round(v) })).filter((x) => x.v > 0).sort((x, y) => y.v - x.v);
  const out: Transfer[] = [];
  let i = 0, j = 0;
  while (i < debt.length && j < cred.length) {
    const c = Math.min(debt[i].v, cred[j].v);
    if (c >= 100) out.push({ from: debt[i].u, to: cred[j].u, cents: c }); // menos de 1 € no merece un pago
    debt[i].v -= c; cred[j].v -= c;
    if (debt[i].v <= 0) i++;
    if (cred[j].v <= 0) j++;
  }
  return out;
}
const moved = (b: Record<string, number>) => Object.values(b).filter((v) => v > 0).reduce((s, v) => s + v, 0);

/** Opción 1: si varios quieren algo, se lo queda quien más puso. Lo que nadie quiere, a vender. */
export function proposalByPaid(items: SplitItem[], wants: Record<string, string[]>, people: string[]): Assignment {
  const a: Assignment = {};
  const got: Record<string, number> = Object.fromEntries(people.map((p) => [p, 0]));
  for (const it of items) {
    const w = people.filter((p) => wants[p]?.includes(it.id));
    if (!w.length) { a[it.id] = "vender"; continue; }
    w.sort((x, y) => shareOf(it, y) - shareOf(it, x) || got[x] - got[y]);
    a[it.id] = w[0];
    got[w[0]] += it.value_cents;
  }
  return a;
}

/** Opción 2: entre lo que quieren varios, el reparto que mueve menos dinero. */
export function proposalBalanced(items: SplitItem[], wants: Record<string, string[]>, people: string[]): Assignment {
  const a: Assignment = {};
  const contested: { id: string; w: string[] }[] = [];
  for (const it of items) {
    const w = people.filter((p) => wants[p]?.includes(it.id));
    if (!w.length) a[it.id] = "vender";
    else if (w.length === 1) a[it.id] = w[0];
    else contested.push({ id: it.id, w });
  }
  if (!contested.length) return a;
  const combos = contested.reduce((n, c) => n * c.w.length, 1);
  if (combos <= 4096) {
    let best: Assignment = a, bestCost = Infinity;
    for (let k = 0; k < combos; k++) {
      let r = k;
      const t: Assignment = { ...a };
      for (const c of contested) { t[c.id] = c.w[r % c.w.length]; r = Math.floor(r / c.w.length); }
      const cost = moved(balances(items, t, people));
      if (cost < bestCost - 0.5) { bestCost = cost; best = t; }
    }
    return best;
  }
  // Muchos objetos en disputa: uno a uno, el que deja menos dinero por mover.
  const t: Assignment = { ...a };
  for (const c of contested) {
    let bestU = c.w[0], bestCost = Infinity;
    for (const u of c.w) {
      const cost = moved(balances(items, { ...t, [c.id]: u }, people));
      if (cost < bestCost) { bestCost = cost; bestU = u; }
    }
    t[c.id] = bestU;
  }
  return t;
}

/** Lo que cobra cada uno de lo que se vende (según lo que puso). */
export function saleSplit(items: SplitItem[], a: Assignment, people: string[]) {
  const sold = items.filter((it) => a[it.id] === "vender");
  const per: Record<string, number> = Object.fromEntries(people.map((p) => [p, 0]));
  for (const it of sold) for (const u of Object.keys(it.paid)) per[u] = (per[u] ?? 0) + it.value_cents * shareOf(it, u);
  return { sold, per, total: sold.reduce((s, it) => s + it.value_cents, 0) };
}

export function sameAssignment(x: Assignment, y: Assignment) {
  const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
  for (const k of keys) if (x[k] !== y[k]) return false;
  return true;
}
