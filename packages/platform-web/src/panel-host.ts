import { ApiRequestError, nodeApiRequest } from "@ontomato/workbench-ui";
import { applicationPanelUsesResponseSchema, productPanelSchema, type ApplicationPanelUse, type ProductPanel } from "@ontomato/contracts/product-panels";
import { appsSdkCurrentSchema } from "@ontomato/contracts/apps-sdk";
import {
  panelDefinitionSnapshotSchema, productDefinitionStreamFrameSchema,
  type ProductDefinitionRevision, type ProductDefinitionTarget,
} from "@ontomato/contracts/product-subscriptions";
import { candidatePanelSourceSchema, type CandidatePanelSource, type PanelHostSource, type PanelAuthorDefinitions, type PanelDefinitionMode } from "@ontomato/contracts/panel-host";
import { buildExecutionContext } from "@ontomato/contracts/build-tests";
import { documentVisible, onDocumentVisibility } from "@ontomato/foundation-ui/visibility";
import { readSseData, sseReconnectDelay } from "@ontomato/contracts/sse";
import { registerCandidateFrame, registerPanelFrame } from "./app-host";
import type { PanelHostPort } from "@ontomato/platform-shell";

/*
 * The platform's panel host (overall design 3.4): the two reads a panel instance needs and the notices it listens to.
 *
 * - A use relation is Java's (`GET /platform/applications/:applicationId/panel-uses`); the application and its
 *   permissions stay there.
 * - A panel's current record is Node's (`GET /api/product-panels/:id`), read outside the frame under the reader's own
 *   credential; a projection's record is read inside the frame by the projection itself.
 * - An author's workspace candidate is Node's too (`GET /api/workspaces/:id/panel-candidate?ref=`), under the author's
 *   workspace access. It is the same host with another source: no use relation, panel ID or revision of its own, and a
 *   build-test execution context instead of a live one.
 * - Viewers reconcile revisions using short requests. Author hosts share the document's definition stream.
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
  snapshot: (panelId: string) => `/api/product-panels/${encodeURIComponent(panelId)}/snapshot`,
  definitionStream: "/api/product-panels/definition-stream",
  candidate: (workspaceId: string, ref: string) =>
    `/api/workspaces/${encodeURIComponent(workspaceId)}/panel-candidate?${new URLSearchParams({ ref })}`,
};

async function json(path: string, init: RequestInit = {}) {
  const response = await nodeApiRequest(path, init);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error?.message ?? `Request failed: ${path}`);
  return body;
}

/** Where Node serves its installed SDK builds; each definition's frame loads the exact version it names there. */
async function sdkRoot() {
  return `${appsSdkCurrentSchema.parse(await json(panelHostPaths.appsSdkCurrent)).publicBasePath}/apps-sdk`;
}

async function panel(panelId: string) {
  return productPanelSchema.parse((await json(panelHostPaths.panel(panelId))).panel) as ProductPanel;
}

async function snapshot(panelId: string) {
  return panelDefinitionSnapshotSchema.parse(await json(panelHostPaths.snapshot(panelId)));
}

/** The platform's panel host for one use relation of the application whose page is showing it. */
export function platformPanelHost(applicationId: string, use: ApplicationPanelUse, mode: PanelDefinitionMode = { kind: "view" }): PanelHostPort<Extract<PanelHostSource, { kind: "registered" }>> {
  return {
    async source() {
      return { kind: "registered", applicationId, use, panel: await panel(use.panelId) };
    },
    pageKey: use.pageKey,
    panel,
    sdkRoot,
    // The frame is this application's: the address the reader is on names it, and a panel shown beside a conversation is
    // the same application's page. Registering it under that ID is what lets the bridge recognise the frame and answer
    // its `connect`, and what keeps a frame of another application from being mistaken for this one. What it may ask for
    // is what the panel's record declares, for this use relation's page.
    frame: (frame, source, open) => registerPanelFrame(frame, applicationId, { pageKey: use.pageKey, manifest: source.panel.manifest }, open),
    // The relation this page opens is still the application's, bound to the same panel: a kept page shown again is
    // checked against Java's current relations before its frame may ask for anything.
    async current() {
      return (await panelUsesOf(applicationId)).some(relation => relation.id === use.id && relation.panelId === use.panelId);
    },
    snapshot,
    mode,
  };
}

/**
 * The author's preview of a workspace candidate (design 6.2): the same host, reading the candidate instead of a use
 * relation. The preview is an author's host, so it declares author mode: the registered projections the candidate names
 * follow the document's definition stream. Its frame runs on the workspace's build-test context — NONE when the
 * workspace has none — and each owner decides what such a request may do.
 */
export function candidatePanelHost(candidate: CandidatePanelSource["workspace"] & { pageKey: string }): PanelHostPort<CandidatePanelSource> {
  return {
    async source() {
      return candidatePanelSourceSchema.parse(await json(panelHostPaths.candidate(candidate.id, candidate.ref)));
    },
    pageKey: candidate.pageKey,
    panel,
    sdkRoot,
    frame: (frame, source, open) => registerCandidateFrame(frame, buildExecutionContext(source.workspace.id, source.previewContext.test), {
      pageKey: candidate.pageKey,
      manifest: source.panel.manifest,
    }, open),
    snapshot,
    mode: { kind: "author", definitions: panelAuthorDefinitions() },
  };
}

