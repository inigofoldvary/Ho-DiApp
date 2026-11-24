"use client";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useRequireUser } from "@/lib/useSession";
import { Button, Card, Header, Loading } from "@/components/ui";

type Member = { user_id: string; left_at: string | null; profiles: { display_name: string } | null };

function Invitar() {
  const { id } = useParams<{ id: string }>();
  const isNew = useSearchParams().get("nuevo") === "1";
  const user = useRequireUser();
  const [home, setHome] = useState<{ name: string; kind: string; invite_code: string } | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!user) return;
    const db = supabase();
    db.from("households").select("name, kind, invite_code").eq("id", id).single().then(({ data }) => setHome(data));
    db.from("household_members").select("user_id, left_at, profiles(display_name)").eq("household_id", id)
      .is("left_at", null).then(({ data }) => setMembers((data as unknown as Member[]) ?? []));
  }, [user, id]);

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
      {isNew && <p className="mb-4 rounded-xl bg-ok-bg px-4 py-3 text-sm text-ok">¡Hogar creado! Ahora invita a {home.kind === "pareja" ? "tu pareja" : "tus compañeros"}.</p>}
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

      <h2 className="mb-2 mt-6 text-sm font-semibold text-muted">Ya están dentro ({members.length})</h2>
      <Card className="divide-y divide-line !p-0">
        {members.map((m) => (
          <p key={m.user_id} className="px-4 py-3">
            {m.profiles?.display_name ?? "—"}{m.user_id === user?.id ? " (tú)" : ""}
          </p>
        ))}
      </Card>

      <Link href={`/hogar/${id}`} className="mt-6 block"><Button variant="ghost">Ir al hogar →</Button></Link>
    </main>
  );
}

export default function InvitarPage() {
  return <Suspense><Invitar /></Suspense>;
}
