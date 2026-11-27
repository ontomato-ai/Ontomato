import { runtimeJsonObjectSchema } from "@ontomato/contracts/agent-runtime-values";
import type { ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import type { PanelOwnerOperationDescriptor } from "@ontomato/contracts/panel-operations";
import type { AssistantCredentials } from "../../utils/assistant-credentials";
import { actionDescriptionRead, planDescription, prepareOperationDescriptions } from "./direct-operations";
import type { JavaPanelReadResult, JavaPanelViewer } from "./java-panel-reads";
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
  const descriptions = await Promise.all(prepareOperationDescriptions(placement, inputs, locale).map(
    async (description): Promise<PlannedDescription> => {
      const { name, target } = description;
      if (description.kind === "action") {
        const action = actionDescriptionRead(description.action);
        return {
          name, reads: [action.read],
          present: async ([result]) => {
            const descriptor = action.present(result!);
            return descriptor && { ...descriptor, target };
          },
        };
      }
      const { handler, calls } = description;
      const planned = await planDescription(context, handler, calls,
        inputSchema => describeServerOperation(handler, locale, placement.slot, target, inputSchema));
      return { name, ...planned };
    }));
  return {
    reads: descriptions.flatMap(({ reads }) => reads),
    async present(results: readonly JavaPanelReadResult[]): Promise<ProductPanelReadResponse> {
      let index = 0;
      const entries = [];
      for (const { name, reads, present } of descriptions) {
        const descriptor = await present(results.slice(index, index += reads.length));
        if (descriptor) entries.push([name, descriptor] as const);
      }
      return { status: "ready", value: runtimeJsonObjectSchema.parse(Object.fromEntries(entries)) };
    },
  };
}
