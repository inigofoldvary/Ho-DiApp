"use client";
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase, errorText } from "@/lib/supabase";
import { useRequireUser } from "@/lib/useSession";
import { loadMembers, type Member } from "@/lib/members";
import { loadReport } from "@/lib/report";
import { formatDateTime } from "@/lib/status";
import { Button, Card, ErrorBox, Header, Loading } from "@/components/ui";

type Household = { name: string; status: string; dissolved_at: string | null };
type Dissolution = { id: string; kind: string; status: string; version: number; created_by: string; created_at: string; completed_at: string | null };
type Conf = { user_id: string; decision: string; comment: string | null; created_at: string; subject_version: number };

export default function Disolver() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const user = useRequireUser();
  const [home, setHome] = useState<Household | null>(null);
  const [diss, setDiss] = useState<Dissolution | null>(null);
  const [confs, setConfs] = useState<Conf[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [comment, setComment] = useState("");
  const [sure, setSure] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    const db = supabase();
    const [h, d, a, i] = await Promise.all([
      db.from("households").select("name, status, dissolved_at").eq("id", id).single(),
      db.from("dissolutions").select("*").eq("household_id", id).eq("kind", "total")
        .in("status", ["pendiente", "confirmado", "rechazado"]).order("created_at", { ascending: false }).limit(1),
      db.from("assets").select("id", { count: "exact", head: true }).eq("household_id", id).eq("status", "pendiente"),
      db.from("installments").select("id", { count: "exact", head: true }).eq("household_id", id).eq("status", "pendiente"),
    ]);
    if (h.error) return setError(errorText(h.error));
    setHome(h.data);
    const last = (d.data?.[0] as Dissolution) ?? null;
    setDiss(last);
    setPendingCount((a.count ?? 0) + (i.count ?? 0));
    if (last) {
      const c = await db.from("confirmations").select("user_id, decision, comment, created_at, subject_version")
        .eq("subject_type", "dissolution").eq("subject_id", last.id).order("created_at");
      setConfs((c.data as Conf[]) ?? []);
    }
    setMembers(await loadMembers(id, user.id));
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

  async function finalPdf() {
    setBusy(true);
    try {
      const r = await loadReport(id);
      const { buildPdf, pdfFileName } = await import("@/lib/pdf");
      buildPdf(r, { final: true }).save(pdfFileName(r, true));
    } catch (e) { setError(errorText(e)); }
    setBusy(false);
  }

  if (!home || !user) return error ? <main className="pt-10"><ErrorBox>{error}</ErrorBox></main> : <Loading />;
  const active = members.filter((m) => m.active);
  const nameOf = (u: string) => (u === user.id ? "Tú" : members.find((m) => m.user_id === u)?.name ?? "?");
  const inProgress = home.status === "disolviendo" && diss?.status === "pendiente";
  const current = diss ? confs.filter((c) => c.subject_version === diss.version) : [];
  const mine = current.find((c) => c.user_id === user.id);

  return (
    <main className="pb-10">
      <Header title="Disolver hogar" back={`/hogar/${id}`} />
      <ErrorBox>{error}</ErrorBox>

      {home.status === "disuelto" && (
        <Card className="space-y-3 text-center">
          <p className="text-4xl">📦</p>
          <p className="text-lg font-semibold">{home.name} está disuelto</p>
          {home.dissolved_at && <p className="text-sm text-muted">Desde el {formatDateTime(home.dissolved_at)}. El inventario ya no se puede cambiar.</p>}
          <Button onClick={finalPdf} disabled={busy}>{busy ? "Preparando…" : "Descargar PDF final"}</Button>
        </Card>
      )}

      {home.status === "activo" && (
        <div className="space-y-4">
          {diss?.status === "rechazado" && (
            <p className="rounded-xl bg-bad-bg px-4 py-3 text-sm text-bad">
              El último intento de disolver se paró porque alguien dijo que faltaba algo. Revisad el inventario antes de volver a intentarlo.
            </p>
          )}
          <Card className="space-y-3">
            <p className="font-semibold">¿Qué pasa si disolvéis el hogar?</p>
            <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
              <li>El inventario se <b>congela</b>: nadie puede añadir ni cambiar nada.</li>
              <li>Cada uno de los {active.length} miembros confirma que <b>está completo</b>.</li>
              <li>Cuando todos confirman, se genera el <b>PDF final</b> con todo lo registrado.</li>
            </ol>
            <p className="text-sm text-muted">Mientras no confirméis todos, se puede cancelar y el hogar vuelve a la normalidad.</p>
          </Card>
          {pendingCount > 0 && (
            <p className="rounded-xl bg-warn-bg px-4 py-3 text-sm text-warn">
              Ojo: hay {pendingCount} {pendingCount === 1 ? "cosa pendiente" : "cosas pendientes"} de confirmar. Lo que no esté confirmado no saldrá en los totales del PDF final.
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

      {inProgress && diss && (
        <div className="space-y-4">
          <p className="rounded-xl bg-warn-bg px-4 py-3 text-sm text-warn">
            🧊 Inventario congelado. Falta que todos confirmen que está completo.
          </p>
          <Card className="divide-y divide-line !p-0">
            {active.map((m) => {
              const a = current.find((c) => c.user_id === m.user_id);
              return (
                <div key={m.user_id} className="px-4 py-3">
                  <span className="font-medium">{nameOf(m.user_id)}</span>
                  <p className={`text-sm ${a?.decision === "confirmar" ? "text-ok" : a?.decision === "rechazar" ? "text-bad" : "text-muted"}`}>
                    {a?.decision === "confirmar" ? `✓ Está completo · ${formatDateTime(a.created_at)}`
                      : a?.decision === "rechazar" ? `✗ Falta algo · ${formatDateTime(a.created_at)}` : "⏳ Falta que confirme"}
                  </p>
                  {a?.comment && <p className="mt-1 text-sm text-muted">“{a.comment}”</p>}
                </div>
              );
            })}
          </Card>

          {!mine && (rejecting ? (
            <div className="space-y-2">
              <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} autoFocus
                placeholder="¿Qué falta? Ej. no está apuntada la lavadora"
                className="w-full rounded-xl border border-line bg-card px-4 py-3 outline-none focus:border-brand" />
              <div className="grid grid-cols-2 gap-3">
                <Button variant="secondary" onClick={() => setRejecting(false)}>Cancelar</Button>
                <Button className="!bg-bad" disabled={busy || !comment.trim()}
                  onClick={() => call("respond", { p_subject_type: "dissolution", p_subject_id: diss.id, p_decision: "rechazar", p_comment: comment })}>Enviar</Button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <Button variant="secondary" onClick={() => setRejecting(true)} disabled={busy}>Falta algo</Button>
              <Button onClick={() => call("respond", { p_subject_type: "dissolution", p_subject_id: diss.id, p_decision: "confirmar" })} disabled={busy}>
                Está completo ✓
              </Button>
            </div>
          ))}

          <Button variant="ghost" disabled={busy} onClick={async () => {
            if (!confirm("¿Cancelar la disolución? El hogar volverá a funcionar con normalidad.")) return;
            if (await call("cancel_dissolution", { p_dissolution: diss.id })) router.replace(`/hogar/${id}`);
          }}>Cancelar la disolución</Button>
        </div>
      )}
    </main>
  );
}
