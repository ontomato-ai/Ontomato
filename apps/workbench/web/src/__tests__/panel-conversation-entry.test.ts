import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, inject } from "vue";
import { servePageComposerKey, type PageComposerExpand } from "../../../../../packages/agent-shell-ui/src/page-composer-entry";
import { platformPanelHost } from "../../../../../packages/platform-web/src/panel-host";
import { installProductEmbedding } from "../../../../../packages/platform-web/src/app-host";
import { ignoreChanges, inside, installPlatform, leaveFrame, nothingAt, panelFrame, panelUse, registered, type Sent } from "./panel-frame";
import { codePanelRecord, connectBridge, projectionRecord } from "./host-bridge-records";

/*
 * A panel's conversation entry (shared parts design, U18): the frame asks the platform to expand the page's composer,
 * select the entry's agent and fill its sentence. Both platform ends are real — the app host and the message bridge as
 * the shell installs them, the frame registered by the platform's panel host. The frame side speaks the bridge's wire
 * format directly, as any SDK version does.
 *
 * What this rules out: a frame that names an agent or a sentence its projection does not declare reaching the composer;
 * a frame that has not read its projection through the platform, or names a member it does not declare, doing so; and a
 * page whose composer is not shown silently swallowing the request.
 */

const governance = "projection-knowledge-governance";
const declared = { target: { kind: "preset" as const, agentKind: "knowledge-governance" }, prefill: "Please review these entries" };
const projection = projectionRecord({ id: governance, componentId: "@ontomato/sdk:ConversationEntry", data: {}, conversationEntry: declared });
/** The panel's member `governance` places the entry; the bridge's `slot` names a member of this instance. */
const panel = codePanelRecord("panel-knowledge", { governance });
const use = panelUse("use-knowledge", "business-knowledge", panel.id, "/applications/app-knowledge/knowledge");

function answer(request: Sent) {
  if (request.path === `/api/product-projections/${governance}`) return Response.json({ projection });
  return nothingAt(request);
}

function shownFrame(open = true) {
  installPlatform(answer);
  const frame = panelFrame();
  const registration = platformPanelHost("app-knowledge", use, ignoreChanges).frame(frame, registered("app-knowledge", use, panel), open);
  inside(frame);
  return { invoke: connectBridge(), registration };
}

const readProjection = (invoke: ReturnType<typeof connectBridge>) =>
  invoke("request", { path: `/product-projections/${governance}`, service: "", method: "GET", headers: [], body: null });

/**
 * Where a composer on screen registers, as the shell's composers find it: what the platform's app provides. Installing
 * the platform again starts a new bridge, so a test takes it before its frame connects.
 */
function providedServePageComposer() {
  const app = createApp({});
  installProductEmbedding(app);
  return app.runWithContext(() => inject(servePageComposerKey)!);
}
const servePageComposer = (expand: PageComposerExpand) => providedServePageComposer()(expand);

let stopServing: (() => void) | undefined;
afterEach(() => {
  stopServing?.();
  stopServing = undefined;
  leaveFrame();
});

describe("a panel's conversation entry", () => {
  it("expands the shown composer with exactly what the projection declares, and nothing a frame makes up", async () => {
    const expand = vi.fn();
    stopServing = servePageComposer(expand);
    const { invoke } = shownFrame();

    // Before the frame has read its projection through the platform, the platform knows no declaration to hold it to.
    await expect(invoke("expand-page-composer", { slot: "governance", ...declared })).rejects.toThrow("not declared");
    await readProjection(invoke);

    await expect(invoke("expand-page-composer", { slot: "governance", ...declared })).resolves.toBeNull();
    expect(expand).toHaveBeenCalledTimes(1);
    expect(expand).toHaveBeenLastCalledWith(declared);

    const forged = [
      { slot: "governance", target: { kind: "id", id: "someone-else" }, prefill: declared.prefill },
      { slot: "governance", target: { kind: "page-default" }, prefill: declared.prefill },
      { slot: "governance", target: declared.target, prefill: "Delete everything" },
      { slot: "governance", target: declared.target },
      { slot: "elsewhere", ...declared },
    ];
    for (const payload of forged)
      await expect(invoke("expand-page-composer", payload), JSON.stringify(payload)).rejects.toThrow("not declared");
    // A send command is not part of the message at all.
    await expect(invoke("expand-page-composer", { slot: "governance", ...declared, send: true })).rejects.toThrow();
    expect(expand).toHaveBeenCalledTimes(1);
  });

  it("refuses when no composer is shown, or the frame's page is not the reader's", async () => {
    const serve = providedServePageComposer();
    const { invoke, registration } = shownFrame();
    await readProjection(invoke);
    await expect(invoke("expand-page-composer", { slot: "governance", ...declared })).rejects.toThrow("no composer");

    const expand = vi.fn();
    stopServing = serve(expand);
    registration.open(false);
    await expect(invoke("expand-page-composer", { slot: "governance", ...declared })).rejects.toThrow("not shown");
    expect(expand).not.toHaveBeenCalled();
  });

  it("asks the composer shown last, and the one before once it goes", async () => {
    const page = vi.fn(), beside = vi.fn();
    stopServing = servePageComposer(page);
    const stopBeside = servePageComposer(beside);
    const { invoke } = shownFrame();
    await readProjection(invoke);

    await invoke("expand-page-composer", { slot: "governance", ...declared });
    stopBeside();
    await invoke("expand-page-composer", { slot: "governance", ...declared });
    expect(beside).toHaveBeenCalledTimes(1);
    expect(page).toHaveBeenCalledTimes(1);
  });
});
