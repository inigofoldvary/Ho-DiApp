"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { supabase, errorText } from "@/lib/supabase";
import { Button, Card, ErrorBox, Loading } from "@/components/ui";

type Preview = { household_id: string; name: string; kind: string; members: number };

export default function Unirse() {
  const { code } = useParams<{ code: string }>();
  const router = useRouter();
  const [preview, setPreview] = useState<Preview | null | undefined>(undefined);
  const [loggedIn, setLoggedIn] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [people, setPeople] = useState<{ person_id: string; name: string }[]>([]);
  const [who, setWho] = useState<string>("");
  const [myName, setMyName] = useState("");

  useEffect(() => {
    const db = supabase();
    db.auth.getUser().then(({ data }) => {
      setLoggedIn(!!data.user);
      if (data.user) db.from("profiles").select("display_name").eq("id", data.user.id).single().then(({ data: p }) => setMyName(p?.display_name ?? ""));
      if (data.user) db.rpc("invite_people", { p_code: code }).then(({ data: ps }) => setPeople((ps as { person_id: string; name: string }[]) ?? []));
    });
    db.rpc("invite_preview", { p_code: code }).then(({ data }) => setPreview((data as Preview[])?.[0] ?? null));
  }, [code]);

  async function join() {
    setBusy(true); setError("");
    const { data, error } = who && who !== "nuevo"
      ? await supabase().rpc("claim_person", { p_code: code, p_person: who })
      : await supabase().rpc("join_household_as", { p_code: code, p_name: myName });
    setBusy(false);
    if (error) return setError(errorText(error));
    router.replace(`/hogar/${data}`);
  }

  if (preview === undefined) return <Loading />;
  if (preview === null) {
    return (
      <main className="pt-16 text-center">
        <p className="text-lg font-semibold">Este enlace no funciona</p>
        <p className="mt-2 text-muted">Puede que haya caducado. Pide uno nuevo a quien te invitó.</p>
      </main>
    );
  }
  return (
    <main className="pt-12">
      <Card className="space-y-4 text-center">
        <p className="text-4xl">🏠</p>
        <div>
          <p className="text-sm text-muted">Te han invitado a</p>
          <p className="text-xl font-bold">{preview.name}</p>
          <p className="text-sm text-muted">{preview.members} {preview.members === 1 ? "persona" : "personas"} dentro</p>
        </div>
        <p className="text-sm text-muted">Aquí apuntáis quién ha pagado cada cosa de casa, y lo confirmáis entre todos.</p>
        <ErrorBox>{error}</ErrorBox>
        {loggedIn && people.length > 0 && (
          <div className="space-y-2 text-left">
            <p className="text-sm font-semibold">¿Quién eres?</p>
            {[...people, { person_id: "nuevo", name: "No estoy en la lista" }].map((p) => (
              <label key={p.person_id} className={`flex items-center gap-3 rounded-xl border-2 px-4 py-3 ${who === p.person_id ? "border-brand bg-ok-bg" : "border-line"}`}>
                <input type="radio" name="quien" checked={who === p.person_id} onChange={() => setWho(p.person_id)} className="h-5 w-5 accent-[var(--brand)]" />
                <span className="font-medium">{p.person_id === "nuevo" ? <span className="text-muted">{p.name}</span> : p.name}</span>
              </label>
            ))}
            <p className="text-xs text-muted">Si eliges tu nombre, todo lo apuntado a ese nombre pasa a tu cuenta, y ya puedes confirmarlo.</p>
          </div>
        )}
        {loggedIn && (people.length === 0 || who === "nuevo") && (
          <label className="block text-left">
            <span className="mb-1 block text-sm font-semibold">Tu nombre</span>
            <input value={myName} onChange={(e) => setMyName(e.target.value)} maxLength={60} placeholder="Cómo te verán los demás"
              className="w-full rounded-xl border border-line bg-bg px-4 py-3 outline-none focus:border-brand" />
          </label>
        )}
        {loggedIn ? (
          <Button onClick={join} disabled={busy || (people.length > 0 && !who) || ((people.length === 0 || who === "nuevo") && !myName.trim())}>{busy ? "Entrando…" : who && who !== "nuevo" ? `Entrar como ${people.find((p) => p.person_id === who)?.name}` : "Unirme"}</Button>
        ) : (
          <Link href={`/entrar?next=${encodeURIComponent(`/unirse/${code}`)}`} className="block">
            <Button>Crear cuenta y unirme</Button>
          </Link>
        )}
      </Card>
    </main>
  );
}
