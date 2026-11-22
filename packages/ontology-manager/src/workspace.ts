/**
 * The counts of the Manager's native pages, read the way those pages read their lists. A panel entry's count is its
 * entry's own declaration (`count`), read as its page reads it; these give way to it as the pages become entries.
 */
export interface OntologyResourceCounts {
  products: number | null;
}

export const emptyOntologyResourceCounts = (): OntologyResourceCounts => ({
  products: null,
});
