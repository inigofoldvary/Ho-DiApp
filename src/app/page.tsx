"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase, errorText } from "@/lib/supabase";
import { useRequireUser } from "@/lib/useSession";
import { Button, Card, ErrorBox, Header, Loading } from "@/components/ui";

type Household = { id: string; name: string; kind: string; status: string };

export default function Home() {
  const user = useRequireUser();
  const router = useRouter();
  const [homes, setHomes] = useState<Household[] | null>(null);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    if (!user) return;
    supabase().from("household_members")
      .select("households(id, name, kind, status)")
      .eq("user_id", user.id).is("left_at", null)
      .then(({ data, error }) => {
        if (error) return setLoadError(errorText(error));
        const list = (data ?? []).map((r: { households: Household | Household[] }) =>
          Array.isArray(r.households) ? r.households[0] : r.households).filter(Boolean);
        if (list.length === 0) router.replace("/hogar/nuevo");
        else if (list.length === 1) router.replace(`/hogar/${list[0].id}`);
        else setHomes(list);
      });
  }, [user, router]);

  if (loadError) return <main className="pt-10"><ErrorBox>No se pudieron cargar tus hogares: {loadError}</ErrorBox></main>;
  if (!homes) return <Loading />;
  return (
    <main>
      <Header title="Tus hogares" right={
        <button className="text-sm text-muted" onClick={async () => { await supabase().auth.signOut(); router.replace("/entrar"); }}>
          Salir
        </button>} />
      <div className="space-y-3">
        {homes.map((h) => (
          <Link key={h.id} href={`/hogar/${h.id}`} className="block">
            <Card>
              <p className="font-semibold">{h.name}</p>
              <p className="text-sm text-muted">{h.kind === "pareja" ? "Pareja" : "Compañeros de piso"}{h.status !== "activo" ? " · " + h.status : ""}</p>
            </Card>
          </Link>
        ))}
        <Link href="/hogar/nuevo"><Button variant="secondary" className="mt-2">+ Crear otro hogar</Button></Link>
      </div>
    </main>
  );
}
