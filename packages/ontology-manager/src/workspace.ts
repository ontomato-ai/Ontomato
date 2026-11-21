export type AssetTab = "metrics" | "functions";
export type ModelResource = "objects" | "attributes";

export interface OntologyResourceCounts {
  objects: number | null;
  attributes: number | null;
  relations: number | null;
  metrics: number | null;
  functions: number | null;
  products: number | null;
}

export const emptyOntologyResourceCounts = (): OntologyResourceCounts => ({
  objects: null,
  attributes: null,
  relations: null,
  metrics: null,
  functions: null,
  products: null,
});
