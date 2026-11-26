import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as panelCheck from "@ontomato/contracts/panel-check";
import {
  AUTOTEST_CASE_SET,
  CREATE_AUTOTEST_CASE_SET,
  DELETE_AUTOTEST_CASE_SET,
  IMPORT_AUTOTEST_CASE_SET,
} from "@ontomato/contracts/platform-object-types";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { installWorkbenchIdentity } from "../../../identity/installed";
import type { WorkbenchIdentity } from "../../../identity/types";
import { getCaseSet } from "../../../platform/diagnosis/autotest/cases/repository";
import { HttpError } from "../../../utils/errors";
import {
  panelServerOperation,
  type PanelOperationHost,
  type PanelWriteServerOperation,
} from "../../product-panels/server-operations";
import { createAutotestCaseSetReadAdapter } from "../case-sets-panel";

configureI18n({
  defaultLocale: "en",
  appTextLocale: "en",
  languageSwitchEnabled: false,
  packs: { en: { ...enLocaleMeta, messages: en } },
});

const mocks = vi.hoisted(() => ({
  assertManagement: vi.fn(),
  assertObserveAccess: vi.fn<
    Parameters<WorkbenchIdentity["assertObserveAccess"]>,
    ReturnType<WorkbenchIdentity["assertObserveAccess"]>
  >(async () => {}),
  autotestDataDir: "",
}));

vi.mock("../../../identity/management", () => ({ assertManagement: mocks.assertManagement }));
vi.mock("../../../content/layout", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../content/layout")>();
  return {
    ...actual,
    publicSkillsRoot: () => os.tmpdir(),
    domainSkillsRoot: () => os.tmpdir(),
    runtimeRoot: () => os.tmpdir(),
  };
});

vi.mock("../../../platform/diagnosis/autotest/config", () => ({
  autotestConfig: {
    get dataDir() {
      return mocks.autotestDataDir;
    },
  },
}));

const objectWrite = (ref: string) =>
  panelServerOperation(ref) as Extract<PanelWriteServerOperation, { targetType: string }>;
const globalWrite = (ref: string) =>
  panelServerOperation(ref) as Extract<PanelWriteServerOperation, { kind: "action"; targetInput?: undefined }>;

function makeHost(domainId = "domain-a", locale = "en"): PanelOperationHost {
  const actor = { owner: { domainId, userId: "user-1" }, credentials: { token: "tok", locale } };
  return {
    initiator: actor,
    executor: actor,
    locale,
    requestWorkbench: vi.fn(),
    request: vi.fn(),
  };
}

let tempRoot = "";

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ops-case-sets-panel-"));
  mocks.autotestDataDir = path.join(tempRoot, "autotest");
  mocks.assertManagement.mockReset().mockResolvedValue(undefined);
  mocks.assertObserveAccess.mockReset().mockResolvedValue(undefined);

  installWorkbenchIdentity({
    authenticate: (_req, _res, next) => next(),
    resolveAutotestActor: async () => ({ userId: "user-1", domainId: "domain-a" }),
    resolveMcpCaller: async () => ({ userId: "user-1", domainId: "domain-a" }),
    resolveSkillResourceDomain: async () => ({ ok: true, domainId: "domain-a" }),
    requirePermission: () => (_req, _res, next) => next(),
    assertPermission: async () => {},
    requireDeploymentMaintenance: (_req, _res, next) => next(),
    observeAccess: (_req, _res, next) => next(),
    assertObserveAccess: mocks.assertObserveAccess,
    requireDomainId: ({ domainId }) => {
      if (!domainId) throw new HttpError(403, "Domain required");
      return domainId;
    },
  });
});

