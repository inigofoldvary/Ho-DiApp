"use client";
import Link from "next/link";
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

  async function google() {
    setError(""); setBusy(true);
    const { error } = await supabase().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${location.origin}${next}` },
    });
    if (error) { setError(errorText(error)); setBusy(false); }
  }

  return (
    <main className="pt-12">
      <div className="mb-8 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="" width={96} height={88} className="mx-auto mb-3 h-auto w-24" />
        <h1 className="text-3xl font-bold tracking-tight"><span className="text-brand">Ho-</span><span className="text-accent">Di</span><span className="text-muted">App</span></h1>
        <p className="text-sm font-medium uppercase tracking-widest text-brand">Home Divide</p>
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
      <div className="my-5 flex items-center gap-3 text-xs text-muted">
        <span className="h-px flex-1 bg-line" />o<span className="h-px flex-1 bg-line" />
      </div>
      <button type="button" disabled={busy} onClick={google}
        className="flex w-full items-center justify-center gap-3 rounded-xl border border-line bg-card px-4 py-3 font-semibold disabled:opacity-50">
        <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>
        Continuar con Google
      </button>
      <p className="mt-8 text-center text-xs text-muted">
        Al continuar aceptas las <Link href="/condiciones" className="underline">condiciones</Link> y
        la <Link href="/privacidad" className="underline">política de privacidad</Link>.
      </p>
    </main>
  );
}

export default function EntrarPage() {
  return <Suspense><EntrarForm /></Suspense>;
}
