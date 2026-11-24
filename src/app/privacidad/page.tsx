import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";
import { CONTACT_EMAIL } from "@/lib/legal";

export const metadata: Metadata = { title: "Privacidad · Home Divide" };

export default function Privacidad() {
  return (
    <LegalPage title="Política de privacidad">
      <section>
        <p>
          Home Divide (Ho-DiApp) es una app para apuntar quién ha pagado cada cosa de un hogar compartido. Aquí te contamos,
          sin letra pequeña, qué datos guardamos y para qué.
        </p>
      </section>
      <section>
        <h2>Quién es el responsable</h2>
        <p>El creador de Home Divide. Puedes escribirnos a <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.</p>
      </section>
      <section>
        <h2>Qué datos guardamos</h2>
        <ul>
          <li>Tu correo y tu nombre (si entras con Google, los que nos da Google; nada más).</li>
          <li>Los hogares que creas o a los que te unes.</li>
          <li>Lo que apuntáis: bienes, importes, fechas, pagos recurrentes, fotos y tickets que subáis.</li>
          <li>Quién confirma o rechaza cada cosa y cuándo.</li>
        </ul>
      </section>
      <section>
        <h2>Para qué los usamos</h2>
        <p>
          Solo para que la app funcione: enseñaros el inventario, pedir confirmaciones y generar los resúmenes en PDF.
          No vendemos tus datos, no hay publicidad y no los usamos para nada más.
        </p>
      </section>
      <section>
        <h2>Quién los ve</h2>
        <p>
          Los miembros de tu hogar ven lo que se apunta en él. Lo que marquéis como privado solo lo ven las personas implicadas.
          Si alguien sale del hogar, sigue pudiendo consultar lo que se apuntó mientras estaba dentro.
        </p>
      </section>
      <section>
        <h2>Dónde se guardan</h2>
        <ul>
          <li>Supabase (base de datos y fotos), en servidores de la Unión Europea (Irlanda).</li>
          <li>Vercel, que sirve la web.</li>
          <li>Google, solo si eliges entrar con tu cuenta de Google.</li>
        </ul>
      </section>
      <section>
        <h2>Cuánto tiempo</h2>
        <p>Mientras tengas cuenta. Si nos pides borrarla, eliminamos tus datos personales.</p>
      </section>
      <section>
        <h2>Tus derechos</h2>
        <p>
          Puedes pedirnos ver, corregir, descargar o borrar tus datos escribiendo a{" "}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. Si no te respondemos bien, puedes reclamar ante la
          Agencia Española de Protección de Datos (aepd.es).
        </p>
      </section>
      <section>
        <h2>Importante</h2>
        <p>
          Los resúmenes y PDFs de Home Divide son informativos: recogen lo que los miembros han apuntado y confirmado.
          No tienen validez legal ni sustituyen a ningún documento oficial.
        </p>
      </section>
    </LegalPage>
  );
}
