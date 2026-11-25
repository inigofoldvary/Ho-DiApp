"use client";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { supabase, errorText } from "@/lib/supabase";
import { useRequireUser } from "@/lib/useSession";
import { Button, Card, ErrorBox, Header, Loading } from "@/components/ui";

type Member = { user_id: string; left_at: string | null; profiles: { display_name: string; placeholder?: boolean } | null };

function Invitar() {
  const { id } = useParams<{ id: string }>();
  const isNew = useSearchParams().get("nuevo") === "1";
  const user = useRequireUser();
  const [home, setHome] = useState<{ name: string; kind: string; invite_code: string } | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [copied, setCopied] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [newName, setNewName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const [removing, setRemoving] = useState<string | null>(null);

  async function remove(u: string) {
    setBusy(true); setError("");
    const { error } = await supabase().rpc("remove_person", { p_household: id, p_user: u });
    setBusy(false); setRemoving(null);
    if (error) return setError(errorText(error));
    setTick((t) => t + 1);
  }

  useEffect(() => {
    if (!user) return;
    const db = supabase();
    db.from("households").select("name, kind, invite_code").eq("id", id).single().then(({ data, error }) => (error ? setLoadError(errorText(error)) : setHome(data)));
    db.from("household_members").select("user_id, left_at, profiles(*)").eq("household_id", id)
      .is("left_at", null).then(({ data }) => setMembers((data as unknown as Member[]) ?? []));
  }, [user, id, tick]);

  async function addPerson(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setBusy(true); setError("");
    const { error } = await supabase().rpc("add_person", { p_household: id, p_name: newName });
    setBusy(false);
    if (error) return setError(errorText(error));
    setNewName(""); setTick((t) => t + 1);
  }

  if (loadError) return <main className="pt-10"><ErrorBox>No se pudo cargar el hogar: {loadError}</ErrorBox></main>;
  if (!home) return <Loading />;
  const link = `${location.origin}/unirse/${home.invite_code}`;
  const message = `Te invito a "${home.name}" para apuntar quién ha pagado cada cosa de casa: ${link}`;

  async function copy() {
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <main>
      <Header title="Invitar" back={`/hogar/${id}`} />
      {isNew && <p className="mb-4 rounded-xl bg-ok-bg px-4 py-3 text-sm text-ok">¡Hogar creado! Ya puedes apuntar cosas. Manda el enlace a los demás: al entrar elegirán quiénes son.</p>}
      <Card className="space-y-4">
        <div>
          <p className="text-sm text-muted">Enlace de invitación a</p>
          <p className="text-lg font-semibold">{home.name}</p>
        </div>
        <p className="break-all rounded-xl bg-bg px-3 py-2 text-sm text-muted">{link}</p>
        <a href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer" className="block">
          <Button type="button" className="!bg-[#25D366] !text-white">Compartir por WhatsApp</Button>
        </a>
        <Button type="button" variant="secondary" onClick={copy}>{copied ? "¡Copiado!" : "Copiar enlace"}</Button>
      </Card>

      <h2 className="mb-2 mt-6 text-sm font-semibold text-muted">Personas del hogar ({members.length})</h2>
      <Card className="divide-y divide-line !p-0">
        {members.map((m) => (
          <p key={m.user_id} className="flex items-center justify-between gap-2 px-4 py-3">
            <span>{m.profiles?.display_name ?? "—"}{m.user_id === user?.id ? " (tú)" : ""}</span>
            <span className="flex items-center gap-2">
              {m.profiles?.placeholder && <span className="rounded-full bg-line px-2 py-0.5 text-xs text-muted">Aún no ha entrado</span>}
              {m.user_id !== user?.id && (removing === m.user_id ? (
                <>
                  <button type="button" onClick={() => setRemoving(null)} className="text-xs text-muted">No</button>
                  <button type="button" disabled={busy} onClick={() => remove(m.user_id)} className="rounded-full bg-bad px-2 py-0.5 text-xs font-semibold text-white">Sí, quitar</button>
                </>
              ) : (
                <button type="button" onClick={() => setRemoving(m.user_id)} className="text-xs font-medium text-bad">Quitar</button>
              ))}
            </span>
          </p>
        ))}
      </Card>
      {home.kind !== "pareja" && (
        <form onSubmit={addPerson} className="mt-3 flex gap-2">
          <input value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={60} placeholder="Añadir a alguien por su nombre"
            className="min-w-0 flex-1 rounded-xl border border-line bg-card px-4 py-3 outline-none focus:border-brand" />
          <button type="submit" disabled={busy || !newName.trim()} className="rounded-xl bg-brand px-4 font-semibold text-brand-ink disabled:opacity-40">Añadir</button>
        </form>
      )}
      <ErrorBox>{error}</ErrorBox>
      <p className="mt-2 text-xs text-muted">Solo se puede quitar a alguien si no tiene dinero puesto en nada. Si sí tiene, usad "Alguien se va" para repartir.</p>

      <Link href={`/hogar/${id}`} className="mt-6 block"><Button variant="ghost">Ir al hogar →</Button></Link>
    </main>
  );
}

export default function InvitarPage() {
  return <Suspense><Invitar /></Suspense>;
}
