import { productProjectionRenderResponseSchema } from "@ontomato/contracts/product-panels";
import { COMPONENT_PACKAGES_PATH, componentPackageResponseSchema, type ComponentPackageResponse } from "@ontomato/contracts/component-packages";
import { PanelMemberUnavailable } from "./direct";
import type { PlatformRequests } from "./platform-objects";
import { PANEL_MEMBER_RENDER_HEADER, productPanelReadResponseSchema, type ProductPanelReadRequest, type ProductPanelReadResponse } from "@ontomato/contracts/panel-host";

/*
 * The platform requests a panel instance makes for itself, as the reader, whether it runs in a frame (over the bridge)
 * or in the platform's own document (over the platform's request path): one implementation of each.
 */

/**
 * Reads one named datum of one of the panel's members through the platform's read entry, as the reader. The frame says
 * which member and datum and with what values; the host fills in which panel this is, and the owner's answer comes back
 * as the read entry gives it (ready, empty, forbidden or an error).
 */
export async function readPanelData(requests: PlatformRequests, request: Omit<ProductPanelReadRequest, "source">): Promise<ProductPanelReadResponse> {
  const response = await requests.request("/product-panels/read", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request),
  }, "");
  const body = await response.json();
  if (!response.ok) {
    const error = new Error(body.error?.message ?? body.message ?? "The panel's data could not be read") as Error & {
      code?: string;
      status?: number;
    };
    const code = body.error?.code ?? body.code;
    if (typeof code === "string" && code.length > 0) error.code = code;
    error.status = response.status;
    throw error;
  }
  return productPanelReadResponseSchema.parse(body);
}

/** Reads a projection's current record by ID; the caller checks it as the record it expects. */
async function requestProjection(requests: PlatformRequests, id: string, rendering: boolean) {
  const response = await requests.request(`/product-projections/${encodeURIComponent(id)}`, {
    ...(rendering && { headers: { [PANEL_MEMBER_RENDER_HEADER]: "1" } }),
  }, "");
  const body = await response.json();
  if (!response.ok) {
    const message = body.error?.message ?? `Projection ${id} is unavailable`;
    // The reader may not use it, or it is not there: the member that places it says so in its own place.
    if (response.status === 403 || response.status === 404) throw new PanelMemberUnavailable(response.status, message);
    throw new Error(message);
  }
  return body;
}

export async function readProjectionRecord(requests: PlatformRequests, id: string): Promise<unknown> {
  return (await requestProjection(requests, id, false)).projection;
}

export async function readProjectionForRender(requests: PlatformRequests, id: string) {
  return productProjectionRenderResponseSchema.parse(await requestProjection(requests, id, true));
}

/** An installed component package's current release and declarations, as the reader may read them. */
export async function readComponentPackage(requests: PlatformRequests, name: string): Promise<ComponentPackageResponse> {
  const response = await requests.request(`${COMPONENT_PACKAGES_PATH.replace(/^\/api/u, "")}/${encodeURIComponent(name)}`, {}, "");
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? `Component package ${name} is unavailable`);
  return componentPackageResponseSchema.parse(body);
}
