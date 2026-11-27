import type { JavaPanelReadResult } from "../java-panel-reads";
import { planAvailability } from "../operation-availability";
import type { RegisteredDataReadItem } from "../registered-data-read";
import type {
  PanelOperationAvailabilityTarget, PanelOperationFactsContext, PanelOperationInputForm, PanelServerOperation,
} from "../server-operations";

export const readerContext: PanelOperationFactsContext = {
  owner: { domainId: "d", userId: "U" }, credentials: { token: "U-token", locale: "en" }, locale: "en",
};

export const ready = (payload: unknown, visibility?: Extract<JavaPanelReadResult, { status: "ready" }>["visibility"]): JavaPanelReadResult =>
  ({ status: "ready", payload, ...(visibility && { visibility }) });

/**
 * An operation's refusals for the targets as the platform decides them, its Java reads answered by `answer`; also the
 * reads it asked for.
 */
export async function refusalsOf(
  operation: PanelServerOperation, targets: readonly PanelOperationAvailabilityTarget[],
  answer: (item: RegisteredDataReadItem) => JavaPanelReadResult,
  { context = readerContext, params = {} }: { context?: PanelOperationFactsContext; params?: Record<string, unknown> } = {},
) {
  const plan = await planAvailability(operation.availability!, context, { from: "targets", targets });
  const refusals = await plan.refuse(plan.reads.map(answer), targets.map(target => ({ target, params })));
  return { refusals, reads: plan.reads };
}

/** An operation's input form schema, its Java reads answered by `answer`. */
export function inputSchemaOf(form: PanelOperationInputForm, answer: (item: RegisteredDataReadItem) => JavaPanelReadResult, locale?: string) {
  return form.schema(form.reads.map(answer), locale);
}
