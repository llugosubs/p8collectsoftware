import { getTranslations } from "next-intl/server";

import { Card, CardContent } from "@/components/ui/card";

/**
 * Marca de "todavía no existe". Cada módulo del panel tiene su ruta viva desde la
 * Fase 0 para poder recorrer la navegación completa en el teléfono; el contenido
 * llega en la fase que indica cada página.
 */
export async function ModulePlaceholder({
  title,
  description,
  phase,
}: {
  title: string;
  description: string;
  phase: string;
}) {
  const t = await getTranslations("common");

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="text-muted-foreground mt-2">{description}</p>

      <Card className="mt-8 border-dashed">
        <CardContent className="py-8">
          <p className="text-sm font-medium">{t("underConstruction")}</p>
          <p className="text-muted-foreground mt-1 text-sm">
            {t("underConstructionBody", { phase })}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
