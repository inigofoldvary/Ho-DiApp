"use client";
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase, errorText } from "@/lib/supabase";
import { useRequireUser } from "@/lib/useSession";
import { loadMembers, type Member } from "@/lib/members";
import { loadReport, type Report } from "@/lib/report";
import { formatEuros } from "@/lib/money";
import { formatDateTime } from "@/lib/status";
import { Button, Card, ErrorBox, Header, Loading } from "@/components/ui";

type Household = { name: string; kind: string; status: string };
type Exit = { id: string; leaving_user_id: string; status: string; version: number; created_by: string; created_at: string; completed_at: string | null };
type Conf = { user_id: string; decision: string; comment: string | null; created_at: string; subject_version: number };

export default function Salida() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const user = useRequireUser();
  const [home, setHome] = useState<Household | null>(null);
  const [exits, setExits] = useState<Exit[]>([]);
  const [confs, setConfs] = useState<Conf[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [report, setReport] = useState<Report | null>(null);
  const [leaving, setLeaving] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [comment, setComment] = useState("");

  const load = useCallback(async () => {
    if (!user) return;
    const db = supabase();
    const [h, d] = await Promise.all([
      db.from("households").select("name, kind, status").eq("id", id).single(),
      db.from("dissolutions").select("id, leaving_user_id, status, version, created_by, created_at, completed_at")
        .eq("household_id", id).eq("kind", "parcial").neq("status", "cancelado").order("created_at", { ascending: false }),
    ]);
    if (h.error) return setError(errorText(h.error));
    setHome(h.data);
    const list = (d.data as Exit[]) ?? [];
    setExits(list);
    const open = list.find((x) => x.status === "pendiente");
    if (open) {
      const c = await db.from("confirmations").select("user_id, decision, comment, created_at, subject_version")
        .eq("subject_type", "dissolution").eq("subject_id", open.id).order("created_at");
      setConfs((c.data as Conf[]) ?? []);
      loadReport(id).then(setReport).catch(() => {});
    }
    setMembers(await loadMembers(id, user.id));
  }, [id, user]);

  useEffect(() => { load(); }, [load]);

  async function call(fn: string, args: Record<string, unknown>) {
    setBusy(true); setError("");
    const { error } = await supabase().rpc(fn, args);
    setBusy(false);
    if (error) { setError(errorText(error)); return false; }
    setRejecting(false); setComment("");
    await load();
    return true;
  }

  async function exitPdf(userId: string) {
    setBusy(true);
    try {
      const r = await loadReport(id);
      const name = members.find((m) => m.user_id === userId)?.name ?? "Antiguo miembro";
      const { buildPdf, pdfFileName } = await import("@/lib/pdf");
      buildPdf(r, { leaving: { user_id: userId, name } }).save(pdfFileName(r, false, name));
    } catch (e) { setError(errorText(e)); }
    setBusy(false);
  }

  if (!home || !user) return error ? <main className="pt-10"><ErrorBox>{error}</ErrorBox></main> : <Loading />;
  const active = members.filter((m) => m.active);
  const iAmActive = active.some((m) => m.user_id === user.id);
  const nameOf = (u: string) => (u === user.id ? "Tú" : members.find((m) => m.user_id === u)?.name ?? "?");
  const realName = (u: string) => members.find((m) => m.user_id === u)?.name ?? "?";
  const open = exits.find((x) => x.status === "pendiente");
  const lastRejected = !open && exits[0]?.status === "rechazado" ? exits[0] : null;
  const done = exits.filter((x) => x.status === "confirmado");
  const current = open ? confs.filter((c) => c.subject_version === open.version) : [];
  const mine = current.find((c) => c.user_id === user.id);
  const leaverTotals = open && report?.people.find((p) => p.user_id === open.leaving_user_id);

  return (
    <main className="pb-10">
      <Header title="Alguien se va del piso" back={`/hogar/${id}`} />
      <ErrorBox>{error}</ErrorBox>

      {home.kind === "pareja" && (
        <Card className="text-sm text-muted">En un hogar de pareja no hay salidas: si uno se va, lo que toca es disolver el hogar.</Card>
      )}

      {open && (
        <div className="space-y-4">
          <Card className="space-y-2 text-center">
            <p className="text-4xl">🚪</p>
            <p className="text-lg font-semibold">
              {open.leaving_user_id === user.id ? "Te vas de " : `${realName(open.leaving_user_id)} se va de `}{home.name}
            </p>
            <p className="text-sm text-muted">{open.created_by === user.id ? "Lo propusiste tú" : `Lo propuso ${realName(open.created_by)}`} · {formatDateTime(open.created_at)}</p>
            {leaverTotals && (
              <p className="pt-1 text-sm">
                Ha puesto <b>{formatEuros(leaverTotals.assets)}</b> en bienes
                {leaverTotals.recurring > 0 && <> y <b>{formatEuros(leaverTotals.recurring)}</b> en pagos recurrentes</>} (confirmado).
              </p>
            )}
            <Button variant="secondary" disabled={busy} onClick={() => exitPdf(open.leaving_user_id)}>📄 Descargar reporte de salida</Button>
          </Card>

          <p className="text-sm text-muted">
            Repasad el reporte y arreglad entre vosotros su parte. Cuando todos confirméis, {open.leaving_user_id === user.id ? "dejarás" : "dejará"} de
            poder añadir cosas, pero el hogar {open.leaving_user_id === user.id ? "te" : "le"} seguirá saliendo en el historial.
            Sus pagos recurrentes compartidos terminan este mes.
          </p>

          <Card className="divide-y divide-line !p-0">
            {active.map((m) => {
              const a = current.find((c) => c.user_id === m.user_id);
              return (
                <div key={m.user_id} className="px-4 py-3">
                  <span className="font-medium">{nameOf(m.user_id)}{m.user_id === open.leaving_user_id ? " (se va)" : ""}</span>
                  <p className={`text-sm ${a?.decision === "confirmar" ? "text-ok" : a?.decision === "rechazar" ? "text-bad" : "text-muted"}`}>
                    {a?.decision === "confirmar" ? `✓ De acuerdo · ${formatDateTime(a.created_at)}`
                      : a?.decision === "rechazar" ? `✗ No es así · ${formatDateTime(a.created_at)}` : "⏳ Falta que confirme"}
                  </p>
                  {a?.comment && <p className="mt-1 text-sm text-muted">“{a.comment}”</p>}
                </div>
              );
            })}
          </Card>

          {iAmActive && !mine && (rejecting ? (
            <div className="space-y-2">
              <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} autoFocus
                placeholder="¿Qué no está bien? Ej. falta apuntar la lavadora"
                className="w-full rounded-xl border border-line bg-card px-4 py-3 outline-none focus:border-brand" />
              <div className="grid grid-cols-2 gap-3">
                <Button variant="secondary" onClick={() => setRejecting(false)}>Cancelar</Button>
                <Button className="!bg-bad" disabled={busy || !comment.trim()}
                  onClick={() => call("respond", { p_subject_type: "dissolution", p_subject_id: open.id, p_decision: "rechazar", p_comment: comment })}>Enviar</Button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <Button variant="secondary" onClick={() => setRejecting(true)} disabled={busy}>No es así</Button>
              <Button onClick={() => call("respond", { p_subject_type: "dissolution", p_subject_id: open.id, p_decision: "confirmar" })} disabled={busy}>
                De acuerdo ✓
              </Button>
            </div>
          ))}

          {iAmActive && (
            <Button variant="ghost" disabled={busy} onClick={async () => {
              if (!confirm("¿Cancelar la salida? Todo sigue como estaba.")) return;
              if (await call("cancel_dissolution", { p_dissolution: open.id })) router.replace(`/hogar/${id}`);
            }}>Cancelar la salida</Button>
          )}
        </div>
      )}

      {!open && home.kind !== "pareja" && home.status === "activo" && iAmActive && (
        <div className="space-y-4">
          {lastRejected && (
            <p className="rounded-xl bg-bad-bg px-4 py-3 text-sm text-bad">
              La salida de {realName(lastRejected.leaving_user_id)} se paró porque alguien dijo que algo no estaba bien. Revisadlo antes de volver a intentarlo.
            </p>
          )}
          <Card className="space-y-3">
            <p className="font-semibold">¿Cómo funciona?</p>
            <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
              <li>Eliges quién se va.</li>
              <li>Sale un <b>reporte de salida</b> con lo que ha puesto en cada bien, para que arregléis su parte.</li>
              <li>Confirmáis <b>todos</b>, también quien se va. El piso sigue funcionando con normalidad.</li>
              <li>Después ya no podrá añadir cosas, pero verá el hogar en su historial.</li>
            </ol>
          </Card>
          {active.length < 2 ? (
            <Card className="text-sm text-muted">Eres la única persona del hogar. Si te vas, mejor disuélvelo.</Card>
          ) : (
            <>
              <p className="text-sm font-medium">¿Quién se va?</p>
              <div className="space-y-2">
                {active.map((m) => (
                  <label key={m.user_id} className={`flex items-center gap-3 rounded-2xl border bg-card p-4 ${leaving === m.user_id ? "border-brand" : "border-line"}`}>
                    <input type="radio" name="leaving" checked={leaving === m.user_id} onChange={() => setLeaving(m.user_id)}
                      className="h-5 w-5 accent-[var(--brand)]" />
                    <span>{m.user_id === user.id ? "Yo me voy" : m.name}</span>
                  </label>
                ))}
              </div>
              <Button disabled={!leaving || busy} onClick={() => call("start_dissolution", { p_household: id, p_leaving_user: leaving })}>
                Empezar la salida
              </Button>
            </>
          )}
        </div>
      )}

      {done.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-2 text-base font-semibold">Salidas anteriores</h2>
          <Card className="divide-y divide-line !p-0">
            {done.map((x) => (
              <div key={x.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{x.leaving_user_id === user.id ? "Tú" : realName(x.leaving_user_id)}</p>
                  {x.completed_at && <p className="text-sm text-muted">Salió el {formatDateTime(x.completed_at)}</p>}
                </div>
                <button className="shrink-0 text-sm font-medium text-brand underline" disabled={busy} onClick={() => exitPdf(x.leaving_user_id)}>PDF</button>
              </div>
            ))}
          </Card>
        </section>
      )}
    </main>
  );
}
