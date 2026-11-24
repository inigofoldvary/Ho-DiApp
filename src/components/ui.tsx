"use client";
import Link from "next/link";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

export function Header({ title, back, right }: { title: string; back?: string; right?: ReactNode }) {
  return (
    <header className="sticky top-0 z-10 -mx-4 mb-4 flex items-center gap-2 bg-bg/95 px-4 py-3 backdrop-blur">
      {back && (
        <Link href={back} className="-ml-2 rounded-full px-2 py-1 text-2xl leading-none text-muted" aria-label="Volver">
          ‹
        </Link>
      )}
      <h1 className="flex-1 truncate text-lg font-semibold">{title}</h1>
      {right}
    </header>
  );
}

export function Button({ variant = "primary", className = "", ...props }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" }) {
  const styles = {
    primary: "bg-brand text-brand-ink",
    secondary: "border border-line bg-card text-ink",
    ghost: "text-brand",
  }[variant];
  return (
    <button
      {...props}
      className={`w-full rounded-xl px-4 py-3 text-base font-semibold transition active:scale-[0.98] disabled:opacity-50 ${styles} ${className}`}
    />
  );
}

export function Field({ label, hint, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-muted">{label}</span>
      <input
        {...props}
        className="w-full rounded-xl border border-line bg-card px-4 py-3 text-base outline-none focus:border-brand"
      />
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function ErrorBox({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <p className="rounded-xl bg-bad-bg px-4 py-3 text-sm text-bad">{children}</p>;
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-line bg-card p-4 ${className}`}>{children}</div>;
}

export function Loading() {
  return <p className="py-16 text-center text-muted">Cargando…</p>;
}

/** Barra superior con el logo: siempre lleva a la lista de hogares. */
export function AppBar({ right }: { right?: ReactNode }) {
  return (
    <header className="sticky top-0 z-10 -mx-4 mb-4 flex items-center gap-2 bg-bg/95 px-4 py-3 backdrop-blur">
      <Link href="/" className="flex flex-1 items-center gap-2" aria-label="Ir a mis hogares">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.png" alt="" className="h-10 w-auto" />
        <span className="text-xl font-bold tracking-tight text-logo">Home Divide</span>
      </Link>
      {right}
    </header>
  );
}
