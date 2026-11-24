"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase, errorText } from "@/lib/supabase";
import { useRequireUser } from "@/lib/useSession";
import { AppBar, Button, Card, ErrorBox, Loading } from "@/components/ui";

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
        else setHomes(list.sort((a, b) => a.name.localeCompare(b.name)));
      });
  }, [user, router]);

  if (loadError) return <main className="pt-10"><ErrorBox>No se pudieron cargar tus hogares: {loadError}</ErrorBox></main>;
  if (!homes) return <Loading />;
  return (
    <main>
      <AppBar right={
        <button className="text-sm text-muted" onClick={async () => { await supabase().auth.signOut(); router.replace("/entrar"); }}>
          Salir
        </button>} />
      <h1 className="mb-3 text-xl font-semibold">Tus hogares</h1>
      <div className="space-y-3">
        {homes.map((h) => (
          <Link key={h.id} href={`/hogar/${h.id}`} className="block">
            <Card className="flex items-center gap-4">
              <span className="text-3xl">{h.kind === "pareja" ? "💑" : "🏠"}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{h.name}</span>
                <span className="block text-sm text-muted">
                  {h.kind === "pareja" ? "Pareja" : "Compañeros de piso"}
                  {h.status === "disolviendo" ? " · disolviéndose" : h.status === "disuelto" ? " · disuelto" : ""}
                </span>
              </span>
              <span className="text-xl text-muted">›</span>
            </Card>
          </Link>
        ))}
        <Link href="/hogar/nuevo" className="block pt-2">
          <Button variant="secondary">+ Añadir otro hogar</Button>
        </Link>
        <p className="text-center text-xs text-muted">Por ejemplo, el piso de la ciudad y la casa de verano.</p>
      </div>
    </main>
  );
}
