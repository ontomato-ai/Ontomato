import type { ProductPanelReadRequest, ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import type { PanelOperationActor } from "../product-panels/server-operations";
import { prepareRegisteredDataReads, runPreparedDataReads } from "../product-panels/registered-read-plan";

/** The run's reader is admitted to the registered member and then reads through the same batch as a formal page. */
export async function readAssistantPanelMember(
  reader: PanelOperationActor, request: ProductPanelReadRequest,
): Promise<ProductPanelReadResponse> {
  const prepared = await prepareRegisteredDataReads(reader.credentials, [request], { owner: reader.owner });
  const [response] = await runPreparedDataReads(reader.credentials, prepared);
  return response!;
}
