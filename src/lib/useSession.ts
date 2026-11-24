"use client";
import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import { supabase } from "./supabase";

/** Devuelve el usuario con sesión. Si no hay, manda a /entrar. */
export function useRequireUser() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  useEffect(() => {
    supabase().auth.getUser().then(({ data }) => {
      if (!data.user) {
        const next = window.location.pathname;
        router.replace(`/entrar?next=${encodeURIComponent(next)}`);
      } else {
        setUser(data.user);
      }
    });
  }, [router]);
  return user;
}
