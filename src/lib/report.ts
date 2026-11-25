import { supabase } from "./supabase";

export type ReportAsset = {
  id: string; name: string; total_cents: number; purchase_date: string; status: string; version: number;
  receipt_path: string | null; category: string | null;
  participants: { user_id: string; name: string; amount_cents: number }[];
  confirmations: { name: string; at: string }[];
};
export type ReportInstallment = {
  id: string; concept: string; period: string; amount_cents: number; status: string; is_exception: boolean;
  payments: { user_id: string; name: string; amount_cents: number }[];
};
export type PersonTotal = { user_id: string; name: string; assets: number; recurring: number; pending: number };
export type Report = {
  household: { name: string; kind: string; status: string };
  assets: ReportAsset[];
  installments: ReportInstallment[];
  people: PersonTotal[];
  generatedAt: Date;
};

export async function loadReport(householdId: string): Promise<Report> {
  const db = supabase();
  const [h, m, a, c, i] = await Promise.all([
    db.from("households").select("name, kind, status").eq("id", householdId).single(),
    db.from("household_members").select("user_id, profiles(display_name)").eq("household_id", householdId),
    db.from("assets").select("id, name, total_cents, purchase_date, status, version, receipt_path, category, asset_participants(user_id, amount_cents)")
      .eq("household_id", householdId).order("purchase_date"),
    db.from("confirmations").select("subject_type, subject_id, subject_version, user_id, decision, created_at")
      .eq("household_id", householdId).eq("decision", "confirmar").order("created_at"),
    db.from("installments").select("id, period, amount_cents, status, is_exception, recurring_plans(concept), installment_payments(user_id, amount_cents)")
      .eq("household_id", householdId).order("period"),
  ]);
  for (const r of [h, m, a, c, i]) if (r.error) throw r.error;

  const names: Record<string, string> = {};
  for (const r of (m.data ?? []) as unknown as { user_id: string; profiles: { display_name: string } | null }[]) {
    names[r.user_id] = r.profiles?.display_name ?? "?";
  }
  const nameOf = (u: string) => names[u] ?? "Antiguo miembro";

  const confs = (c.data ?? []) as { subject_type: string; subject_id: string; subject_version: number; user_id: string; created_at: string }[];

  const assets: ReportAsset[] = ((a.data ?? []) as unknown as {
    id: string; name: string; total_cents: number; purchase_date: string; status: string; version: number; receipt_path: string | null; category: string | null;
    asset_participants: { user_id: string; amount_cents: number }[];
  }[]).map((x) => ({
    ...x,
    participants: x.asset_participants.map((p) => ({ ...p, name: nameOf(p.user_id) })),
    confirmations: confs.filter((k) => k.subject_type === "asset" && k.subject_id === x.id && k.subject_version === x.version)
      .map((k) => ({ name: nameOf(k.user_id), at: k.created_at })),
  }));

  const installments: ReportInstallment[] = ((i.data ?? []) as unknown as {
    id: string; period: string; amount_cents: number; status: string; is_exception: boolean;
    recurring_plans: { concept: string } | null; installment_payments: { user_id: string; amount_cents: number }[];
  }[]).map((x) => ({
    id: x.id, period: x.period, amount_cents: x.amount_cents, status: x.status, is_exception: x.is_exception,
    concept: x.recurring_plans?.concept ?? "Pago recurrente",
    payments: x.installment_payments.map((p) => ({ ...p, name: nameOf(p.user_id) })),
  }));

  const people = new Map<string, PersonTotal>();
  const get = (u: string) => {
    if (!people.has(u)) people.set(u, { user_id: u, name: nameOf(u), assets: 0, recurring: 0, pending: 0 });
    return people.get(u)!;
  };
  Object.keys(names).forEach(get);
  for (const x of assets) for (const p of x.participants) {
    if (x.status === "confirmado") get(p.user_id).assets += p.amount_cents; else get(p.user_id).pending += p.amount_cents;
  }
  for (const x of installments) for (const p of x.payments) {
    if (x.status === "confirmado") get(p.user_id).recurring += p.amount_cents; else get(p.user_id).pending += p.amount_cents;
  }

  return {
    household: h.data!,
    assets, installments,
    people: [...people.values()].sort((p, q) => (q.assets + q.recurring) - (p.assets + p.recurring)),
    generatedAt: new Date(),
  };
}

export const LEGAL_NOTE =
  "Este documento es un resumen informativo de lo que los miembros del hogar han registrado y confirmado en Ho-DiApp. " +
  "No tiene validez legal ni sustituye a ningún documento oficial.";
