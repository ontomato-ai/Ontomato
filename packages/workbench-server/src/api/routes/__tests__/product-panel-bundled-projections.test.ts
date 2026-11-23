import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  productPanelResponseSchema,
  type ProductPanel,
  type ProductProjection,
} from "@ontomato/contracts/product-panels";
import { HttpError } from "../../../utils/errors";

const mocks = vi.hoisted(() => ({
  panel: vi.fn(),
  projection: vi.fn(),
  validateComponent: vi.fn(),
  framePanel: vi.fn(),
  pageSkill: vi.fn(),
}));

vi.mock("../../../services/product-panels/operations", () => ({ ownPanelSettings: vi.fn() }));
vi.mock("../../../services/product-panels/current", () => ({
  readCurrentPanelRecord: mocks.panel,
  readCurrentProjectionRecord: mocks.projection,
}));
vi.mock("../../../services/product-panels/component-catalogue", () => ({
  validateProjectionComponent: mocks.validateComponent,
}));
vi.mock("../../../services/product-panels/member-path", () => ({
  requireRegisteredPanelRoot: mocks.framePanel,
}));
vi.mock("../../../services/skills/view", () => ({ readRegisteredPanelPageSkillContext: mocks.pageSkill }));
vi.mock("../../../utils/request-identity", async original => ({
  ...await original<typeof import("../../../utils/request-identity")>(),
  requireDomainId: () => "domain-1",
}));

import { productPanelsRouter } from "../product-panels";

const owner = { domainId: "domain-1", userId: "caller-1" };
const now = "2026-11-22T00:00:00.000Z";

function makeProjection(id: string, revision = 1, componentId = "@ontomato/sdk:DataTable"): ProductProjection {
  return {
    id,
    name: `Projection ${id}`,
    description: "",
    revision,
    domainId: owner.domainId,
    ownerId: owner.userId,
    editable: true,
    visibility: "domain",
    createdAt: now,
    updatedAt: now,
    componentId,
    inputs: {},
    outputs: {},
    data: {},
    config: {},
  } as ProductProjection;
}

function makePanel(id = "panel-1"): ProductPanel {
  return {
    id,
    name: "Test Panel",
    description: "",
    revision: 3,
    domainId: owner.domainId,
    ownerId: owner.userId,
    editable: true,
    visibility: "domain",
    createdAt: now,
    updatedAt: now,
    content: {
      html: "<div></div>",
      module: "export default {};",
    },
    manifest: {
      state: { tab: { type: { kind: "object", objectType: "platform:ProductProjection" }, personal: false, deepLink: false, external: false } },
      members: {
        listA: { target: { projectionId: "proj-ready" } },
        listADup: { target: { projectionId: "proj-ready" } },
        customComp: { target: { projectionId: "proj-domain-comp" } },
        secretMember: { target: { projectionId: "proj-forbidden" } },
        missingMember: { target: { projectionId: "proj-missing" } },
        nestedFixed: { target: { panelId: "panel-child" } },
        dynamicMember: { target: { fromState: "tab", candidates: { projectionIds: ["proj-dynamic"] } } },
      },
    },
  } as ProductPanel;
}

let base: string;
let server: Server;

