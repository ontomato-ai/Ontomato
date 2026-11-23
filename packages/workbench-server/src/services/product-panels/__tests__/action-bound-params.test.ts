import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PanelOperationIntent } from "@ontomato/contracts/panel-agent";
import type { RuntimeRun } from "@ontomato/contracts/agent-runtime";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  backendGet: vi.fn(),
  backendPost: vi.fn(),
  run: vi.fn(),
  session: vi.fn(),
  request: vi.fn(),
  resolve: vi.fn(),
  panel: vi.fn(),
  projection: vi.fn(),
  useEntry: vi.fn(),
  pages: vi.fn(),
  resolveMember: vi.fn(),
  loadedMember: vi.fn(),
  restore: vi.fn(),
  sessionActor: vi.fn(),
  notify: vi.fn(),
}));

vi.mock("../../../infrastructure/postgres", () => ({
  getPostgresPool: () => ({ query: mocks.query }),
  qualifiedTable: (name: string) => name,
}));
vi.mock("../../../config/application", () => ({ config: { dataQuery: { baseUrl: "http://owner.test" } } }));
vi.mock("../../../config/environment", () => ({
  environment: { agentRuntime: () => ({ callbackUrl: "http://workbench.test" }) },
}));
vi.mock("../../../infrastructure/agent-runtime/client", () => ({
  RuntimeClient: class {
    run = mocks.run;
    session = mocks.session;
    request = mocks.request;
  },
}));
vi.mock("../../assistant/execution-setting", () => ({ resolveAgentExecution: mocks.resolve }));
vi.mock("../../assistant/store", () => ({ assistantStore: { turn: async () => ({}) } }));
vi.mock("../../assistant/skills", () => ({
  readAssistantSkillView: mocks.pages,
  resolvePageSkillSource: mocks.resolveMember,
  loadedPageSkillVersion: mocks.loadedMember,
}));
vi.mock("../../agent-host/caller", () => ({
  restoreAgentCaller: mocks.restore,
  readAgentSessionActor: mocks.sessionActor,
}));
vi.mock("../../agent-host/presentation", () => ({ publishObjectChanged: mocks.notify }));
vi.mock("../../../utils/backend-client", () => ({
  backendGet: mocks.backendGet,
  backendPost: mocks.backendPost,
  buildBackendHeaders: (token?: string, _x?: unknown, _l?: unknown, key?: string, headers?: object) => ({
    ...headers,
    ...(token ? { tk: token } : {}),
    ...(key ? { "X-API-Key": key } : {}),
  }),
}));
vi.mock("../current", () => ({
  readCurrentPanelRecord: mocks.panel,
  async requireDirectPanelMember(
    _o: unknown,
    _c: unknown,
    panel: { manifest: { members: Record<string, { target: { projectionId: string } }> } },
    slot: string,
  ) {
    const member = panel.manifest.members[slot]!;
    const projection = await mocks.projection(member.target.projectionId);
    return { member, projection };
  },
}));
vi.mock("../application-use", () => ({
  requirePanelUseEntry: mocks.useEntry,
}));

import {
  dispatchHumanPanelOperation,
  prepareHumanPanelOperation,
} from "../operations";

configureI18n({
  defaultLocale: "en",
  appTextLocale: "en",
  languageSwitchEnabled: true,
  packs: { en: { ...enLocaleMeta, messages: en } },
});

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const owner = { domainId: "d", userId: "U" };
const credentials = { token: "U-token", locale: "en" };
const root = { providerId: "web", sessionId: uuid(1) };
const skill = { namespace: { kind: "domain" as const, domainId: "d" }, name: "students-panel" };

const createStudentAction = {
  id: "create-student",
  name: "Create student",
  status: "PUBLISHED",
  codeHash: "a".repeat(64),
  target: null,
  definition: { affects: ["Student"] },
  function: {
    name: "create_student",
    parameters: [
      { name: "campus", type: "TYPE_STRING", description: "Campus code" },
      { name: "term", type: "TYPE_STRING", description: "Academic term" },
      { name: "limit", type: "TYPE_NUMBER", description: "Max courses" },
      { name: "tags", type: "TYPE_ARRAY", description: "Tags" },
      { name: "cleared", type: "TYPE_OBJECT", description: "Cleared JSON" },
      { name: "customer", type: "TYPE_STRING", description: "Student name" },
      { name: "studentPhone", type: "TYPE_STRING", description: "Phone" },
      { name: "profile", type: "TYPE_OBJECT", description: "Packed profile" },
    ],
  },
};

