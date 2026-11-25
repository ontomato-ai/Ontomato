import { z } from "zod";
import { sandboxCapabilitySchema, type SandboxCapability } from "@ontomato/contracts/data-adapters";
import type { PanelFieldTone } from "@ontomato/contracts/panel-projection";
import { tForLocale } from "../../i18n";
import { ownerEnvelopeSchema, ownerPost, ownerWriteFailure } from "./data-query-operations";
import type { PanelOperationHost, SinglePanelOperationOutcome } from "./server-operations";

const tones = {
  passed: "success",
  failed: "danger",
  unsupported: "info",
  unchecked: "warning",
} satisfies Record<SandboxCapability["status"], PanelFieldTone>;

export const sandboxPermissionResultSchema = z.object({ sandboxCapability: sandboxCapabilitySchema }).strict();

export function sandboxPermissionPresentation(
  capability: Pick<SandboxCapability, "status" | "reason">, locale?: string,
) {
  return {
    status: tForLocale(locale, `panels.dataAdapters.sandbox.${capability.status}`),
    detail: tForLocale(locale, `panels.dataAdapters.sandbox.${capability.status}Detail`, { reason: capability.reason }),
    tone: tones[capability.status],
  };
}

export async function checkSandboxPermission(
  host: Pick<PanelOperationHost, "request" | "locale">, objectTypes: string[],
): Promise<SinglePanelOperationOutcome> {
  const envelope = await ownerPost(host, "/businessConfig/checkSandboxPermission", {}, ownerEnvelopeSchema);
  if (!envelope.success) {
    return ownerWriteFailure(envelope, "SANDBOX_CHECK_FAILED",
      tForLocale(host.locale, "panels.dataAdapters.sandbox.checkFailed"));
  }
  return {
    kind: "success",
    data: sandboxPermissionResultSchema.parse(envelope.data),
    affected: { objects: [], objectTypes },
  };
}
