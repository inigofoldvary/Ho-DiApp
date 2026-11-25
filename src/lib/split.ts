import { supabase } from "./supabase";

/** Un bien del reparto: su valor de hoy y cuánto puso cada persona (bien + cuotas confirmadas vinculadas). */
export type SplitItem = {
  id: string; name: string; price_cents: number; purchase_date: string; photo_path: string | null; receipt_path: string | null;
  value_cents: number;
  paid: Record<string, number>; // céntimos puestos por cada persona (o su % actual si `owned`)
  owned?: boolean;
  is_private?: boolean;
  is_set?: boolean;            // alguien ha puesto ya su valor de hoy
  itemOks?: string[];          // quién ha dado el OK al valor actual
  deciders?: string[];         // quién decide este bien (privados: los de dentro)
};
export type PrivateDeal = { asset_id: string; keeper: string; set_by: string; oks: string[] };
export type BackRequest = { id: string; from_user: string; reason: string | null; status: string; created_at: string; oks: string[] };
export type Assignment = Record<string, string>; // asset_id -> user_id | "vender" | "piso" (se queda para los que siguen)
export type Transfer = { from: string; to: string; cents: number };

export type Dissolution = {
  id: string; kind: string; status: string; phase: string; values_version: number; version: number;
  created_by: string; created_at: string; completed_at: string | null;
};
export type Offer = {
  id: string; from_user: string; assignment: Assignment; assignment_b: Assignment | null; chosen: string | null;
  note: string | null; status: string; created_at: string;
};
export type OfferOk = { user_id: string; choice: "a" | "b" | null };
export type ValueChange = { asset_id: string; user_id: string | null; old_cents: number | null; new_cents: number; created_at: string };

/** El reparto aprobado (opción A o B). */
export function chosenAssignment(o: Offer): Assignment {
  return o.chosen === "b" && o.assignment_b ? o.assignment_b : o.assignment;
}

export type SplitState = {
  diss: Dissolution;
  items: SplitItem[];
  valueOks: string[];          // quién ha dado el OK a los valores actuales
  picksDone: string[];
  wants: Record<string, string[]>; // user -> assets
  offers: Offer[];             // de la más antigua a la más nueva
  offerOks: Record<string, OfferOk[]>; // offer -> quién la aprueba y qué opción
  valueLog: ValueChange[];     // quién propuso cada valor
  leavers: string[];           // quién se va (en una disolución total, todos)
  privateDeals: Record<string, PrivateDeal>;
  back: BackRequest | null;    // petición pendiente de volver al paso 1
};

/**
 * % de cada persona en un bien (0..1).
 * Con `among`, solo cuentan esas personas: lo que puso alguien que ya se fue (y al que ya se compensó)
 * se reparte entre los demás según lo que pusieron. Si ninguna de ellas puso nada, a partes iguales.
 */
export function shareOf(it: SplitItem, user: string, among?: string[]): number {
  const who = among ?? Object.keys(it.paid);
  const total = who.reduce((s, u) => s + (it.paid[u] ?? 0), 0);
  if (total <= 0) return among && among.includes(user) ? 1 / among.length : 0;
  return who.includes(user) ? (it.paid[user] ?? 0) / total : 0;
}

