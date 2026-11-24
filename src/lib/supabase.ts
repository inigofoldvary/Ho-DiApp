import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

/** Conexión con Supabase (la "cocina" de la app). */
export function supabase(): SupabaseClient {
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) {
      throw new Error("Faltan las claves de Supabase en .env.local");
    }
    client = createBrowserClient(url, key);
  }
  return client;
}

/** Pasa un error de Supabase a un mensaje entendible. */
export function errorText(e: unknown): string {
  const msg = (e as { message?: string })?.message ?? String(e);
  if (msg.includes("Invalid login credentials")) return "Correo o contraseña incorrectos.";
  if (msg.includes("User already registered")) return "Ya existe una cuenta con ese correo. Prueba a entrar.";
  if (msg.includes("Password should be at least")) return "La contraseña tiene que tener al menos 6 caracteres.";
  if (msg.includes("provider is not enabled")) return "El acceso con Google aún no está activado. Usa correo y contraseña de momento.";
  return msg;
}
