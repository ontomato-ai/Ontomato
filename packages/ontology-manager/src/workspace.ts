export type AssetTab = "metrics" | "actions" | "functions";
export type ModelResource = "objects" | "attributes" | "relations";

export interface OntologyResourceCounts {
  objects: number | null;
  attributes: number | null;
  relations: number | null;
  metrics: number | null;
  actions: number | null;
  functions: number | null;
}

export const emptyOntologyResourceCounts = (): OntologyResourceCounts => ({
  objects: null,
  attributes: null,
  relations: null,
  metrics: null,
  actions: null,
  functions: null,
});
