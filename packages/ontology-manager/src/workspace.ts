export interface OntologyResourceCounts {
  objects: number | null;
  attributes: number | null;
  relations: number | null;
  products: number | null;
}

export const emptyOntologyResourceCounts = (): OntologyResourceCounts => ({
  objects: null,
  attributes: null,
  relations: null,
  products: null,
});
