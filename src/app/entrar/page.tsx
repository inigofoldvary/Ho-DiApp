"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase, errorText } from "@/lib/supabase";
import { Button, ErrorBox, Field } from "@/components/ui";

function EntrarForm() {
  const router = useRouter();
  const next = useSearchParams().get("next") || "/";
  const [mode, setMode] = useState<"entrar" | "registro">("registro");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(""); setInfo(""); setBusy(true);
    try {
      if (mode === "registro") {
        const { data, error } = await supabase().auth.signUp({
          email, password,
          options: { data: { full_name: name.trim() }, emailRedirectTo: `${location.origin}${next}` },
        });
        if (error) throw error;
        if (!data.session) {
          setInfo("Te hemos mandado un correo para confirmar tu cuenta. Ábrelo y vuelve aquí.");
          return;
        }
      } else {
        const { error } = await supabase().auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      router.replace(next);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="pt-12">
      <div className="mb-8 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="" width={96} height={88} className="mx-auto mb-3 h-auto w-24" />
        <h1 className="text-3xl font-bold tracking-tight"><span className="text-brand">Ho-</span><span className="text-accent">Di</span><span className="text-muted">App</span></h1>
        <p className="mt-1 text-muted">Quién pagó qué en vuestra casa, claro y sin discusiones.</p>
      </div>

      <div className="mb-5 grid grid-cols-2 rounded-xl bg-line/60 p-1 text-sm font-semibold">
        {(["registro", "entrar"] as const).map((m) => (
          <button key={m} type="button" onClick={() => setMode(m)}
            className={`rounded-lg py-2 ${mode === m ? "bg-card shadow-sm" : "text-muted"}`}>
            {m === "registro" ? "Crear cuenta" : "Entrar"}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="space-y-4">
        {mode === "registro" && (
          <Field label="Tu nombre" value={name} onChange={(e) => setName(e.target.value)} required
            placeholder="Como te llaman en casa" autoComplete="given-name" />
        )}
        <Field label="Correo" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
          autoComplete="email" inputMode="email" />
        <Field label="Contraseña" type="password" value={password} onChange={(e) => setPassword(e.target.value)}
          required minLength={6} autoComplete={mode === "registro" ? "new-password" : "current-password"} />
        <ErrorBox>{error}</ErrorBox>
        {info && <p className="rounded-xl bg-ok-bg px-4 py-3 text-sm text-ok">{info}</p>}
        <Button type="submit" disabled={busy}>
          {busy ? "Un momento…" : mode === "registro" ? "Crear cuenta" : "Entrar"}
        </Button>
      </form>
      <p className="mt-6 text-center text-xs text-muted">Pronto: entrar con Google.</p>
    </main>
  );
}

export default function EntrarPage() {
  return <Suspense><EntrarForm /></Suspense>;
}
