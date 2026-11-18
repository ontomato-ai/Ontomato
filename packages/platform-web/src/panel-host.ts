import { ApiRequestError, nodeApiRequest } from "@ontomato/workbench-ui";
import { applicationPanelUsesResponseSchema, productPanelSchema, type ProductPanel } from "@ontomato/contracts/product-panels";
import { appsSdkCurrentSchema } from "@ontomato/contracts/apps-sdk";
import { panelSubscriptionFrameSchema, type PanelSubscriptionEvent, type PanelSubscriptionSnapshot } from "@ontomato/contracts/product-subscriptions";
import { readSseData } from "@ontomato/contracts/sse";
import { ElMessage } from "element-plus";
import { registerPanelFrame } from "./app-host";
import type { PanelHostPort } from "@ontomato/platform-shell";

/*
 * The platform's panel host (overall design 3.4): the two reads a panel instance needs and the notices it listens to.
 *
 * - A use relation is Java's (`GET /platform/applications/:applicationId/panel-uses`); the application and its
 *   permissions stay there.
 * - A panel's current record is Node's (`GET /api/product-panels/:id`), read outside the frame under the reader's own
 *   credential; a projection's record is read inside the frame by the projection itself.
 * - Node's product subscription streams definition and object identities. The reader reads current data from its owner.
 */

/**
 * The addresses the panel host reads, each at its own owner. Java answers the use relations, under the gateway's
 * data-query prefix; Node answers panels, subscriptions and the SDK's current version, at `/api` with no such prefix. They
 * are named here once, and a test asserts them, because an address assembled from the wrong owner's habit is a 403 that
 * looks like a permission problem.
 */
export const panelHostPaths = {
  appsSdkCurrent: "/api/apps-sdk/current",
  applicationPanelUses: (applicationId: string) =>
    `/api/data-query/platform/applications/${encodeURIComponent(applicationId)}/panel-uses`,
  panel: (panelId: string) => `/api/product-panels/${encodeURIComponent(panelId)}`,
  subscriptions: "/api/product-assets/subscriptions",
};

async function json(path: string, init: RequestInit = {}) {
  const response = await nodeApiRequest(path, init);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? `Request failed: ${path}`);
  return body;
}

/** The platform's panel host, for the application whose page is showing a panel. */
export function platformPanelHost(applicationId: string): PanelHostPort {
  return {
    applicationId: () => applicationId,
    async uses(id) {
      return panelUsesOf(id);
    },
    async panel(panelId) {
      return productPanelSchema.parse((await json(panelHostPaths.panel(panelId))).panel) as ProductPanel;
    },
    async sdkBase() {
      return appsSdkCurrentSchema.parse(await json(panelHostPaths.appsSdkCurrent)).sdkBasePath;
    },
    // The frame is this application's: the address the reader is on names it, and a panel shown beside a conversation is
    // the same application's page. Registering it under that ID is what lets the bridge recognise the frame and answer
    // its `connect`, and what keeps a frame of another application from being mistaken for this one. What it may ask for
    // is what the panel's record declares, for this use relation's page.
    frame: (frame, use, panel) => registerPanelFrame(frame, applicationId, { pageKey: use.pageKey, manifest: panel.manifest }),
    subscribe: subscribePanelDefinition,
  };
}

/** One application's use relations, as Java declares them; the app's entry and its page skills belong to them. */
export async function panelUsesOf(applicationId: string) {
  const answer = await json(panelHostPaths.applicationPanelUses(applicationId));
  return applicationPanelUsesResponseSchema.parse(answer.data ?? answer).panelUses;
}

class PanelStreamContractError extends Error {}

/** Follow the panel stream for as long as the reader keeps the instance open. */
function subscribePanelDefinition(
  panelId: string,
  listener: (event: PanelSubscriptionEvent) => void,
  recover: (snapshot: PanelSubscriptionSnapshot) => Promise<void>,
): () => void {
  const stream = new AbortController();
  async function watch() {
    let reconnecting = false;
    while (!stream.signal.aborted) {
      try {
        const response = await nodeApiRequest(panelHostPaths.subscriptions, {
          method: "POST",
          signal: stream.signal,
          headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
          body: JSON.stringify({ kind: "product-definition", target: { kind: "panel", id: panelId } }),
        });
        if (!response.body || response.headers.get("content-type")?.split(";")[0] !== "text/event-stream") {
          throw new PanelStreamContractError("Panel subscription did not return an event stream");
        }
        await readSseData(response, async payload => {
          const parsed = panelSubscriptionFrameSchema.safeParse(payload);
          if (!parsed.success) throw new PanelStreamContractError("Panel subscription frame broke the contract", { cause: parsed.error });
          const frame = parsed.data;
          if (frame.kind === "snapshot") {
            if (reconnecting) await recover(frame);
          } else {
            listener(frame);
          }
          return false;
        }, () => !stream.signal.aborted);
      } catch (reason) {
        if (stream.signal.aborted) return;
        const refused = reason instanceof ApiRequestError && (reason.status === 403 || reason.status === 404);
        if (refused || reason instanceof PanelStreamContractError || reason instanceof SyntaxError)
          throw reason;
      }
      reconnecting = true;
    }
  }
  void watch().catch(reason => {
    if (!stream.signal.aborted) ElMessage.error(reason instanceof Error ? reason.message : String(reason));
  });
  return () => stream.abort();
}
