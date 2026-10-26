import type { Metadata } from "next";
import Link from "next/link";
import { LegalDocument, LegalSection } from "@/components/legal/legal-document";

export const metadata: Metadata = {
  title: "Aviso de alérgenos",
  description: "Qué tener en cuenta sobre las etiquetas dietarias que muestra la carta y por qué conviene consultar al personal antes de pedir.",
};

export default function AllergenNoticePage() {
  return (
    <LegalDocument
      title="Aviso de alérgenos"
      intro="Si tenés una alergia, una intolerancia, celiaquía o seguís una dieta especial, leé esto antes de pedir y consultá siempre al personal."
    >
      <LegalSection title="1. Qué muestra la carta y qué no">
        <p>
          La carta <strong>no muestra los ingredientes ni los alérgenos de cada plato</strong>. Lo único que puede mostrar son
          etiquetas dietarias («Sin TACC», «Vegano» y «Vegetariano») que el local marca en los platos que él mismo considera que
          las cumplen.
        </p>
      </LegalSection>

      <LegalSection title="2. Un plato sin etiqueta no está declarado como apto">
        <p>
          Que un plato no tenga etiqueta significa que el local no declaró nada sobre él. <strong>No significa que contenga o
          que no contenga un alérgeno</strong>, ni que sea apto o no apto para vos. Del mismo modo, si filtrás por una etiqueta y
          no aparece un plato, puede que el local simplemente no lo haya etiquetado: preguntale al personal qué opciones tiene.
        </p>
      </LegalSection>

      <LegalSection title="3. Quién declara la información">
        <p>
          Las etiquetas las declara el local y no son una certificación. UcoMenu muestra lo que el local cargó: no lo verifica, no
          lo analiza ni lo certifica. Las recetas, los proveedores y los ingredientes cambian: es posible que la carta no refleje
          un cambio reciente o que una etiqueta esté desactualizada.
        </p>
      </LegalSection>

      <LegalSection title="4. Contaminación cruzada">
        <p>
          Aunque un plato no lleve un alérgeno entre sus ingredientes, puede haber entrado en contacto con él en la cocina (por
          los utensilios, las superficies, el horno o el aceite). Una etiqueta como «Sin TACC» o «Vegano» no garantiza por sí sola
          que no haya trazas ni contacto con otros ingredientes durante la preparación.
        </p>
      </LegalSection>

      <LegalSection title="5. Variantes y adicionales">
        <p>
          Las etiquetas se declaran sobre el plato. Las variantes y los adicionales que se pueden elegir (por ejemplo, un extra de
          queso) pueden cambiar lo que declara la etiqueta. Si un plato tiene opciones, consultá al personal cuáles mantienen la
          etiqueta.
        </p>
      </LegalSection>

      <LegalSection title="6. Qué te recomendamos">
        <ul>
          <li>Antes de pedir, avisale al personal de tu alergia o intolerancia y consultale por el plato y su preparación.</li>
          <li>Ante cualquier duda, consultá antes de comer y no te guíes solo por la carta digital.</li>
          <li>Si tu alergia es grave, pedile al local que confirme cómo se prepara el plato.</li>
          <li>
            Si ves una etiqueta que te parece incorrecta, avisá al personal y reportalo como explican los{" "}
            <Link href="/terminos" className="underline underline-offset-2">
              términos de uso
            </Link>
            .
          </li>
        </ul>
      </LegalSection>
    </LegalDocument>
  );
}
