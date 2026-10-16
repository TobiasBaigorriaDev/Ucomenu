import type { Metadata } from "next";
import { LegalDocument, LegalSection } from "@/components/legal/legal-document";

export const metadata: Metadata = {
  title: "Aviso de alérgenos",
  description: "Qué tener en cuenta sobre la información de alérgenos e ingredientes que muestra la carta.",
};

export default function AllergenNoticePage() {
  return (
    <LegalDocument
      title="Aviso de alérgenos"
      intro="Si tenés una alergia, una intolerancia o seguís una dieta especial, leé esto antes de pedir."
    >
      <LegalSection title="1. Quién declara la información">
        <p>
          Los ingredientes, los alérgenos y las etiquetas dietarias de cada plato (por ejemplo, «sin gluten» o «vegetariano») los
          declara el local. UcoMenu solo muestra lo que el local cargó: no la verifica ni la analiza.
        </p>
      </LegalSection>

      <LegalSection title="2. Puede estar incompleta o desactualizada">
        <p>
          Las recetas, los proveedores y los ingredientes cambian. Es posible que la carta no refleje un cambio reciente, que
          falte un ingrediente o que un plato no tenga ninguna etiqueta. La ausencia de un aviso en un plato no significa que sea
          seguro para vos.
        </p>
      </LegalSection>

      <LegalSection title="3. Contaminación cruzada">
        <p>
          Aunque un plato no lleve un alérgeno entre sus ingredientes, puede haber entrado en contacto con él en la cocina (por
          los utensilios, las superficies o el aceite). Un plato etiquetado como apto para una dieta no garantiza la ausencia
          total de trazas.
        </p>
      </LegalSection>

      <LegalSection title="4. Qué te recomendamos">
        <ul>
          <li>Antes de pedir, avisale al personal de tu alergia o intolerancia y consultale por el plato.</li>
          <li>Ante cualquier duda, consultá antes de comer y no te guíes solo por la carta digital.</li>
          <li>Si tu alergia es grave, pedile al local que confirme cómo se prepara el plato.</li>
        </ul>
      </LegalSection>
    </LegalDocument>
  );
}