afterEach(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe("AutotestCaseSet panel reads and operations", () => {
  it("enforces observe access and isolates case sets by domain", async () => {
    const createOp = globalWrite(CREATE_AUTOTEST_CASE_SET);
    const createdA = await createOp.execute(makeHost("domain-a"), null, { name: "Domain A Suite" }, "intent-a");
    expect(createdA.kind).toBe("success");
    const idA = (createdA as Extract<typeof createdA, { kind: "success" }>).created!.primaryKey;

    const createdB = await createOp.execute(makeHost("domain-b"), null, { name: "Domain B Suite" }, "intent-b");
    expect(createdB.kind).toBe("success");
    const idB = (createdB as Extract<typeof createdB, { kind: "success" }>).created!.primaryKey;

    const adapterA = createAutotestCaseSetReadAdapter(
      { domainId: "domain-a", userId: "user-1" },
      { token: "tok", locale: "en" },
    );

    const listA = await adapterA.list();
    expect(listA.map((item) => item.primaryKey)).toEqual([idA]);
    expect(listA[0]!.className).toBe(AUTOTEST_CASE_SET);
    expect(listA[0]!.label).toBe("Domain A Suite");

    const filtered = await adapterA.list({ search: "missing" });
    expect(filtered).toEqual([]);
    const matched = await adapterA.list({ search: "domain a" });
    expect(matched.map((item) => item.primaryKey)).toEqual([idA]);

    const recordA = await adapterA.record(idA);
    expect(recordA.outputs).toEqual({ caseCount: 0 });

    await expect(adapterA.record(idB)).rejects.toMatchObject({ status: 404 });
    await expect(adapterA.form(idB)).rejects.toMatchObject({ status: 404 });

    mocks.assertManagement.mockRejectedValueOnce(new HttpError(403, "Operation forbidden"));
    await expect(adapterA.list()).rejects.toMatchObject({ status: 403 });
  });

  it("switches /cases between object-array (form) and code(json) (json) on the single /cases path without duplicating fields", async () => {
    const importOp = globalWrite(IMPORT_AUTOTEST_CASE_SET);
    const imported = await importOp.execute(
      makeHost("domain-a"),
      null,
      {
        name: "Core Regression",
        content: JSON.stringify([
          { caseId: "c1", question: "How many orders?", expectedAnswer: "42" },
        ]),
      },
      "intent-import",
    );
    expect(imported.kind).toBe("success");
    const id = (imported as Extract<typeof imported, { kind: "success" }>).created!.primaryKey;

    const adapter = createAutotestCaseSetReadAdapter(
      { domainId: "domain-a", userId: "user-1" },
      { token: "tok", locale: "en" },
    );

    const formDesc = await adapter.form(id, { editMode: "form" });
    expect(formDesc.fields.map((field) => field.path)).toEqual(["/name", "/cases"]);
    const formCasesField = formDesc.fields.find((field) => field.path === "/cases")!;
    expect(formCasesField.control.kind).toBe("object-array");
    if (formCasesField.control.kind !== "object-array") throw new Error("expected object-array");
    expect(formCasesField.control.itemKeyPath).toBe("/caseId");
    expect(formCasesField.control.itemFields.map((field) => field.path)).toEqual([
      "/caseId",
      "/question",
      "/expectedAnswer",
      "/judgment",
      "/expectedLogic",
    ]);
    expect(formDesc.values.cases).toEqual([
      {
        caseId: "c1",
        question: "How many orders?",
        expectedAnswer: "42",
        expectedLogic: "",
        judgment: "A result counts as correct",
      },
    ]);

    // Switching to JSON mode reuses the exact same `/cases` path and preserves unsaved draft values.
    const draftValues = {
      name: "Core Regression Draft",
      cases: [
        { caseId: "c1", question: "Updated question", expectedAnswer: "43", expectedLogic: "", judgment: "" },
      ],
    };
    const jsonDesc = await adapter.form(id, { editMode: "json", values: draftValues, changedField: null });
    expect(jsonDesc.fields.map((field) => field.path)).toEqual(["/name", "/cases"]);
    const jsonCasesField = jsonDesc.fields.find((field) => field.path === "/cases")!;
    expect(jsonCasesField.control).toEqual({ kind: "code", language: "json" });
    expect(jsonCasesField.valueSchema.type).toBe("array");
    expect(jsonDesc.values).toEqual(draftValues);
    expect(jsonDesc.errors).toEqual([]);

    // Validation errors in JSON mode attach directly to `/cases`, whereas form mode attaches to item paths.
    const duplicateDraft = {
      name: "Dup Test",
      cases: [
        { caseId: "dup", question: "Q1" },
        { caseId: "dup", question: "Q2" },
      ],
    };
    const jsonInvalid = await adapter.form(id, { editMode: "json", values: duplicateDraft, changedField: null });
    expect(jsonInvalid.errors).toEqual([
      expect.objectContaining({ field: "/cases", code: "already_exists" }),
    ]);

    const formInvalid = await adapter.form(id, { editMode: "form", values: duplicateDraft, changedField: null });
    expect(formInvalid.errors).toEqual([
      expect.objectContaining({ field: "/cases/1/caseId", code: "already_exists" }),
    ]);
  });

  it("imports JSON (including legacy fields) and CSV (including quotes, commas, and BOM) and refuses malformed input", async () => {
    const importOp = globalWrite(IMPORT_AUTOTEST_CASE_SET);
    const host = makeHost("domain-a");

    const jsonOutcome = await importOp.execute(
      host,
      null,
      {
        name: "Legacy JSON",
        format: "json",
        content: JSON.stringify({
          cases: [
            { case_id: "q1", question: "Revenue?", answer: "100", logic: "SUM(amount)" },
            { case_id: "q1", question: "Duplicate id normalized" },
          ],
        }),
      },
      "intent-json",
    );
    expect(jsonOutcome.kind).toBe("success");
    const jsonData = (jsonOutcome as Extract<typeof jsonOutcome, { kind: "success" }>).data as {
      id: string;
      caseCount: number;
      warnings: string[];
    };
    expect(jsonData.caseCount).toBe(2);
    expect(jsonData.warnings.length).toBeGreaterThan(0);
    const storedJson = getCaseSet(jsonData.id, "domain-a")!;
    expect(storedJson.cases.map((item) => item.caseId)).toEqual(["q1", "q1-2"]);
    expect(storedJson.cases[0]!.expectedAnswer).toBe("100");
    expect(storedJson.cases[0]!.expectedLogic).toBe("SUM(amount)");

    const csvText = `\uFEFFcase_id,question,expected_answer,judgment,expected_logic\r\ncsv-1,"What is ""Q1"", total?","1,200","Exact match","SELECT sum(x)"\r\ncsv-2,Active users?,50,,\r\n`;
    const csvOutcome = await importOp.execute(
      host,
      null,
      {
        name: "CSV Cases",
        format: "auto",
        content: csvText,
      },
      "intent-csv",
    );
    expect(csvOutcome.kind).toBe("success");
    const csvId = (csvOutcome as Extract<typeof csvOutcome, { kind: "success" }>).created!.primaryKey;
    const storedCsv = getCaseSet(csvId, "domain-a")!;
    expect(storedCsv.cases).toEqual([
      {
        caseId: "csv-1",
        question: 'What is "Q1", total?',
        expectedAnswer: "1,200",
        judgment: "Exact match",
        expectedLogic: "SELECT sum(x)",
      },
      {
        caseId: "csv-2",
        question: "Active users?",
        expectedAnswer: "50",
        judgment: undefined,
        expectedLogic: undefined,
      },
    ]);

    const badJson = await importOp.execute(
      host,
      null,
      { name: "Bad JSON", format: "auto", content: "[{\"caseId\": \"1\"" },
      "intent-bad-json",
    );
    expect(badJson.kind).toBe("refusal");

    const badCsv = await importOp.execute(
      host,
      null,
      { name: "Bad CSV", format: "csv", content: "caseId,answer\n1,42" },
      "intent-bad-csv",
    );
    expect(badCsv.kind).toBe("refusal");
  });

  it("validates save rules (non-empty name, unique valid caseId, non-empty question, default judgment) and supports partial save", async () => {
    const createOp = globalWrite(CREATE_AUTOTEST_CASE_SET);
    const saveOp = objectWrite(`${AUTOTEST_CASE_SET}.save`);
    const host = makeHost("domain-a");

    const created = await createOp.execute(host, null, { name: "Initial Name" }, "intent-create");
    const id = (created as Extract<typeof created, { kind: "success" }>).created!.primaryKey;
    const target = { kind: "object" as const, objectType: AUTOTEST_CASE_SET, primaryKey: id };

    // Blank name refused
    const emptyName = await saveOp.execute(host, target, { values: { name: "   ", cases: [] } }, "intent-1");
    expect(emptyName.kind).toBe("refusal");
    if (emptyName.kind === "refusal") {
      expect(emptyName.errors).toEqual([expect.objectContaining({ field: "/name", code: "required" })]);
    }

    // Missing caseId, duplicate caseId, invalid path caseId, missing question refused
    const invalidCases = await saveOp.execute(
      host,
      target,
      {
        values: {
          name: "Validated",
          cases: [
            { caseId: "", question: "Q1" },
            { caseId: "dup", question: "" },
            { caseId: "dup", question: "Q3" },
            { caseId: "../escape", question: "Q4" },
          ],
        },
      },
      "intent-2",
    );
    expect(invalidCases.kind).toBe("refusal");
    if (invalidCases.kind === "refusal") {
      expect(invalidCases.errors).toEqual([
        expect.objectContaining({ field: "/cases/0/caseId", code: "required" }),
        expect.objectContaining({ field: "/cases/1/question", code: "required" }),
        expect.objectContaining({ field: "/cases/2/caseId", code: "already_exists" }),
        expect.objectContaining({ field: "/cases/3/caseId", code: "invalid_format" }),
      ]);
    }

    // Valid save fills blank judgment with default text and persists
    const saved = await saveOp.execute(
      host,
      target,
      {
        values: {
          name: "Validated Suite",
          cases: [
            { caseId: "c1", question: "How many users?", expectedAnswer: "10", expectedLogic: "", judgment: "   " },
            { caseId: "c2", question: "Total revenue?", judgment: "Within 1%" },
          ],
        },
      },
      "intent-3",
    );
    expect(saved.kind).toBe("success");
    const stored = getCaseSet(id, "domain-a")!;
    expect(stored.name).toBe("Validated Suite");
    expect(stored.cases).toEqual([
      {
        caseId: "c1",
        question: "How many users?",
        expectedAnswer: "10",
        judgment: "A result counts as correct",
      },
      {
        caseId: "c2",
        question: "Total revenue?",
        judgment: "Within 1%",
      },
    ]);

    // Partial save via submittedFields updates only /name and preserves existing cases
    const renamed = await saveOp.execute(
      host,
      target,
      {
        values: { name: "Renamed Suite" },
        submittedFields: ["/name"],
      },
      "intent-4",
    );
    expect(renamed.kind).toBe("success");
    const afterRename = getCaseSet(id, "domain-a")!;
    expect(afterRename.name).toBe("Renamed Suite");
    expect(afterRename.cases).toHaveLength(2);

    // Cross-domain save refused
    const crossDomain = await saveOp.execute(
      makeHost("domain-b"),
      target,
      { values: { name: "Hijack" }, submittedFields: ["/name"] },
      "intent-5",
    );
    expect(crossDomain.kind).toBe("refusal");
  });

  it("inspects delete impact and deletes owned case sets while blocking cross-domain deletes", async () => {
    const importOp = globalWrite(IMPORT_AUTOTEST_CASE_SET);
    const deleteOp = objectWrite(DELETE_AUTOTEST_CASE_SET);
    const hostA = makeHost("domain-a");

    const imported = await importOp.execute(
      hostA,
      null,
      {
        name: "To Delete",
        content: JSON.stringify([
          { caseId: "c1", question: "Q1" },
          { caseId: "c2", question: "Q2" },
        ]),
      },
      "intent-imp",
    );
    const id = (imported as Extract<typeof imported, { kind: "success" }>).created!.primaryKey;
    const target = { kind: "object" as const, objectType: AUTOTEST_CASE_SET, primaryKey: id };

    const impact = await deleteOp.inspectImpact!.inspect(hostA, [{ target, input: {} }]);
    expect(impact).toMatchObject({
      summary: 'Delete test case set "To Delete" (2 cases)?',
      total: 1,
      objects: [{ target: { objectType: AUTOTEST_CASE_SET, primaryKey: id }, label: "To Delete" }],
    });

    const deniedDelete = await deleteOp.execute(makeHost("domain-b"), target, {}, "intent-del-b");
    expect(deniedDelete.kind).toBe("refusal");
    expect(getCaseSet(id, "domain-a")).not.toBeNull();

    const deleted = await deleteOp.execute(hostA, target, {}, "intent-del-a");
    expect(deleted.kind).toBe("success");
    if (deleted.kind === "success") {
      expect(deleted.affected?.removed).toEqual([{ objectType: AUTOTEST_CASE_SET, primaryKey: id }]);
    }
    expect(getCaseSet(id, "domain-a")).toBeNull();
  });

  it("validates ops-autotest-cases builtin panel source with TestcaseWorkbench, local draft persistence, and 8-locale parity", async () => {
    const repoRoot = path.resolve(__dirname, "../../../../../..");
    const { checkBuiltinPanelSource } = await import(
      path.resolve(repoRoot, "agent-skills/ontomato-app-builder/scripts/panel-check.mjs")
    );
    const dir = path.resolve(repoRoot, "packages/platform-admin/resources/builtin-panels/ops-autotest-cases");
    await checkBuiltinPanelSource(dir, { ...panelCheck, draftReadOperationIds: [] });

    const mod = fs.readFileSync(path.resolve(dir, "panel.mjs"), "utf8");
    const html = fs.readFileSync(path.resolve(dir, "panel.html"), "utf8");
    const desc = JSON.parse(fs.readFileSync(path.resolve(dir, "panel.json"), "utf8"));

    expect(mod).not.toContain("localStorage");
    expect(html).not.toContain("<el-");
    expect(html).not.toContain("--el-");
    expect(html).not.toContain("segmented-control");
    expect(html).not.toContain("ops-cases-footer");

    expect(desc.manifest.state).not.toHaveProperty("editMode");
    expect(desc.manifest.members.caseSets.config).toMatchObject({
      showDraftIndicator: true,
      fallbackToFirst: true,
    });
    expect(desc.manifest.members.caseSetForm).toMatchObject({
      component: "TestcaseWorkbench",
      target: "selected",
      data: { form: "form" },
      operation: `${AUTOTEST_CASE_SET}.save`,
      config: {
        persistDraft: true,
        unsavedSwitchMode: "save-discard-cancel",
        showFooterBar: true,
      },
    });

    const locales = ["en", "zh-CN", "zh-TW", "ja", "de", "fr", "it", "ar"];
    const messages = desc.content.messages as Record<string, Record<string, string>>;
    expect(Object.keys(messages).sort()).toEqual([...locales].sort());
    const enKeys = Object.keys(messages.en!).sort();
    for (const locale of locales) {
      expect(Object.keys(messages[locale]!).sort()).toEqual(enKeys);
    }
  });
});
