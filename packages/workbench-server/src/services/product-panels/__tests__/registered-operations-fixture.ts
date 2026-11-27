import type { PanelOwnerOperationDescriptor } from "@ontomato/contracts/panel-operations";
import { readDirect } from "../operation-availability";
import { prepareRegisteredOperationRead } from "../registered-operation-reads";
import type { PanelOperationActor } from "../server-operations";

/** Execute the registered operation-read plan directly, as a candidate or other unregistered placement does. */
export async function readRegisteredProjectionOperations(
  actor: PanelOperationActor,
  placement: Parameters<typeof prepareRegisteredOperationRead>[0],
  inputs: Record<string, unknown>,
): Promise<Record<string, PanelOwnerOperationDescriptor>> {
  const plan = await prepareRegisteredOperationRead(placement, inputs, actor.owner, actor.credentials);
  const [results] = await readDirect(
    { owner: actor.owner, credentials: actor.credentials, locale: actor.credentials.locale },
    [{ reads: plan.reads }],
  );
  const response = await plan.present(results!);
  if (response.status !== "ready") throw new Error(`Expected ready operation descriptions, got ${response.status}`);
  return response.value as unknown as Record<string, PanelOwnerOperationDescriptor>;
}
