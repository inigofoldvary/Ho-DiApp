import { supabase } from "./supabase";

/** Reduce la foto (para que suba rápido) y la guarda en Supabase. Devuelve la ruta. */
export async function uploadPhoto(householdId: string, file: File): Promise<string> {
  const blob = await shrink(file, 1600, 0.8);
  const path = `${householdId}/${crypto.randomUUID()}.jpg`;
  const { error } = await supabase().storage.from("fotos").upload(path, blob, {
    contentType: "image/jpeg",
    upsert: false,
  });
  if (error) throw error;
  return path;
}

/** Enlaces temporales para ver fotos privadas. */
export async function signedUrls(paths: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(paths.filter(Boolean))];
  if (unique.length === 0) return {};
  const { data } = await supabase().storage.from("fotos").createSignedUrls(unique, 60 * 60);
  const out: Record<string, string> = {};
  for (const d of data ?? []) if (d.path && d.signedUrl) out[d.path] = d.signedUrl;
  return out;
}

async function shrink(file: File, maxSide: number, quality: number): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise((res, rej) =>
      canvas.toBlob((b) => (b ? res(b) : rej(new Error("No se pudo procesar la foto"))), "image/jpeg", quality));
  } catch {
    return file; // si el navegador no puede reducirla, se sube tal cual
  }
}
