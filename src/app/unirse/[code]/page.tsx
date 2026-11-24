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

  useEffect(() => {
    const db = supabase();
    db.auth.getUser().then(({ data }) => setLoggedIn(!!data.user));
    db.rpc("invite_preview", { p_code: code }).then(({ data }) => setPreview((data as Preview[])?.[0] ?? null));
  }, [code]);

  async function join() {
    setBusy(true); setError("");
    const { data, error } = await supabase().rpc("join_household", { p_code: code });
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
        <p className="text-4xl">{preview.kind === "pareja" ? "💑" : "🏠"}</p>
        <div>
          <p className="text-sm text-muted">Te han invitado a</p>
          <p className="text-xl font-bold">{preview.name}</p>
          <p className="text-sm text-muted">{preview.members} {preview.members === 1 ? "persona" : "personas"} dentro</p>
        </div>
        <p className="text-sm text-muted">Aquí apuntáis quién ha pagado cada cosa de casa, y lo confirmáis entre todos.</p>
        <ErrorBox>{error}</ErrorBox>
        {loggedIn ? (
          <Button onClick={join} disabled={busy}>{busy ? "Entrando…" : "Unirme"}</Button>
        ) : (
          <Link href={`/entrar?next=${encodeURIComponent(`/unirse/${code}`)}`} className="block">
            <Button>Crear cuenta y unirme</Button>
          </Link>
        )}
      </Card>
    </main>
  );
}
