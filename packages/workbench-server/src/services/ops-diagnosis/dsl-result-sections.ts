import {
  panelReadOperationSectionSchema,
  type PanelReadOperationSection,
} from "@ontomato/contracts/panel-operations";

export interface DslResultSectionContext {
  /** Normalized payload returned by the backend DSL execution endpoint. */
  readonly payload: unknown;
  /** Reader's resolved locale for localized section labels and empty states. */
  readonly locale?: string;
}

export type DslResultSectionProvider = (
  context: DslResultSectionContext,
) => PanelReadOperationSection | readonly PanelReadOperationSection[] | null | undefined;

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

/** Evaluates all registered DSL result section providers in registration order. */
export function collectDslResultSections(context: DslResultSectionContext): PanelReadOperationSection[] {
  const extra: PanelReadOperationSection[] = [];
  for (const provider of providers) {
    const produced = provider(context);
    if (!produced) continue;
    const list = Array.isArray(produced) ? produced : [produced];
    for (const section of list) {
      if (!section) continue;
      extra.push(panelReadOperationSectionSchema.parse(section));
    }
  }
  return extra;
}
