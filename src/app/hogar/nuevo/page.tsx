"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase, errorText } from "@/lib/supabase";
import { useRequireUser } from "@/lib/useSession";
import { Button, ErrorBox, Field, Header, Loading } from "@/components/ui";

const KINDS = [
  { id: "pareja", emoji: "💑", title: "Pareja", text: "Dos personas que comparten casa." },
  { id: "piso", emoji: "🏠", title: "Compañeros de piso", text: "Varias personas, pueden entrar y salir." },
] as const;

export default function NuevoHogar() {
  const user = useRequireUser();
  const router = useRouter();
  const [kind, setKind] = useState<"pareja" | "piso" | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!kind) return;
    setBusy(true); setError("");
    const { data, error } = await supabase().rpc("create_household", { p_name: name, p_kind: kind });
    setBusy(false);
    if (error) return setError(errorText(error));
    router.replace(`/hogar/${data}/invitar?nuevo=1`);
  }

  if (!user) return <Loading />;
  return (
    <main>
      <Header title="Crear hogar" back="/" />
      <form onSubmit={create} className="space-y-6">
        <div>
          <p className="mb-2 text-sm font-medium text-muted">¿Qué tipo de hogar es?</p>
          <div className="grid gap-3">
            {KINDS.map((k) => (
              <button type="button" key={k.id} onClick={() => setKind(k.id)}
                className={`flex items-center gap-4 rounded-2xl border-2 bg-card p-4 text-left transition ${kind === k.id ? "border-brand" : "border-line"}`}>
                <span className="text-3xl">{k.emoji}</span>
                <span>
                  <span className="block font-semibold">{k.title}</span>
                  <span className="block text-sm text-muted">{k.text}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
        <Field label="Nombre del hogar" value={name} onChange={(e) => setName(e.target.value)} required
          maxLength={80} placeholder="Ej. Piso de Malasaña" />
        <ErrorBox>{error}</ErrorBox>
        <Button type="submit" disabled={!kind || !name.trim() || busy}>{busy ? "Creando…" : "Crear hogar"}</Button>
      </form>
    </main>
  );
}