const updateStudentAction = {
  id: "update-student",
  name: "Update student",
  status: "PUBLISHED",
  codeHash: "b".repeat(64),
  target: { className: "Student", keyParameter: "student_id" },
  definition: { affects: ["Student"] },
  function: {
    name: "update_student",
    parameters: [
      { name: "student_id", type: "TYPE_STRING", description: "Student ID" },
      { name: "campus", type: "TYPE_STRING", description: "Campus code" },
      { name: "term", type: "TYPE_STRING", description: "Academic term" },
      { name: "limit", type: "TYPE_NUMBER", description: "Max courses" },
      { name: "customer", type: "TYPE_STRING", description: "Student name" },
      { name: "studentPhone", type: "TYPE_STRING", description: "Phone" },
      { name: "profile", type: "TYPE_OBJECT", description: "Packed profile" },
    ],
  },
};

const rowAction = {
  id: "archive-student",
  name: "Archive student",
  status: "PUBLISHED",
  codeHash: "c".repeat(64),
  target: { className: "Student", keyParameter: "student_id" },
  definition: { affects: ["Student"] },
  function: {
    name: "archive_student",
    parameters: [
      { name: "student_id", type: "TYPE_STRING", description: "Student ID" },
      { name: "campus", type: "TYPE_STRING", description: "Campus code" },
      { name: "rowId", type: "TYPE_STRING", description: "Row ID" },
      { name: "reason", type: "TYPE_STRING", description: "Archive reason" },
    ],
  },
};

const literalOnlyAction = {
  id: "sync-campus",
  name: "Sync campus",
  status: "PUBLISHED",
  codeHash: "d".repeat(64),
  target: null,
  definition: { affects: ["Student"] },
  function: {
    name: "sync_campus",
    parameters: [
      { name: "campus", type: "TYPE_STRING", description: "Campus code" },
      { name: "limit", type: "TYPE_NUMBER", description: "Max batch" },
    ],
  },
};

