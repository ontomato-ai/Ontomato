export type AssetTab = "metrics";

export interface OntologyResourceCounts {
  objects: number | null;
  attributes: number | null;
  relations: number | null;
  metrics: number | null;
  products: number | null;
}

export const emptyOntologyResourceCounts = (): OntologyResourceCounts => ({
  objects: null,
  attributes: null,
  relations: null,
  metrics: null,
  products: null,
});
