import type { ProductPanelResponse } from "@ontomato/contracts/product-panels";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";
import type { ProductOwner } from "../product-governance/grants";
import { validateProjectionComponent } from "./component-catalogue";
import { readCurrentProjectionRecords } from "./current";

export async function readBundledPanelProjections(
  owner: ProductOwner, credentials: AssistantCredentials, ids: readonly string[],
): Promise<NonNullable<ProductPanelResponse["projections"]>> {
  if (!ids.length) return {};
  const loaded = await readCurrentProjectionRecords(owner, credentials, ids);
  const entries = await Promise.all([...loaded].map(async ([id, item]) => {
    try {
      if (!item.ok) throw item.error;
      const { projection } = item;
      const domainComponent = await validateProjectionComponent(
        id, projection, undefined, { domainId: projection.domainId, credentials },
      );
      return [id, { status: "ready", projection, ...(domainComponent && { domainComponent }) }] as const;
    } catch (error) {
      if (error instanceof HttpError && (error.status === 403 || error.status === 404)) {
        return [id, { status: "unavailable", httpStatus: error.status, message: error.message }] as const;
      }
      // A broken component is reported by its own render request.
      if (error instanceof HttpError && error.status === 400) return undefined;
      throw error;
    }
  }));
  return Object.fromEntries(entries.filter(entry => entry !== undefined));
}