describe("customer Action boundParams materialization into input.values", () => {
  let intents: Map<string, PanelOperationIntent>;
  let humanAnswer: object | null;
  let formCalls: Array<Record<string, unknown>>;
  let projections: Record<string, Record<string, unknown>>;
  let currentPanel: Record<string, unknown>;
  let currentUse: Record<string, unknown>;

  beforeEach(() => {
    intents = new Map();
    humanAnswer = null;
    formCalls = [];

    projections = {
      "proj-create-form": {
        id: "proj-create-form",
        name: "Student create form",
        description: "",
        visibility: "domain",
        componentId: "@ontomato/sdk:ObjectForm",
        inputs: { activeTerm: { kind: "scalar", type: "string" } },
        outputs: {},
        config: {},
        data: {
          createForm: {
            source: { type: { kind: "ObjectType", id: "Student" } },
            read: "createForm",
            params: {},
          },
        },
        operations: {
          save: {
            operation: { kind: "Action", id: "create-student" },
            params: {
              campus: { literal: "north" },
              term: { input: "activeTerm" },
              limit: { literal: 10 },
              tags: { literal: ["vip", "edu"] },
              cleared: { literal: null },
              studentPhone: { formField: "/phone" },
              profile: { formFields: { grade: "/grade", note: "/note" } },
            },
          },
        },
      },
      "proj-edit-form": {
        id: "proj-edit-form",
        name: "Student edit form",
        description: "",
        visibility: "domain",
        componentId: "@ontomato/sdk:ObjectForm",
        inputs: {
          target: { kind: "object", objectType: "Student" },
          activeTerm: { kind: "scalar", type: "string" },
        },
        outputs: {},
        config: {},
        data: {
          form: {
            source: { object: { input: "target" } },
            read: "form",
            params: {},
          },
        },
        operations: {
          save: {
            operation: { kind: "Action", id: "update-student" },
            target: { input: "target" },
            params: {
              campus: { literal: "north" },
              term: { input: "activeTerm" },
              limit: { literal: 10 },
              studentPhone: { formField: "/phone" },
              profile: { formFields: { grade: "/grade", note: "/note" } },
            },
          },
        },
      },
      "proj-student-list": {
        id: "proj-student-list",
        name: "Student list",
        description: "",
        visibility: "domain",
        componentId: "@ontomato/sdk:ObjectList",
        inputs: {},
        outputs: {},
        config: {},
        data: {
          rows: {
            source: { type: { kind: "ObjectType", id: "Student" } },
            read: "query",
            params: {},
          },
        },
        operations: {
          archive: {
            operation: { kind: "Action", id: "archive-student" },
            target: { row: true },
            params: {
              campus: { literal: "north" },
              rowId: { row: "primaryKey" },
            },
          },
        },
      },
      "proj-sync-btn": {
        id: "proj-sync-btn",
        name: "Sync campus",
        description: "",
        visibility: "domain",
        componentId: "@ontomato/sdk:OperationButton",
        inputs: {},
        outputs: {},
        config: { operation: "sync" },
        data: {},
        operations: {
          sync: {
            operation: { kind: "Action", id: "sync-campus" },
            params: {
              campus: { literal: "north" },
              limit: { literal: 50 },
            },
          },
        },
      },
    };

    currentUse = {
      id: "students-use",
      panelId: "panel-students",
      pageKey: "students",
      path: "/applications/app-1/students",
      access: { kind: "domain-member" },
      inputs: {
        pinnedTerm: { literal: "2026-fall" },
      },
    };

    currentPanel = {
      id: "panel-students",
      manifest: {
        state: {
          selectedStudent: { type: { kind: "object", objectType: "Student" }, personal: false, deepLink: false, external: false },
          pinnedTerm: { type: { kind: "scalar", type: "string" }, personal: false, deepLink: false, external: false },
        },
        members: {
          createForm: {
            target: { projectionId: "proj-create-form" },
            inputs: { activeTerm: { state: "pinnedTerm" } },
          },
          editForm: {
            target: { projectionId: "proj-edit-form" },
            inputs: {
              target: { state: "selectedStudent" },
              activeTerm: { state: "pinnedTerm" },
            },
          },
          studentList: {
            target: { projectionId: "proj-student-list" },
          },
          syncBtn: {
            target: { projectionId: "proj-sync-btn" },
          },
        },
      },
    };

    mocks.useEntry.mockImplementation(async () => ({ use: currentUse, framePanelId: undefined }));
    mocks.panel.mockImplementation(async () => currentPanel);
    mocks.projection.mockImplementation(async (id: string) => projections[id]);
    mocks.pages.mockResolvedValue({ byId: new Map() });
    mocks.resolveMember.mockResolvedValue(skill);
    mocks.loadedMember.mockImplementation((ref, loaded: RuntimeRun["resolvedSkills"]) =>
      loaded.find(entry => JSON.stringify(entry.skill) === JSON.stringify(ref)) ?? null);
    mocks.resolve.mockResolvedValue({ executionUserId: null, credentials });
    mocks.restore.mockResolvedValue({ owner });
    mocks.run.mockResolvedValue({
      run: {
        id: uuid(2),
        sessionId: uuid(3),
        status: "running",
        executionUserId: null,
        resolvedSkills: [{ skill, version: "1" }],
        channel: {
          agent: { providerId: "web" },
          userRecipient: { session: root },
          authority: { executionKind: "live" },
        },
      },
    });
    mocks.session.mockImplementation(async () => ({ messages: humanAnswer ? [{ message: humanAnswer }] : [] }));
    mocks.request.mockImplementation(async (path: string, _method: string, body: { source: unknown }) =>
      path === "/v1/channel/user-questions"
        ? {
            questionId: uuid(10),
            source: body.source,
            recipient: { session: root, actor: { id: uuid(4), domainId: "d" } },
          }
        : {
            questionId: uuid(10),
            answerId: uuid(11),
            source: { kind: "user" },
            respondent: { id: uuid(12), domainId: "d" },
            recipientSession: root,
            selectedOption: 1,
            text: "Execute",
          });

    mocks.query.mockImplementation(async (sql: string, args: unknown[]) => {
      const id = String(args[sql.startsWith("SELECT intent,owner_id") ? 1 : 2]);
      if (sql.startsWith("SELECT confirm_before")) return { rows: [] };
      if (sql.startsWith("SELECT intent")) {
        return { rows: intents.has(id) ? [{ intent: structuredClone(intents.get(id)), owner_id: owner.userId }] : [] };
      }
      if (sql.startsWith("INSERT INTO panel_operation_intents")) {
        if (!intents.has(String(args[1]))) intents.set(String(args[1]), structuredClone(args[4] as PanelOperationIntent));
        return { rows: [] };
      }
      if (sql.includes("jsonb_set(intent,'{invalidated}'")) return { rowCount: 0 };
      if (sql.includes("AND intent->>'dispatched'='false'")) {
        const value = intents.get(id)!;
        if (value.dispatched) return { rowCount: 0 };
        intents.set(id, structuredClone(args[3] as PanelOperationIntent));
        return { rowCount: 1 };
      }
      if (sql.includes("jsonb_set")) {
        intents.get(id)!.outcome = JSON.parse(String(args[3]));
        return { rowCount: 1 };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const actionsById: Record<string, unknown> = {
      "create-student": createStudentAction,
      "update-student": updateStudentAction,
      "archive-student": rowAction,
      "sync-campus": literalOnlyAction,
    };

    mocks.backendPost.mockImplementation(async (_url: string, path: string, body: unknown) => {
      if (path === "/ontology/objects/query") {
        const { className, filter } = body as { className: string; filter: { conditions: Array<{ value: string }> } };
        const pk = filter.conditions[0]?.value ?? "stu-1";
        return {
          success: true,
          data: {
            records: [{ className, primaryKey: pk, label: `Student ${pk}`, fields: { id: pk, name: "Alice" } }],
            total: 1,
          },
        };
      }
      return { success: true, data: {} };
    });

    mocks.backendGet.mockResolvedValue({
      success: true,
      data: {
        className: "Student",
        displayName: "Student",
        attributes: [
          { name: "id", displayName: "ID", dataType: "STRING", primaryKey: true },
          { name: "name", displayName: "Name", dataType: "STRING", titleKey: true },
        ],
      },
    });

    vi.stubGlobal("fetch", vi.fn(async (url: string, init: NonNullable<Parameters<typeof fetch>[1]>) => {
      if (url.endsWith("/action/queryById")) {
        const { id } = JSON.parse(String(init.body)) as { id: string };
        return Response.json({ success: true, data: actionsById[id] ?? null });
      }
      if (url.endsWith("/action/form")) {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        if (body.values) formCalls.push(body);
        const values = (body.values as Record<string, string> | undefined) ?? {};
        const fields = Object.keys(values).map(key => ({
          key,
          label: key,
          required: false,
          defaultValue: null,
          help: null,
          type: "text" as const,
          multiline: false,
          placeholder: null,
          maxLength: 200,
        }));
        return Response.json({
          success: true,
          data: {
            fields,
            values,
            errors: [],
            parameters: body.values ? { ...(body.parameters as Record<string, unknown>), ...values } : null,
          },
        });
      }
      if (url.endsWith("/action/execute")) {
        return Response.json({
          success: true,
          data: { result: "{\"ok\":true}", error: null, spendTime: 3, affects: ["Student"], partialQuery: null },
        });
      }
      throw new Error(`Unexpected fetch ${url}`);
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("merges literal and pinned input params into input.values for untargeted create Action (human & agent) without top-level leakage", async () => {
    // 1. Human channel: client supplies matching bound values alongside same-name, formField, and formFields values.
    const humanPrep = await prepareHumanPanelOperation(owner, credentials, {
      applicationId: "app-1",
      useId: "students-use",
      operationId: "createForm.save",
      call: {
        target: null,
        input: {
          values: {
            campus: "north",
            term: "2026-fall",
            limit: "10",
            tags: JSON.stringify(["vip", "edu"]),
            cleared: "null",
            customer: "Alice",
            studentPhone: "13800001111",
            profile: JSON.stringify({ grade: "G3", note: "honor" }),
          },
        },
      },
    });

    const storedHuman = intents.get(humanPrep.intentId)!;
    expect("call" in storedHuman && Object.keys(storedHuman.call.input)).toEqual(["values"]);

    const humanDone = await dispatchHumanPanelOperation(owner, credentials, humanPrep.intentId);
    expect(humanDone).toMatchObject({ kind: "dispatched", outcome: { kind: "success" } });
    expect(formCalls).toHaveLength(1);
    expect(formCalls[0]).toEqual({
      id: "create-student",
      parameters: {},
      readOnlyParameters: [],
      values: {
        campus: "north",
        term: "2026-fall",
        limit: "10",
        tags: "[\"vip\",\"edu\"]",
        cleared: "null",
        customer: "Alice",
        studentPhone: "13800001111",
        profile: "{\"grade\":\"G3\",\"note\":\"honor\"}",
      },
    });

    // 2. Agent channel: caller omits all fixed literal/pinned-input params; server injects them into input.values.
    const operated = await prepareHumanPanelOperation(owner, credentials, {
      agentRun: { runId: uuid(2), sessionId: uuid(3), toolCallId: "fill-save" },
      applicationId: "app-1",
      useId: "students-use",
      operationId: "createForm.save",
      call: {
        target: null,
        input: {
          values: {
            customer: "Bob",
            studentPhone: "13900002222",
            profile: JSON.stringify({ grade: "G4", note: "new" }),
          },
        },
      },
    }, "Alice");
    const storedAgent = intents.get(operated.intentId)!;
    expect(storedAgent.source.kind).toBe("agent-page");
    expect("call" in storedAgent && Object.keys(storedAgent.call.input)).toEqual(["values"]);

    const agentDone = await dispatchHumanPanelOperation(owner, credentials, operated.intentId);
    expect(agentDone).toMatchObject({ kind: "dispatched", outcome: { kind: "success" } });
    expect(formCalls[1]).toEqual({
      id: "create-student",
      parameters: {},
      readOnlyParameters: [],
      values: {
        campus: "north",
        term: "2026-fall",
        limit: "10",
        tags: "[\"vip\",\"edu\"]",
        cleared: "null",
        customer: "Bob",
        studentPhone: "13900002222",
        profile: "{\"grade\":\"G4\",\"note\":\"new\"}",
      },
    });

    // 3. Literal-only button Action succeeds even when caller sends empty input `{}`.
    const syncPrep = await prepareHumanPanelOperation(owner, credentials, {
      applicationId: "app-1",
      useId: "students-use",
      operationId: "syncBtn.sync",
      call: { target: null, input: {} },
    });
    const syncDone = await dispatchHumanPanelOperation(owner, credentials, syncPrep.intentId);
    expect(syncDone).toMatchObject({ kind: "dispatched", outcome: { kind: "success" } });
    expect(formCalls[2]).toEqual({
      id: "sync-campus",
      parameters: {},
      readOnlyParameters: [],
      values: { campus: "north", limit: "50" },
    });
  });

  it("merges literal and pinned input params into input.values for targeted edit Action and ObjectList row Action", async () => {
    const target = { kind: "object" as const, objectType: "Student", primaryKey: "stu-42" };

    // 1. Targeted edit Action combining literal + pinned input + same-name + formField + formFields.
    const editPrep = await prepareHumanPanelOperation(owner, credentials, {
      applicationId: "app-1",
      useId: "students-use",
      operationId: "editForm.save",
      call: {
        target,
        input: {
          values: {
            customer: "Alice Updated",
            studentPhone: "13800009999",
            profile: JSON.stringify({ grade: "G5", note: "promoted" }),
          },
        },
      },
    });
    const storedEdit = intents.get(editPrep.intentId)!;
    expect("call" in storedEdit && Object.keys(storedEdit.call.input)).toEqual(["values"]);

    const editDone = await dispatchHumanPanelOperation(owner, credentials, editPrep.intentId);
    expect(editDone).toMatchObject({ kind: "dispatched", outcome: { kind: "success" } });
    expect(formCalls[0]).toEqual({
      id: "update-student",
      parameters: { student_id: "stu-42" },
      readOnlyParameters: ["student_id"],
      values: {
        campus: "north",
        term: "2026-fall",
        limit: "10",
        customer: "Alice Updated",
        studentPhone: "13800009999",
        profile: "{\"grade\":\"G5\",\"note\":\"promoted\"}",
      },
    });

    // 2. ObjectList row-targeted Action with literal + row primaryKey bound params.
    const rowPrep = await prepareHumanPanelOperation(owner, credentials, {
      applicationId: "app-1",
      useId: "students-use",
      operationId: "studentList.archive",
      call: {
        target,
        input: {
          values: { reason: "graduated" },
        },
      },
    });
    const rowDone = await dispatchHumanPanelOperation(owner, credentials, rowPrep.intentId);
    expect(rowDone).toMatchObject({ kind: "dispatched", outcome: { kind: "success" } });
    expect(formCalls[1]).toEqual({
      id: "archive-student",
      parameters: { student_id: "stu-42" },
      readOnlyParameters: ["student_id"],
      values: {
        campus: "north",
        rowId: "stu-42",
        reason: "graduated",
      },
    });
  });

  it("rejects client tampering in input.values with 403 OPERATION_PARAM_MISMATCH and rejects changed bindings on dispatch", async () => {
    const target = { kind: "object" as const, objectType: "Student", primaryKey: "stu-42" };

    // 1. Tampered text literal on untargeted create Action (human channel).
    await expect(prepareHumanPanelOperation(owner, credentials, {
      applicationId: "app-1",
      useId: "students-use",
      operationId: "createForm.save",
      call: {
        target: null,
        input: { values: { campus: "south", customer: "Alice" } },
      },
    })).rejects.toMatchObject({ status: 403, code: "OPERATION_PARAM_MISMATCH" });

    // 2. Tampered pinned input on targeted edit Action (agent channel).
    await expect(prepareHumanPanelOperation(owner, credentials, {
      agentRun: { runId: uuid(2), sessionId: uuid(3), toolCallId: "tampered-save" },
      applicationId: "app-1",
      useId: "students-use",
      operationId: "editForm.save",
      call: {
        target,
        input: { values: { term: "2025-spring", customer: "Alice" } },
      },
    }, "Alice")).rejects.toMatchObject({ status: 403, code: "OPERATION_PARAM_MISMATCH" });

    // 3. Tampered JSON literal value or wrong JSON encoding on create Action.
    await expect(prepareHumanPanelOperation(owner, credentials, {
      applicationId: "app-1",
      useId: "students-use",
      operationId: "createForm.save",
      call: {
        target: null,
        input: { values: { limit: "99", customer: "Alice" } },
      },
    })).rejects.toMatchObject({ status: 403, code: "OPERATION_PARAM_MISMATCH" });

    await expect(prepareHumanPanelOperation(owner, credentials, {
      applicationId: "app-1",
      useId: "students-use",
      operationId: "createForm.save",
      call: {
        target: null,
        input: { values: { limit: "\"10\"", customer: "Alice" } },
      },
    })).rejects.toMatchObject({ status: 403, code: "OPERATION_PARAM_MISMATCH" });

    // 4. Tampered row primaryKey on ObjectList row Action.
    await expect(prepareHumanPanelOperation(owner, credentials, {
      applicationId: "app-1",
      useId: "students-use",
      operationId: "studentList.archive",
      call: {
        target,
        input: { values: { rowId: "stu-other", reason: "tamper" } },
      },
    })).rejects.toMatchObject({ status: 403, code: "OPERATION_PARAM_MISMATCH" });

    // 5. Extraneous top-level key alongside values is still rejected by objectActionInputSchema.strict().
    await expect(prepareHumanPanelOperation(owner, credentials, {
      applicationId: "app-1",
      useId: "students-use",
      operationId: "createForm.save",
      call: {
        target: null,
        input: { campus: "south", values: { customer: "Alice" } },
      },
    })).rejects.toThrow();

    // 6. Changing the panel's bound literal between prepare and dispatch triggers 409 INTENT_CHANGED.
    const prep = await prepareHumanPanelOperation(owner, credentials, {
      applicationId: "app-1",
      useId: "students-use",
      operationId: "createForm.save",
      call: { target: null, input: { values: { customer: "Alice" } } },
    });
    const ops = projections["proj-create-form"]!.operations as { save: { params: Record<string, unknown> } };
    ops.save.params.campus = { literal: "south" };
    await expect(dispatchHumanPanelOperation(owner, credentials, prep.intentId))
      .rejects.toMatchObject({ status: 409, code: "INTENT_CHANGED" });
  });
});
