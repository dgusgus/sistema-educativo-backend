-- Periodos de cobro: un concepto puede ser único, mensual o trimestral y pertenecer a un trimestre.
CREATE TYPE "Periodicidad" AS ENUM ('UNICO', 'MENSUAL', 'TRIMESTRAL');

ALTER TABLE "ConceptoPago"
  ADD COLUMN "periodicidad" "Periodicidad" NOT NULL DEFAULT 'UNICO',
  ADD COLUMN "trimestreId" INTEGER;

CREATE INDEX "ConceptoPago_trimestreId_idx" ON "ConceptoPago"("trimestreId");

ALTER TABLE "ConceptoPago"
  ADD CONSTRAINT "ConceptoPago_trimestreId_fkey"
  FOREIGN KEY ("trimestreId") REFERENCES "Trimestre"("id") ON DELETE SET NULL ON UPDATE CASCADE;
