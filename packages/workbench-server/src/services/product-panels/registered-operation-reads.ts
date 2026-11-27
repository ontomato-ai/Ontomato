import { runtimeJsonObjectSchema } from "@ontomato/contracts/agent-runtime-values";
import type { ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import type { PanelOwnerOperationDescriptor } from "@ontomato/contracts/panel-operations";
import type { AssistantCredentials } from "../../utils/assistant-credentials";
import { actionDefinitionsRead, planDescription, prepareOperationDescriptions, presentActionDefinitions } from "./direct-operations";
import type { JavaPanelReadResult, JavaPanelViewer } from "./java-panel-reads";
import { readyPayload } from "./registered-data-read";
import type { RegisteredDataReadItem } from "./registered-data-read";
import { describeServerOperation } from "./server-operations";

interface PlannedDescription {
  name: string;
  reads: readonly RegisteredDataReadItem[];
  present(results: readonly JavaPanelReadResult[]): Promise<PanelOwnerOperationDescriptor | undefined>;
}

/** A formal page's operation descriptions: every fact they need joins the page's second read. */
export async function prepareRegisteredOperationRead(
  placement: Parameters<typeof prepareOperationDescriptions>[0], inputs: Record<string, unknown>, viewer: JavaPanelViewer,
  credentials: AssistantCredentials,
) {
  const { locale } = credentials;
  const context = { owner: viewer, credentials, locale };
  const descriptions = prepareOperationDescriptions(placement, inputs, locale);
  const actions = descriptions.flatMap(description => description.kind === "action" ? [description] : []);
  const actionRead = actions.length ? [actionDefinitionsRead(actions)] : [];
  const platformDescriptions = await Promise.all(descriptions.map(async description => {
    if (description.kind === "action") return undefined;
    const { name, target, handler, calls } = description;
    const planned = await planDescription(context, handler, calls,
      inputSchema => describeServerOperation(handler, locale, placement.slot, target, inputSchema));
    return { name, ...planned } satisfies PlannedDescription;
  }));
  return {
    reads: [...actionRead, ...platformDescriptions.flatMap(description => description?.reads ?? [])],
    async present(results: readonly JavaPanelReadResult[]): Promise<ProductPanelReadResponse> {
      const actionEntries = actions.length
        ? presentActionDefinitions(readyPayload(results[0]).payload, actions)
        : new Map<string, PanelOwnerOperationDescriptor>();
      let index = actionRead.length;
      const entries = [];
      for (const [position, description] of descriptions.entries()) {
        if (description.kind === "action") {
          const descriptor = actionEntries.get(description.name);
          if (descriptor) entries.push([description.name, descriptor] as const);
          continue;
        }
        const planned = platformDescriptions[position]!;
        const descriptor = await planned.present(results.slice(index, index += planned.reads.length));
        if (descriptor) entries.push([planned.name, descriptor] as const);
      }
      return { status: "ready", value: runtimeJsonObjectSchema.parse(Object.fromEntries(entries)) };
    },
  };
}
