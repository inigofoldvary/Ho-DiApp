"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase, errorText } from "@/lib/supabase";
import { useRequireUser } from "@/lib/useSession";
import { AppBar, Button, Card, ErrorBox, Loading } from "@/components/ui";

type Household = { id: string; name: string; kind: string; status: string; left?: boolean };

export default function Home() {
  const user = useRequireUser();
  const router = useRouter();
  const [homes, setHomes] = useState<Household[] | null>(null);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    if (!user) return;
    supabase().from("household_members")
      .select("left_at, households(id, name, kind, status)")
      .eq("user_id", user.id)
      .then(({ data, error }) => {
        if (error) return setLoadError(errorText(error));
        const list = (data ?? []).map((r: { left_at: string | null; households: Household | Household[] }) => {
          const h = Array.isArray(r.households) ? r.households[0] : r.households;
          return h ? ({ ...h, left: !!r.left_at } as Household) : null;
        }).filter((h): h is Household => !!h);
        if (list.length === 0) router.replace("/hogar/nuevo");
        else setHomes(list.sort((a, b) => a.name.localeCompare(b.name)));
      });
  }, [user, router]);

  if (loadError) return <main className="pt-10"><ErrorBox>No se pudieron cargar tus hogares: {loadError}</ErrorBox></main>;
  if (!homes) return <Loading />;
  const active = homes.filter((h) => h.status !== "disuelto" && !h.left);
  const past = homes.filter((h) => h.status === "disuelto" || h.left);
  return (
    <main>
      <AppBar right={
        <button className="text-sm text-muted" onClick={async () => { await supabase().auth.signOut(); router.replace("/entrar"); }}>
          Salir
        </button>} />
      <h1 className="mb-3 text-xl font-semibold">Tus hogares</h1>
      <div className="space-y-3">
        {active.map((h) => <HomeCard key={h.id} h={h} />)}
        <Link href="/hogar/nuevo" className="block pt-2">
          <Button variant="secondary">+ Añadir otro hogar</Button>
        </Link>
        <p className="text-center text-xs text-muted">Por ejemplo, el piso de la ciudad y la casa de verano.</p>
      </div>
      {past.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-1 text-base font-semibold">Historial</h2>
          <p className="mb-3 text-sm text-muted">Hogares disueltos o de los que saliste. Puedes consultarlos y volver a descargar su PDF cuando quieras.</p>
          <div className="space-y-3 opacity-80">
            {past.map((h) => <HomeCard key={h.id} h={h} />)}
          </div>
        </section>
      )}
    </main>
  );
}

function HomeCard({ h }: { h: Household }) {
  const gone = h.status === "disuelto" || !!h.left;
  return (
    <Link href={`/hogar/${h.id}`} className="block">
      <Card className="flex items-center gap-4">
        <span className={`text-3xl ${gone ? "grayscale" : ""}`}>{h.kind === "pareja" ? "💑" : "🏠"}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{h.name}</span>
          <span className="block text-sm text-muted">
            {h.kind === "pareja" ? "Pareja" : "Compañeros de piso"}
            {h.left ? " · saliste" : h.status === "disolviendo" ? " · disolviéndose" : h.status === "disuelto" ? " · disuelto" : ""}
          </span>
        </span>
        <span className="text-xl text-muted">›</span>
      </Card>
    </Link>
  );
}
