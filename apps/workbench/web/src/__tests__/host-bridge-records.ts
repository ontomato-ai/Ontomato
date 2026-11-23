import { APP_BRIDGE_CHANNEL } from "@ontomato/contracts/app-bridge";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import { productPanelSchema, productProjectionSchema, type ProductPanel, type ProductProjection } from "@ontomato/contracts/product-panels";

/*
 * Records and the frame's end of the bridge for the host bridge's own tests: a code panel's record whose members place
 * projections, and projections as Node answers them, each checked by the contract's own schema.
 */

const current = {
  domainId: "domain-1",
  ownerId: "owner-1",
  revision: 1,
  createdAt: "2026-11-21T00:00:00.000Z",
  updatedAt: "2026-11-21T00:00:00.000Z",
  editable: false,
  visibility: "domain" as const,
};

type ProjectionFields = Pick<ProductProjection, "id" | "componentId" | "data"> & Partial<Pick<ProductProjection, "inputs" | "conversationEntry" | "operations" | "config">>
  & { metricId?: string };

/** A projection's current record as Node answers it; a chart's also names its source card and metric. */
export const projectionRecord = ({ inputs = {}, ...fields }: ProjectionFields): ProductProjection =>
  productProjectionSchema.parse({ ...current, name: fields.id, description: "", outputs: {}, config: {}, inputs, ...fields });

/** A code panel's current record (it runs in a frame) whose members each place the given projection. */
export function codePanelRecord(id: string, members: Record<string, string>): ProductPanel {
  const manifest = definePanel({
    state: {},
    members: Object.fromEntries(Object.entries(members).map(([member, projectionId]) => [member, { target: { projectionId } }])),
  });
  return productPanelSchema.parse({
    ...current, id, name: id, description: id, content: { html: '<div id="app"></div>', module: "" }, manifest,
  });
}

/** The frame's end of the bridge: one call per operation, answered with its result or refused with its error. */
export function connectBridge() {
  const channel = new MessageChannel();
  window.parent.postMessage({ channel: APP_BRIDGE_CHANNEL, operation: "connect" }, "*", [channel.port2]);
  channel.port1.start();
  let calls = 0;
  return (operation: string, payload?: unknown) =>
    new Promise<unknown>((resolve, reject) => {
      const id = `call-${++calls}`;
      const listener = (event: MessageEvent) => {
        if (event.data?.id !== id) return;
        channel.port1.removeEventListener("message", listener);
        if (event.data.error) reject(new Error(event.data.error));
        else resolve(event.data.result);
      };
      channel.port1.addEventListener("message", listener);
      channel.port1.postMessage({ channel: APP_BRIDGE_CHANNEL, id, operation, payload });
    });
}