/** One application's use relations, as Java declares them; the app's entry and its page skills belong to them. */
export async function panelUsesOf(applicationId: string) {
  const answer = await json(panelHostPaths.applicationPanelUses(applicationId));
  return applicationPanelUsesResponseSchema.parse(answer.data ?? answer).panelUses;
}

class PanelStreamContractError extends Error {}

const targetKey = (target: ProductDefinitionTarget) => `${target.kind}:${target.id}`;
type AuthorObserver = {
  targets: Set<string>;
  onRevisions: Parameters<PanelAuthorDefinitions["observe"]>[1];
  onError: Parameters<PanelAuthorDefinitions["observe"]>[2];
};

let documentAuthors: PanelAuthorDefinitions | undefined;

/** The actual editor or preview opts in and passes this document's port to its panels. */
export function panelAuthorDefinitions(): PanelAuthorDefinitions {
  return documentAuthors ??= createAuthorDefinitions();
}

function createAuthorDefinitions(): PanelAuthorDefinitions {
  const observers = new Map<AuthorObserver, readonly ProductDefinitionTarget[]>();
  const observed = new Map<string, ProductDefinitionRevision>();
  let collection = "";
  let stop: (() => void) | undefined;

  function sync() {
    const targets = new Map<string, ProductDefinitionTarget>();
    for (const requested of observers.values())
      for (const target of requested) targets.set(targetKey(target), target);
    for (const key of observed.keys()) if (!targets.has(key)) observed.delete(key);
    const next = documentVisible() && targets.size ? JSON.stringify([...targets.keys()].sort()) : "";
    if (next === collection) return;
    stop?.();
    stop = undefined;
    collection = next;
    if (!next) return;
    stop = openDefinitionStream([...targets.values()], revisions => {
      const changed = revisions.filter(revision => {
        const key = targetKey(revision);
        if ((observed.get(key)?.revision ?? 0) >= revision.revision) return false;
        observed.set(key, revision);
        return true;
      });
      for (const observer of observers.keys()) {
        const relevant = changed.filter(revision => observer.targets.has(targetKey(revision)));
        if (relevant.length) observer.onRevisions(relevant);
      }
    }, error => {
      for (const observer of observers.keys()) observer.onError(error);
    });
  }

  onDocumentVisibility(sync);
  return {
    observe(requested, onRevisions, onError) {
      const observer = { targets: new Set(requested.map(targetKey)), onRevisions, onError };
      function replace(targets: readonly ProductDefinitionTarget[]) {
        const previous = observers.has(observer) ? observer.targets : new Set<string>();
        observer.targets = new Set(targets.map(targetKey));
        observers.set(observer, targets);
        sync();
        const alreadyRead = [...observed.values()].filter(revision => {
          const key = targetKey(revision);
          return observer.targets.has(key) && !previous.has(key);
        });
        if (alreadyRead.length) onRevisions(alreadyRead);
      }
      replace(requested);
      return {
        replace,
        close() {
          observers.delete(observer);
          sync();
        },
      };
    },
  };
}

/** Reconnect the document's current author collection using the existing stream backoff. */
function openDefinitionStream(
  targets: readonly ProductDefinitionTarget[],
  onRevisions: AuthorObserver["onRevisions"],
  onError: AuthorObserver["onError"],
) {
  const stream = new AbortController();
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function connect() {
    try {
      const response = await nodeApiRequest(panelHostPaths.definitionStream, {
        method: "POST", signal: stream.signal,
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({ targets }),
      });
      if (!response.body || response.headers.get("content-type")?.split(";")[0] !== "text/event-stream")
        throw new PanelStreamContractError("Product definition stream did not return an event stream");

      await readSseData(response, payload => {
        if (stream.signal.aborted) return true;
        const parsed = productDefinitionStreamFrameSchema.safeParse(payload);
        if (!parsed.success) throw new PanelStreamContractError("Product definition stream frame broke the contract", { cause: parsed.error });
        const frame = parsed.data;
        if (frame.kind === "snapshot") attempt = 0;
        onRevisions(frame.kind === "snapshot" ? frame.definitions : [frame.definition]);
        return false;
      }, () => !stream.signal.aborted);
    } catch (reason) {
      if (stream.signal.aborted) return;
      const refused = reason instanceof ApiRequestError && (reason.status === 403 || reason.status === 404);
      if (refused || reason instanceof PanelStreamContractError || reason instanceof SyntaxError) {
        onError(reason);
        return;
      }
    }
    if (!stream.signal.aborted) timer = setTimeout(() => void connect(), sseReconnectDelay(attempt++));
  }

  void connect();
  return () => {
    stream.abort();
    clearTimeout(timer);
  };
}