beforeAll(async () => {
  const app = express();
  app.use((req, _res, next) => {
    Object.assign(req, owner, { token: "caller-token", locale: "en" });
    next();
  });
  app.use("/api/product-panels", productPanelsRouter);
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/product-panels`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

beforeEach(() => {
  vi.resetAllMocks();
});

describe("GET /api/product-panels/:id?includeProjections=1", () => {
  it("bundles deduplicated fixed projections, includes domainComponent, and isolates 403/404 members", async () => {
    const panel = makePanel();
    const readyProjection = makeProjection("proj-ready", 2);
    const domainCompProjection = makeProjection("proj-domain-comp", 4, "domain-component:custom-widget");
    const domainComponent = {
      domainId: owner.domainId,
      componentId: "domain-component:custom-widget",
      revision: 5,
      source: {
        template: "<div>Custom</div>",
        module: "export default {};",
      },
    };

    mocks.panel.mockResolvedValue(panel);
    mocks.projection.mockImplementation(async (_owner, _creds, id: string) => {
      if (id === "proj-ready") return readyProjection;
      if (id === "proj-domain-comp") return domainCompProjection;
      if (id === "proj-forbidden") throw new HttpError(403, "No use grant", "FORBIDDEN");
      if (id === "proj-missing") throw new HttpError(404, "Projection gone", "NOT_FOUND");
      throw new Error(`Unexpected projection read: ${id}`);
    });
    mocks.validateComponent.mockImplementation(async (id: string) =>
      id === "proj-domain-comp" ? domainComponent : undefined,
    );

    const response = await fetch(`${base}/${panel.id}?includeProjections=1`);
    expect(response.status).toBe(200);
    const parsed = productPanelResponseSchema.parse(await response.json());

    expect(parsed.panel.id).toBe(panel.id);
    expect(parsed.projections).toEqual({
      "proj-ready": { status: "ready", projection: readyProjection },
      "proj-domain-comp": { status: "ready", projection: domainCompProjection, domainComponent },
      "proj-forbidden": { status: "unavailable", httpStatus: 403, message: "No use grant" },
      "proj-missing": { status: "unavailable", httpStatus: 404, message: "Projection gone" },
    });

    // Deduplicated: proj-ready appears twice in manifest, read once; panelId and fromState members are skipped.
    const readIds = mocks.projection.mock.calls.map(call => call[2]).sort();
    expect(readIds).toEqual(["proj-domain-comp", "proj-forbidden", "proj-missing", "proj-ready"]);
    for (const call of mocks.projection.mock.calls) {
      expect(call[3]).toBe(false);
    }
  });

  it("omits a member whose component validation fails (400) without failing the whole panel", async () => {
    const panel = makePanel();
    panel.manifest.members = {
      ok: { target: { projectionId: "proj-ok" } },
      broken: { target: { projectionId: "proj-broken" } },
    };
    const okProj = makeProjection("proj-ok", 1);
    const brokenProj = makeProjection("proj-broken", 1);

    mocks.panel.mockResolvedValue(panel);
    mocks.projection.mockImplementation(async (_o, _c, id: string) => (id === "proj-ok" ? okProj : brokenProj));
    mocks.validateComponent.mockImplementation(async (id: string) => {
      if (id === "proj-broken") throw new HttpError(400, "Unknown component", "INVALID_COMPONENT");
      return undefined;
    });

    const response = await fetch(`${base}/${panel.id}?includeProjections=1`);
    expect(response.status).toBe(200);
    const parsed = productPanelResponseSchema.parse(await response.json());
    expect(parsed.projections).toEqual({
      "proj-ok": { status: "ready", projection: okProj },
    });
  });

  it("keeps response 100% backward compatible when includeProjections is omitted", async () => {
    const panel = makePanel();
    mocks.panel.mockResolvedValue(panel);

    const response = await fetch(`${base}/${panel.id}`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ panel });
    expect("projections" in body).toBe(false);
    expect(mocks.projection).not.toHaveBeenCalled();
  });

  it("supports includeProjections=1 with source=frame", async () => {
    const framePanel = makePanel("frame-1");
    framePanel.manifest.members = { nav: { target: { projectionId: "proj-nav" } } };
    const navProj = makeProjection("proj-nav", 3);

    mocks.framePanel.mockResolvedValue({ panel: framePanel });
    mocks.projection.mockResolvedValue(navProj);
    mocks.validateComponent.mockResolvedValue(undefined);

    const query = new URLSearchParams({
      applicationId: "app-1",
      useId: "use-1",
      source: "frame",
      includeProjections: "1",
    });
    const response = await fetch(`${base}/frame-1?${query}`);
    expect(response.status).toBe(200);
    const parsed = productPanelResponseSchema.parse(await response.json());
    expect(parsed.panel.id).toBe("frame-1");
    expect(parsed.projections).toEqual({
      "proj-nav": { status: "ready", projection: navProj },
    });
    expect(mocks.panel).not.toHaveBeenCalled();
  });

  it("rejects invalid includeProjections values with 400 before reading", async () => {
    const response = await fetch(`${base}/panel-1?includeProjections=2`);
    expect(response.status).toBe(400);
    expect(mocks.panel).not.toHaveBeenCalled();
    expect(mocks.projection).not.toHaveBeenCalled();
  });
});
