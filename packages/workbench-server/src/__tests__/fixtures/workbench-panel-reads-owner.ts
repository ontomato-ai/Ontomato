import type { Express, Request } from "express";
import { isDeepStrictEqual } from "node:util";
import { isApplicationPanelUse } from "@ontomato/contracts/product-panels";
import type {
  JavaDirectPanelRead, JavaPanelLocateRef, JavaPanelRead, JavaPanelReadResult, JavaPanelViewer, JavaRegisteredPanelEntry,
} from "../../services/product-panels/java-panel-reads";
import type { Decision } from "../../services/product-governance/authorization";
import { HttpError } from "../../utils/errors";

export type OwnerFixtureHttp = {
  credential: string;
  get(path: string, query?: Record<string, string>): Promise<any>;
  post(path: string, body: unknown): Promise<any>;
};

export type PanelFixtureRead = (
  call: NonNullable<JavaPanelRead["call"]>, owner: OwnerFixtureHttp, viewer: JavaPanelViewer,
) => unknown | Promise<unknown>;

export function ownerData(body: { success: boolean; code?: string; message?: string; data: unknown }) {
  if (!body.success) throw new HttpError(422, body.message ?? "Owner refused the read", body.code);
  return body.data;
}

function fixtureHttp(req: Request, prefix: string): OwnerFixtureHttp {
  const headers = new Headers({ "Content-Type": "application/json" });
  for (const name of ["tk", "X-API-Key", "Accept-Language", "X-Ontomato-Query-Service-Token"]) {
    const value = req.header(name);
    if (value !== undefined) headers.set(name, value);
  }
  const base = `${req.protocol}://${req.get("host")}${prefix}`;
  async function send(path: string, init: NonNullable<Parameters<typeof fetch>[1]>) {
    const response = await fetch(base + path, { ...init, headers });
    const data = response.headers.get("content-type")?.includes("application/json") ? await response.json() : await response.text();
    if (!response.ok) {
      const refusal = data?.error ?? data;
      throw new HttpError(response.status, refusal?.message ?? response.statusText, refusal?.code);
    }
    return data;
  }
  return {
    credential: req.header("tk")!,
    get: (path, query) => send(query ? `${path}?${new URLSearchParams(query)}` : path, {}),
    post: (path, body) => send(path, { method: "POST", body: JSON.stringify(body) }),
  };
}

/** Mount the two Java turns on the suite's existing owner. Reuse its entry, access and business fixtures. */
export function mountWorkbenchPanelReadsOwner(app: Express, {
  prefix = "", token, viewer, read,
}: {
  prefix?: string;
  token: string;
  viewer: (token: string) => JavaPanelViewer;
  read?: PanelFixtureRead;
}) {
  app.post(prefix + "/internal/workbench-panel-reads", async (req, res, next) => {
    try {
      if (req.header("X-Ontomato-Query-Service-Token") !== token || !req.header("tk")) {
        res.sendStatus(401);
        return;
      }
      const identity = viewer(req.header("tk")!);
      const owner = fixtureHttp(req, prefix);
      const entry = async ({ applicationId, useId }: JavaPanelLocateRef) => {
        const result = ownerData(await owner.get("/platform/applications/registered-entry", { applicationId, useId })) as JavaRegisteredPanelEntry;
        return { ...result, framePanelId: result.framePanelId ?? "builtin-product-platform-frame" };
      };
      if (req.body.kind === "locate") {
        const entries = await Promise.all((req.body.entries as JavaPanelLocateRef[]).map(async ref => {
          try {
            return { kind: "ready", entry: await entry(ref) };
          } catch (error) {
            if (!(error instanceof HttpError)) throw error;
            return { kind: "error", status: error.status, code: error.code, error: error.message };
          }
        }));
        res.json({ viewer: identity, entries });
        return;
      }
      if (req.body.kind !== "read") throw new Error("Expected a Workbench panel locate or read request");
      if (req.body.viewer.userId !== identity.userId || req.body.viewer.domainId !== identity.domainId) {
        res.sendStatus(403);
        return;
      }
      const results = await Promise.all((req.body.reads as (JavaPanelRead | JavaDirectPanelRead)[]).map(async (item): Promise<JavaPanelReadResult> => {
        try {
          // A direct read has no placement to compare or admit: the owner judges the person by itself.
          if (item.source.kind !== "direct") {
            const placed = item as JavaPanelRead;
            const current = await entry(placed.source);
            const use = isApplicationPanelUse(current.use) ? current.use : undefined;
            if (placed.registration.panelId !== (use?.panelId ?? null) || placed.registration.framePanelId !== current.framePanelId
                || !isDeepStrictEqual(placed.registration.inputs ?? null, use?.inputs ?? null)) {
              return { status: "forbidden", code: "PANEL_ENTRY_CHANGED", error: "The panel entry changed" };
            }
            if (placed.uses.length) {
              const requests = placed.uses.map(use => ({ ...use, verb: "USE" }));
              const { decisions } = await owner.post("/authorization/objects/decide-batch", { requests }) as { decisions: Decision[] };
              const refusal = decisions.find(decision => !decision.allowed);
              if (refusal && !refusal.allowed) return { status: "forbidden", code: refusal.code, error: refusal.reason };
            }
          }
          const visibility = item.visibleKinds && Object.fromEntries(await Promise.all(item.visibleKinds.map(async ({ kind, verbs }) =>
            [kind, (await owner.post("/authorization/objects/read-ranges", { kind, verbs })).ranges])));
          const payload = item.call ? await read?.(item.call, owner, identity) : undefined;
          if (item.call && payload === undefined)
            return { status: "error", code: "PANEL_READ_UNKNOWN", error: `${item.call.type}.${item.call.name} is not registered by the fixture` };
          return payload === null ? { status: "empty" } : { status: "ready", payload, visibility };
        } catch (error) {
          if (!(error instanceof HttpError)) throw error;
          if (error.status === 403) return { status: "forbidden", code: error.code, error: error.message };
          return { status: "error", code: error.code, error: error.message };
        }
      }));
      res.json({ viewer: identity, results });
    } catch (error) {
      next(error);
    }
  });
}
