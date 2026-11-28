import { beforeAll, beforeEach, expect, it, vi } from "vitest";
import { DELETE_ROLE, ROLE } from "@ontomato/contracts/platform-object-types";
import { installContentLayout } from "../../../content/layout";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import type { JavaPanelRead, JavaPanelReadResult } from "../java-panel-reads";
import type { RegisteredDataRead } from "../registered-read-plan";
import type { PanelOperationAvailability, PanelServerOperation } from "../server-operations";

/*
 * One check added to one operation's declaration reaches every place the operation is shown: a formal detail, a formal
 * list's rows and a page outside the formal read. A formal list that cannot carry the operation's facts back refuses
 * the read instead of showing the operation as available.
 */

const mocks = vi.hoisted(() => ({ locate: vi.fn(), read: vi.fn(), resolve: vi.fn(), prepare: vi.fn() }));
vi.mock("../java-panel-reads", async original => ({
  ...await original<typeof import("../java-panel-reads")>(), locateViaJava: mocks.locate, readViaJava: mocks.read,
}));
vi.mock("../data-reads", async original => ({
  ...await original<typeof import("../data-reads")>(), resolveReadMember: mocks.resolve, prepareProjectionDataRead: mocks.prepare,
}));

let plan: typeof import("../registered-read-plan");
let readRegisteredProjectionOperations: typeof import("./registered-operations-fixture").readRegisteredProjectionOperations;
let serverOperations: typeof import("../server-operations");

beforeAll(async () => {
  installContentLayout({ runtimeRoot: process.cwd(), publicSkillsRoot: process.cwd(), prompts: [], knowledgeRoot: process.cwd(), runtimeResources: [] });
  configureI18n({ defaultLocale: "en", appTextLocale: "en", languageSwitchEnabled: false, packs: { en: { ...enLocaleMeta, messages: en } } });
  plan = await import("../registered-read-plan");
  ({ readRegisteredProjectionOperations } = await import("./registered-operations-fixture"));
  serverOperations = await import("../server-operations");
});

const viewer = { domainId: "tenant", userId: "reader" };
const credentials = { token: "reader-token", locale: "en" };
const source = { kind: "registered", applicationId: "app", useId: "roles" } as const;
const entry = {
  applicationId: source.applicationId, framePanelId: "frame",
  use: { id: source.useId, names: { en: "Roles" }, pageKey: "roles", path: "/applications/app/roles", panelId: "roles-panel" },
};
const frozen = { reason: "Frozen roles cannot be deleted" };
const binding = { kind: "PlatformOperation", id: DELETE_ROLE } as const;
const port = { kind: "object", objectType: ROLE } as const;
const detail = {
  panel: { manifest: { state: { role: { type: port } }, members: {} } },
  member: { inputs: { role: { state: "role" } } },
  projection: { inputs: { role: port }, data: {}, operations: { delete: { operation: binding, target: { input: "role" } } } },
  inputs: { role: { className: ROLE, primaryKey: "frozen" } },
};
const list = (read: string) => ({
  panel: { manifest: { state: {}, members: {} } }, member: {}, inputs: {},
  projection: {
    inputs: {}, data: { rows: { source: { type: { kind: "PlatformObjectType", id: ROLE } }, read } },
    operations: { delete: { operation: binding, target: { row: true } } },
  },
});
const rows = [{ primaryKey: "frozen", label: "Frozen", fields: {} }, { primaryKey: "open", label: "Open", fields: {} }];
const operationsRead: RegisteredDataRead = { source, memberPath: [{ member: "header" }], operations: true, inputs: {} };
const dataRead: RegisteredDataRead = { source, memberPath: [{ member: "list" }], dataName: "rows", inputs: {} };

beforeEach(() => {
  vi.restoreAllMocks();
  mocks.locate.mockReset().mockResolvedValue({ viewer, entries: [{ kind: "ready", entry }] });
  // The Java owner refuses nothing: the added check alone decides.
  mocks.read.mockReset().mockImplementation(async (_viewer, reads: JavaPanelRead[]) => ({ viewer, results: reads.map(({ call }) =>
    call?.name === "query"
      ? { status: "ready", payload: { value: { rows, total: rows.length }, rowRefusals: { frozen: null, open: null } } }
      : { status: "ready", payload: { reason: null } }) satisfies JavaPanelReadResult[] }));
  const { handler } = serverOperations.registeredPanelOperation(DELETE_ROLE)!;
  const declared = handler.availability as PanelOperationAvailability<unknown, { reason: string | null }>;
  // The new check, written only in the operation's declaration.
  const checked = { ...handler, availability: {
    ...declared, refuse: input => declared.refuse(input) ?? (input.target!.primaryKey === "frozen" ? frozen : undefined),
  } satisfies PanelOperationAvailability<unknown, { reason: string | null }> } as PanelServerOperation;
  vi.spyOn(serverOperations, "registeredPanelOperation").mockImplementation(id => id === DELETE_ROLE
    ? { handler: checked, declaration: serverOperations.operationDeclaration(checked), targetType: checked.targetType }
    : undefined);
});

it("shows a check added to the role delete declaration in the formal detail, the formal list rows and outside the formal read", async () => {
  mocks.resolve.mockResolvedValueOnce(detail).mockResolvedValueOnce(list("query"));
  mocks.prepare.mockResolvedValueOnce({
    declaration: { result: "panelRecordQuery" }, params: {}, inputs: {}, selection: { kind: "platform", typeId: ROLE, method: "query" },
  });
  const formal = await plan.runPreparedDataReads(credentials, await plan.prepareRegisteredDataReads(credentials, [operationsRead, dataRead]));
  expect(formal).toMatchObject([
    { status: "ready", value: { delete: { unavailable: frozen } } },
    { status: "ready", rowOperations: {
      [`${ROLE}:frozen`]: { delete: { available: false, unavailable: frozen } },
      [`${ROLE}:open`]: { delete: { available: true } },
    } },
  ]);
  // The detail read the role's refusal and the list carried its rows' refusals back, both in the second read.
  expect(mocks.read.mock.lastCall![1].map(({ call }: JavaPanelRead) => call)).toEqual([
    { type: ROLE, name: "deleteRefusal", parameters: { primaryKey: "frozen" } },
    { type: ROLE, name: "query", parameters: { inspectRowRemoval: true } },
  ]);

  const actor = { owner: viewer, credentials };
  const outside = await readRegisteredProjectionOperations(actor, { ...detail, slot: "header" } as never, detail.inputs);
  expect(outside.delete?.unavailable).toEqual(frozen);
  expect(mocks.read.mock.lastCall![1]).toEqual([
    { source: { kind: "direct" }, call: { type: ROLE, name: "deleteRefusal", parameters: { primaryKey: "frozen" } } },
  ]);
});

it("refuses a formal list read whose list cannot carry the rows' facts instead of showing the operation as available", async () => {
  mocks.resolve.mockResolvedValueOnce(list("list"));
  mocks.prepare.mockResolvedValueOnce({
    declaration: { result: "panelRecordList" }, params: {}, inputs: {}, selection: { kind: "platform", typeId: ROLE, method: "list" },
  });
  const [refused] = await plan.runPreparedDataReads(credentials, await plan.prepareRegisteredDataReads(credentials, [dataRead]));
  expect(refused).toMatchObject({ status: "error", code: "PANEL_OPERATION_READ_UNAVAILABLE" });
  expect(refused).not.toHaveProperty("rowOperations");
});
