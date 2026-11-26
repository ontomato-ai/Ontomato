import type { ProductPanelReadRequest, ProductPanelReadResponse } from "@ontomato/contracts/panel-host";
import type { PanelOperationActor } from "../product-panels/server-operations";
import {
  panelMemberReadRefusal, prepareProjectionDataRead, presentPanelMemberRead, projectionDataReadOutcome,
  readPanelMemberOperationDescriptions, readResolvedPanelOwner, resolveReadMember,
} from "../product-panels/data-reads";

/** The run's reader must still be admitted to the member before calling its owner. */
export async function readAssistantPanelMember(
  reader: PanelOperationActor, request: ProductPanelReadRequest, callerUserName?: string, retrievalScopeId?: string,
): Promise<ProductPanelReadResponse> {
  try {
    const resolved = await resolveReadMember(reader.owner, reader.credentials, request);
    const placement = { ...resolved, slot: request.memberPath.at(-1)!.member };
    const actor = { owner: reader.owner, credentials: resolved.viewer };
    if ("operations" in request) {
      const path = resolved.javaPath;
      const actionScope = path && retrievalScopeId !== undefined ? { path, retrievalScopeId } : undefined;
      return await readPanelMemberOperationDescriptions(actor, placement, resolved.inputs, actionScope);
    }
    const { selection, params, declaration, inputs } = await prepareProjectionDataRead(
      resolved.viewer, placement, request.dataName, resolved.inputs, request.runtimeParams,
    );
    const value = await readResolvedPanelOwner(
      { owner: reader.owner, viewer: resolved.viewer, callerUserName }, selection, params, resolved.projection,
      resolved.javaPath, retrievalScopeId,
    );
    return await presentPanelMemberRead(actor, placement, request.dataName, inputs, projectionDataReadOutcome(declaration, value));
  } catch (error) {
    const refusal = panelMemberReadRefusal(error);
    if (refusal) return refusal;
    throw error;
  }
}
