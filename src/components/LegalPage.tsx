import Link from "next/link";
import type { ReactNode } from "react";
import { LEGAL_UPDATED } from "@/lib/legal";

export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="pb-12 pt-6">
      <Link href="/" className="mb-4 flex items-center gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="" width={40} height={32} className="h-8 w-auto" />
        <span className="font-semibold text-brand">Home Divide</span>
      </Link>
      <h1 className="mb-1 text-2xl font-bold tracking-tight">{title}</h1>
      <p className="mb-6 text-sm text-muted">Última actualización: {LEGAL_UPDATED}</p>
      <div className="space-y-5 text-[15px] leading-relaxed [&_h2]:mb-1 [&_h2]:text-base [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_a]:text-brand [&_a]:underline">
        {children}
      </div>
      <p className="mt-10 text-center text-sm text-muted">
        <Link href="/privacidad" className="underline">Privacidad</Link> · <Link href="/condiciones" className="underline">Condiciones</Link>
      </p>
    </main>
  );
}
