import { assistantStore, type AssistantOwner } from "./store";

/** A report link belongs to the window recorded for this run. */
export async function governanceReportHref(runId: string, owner: AssistantOwner) {
  const recordId = await assistantStore.governanceWindow(runId, owner);
  return recordId ? `/governance/reports/${recordId}` : null;
}