export async function loadSplit(householdId: string, diss: Dissolution): Promise<SplitState> {
  const db = supabase();
  const [v, ok, pd, w, of, lv, vl, io, pdl, br] = await Promise.all([
    db.from("dissolution_values").select("*, assets(name, total_cents, purchase_date, photo_path, receipt_path, visibility, asset_participants(user_id, amount_cents))")
      .eq("dissolution_id", diss.id),
    db.from("dissolution_value_oks").select("user_id").eq("dissolution_id", diss.id).eq("values_version", diss.values_version),
    db.from("dissolution_picks_done").select("user_id").eq("dissolution_id", diss.id),
    db.from("dissolution_wants").select("user_id, asset_id").eq("dissolution_id", diss.id),
    db.from("dissolution_offers").select("*").eq("dissolution_id", diss.id).order("created_at"),
    db.from("dissolution_leavers").select("user_id").eq("dissolution_id", diss.id),
    db.from("dissolution_value_log").select("asset_id, user_id, old_cents, new_cents, created_at").eq("dissolution_id", diss.id).order("created_at"),
    db.from("dissolution_item_oks").select("asset_id, user_id, value_cents").eq("dissolution_id", diss.id),
    db.from("dissolution_private_deals").select("asset_id, keeper, set_by, oks").eq("dissolution_id", diss.id),
    db.from("dissolution_back_requests").select("id, from_user, reason, status, created_at").eq("dissolution_id", diss.id).eq("status", "pendiente").limit(1),
  ]);
  for (const r of [v, ok, pd, w, of]) if (r.error) throw r.error;

  type Row = { asset_id: string; value_cents: number; is_set?: boolean; assets: { name: string; total_cents: number; purchase_date: string; photo_path: string | null; receipt_path: string | null; visibility: string; asset_participants: { user_id: string; amount_cents: number }[] } | null };
  const oksRows = (io.error ? [] : io.data ?? []) as { asset_id: string; user_id: string; value_cents: number }[];
  const rows = ((v.data ?? []) as unknown as Row[]).filter((r) => r.assets);
  const items: SplitItem[] = rows.map((r) => {
    const paid: Record<string, number> = {};
    for (const p of r.assets!.asset_participants) paid[p.user_id] = (paid[p.user_id] ?? 0) + p.amount_cents;
    return {
      id: r.asset_id, name: r.assets!.name, price_cents: r.assets!.total_cents, purchase_date: r.assets!.purchase_date,
      photo_path: r.assets!.photo_path, receipt_path: r.assets!.receipt_path, value_cents: r.value_cents, paid,
      is_private: r.assets!.visibility === "implicados",
      is_set: r.is_set ?? true,
      itemOks: oksRows.filter((k) => k.asset_id === r.asset_id && k.value_cents === r.value_cents).map((k) => k.user_id),
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
  // Si tras una salida o una compra ya consta de quién es cada cosa, manda eso (en %).
  if (items.length) {
    const ow = await db.from("asset_owners").select("asset_id, user_id, share").in("asset_id", items.map((i) => i.id));
    if (!ow.error && ow.data?.length) {
      const by: Record<string, Record<string, number>> = {};
      for (const r of ow.data as { asset_id: string; user_id: string; share: number }[]) (by[r.asset_id] ??= {})[r.user_id] = Number(r.share) * 1_000_000;
      for (const it of items) if (by[it.id]) { it.paid = by[it.id]; it.owned = true; }
    }
  }
  // Quién decide cada privado
  await Promise.all(items.filter((i) => i.is_private).map(async (i) => {
    const { data } = await db.rpc("asset_insiders", { p_asset: i.id });
    i.deciders = ((data ?? []) as unknown[]).map((x) => (typeof x === "string" ? x : (x as Record<string, string>).asset_insiders));
  }));
  let back: BackRequest | null = null;
  const b0 = (br.error ? [] : br.data ?? []) as Omit<BackRequest, "oks">[];
  if (b0.length) {
    const k = await db.from("dissolution_back_oks").select("user_id").eq("request_id", b0[0].id);
    back = { ...b0[0], oks: ((k.data ?? []) as { user_id: string }[]).map((x) => x.user_id) };
  }
  const privateDeals: Record<string, PrivateDeal> = {};
  for (const r of (pdl.error ? [] : pdl.data ?? []) as PrivateDeal[]) privateDeals[r.asset_id] = r;
  items.sort((a, b) => b.value_cents - a.value_cents || a.name.localeCompare(b.name));

  const wants: Record<string, string[]> = {};
  for (const r of (w.data ?? []) as { user_id: string; asset_id: string }[]) (wants[r.user_id] ??= []).push(r.asset_id);
  const offers = ((of.data ?? []) as Offer[]).map((o) => ({ ...o, assignment_b: o.assignment_b ?? null, chosen: o.chosen ?? null }));
  const offerOks: Record<string, OfferOk[]> = {};
  if (offers.length) {
    const k = await db.from("dissolution_offer_oks").select("*").in("offer_id", offers.map((o) => o.id));
    for (const r of (k.data ?? []) as { offer_id: string; user_id: string; choice?: "a" | "b" | null }[])
      (offerOks[r.offer_id] ??= []).push({ user_id: r.user_id, choice: r.choice ?? null });
  }
  return {
    diss, items,
    valueOks: ((ok.data ?? []) as { user_id: string }[]).map((r) => r.user_id),
    picksDone: ((pd.data ?? []) as { user_id: string }[]).map((r) => r.user_id),
    wants, offers, offerOks,
    privateDeals, back,
    valueLog: (vl.error ? [] : (vl.data ?? [])) as ValueChange[],
    leavers: ((lv.data ?? []) as { user_id: string }[]).map((r) => r.user_id),
  };
}

/**
 * Lo que se lleva cada uno menos lo que le corresponde de lo que se reparte. >0 debe pagar, <0 debe cobrar.
 * "piso" = se queda para los que siguen (`stayers`): lo pagan entre ellos según lo que pusieron
 * (a partes iguales si ninguno puso nada), y así se compensa a los que se van.
 */
export function balances(items: SplitItem[], a: Assignment, people: string[], stayers: string[] = []): Record<string, number> {
  const b: Record<string, number> = Object.fromEntries(people.map((p) => [p, 0]));
  for (const it of items) {
    const who = a[it.id];
    if (!who || who === "vender") continue;
    if (who === "piso") {
      if (!stayers.length) continue;
      for (const s of stayers) b[s] = (b[s] ?? 0) + it.value_cents * shareOf(it, s, stayers);
    } else {
      b[who] = (b[who] ?? 0) + it.value_cents;
    }
    for (const p of people) b[p] -= it.value_cents * shareOf(it, p, people);
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
export function proposalByPaid(items: SplitItem[], wants: Record<string, string[]>, people: string[], nobody = "vender"): Assignment {
  const a: Assignment = {};
  const got: Record<string, number> = Object.fromEntries(people.map((p) => [p, 0]));
  for (const it of items) {
    const w = people.filter((p) => wants[p]?.includes(it.id));
    if (!w.length) { a[it.id] = nobody; continue; }
    w.sort((x, y) => shareOf(it, y, people) - shareOf(it, x, people) || got[x] - got[y]);
    a[it.id] = w[0];
    got[w[0]] += it.value_cents;
  }
  return a;
}

/** Opción 2: entre lo que quieren varios, el reparto que mueve menos dinero. */
export function proposalBalanced(items: SplitItem[], wants: Record<string, string[]>, people: string[], nobody = "vender", stayers: string[] = []): Assignment {
  const a: Assignment = {};
  const contested: { id: string; w: string[] }[] = [];
  for (const it of items) {
    const w = people.filter((p) => wants[p]?.includes(it.id));
    if (!w.length) a[it.id] = nobody;
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
      const cost = moved(balances(items, t, people, stayers));
      if (cost < bestCost - 0.5) { bestCost = cost; best = t; }
    }
    return best;
  }
  // Muchos objetos en disputa: uno a uno, el que deja menos dinero por mover.
  const t: Assignment = { ...a };
  for (const c of contested) {
    let bestU = c.w[0], bestCost = Infinity;
    for (const u of c.w) {
      const cost = moved(balances(items, { ...t, [c.id]: u }, people, stayers));
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
  for (const it of sold) for (const u of people) per[u] = (per[u] ?? 0) + it.value_cents * shareOf(it, u, people);
  return { sold, per, total: sold.reduce((s, it) => s + it.value_cents, 0) };
}

export function sameAssignment(x: Assignment, y: Assignment) {
  const keys = new Set([...Object.keys(x), ...Object.keys(y)]);
  for (const k of keys) if (x[k] !== y[k]) return false;
  return true;
}

/** Explicación en frases de un reparto, persona a persona. */
export function explain(items: SplitItem[], a: Assignment, people: string[], stayers: string[]) {
  const b = balances(items, a, people, stayers);
  const kept = items.filter((it) => a[it.id] && a[it.id] !== "vender");
  return people.map((u) => {
    const mine = items.filter((it) => a[it.id] === u);
    const fromHome = items.filter((it) => a[it.id] === "piso" && stayers.includes(u))
      .map((it) => ({ it, cents: it.value_cents * shareOf(it, u, stayers) })).filter((x) => x.cents >= 1);
    const gets = mine.reduce((s, it) => s + it.value_cents, 0) + fromHome.reduce((s, x) => s + x.cents, 0);
    const due = kept.reduce((s, it) => s + it.value_cents * shareOf(it, u, people), 0);
    return { user: u, mine, fromHome, gets: Math.round(gets), due: Math.round(due), balance: Math.round(b[u] ?? 0) };
  });
}
