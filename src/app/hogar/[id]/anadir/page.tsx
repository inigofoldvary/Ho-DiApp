"use client";
import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { supabase, errorText } from "@/lib/supabase";
import { useRequireUser } from "@/lib/useSession";
import { formatEuros, parseEuros } from "@/lib/money";
import { uploadPhoto } from "@/lib/photos";
import { Button, ErrorBox, Field, Loading } from "@/components/ui";

type Member = { user_id: string; name: string };
type Row = { user_id: string; name: string; involved: boolean; amount: string };

function today() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

/** Reparte unos céntimos a partes iguales (el resto, céntimo a céntimo). */
function splitEqual(total: number, n: number): number[] {
  const base = Math.floor(total / n);
  return Array.from({ length: n }, (_, i) => base + (i < total - base * n ? 1 : 0));
}

function centsToInput(c: number) {
  return (c / 100).toFixed(2).replace(".", ",").replace(",00", "");
}

export default function AnadirBienPage() {
  return <Suspense><AnadirBien /></Suspense>;
}

function AnadirBien() {
  const { id } = useParams<{ id: string }>();
  const editId = useSearchParams().get("editar");
  const [existing, setExisting] = useState<{ receipt: string | null; photo: string | null }>({ receipt: null, photo: null });
  const router = useRouter();
  const user = useRequireUser();
  const [kind, setKind] = useState<string>("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [date, setDate] = useState(today());
  const [isPrivate, setIsPrivate] = useState(false);
  const [receipt, setReceipt] = useState<File | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [ocr, setOcr] = useState<{ state: "leyendo" | "ok" | "nada"; text?: string } | null>(null);

  async function pickReceipt(f: File | null) {
    setReceipt(f);
    setOcr(null);
    if (!f) return;
    setOcr({ state: "leyendo" });
    try {
      const { readTicket } = await import("@/lib/ticket");
      const g = await readTicket(f);
      const bits: string[] = [];
      if (g.totalCents) { setPrice(centsToInput(g.totalCents)); bits.push(`total ${formatEuros(g.totalCents)}`); }
      if (g.date) { setDate(g.date); bits.push(`fecha ${g.date.split("-").reverse().join("/")}`); }
      setOcr(bits.length ? { state: "ok", text: bits.join(" y ") } : { state: "nada" });
    } catch {
      setOcr({ state: "nada" });
    }
  }

  useEffect(() => {
    if (!user) return;
    const db = supabase();
    db.from("households").select("kind").eq("id", id).single().then(({ data }) => setKind(data?.kind ?? ""));
    db.from("household_members").select("user_id, profiles(display_name)").eq("household_id", id).is("left_at", null)
      .then(({ data }) => {
        const members: Member[] = ((data ?? []) as unknown as { user_id: string; profiles: { display_name: string } | null }[])
          .map((m) => ({ user_id: m.user_id, name: m.profiles?.display_name ?? "?" }))
          .sort((a, b) => (a.user_id === user.id ? -1 : b.user_id === user.id ? 1 : a.name.localeCompare(b.name)));
        if (!editId) {
          setRows(members.map((m) => ({ ...m, involved: false, amount: "" })));
          return;
        }
        db.from("assets").select("name, total_cents, purchase_date, visibility, receipt_path, photo_path, asset_participants(user_id, amount_cents)")
          .eq("id", editId).single().then(({ data: a, error }) => {
            if (error || !a) { setError("No se pudo cargar el bien para editarlo"); setRows([]); return; }
            setName(a.name); setPrice(centsToInput(a.total_cents)); setDate(a.purchase_date);
            setIsPrivate(a.visibility === "implicados");
            setExisting({ receipt: a.receipt_path, photo: a.photo_path });
            const parts = new Map((a.asset_participants as { user_id: string; amount_cents: number }[]).map((p) => [p.user_id, p.amount_cents]));
            setRows(members.map((m) => ({ ...m, involved: parts.has(m.user_id),
              amount: parts.has(m.user_id) && parts.get(m.user_id)! > 0 ? centsToInput(parts.get(m.user_id)!) : "" })));
          });
      });
  }, [user, id, editId]);

  const total = parseEuros(price);
  const involved = (rows ?? []).filter((r) => r.involved);
  const sum = involved.reduce((s, r) => s + (parseEuros(r.amount) ?? 0), 0);
  const badAmount = involved.some((r) => r.amount.trim() !== "" && parseEuros(r.amount) === null);
  const diff = total === null ? null : total - sum;
  const canSave = !!name.trim() && total !== null && total > 0 && diff === 0 && !badAmount && involved.length > 0 && !busy;

  const status = useMemo(() => {
    if (total === null || total <= 0) return null;
    if (badAmount) return { ok: false, text: "Hay una cantidad que no se entiende" };
    if (diff === 0) return { ok: true, text: "Cuadra con el total" };
    if (diff! > 0) return { ok: false, text: `Faltan ${formatEuros(diff!)} por repartir` };
    return { ok: false, text: `Sobran ${formatEuros(-diff!)}: la suma pasa del total` };
  }, [total, diff, badAmount]);

  function update(i: number, patch: Partial<Row>) {
    setRows((rs) => rs!.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  function allMine() {
    if (total === null || !rows) return;
    setRows(rows.map((r) => (r.user_id === user!.id ? { ...r, involved: true, amount: centsToInput(total) } : { ...r, amount: "" })));
  }

  function equal() {
    if (total === null || !rows) return;
    // Si solo hay una persona marcada (p. ej. después de "Lo pagué yo todo"), se reparte entre todos.
    const all = involved.length <= 1;
    const n = all ? rows.length : involved.length;
    const parts = splitEqual(total, n);
    let k = 0;
    setRows(rows.map((r) => (all || r.involved ? { ...r, involved: true, amount: centsToInput(parts[k++]) } : r)));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    setBusy(true); setError("");
    try {
      const [receiptPath, photoPath] = await Promise.all([
        receipt ? uploadPhoto(id, receipt) : Promise.resolve(existing.receipt),
        photo ? uploadPhoto(id, photo) : Promise.resolve(existing.photo),
      ]);
      const shares = involved.map((r) => ({ user_id: r.user_id, amount_cents: parseEuros(r.amount) ?? 0 }));
      const common = {
        p_name: name, p_total_cents: total, p_purchase_date: date, p_shares: shares,
        p_visibility: isPrivate && involved.length >= 2 ? "implicados" : "hogar", p_receipt_path: receiptPath, p_photo_path: photoPath,
      };
      const { error } = editId
        ? await supabase().rpc("update_asset", { p_asset: editId, ...common })
        : await supabase().rpc("create_asset", { p_household: id, ...common });
      if (error) throw error;
      router.replace(editId ? `/hogar/${id}/bien/${editId}` : `/hogar/${id}`);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  if (!rows) return <Loading />;
  const isPiso = kind === "piso";

  return (
    <main>
      <Link href={editId ? `/hogar/${id}/bien/${editId}` : `/hogar/${id}`} className="mb-4 inline-block py-2 text-sm font-medium text-muted">‹ Volver</Link>
      <form onSubmit={save} className="space-y-5">
        <Field label="¿Qué es?" value={name} onChange={(e) => setName(e.target.value)} required maxLength={120}
          placeholder="Sofá, nevera, coche…" autoFocus />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Precio total (€)" value={price} onChange={(e) => setPrice(e.target.value)} required
            inputMode="decimal" placeholder="0,00" />
          <Field label="Fecha de compra" type="date" value={date} onChange={(e) => setDate(e.target.value)} required max={today()} />
        </div>

        <section>
          <div className="mb-2 flex items-baseline justify-between">
            <p className="text-sm font-medium text-muted">¿Cuánto puso cada uno?</p>
          </div>
          <div className="mb-3 flex gap-2">
            <button type="button" onClick={allMine} disabled={total === null}
              className="rounded-full border border-line bg-card px-3 py-1.5 text-sm disabled:opacity-40">Lo pagué yo todo</button>
            <button type="button" onClick={equal} disabled={total === null}
              className="rounded-full border border-line bg-card px-3 py-1.5 text-sm disabled:opacity-40">A partes iguales</button>
          </div>
          <div className="divide-y divide-line rounded-2xl border border-line bg-card">
            {rows.map((r, i) => (
              <div key={r.user_id} className={`flex items-center gap-3 px-4 py-2.5 ${r.involved ? "" : "opacity-50"}`}>
                {(
                  <input type="checkbox" checked={r.involved} aria-label={`${r.name} participa`}
                    onChange={(e) => update(i, { involved: e.target.checked, amount: e.target.checked ? r.amount : "" })}
                    className="h-5 w-5 accent-[var(--brand)]" />
                )}
                <span className="flex-1 truncate">{r.name}{r.user_id === user?.id ? " (tú)" : ""}</span>
                <div className="flex items-center gap-1">
                  <input value={r.amount} onChange={(e) => update(i, { amount: e.target.value, involved: r.involved || e.target.value.trim() !== "" })}
                    inputMode="decimal" placeholder="0" aria-label={`Cuánto puso ${r.name}`}
                    className="w-24 rounded-lg border border-line bg-bg px-2 py-1.5 text-right outline-none focus:border-brand" />
                  <span className="text-muted">€</span>
                </div>
              </div>
            ))}
          </div>
          {total === null && <p className="mt-1 text-xs text-muted">Pon primero el precio total para poder repartirlo.</p>}
          <p className="mt-1 text-xs text-muted">Marca a quienes participan en esta compra: ellos la confirman. Si participa uno solo, la confirma el resto del hogar.</p>
          {status && (
            <p className={`mt-2 rounded-xl px-3 py-2 text-sm ${status.ok ? "bg-ok-bg text-ok" : "bg-warn-bg text-warn"}`}>
              {status.ok ? "✓ " : ""}{status.text}
            </p>
          )}
        </section>

        <section className="grid grid-cols-2 gap-3">
          <PhotoPicker label={existing.receipt && !receipt ? "Ticket guardado ✓ (toca para cambiar)" : "Foto del ticket"} file={receipt} onChange={pickReceipt} />
          <PhotoPicker label={existing.photo && !photo ? "Foto guardada ✓ (toca para cambiar)" : "Foto del objeto"} file={photo} onChange={setPhoto} />
        </section>
        {ocr && (
          <p className={`-mt-2 rounded-xl px-3 py-2 text-sm ${ocr.state === "ok" ? "bg-ok-bg text-ok" : "bg-line/60 text-muted"}`}>
            {ocr.state === "leyendo" ? "📄 Leyendo el ticket…"
              : ocr.state === "ok" ? `📄 He leído del ticket: ${ocr.text}. Revisa que esté bien.`
              : "📄 No he podido leer el ticket. Rellénalo a mano."}
          </p>
        )}
        {!receipt && !existing.receipt && <p className="-mt-3 text-xs text-muted">El ticket es opcional, pero recomendable. Si no lo pones, saldrá como “sin ticket”.</p>}

        {isPiso && (
          <label className="flex items-start gap-3 rounded-2xl border border-line bg-card p-4">
            <input type="checkbox" checked={isPrivate && involved.length >= 2} disabled={involved.length < 2}
              onChange={(e) => setIsPrivate(e.target.checked)}
              className="mt-0.5 h-5 w-5 accent-[var(--brand)]" />
            <span>
              <span className="block font-medium">Privado 🔒</span>
              <span className="block text-sm text-muted">{involved.length < 2
                ? "Necesita al menos 2 personas implicadas, para que alguien más lo confirme."
                : "Solo lo verán las personas que participan."}</span>
            </span>
          </label>
        )}

        <ErrorBox>{error}</ErrorBox>
        <div className="sticky bottom-0 -mx-4 bg-bg/95 px-4 py-3 backdrop-blur">
          <Button type="submit" disabled={!canSave}>{busy ? "Guardando…" : editId ? "Guardar cambios" : "Guardar"}</Button>
        </div>
      </form>
    </main>
  );
}

function PhotoPicker({ label, file, onChange }: { label: string; file: File | null; onChange: (f: File | null) => void }) {
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  return (
    <label className="relative flex aspect-square cursor-pointer flex-col items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed border-line bg-card text-center text-sm text-muted">
      {preview ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={preview} alt={label} className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <>
          <span className="text-2xl">📷</span>
          <span>{label}</span>
        </>
      )}
      <input type="file" accept="image/*" className="sr-only"
        onChange={(e) => onChange(e.target.files?.[0] ?? null)} />
      {file && (
        <button type="button" onClick={(e) => { e.preventDefault(); onChange(null); }}
          className="absolute right-2 top-2 rounded-full bg-black/60 px-2 text-white">✕</button>
      )}
    </label>
  );
}
