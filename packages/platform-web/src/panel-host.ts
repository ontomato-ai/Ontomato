import { nodeApiRequest } from "@ontomato/workbench-ui";
import { applicationPanelUsesResponseSchema, productPanelSchema, type ProductPanel } from "@ontomato/contracts/product-panels";
import { appsSdkCurrentSchema } from "@ontomato/contracts/apps-sdk";
import type { ProductSubscriptionEvent } from "@ontomato/contracts/product-subscriptions";
import { registerPanelFrame } from "./app-host";
import type { DefinitionChanged, PanelHostPort } from "@ontomato/platform-shell";

/*
 * The platform's panel host (overall design 3.4): the two reads a panel instance needs and the notices it listens to.
 *
 * - A use relation is Java's (`GET /platform/applications/:applicationId/panel-uses`); the application and its
 *   permissions stay there.
 * - A panel's current record is Node's (`GET /api/product-panels/:id`), read outside the frame under the reader's own
 *   credential; a projection's record is read inside the frame by the projection itself.
 * - "Definition changed" is Node's product subscription, which the platform's product client already polls; the notice
 *   carries identity only, so a reader reads the current definition again by that ID.
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
  subscription: (subscriptionId: string) => `/api/product-assets/subscriptions/${encodeURIComponent(subscriptionId)}`,
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
    subscribe: (panelId, listener) => subscribePanelDefinition(panelId, listener),
  };
}

/** One application's use relations, as Java declares them; the app's entry and its page skills belong to them. */
export async function panelUsesOf(applicationId: string) {
  const answer = await json(panelHostPaths.applicationPanelUses(applicationId));
  return applicationPanelUsesResponseSchema.parse(answer.data ?? answer).panelUses;
}

/** The subscription owner resolves this panel's current projection definitions. */
function subscribePanelDefinition(panelId: string, listener: (event: DefinitionChanged) => void): () => void {
  let stopped = false;
  let id: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  async function watch() {
    const answer = await json(panelHostPaths.subscriptions, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "product-definition", target: { kind: "panel", id: panelId } }),
    });
    if (stopped) {
      await stopSubscription(answer.id);
      return;
    }
    id = answer.id;
    const poll = async () => {
      const body = await json(panelHostPaths.subscription(answer.id));
      if (stopped) return;
      for (const event of body.events as ProductSubscriptionEvent[]) {
        if (event.kind === "definition-changed") listener(event);
      }
      timer = setTimeout(() => void poll(), answer.intervalMs);
    };
    timer = setTimeout(() => void poll(), answer.intervalMs);
  }
  void watch();
  return () => {
    stopped = true;
    clearTimeout(timer);
    if (id) void stopSubscription(id);
  };
}

function stopSubscription(id: string) {
  return nodeApiRequest(panelHostPaths.subscription(id), { method: "DELETE" });
}
