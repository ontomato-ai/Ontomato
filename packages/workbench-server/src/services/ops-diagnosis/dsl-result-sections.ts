import type {
  PanelReadOperationSection,
  PanelReadOperationSectionDeclaration,
} from "@ontomato/contracts/panel-operations";

export interface DslResultSectionContext {
  /** Normalized payload returned by the backend DSL execution endpoint. */
  readonly payload: unknown;
  /** Reader's resolved locale for localized section labels and empty states. */
  readonly locale?: string;
}

export interface DslResultSectionProvider {
  describe(locale?: string): PanelReadOperationSectionDeclaration;
  build(context: DslResultSectionContext): PanelReadOperationSection;
}

const providers = new Set<DslResultSectionProvider>();

/**
 * Registers a server-side provider that appends extra read-only result sections between the tabular data section
 * and the raw JSON response section of `dslQuery.execute`. Returns an unregister callback.
 */
export function registerDslResultSectionProvider(provider: DslResultSectionProvider): () => void {
  providers.add(provider);
  return () => {
    providers.delete(provider);
  };
}

export function describeDslResultSections(locale?: string): PanelReadOperationSectionDeclaration[] {
  return [...providers].map(provider => provider.describe(locale));
}

export function collectDslResultSections(context: DslResultSectionContext): PanelReadOperationSection[] {
  return [...providers].map(provider => provider.build(context));
}
