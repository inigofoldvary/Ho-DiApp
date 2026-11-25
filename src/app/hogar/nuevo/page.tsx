"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase, errorText } from "@/lib/supabase";
import { useRequireUser } from "@/lib/useSession";
import { Button, ErrorBox, Field, Header, Loading } from "@/components/ui";

export default function NuevoHogar() {
  const user = useRequireUser();
  const router = useRouter();
  const [people, setPeople] = useState<string[]>([""]);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [hasHomes, setHasHomes] = useState(true);

  useEffect(() => {
    if (!user) return;
    supabase().from("household_members").select("household_id", { count: "exact", head: true }).eq("user_id", user.id)
      .then(({ count }) => setHasHomes((count ?? 0) > 0));
  }, [user]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const names = people.map((p) => p.trim()).filter(Boolean);
    if (new Set(names.map((n) => n.toLowerCase())).size !== names.length) return setError("Hay dos personas con el mismo nombre");
    setBusy(true); setError("");
    const { data, error } = await supabase().rpc("create_home", { p_name: name, p_people: names });
    setBusy(false);
    if (error) return setError(errorText(error));
    router.replace(`/hogar/${data}/invitar?nuevo=1`);
  }

  if (!user) return <Loading />;
  return (
    <main>
      <Header title="Crear hogar" back={hasHomes ? "/" : undefined} right={
        <button type="button" className="text-sm text-muted" onClick={async () => { await supabase().auth.signOut(); router.replace("/entrar"); }}>
          Salir
        </button>} />
      {!hasHomes && (
        <p className="mb-5 rounded-xl bg-line/60 px-4 py-3 text-sm text-muted">
          Has entrado como <b className="text-ink">{user.email}</b>. ¿No es tu cuenta? Pulsa <b>Salir</b> arriba a la derecha.
        </p>
      )}
      <form onSubmit={create} className="space-y-6">
        <Field label="Nombre del hogar" value={name} onChange={(e) => setName(e.target.value)} required autoFocus
          maxLength={80} placeholder="Ej. Piso de Malasaña, Casa de los abuelos…" />
        <section>
          <p className="mb-1 text-sm font-medium text-muted">¿Quién más forma parte?</p>
          <p className="mb-2 text-xs text-muted">Pon su nombre. No hace falta que tengan cuenta: cuando entren con el enlace, elegirán quién son. Puedes añadir a más gente después.</p>
          <div className="space-y-2">
            <p className="rounded-xl border border-line bg-card px-4 py-3 text-muted">Tú</p>
            {people.map((p, i) => (
              <div key={i} className="flex gap-2">
                <input value={p} onChange={(e) => setPeople((ps) => ps.map((x, j) => (j === i ? e.target.value : x)))} maxLength={60}
                  placeholder={i === 0 ? "Ej. Pepe" : "Otro nombre"} aria-label={`Persona ${i + 2}`}
                  className="min-w-0 flex-1 rounded-xl border border-line bg-card px-4 py-3 outline-none focus:border-brand" />
                {people.length > 1 && (
                  <button type="button" onClick={() => setPeople((ps) => ps.filter((_, j) => j !== i))} aria-label="Quitar"
                    className="rounded-xl border border-line px-3 text-muted">✕</button>
                )}
              </div>
            ))}
          </div>
          <button type="button" onClick={() => setPeople((ps) => [...ps, ""])} className="mt-2 text-sm font-medium text-brand">+ Añadir otra persona</button>
        </section>
        <ErrorBox>{error}</ErrorBox>
        <Button type="submit" disabled={!name.trim() || busy}>{busy ? "Creando…" : "Crear hogar"}</Button>
      </form>
    </main>
  );
}
