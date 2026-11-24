import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";
import { CONTACT_EMAIL } from "@/lib/legal";

export const metadata: Metadata = { title: "Condiciones · Home Divide" };

export default function Condiciones() {
  return (
    <LegalPage title="Condiciones de uso">
      <section>
        <h2>Qué es Home Divide</h2>
        <p>
          Una app gratuita, todavía en fase de prueba, para apuntar quién ha pagado cada cosa de un hogar compartido
          y que lo confirmen las personas implicadas.
        </p>
      </section>
      <section>
        <h2>Lo que apuntas es cosa tuya</h2>
        <p>
          Cada persona es responsable de que lo que apunta sea verdad. Home Divide no comprueba los importes ni los tickets:
          solo guarda lo que apuntáis y quién lo ha confirmado.
        </p>
      </section>
      <section>
        <h2>Sin validez legal</h2>
        <p>
          Los resúmenes y PDFs son informativos. No tienen validez legal, no son un contrato ni sustituyen a ningún documento
          oficial. Cómo os repartís las cosas lo decidís vosotros.
        </p>
      </section>
      <section>
        <h2>Uso correcto</h2>
        <ul>
          <li>No subas contenido ilegal ni datos de otras personas sin su permiso.</li>
          <li>No intentes acceder a hogares de los que no eres miembro.</li>
        </ul>
      </section>
      <section>
        <h2>Fase de prueba</h2>
        <p>
          La app puede cambiar, tener errores o dejar de estar disponible. Te recomendamos descargar el PDF de vez en cuando.
          Haremos lo posible por no perder datos, pero no podemos garantizarlo.
        </p>
      </section>
      <section>
        <h2>Contacto</h2>
        <p>Para cualquier duda: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.</p>
      </section>
    </LegalPage>
  );
}
