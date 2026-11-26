import { afterEach, describe, expect, it, vi } from "vitest";
import { DELETE_TRIGGER, SET_TRIGGER_STATUS, TRIGGER } from "@ontomato/contracts/panel-client-requests";
import { panelOwnerOperationDescriptorSchema } from "@ontomato/contracts/panel-operations";
import { panelRecordListSchema, panelRecordQuerySchema } from "@ontomato/contracts/panel-projection";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { HttpError } from "../../../utils/errors";
import { createTriggerReadAdapter } from "../panel-reads";

vi.mock("../../../config/application", () => ({ config: { dataQuery: { baseUrl: "http://owner.test/" } } }));
vi.mock("../../assistant/skills", () => ({
  readAssistantSkillView: vi.fn(), resolvePageSkillSource: vi.fn(), loadedPageSkillVersion: vi.fn(),
}));

configureI18n({
  defaultLocale: "en", appTextLocale: "en", languageSwitchEnabled: false,
  packs: { en: { ...enLocaleMeta, messages: en } },
});

const owner = { domainId: "domain-a", userId: "reader" };
const viewer = { token: "reader-token", locale: "en" };
const nightly = {
  id: "tr-1",
  name: "Nightly check",
  description: "Checks inventory every morning",
  version: 3,
  status: "PUBLISHED",
  statusLabel: "Published",
  enabled: true,
  conditionKind: "time",
  conditionKindLabel: "Schedule",
  cadenceSummary: "Daily at 09:00",
  condition: { frequency: { kind: "daily", time: "09:00" }, timeZone: "Asia/Shanghai" },
  effectKind: "action",
  effectKindLabel: "Action",
  effectLabel: "Action · Check stock",
  executor: "",
  executorName: "Alice",
  nextRunAt: "2026-11-23T01:00:00Z",
  lastFiredAt: "2026-11-22T01:00:00Z",
  createdByName: "Alice",
  reviewedByName: "Bob",
  modifyTimestamp: Date.UTC(2026, 10, 22, 8, 30),
};
const triggerForm = {
  fields: [
    {
      path: "/name", label: "Name", required: true, readOnly: false,
      control: { kind: "text" }, valueSchema: { type: "string" },
    },
    {
      path: "/condition/frequency", label: "Schedule", required: true, readOnly: false,
      control: { kind: "frequency" }, valueSchema: { type: "object" },
    },
  ],
  values: { name: "Nightly check", condition: { frequency: { kind: "daily", time: "09:00" }, timeZone: "Asia/Shanghai" } },
  errors: [],
  save: { method: "POST", path: "/trigger/save", bodySchema: { type: "object" } },
};
const triggerFormWithStatus = {
  ...triggerForm,
  fields: [
    ...triggerForm.fields,
    {
      path: "/status",
      label: "Status",
      required: true,
      readOnly: false,
      control: {
        kind: "select",
        options: [
          { value: "PENDING_REVIEW", label: "Draft", description: null, disabled: false, disabledReason: null },
          { value: "PUBLISHED", label: "Publish", description: null, disabled: false, disabledReason: null },
          { value: "UNUSED", label: "Retired", description: null, disabled: false, disabledReason: null },
        ],
      },
      valueSchema: { type: "string", enum: ["PENDING_REVIEW", "PUBLISHED", "UNUSED"] },
    },
  ],
  values: { ...triggerForm.values, status: "UNUSED" },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function ownerAnswering(answers: Record<string, (body: Record<string, unknown>) => Response>) {
  const sent: { path: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: NonNullable<Parameters<typeof fetch>[1]>) => {
    const headers = new Headers(init.headers);
    expect(headers.get("tk")).toBe(viewer.token);
    expect(headers.get("Accept-Language")).toBe(viewer.locale);
    const path = new URL(url).pathname;
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    sent.push({ path, body });
    const answer = answers[path];
    if (init.method !== "POST" || !answer) throw new Error(`Unexpected owner request ${init.method} ${path}`);
    return answer(body);
  }));
  return sent;
}

const ok = (data: unknown) => () => Response.json({ success: true, data });

describe("trigger catalog reads", () => {
  it.each([2, 80])("lists and queries %i triggers with at most one owner RPC per read", async size => {
    const extra = Array.from({ length: size - 2 }, (_, i) => ({
      ...nightly, id: `trigger-${i}`, name: `Nightly check ${i}`, enabled: false,
    }));
    const listed = ok([
      nightly,
      {
        ...nightly,
        id: "tr-2",
        name: "Weekly restock",
        description: "",
        version: null,
        status: "PENDING_REVIEW",
        statusLabel: "Draft",
        enabled: false,
        cadenceSummary: null,
        effectLabel: "Workflow · Restock",
      },
      ...extra,
    ]);
    const sent = ownerAnswering({
      "/trigger/queryList": body => body.countOnly === true
        ? Response.json({ success: true, data: { total: size } })
        : listed(),
    });

    const adapter = createTriggerReadAdapter(owner, viewer);
    const records = await adapter.list();
    expect(records).toHaveLength(size);
    expect(sent.length).toBeLessThanOrEqual(1);
    expect(panelRecordListSchema.parse(records)).toEqual(records);
    expect(records[0]).toMatchObject({
      primaryKey: "tr-1",
      label: "Nightly check",
      subtitle: "Checks inventory every morning",
      fields: {
        status: "Published",
        statusCode: "PUBLISHED",
        version: 3,
        triggerTitle: ["Nightly check", "v3"],
        enabled: true,
        conditionKind: "Schedule",
        cadence: "Daily at 09:00",
        condition: "Daily at 09:00",
        timeZone: "Asia/Shanghai",
        effect: "Action · Check stock",
        executor: "Alice",
        nextRunAt: "2026-11-23T01:00:00Z",
        lastFiredAt: "2026-11-22T01:00:00Z",
        createdBy: "Alice",
        reviewedBy: "Bob",
        updatedAt: "2026-11-22T08:30:00.000Z",
      },
      tones: { status: "success", enabled: "success" },
    });
    expect(records[1]).toMatchObject({
      primaryKey: "tr-2",
      fields: {
        status: "Draft",
        statusCode: "PENDING_REVIEW",
        version: 1,
        triggerTitle: ["Weekly restock", "v1"],
        conditionKind: "Schedule",
        cadence: "",
      },
      tones: { status: "info", enabled: "info" },
    });

    const beforeSearch = sent.length;
    const searched = await adapter.query({ search: "restock", size: 1 });
    expect(panelRecordQuerySchema.parse(searched)).toEqual(searched);
    expect(searched.total).toBe(1);
    expect(searched.rows.map(row => row.primaryKey)).toEqual(["tr-2"]);
    expect(sent.length - beforeSearch).toBeLessThanOrEqual(1);

    const beforePage = sent.length;
    const paged = await adapter.query({ size: 1 });
    expect(paged.total).toBe(size);
    expect(paged.nextCursor).toBe("1");
    expect(sent.length - beforePage).toBeLessThanOrEqual(1);

    expect(await adapter.count()).toEqual({ rows: [], total: size });
    expect(await adapter.armedCount()).toEqual({ rows: [], total: 1 });
  });

  it("reads one record, edit form, create form, and operation descriptors", async () => {
    const sent = ownerAnswering({
      "/trigger/queryById": ok(nightly),
      "/trigger/form": ok(triggerForm),
    });

    const adapter = createTriggerReadAdapter(owner, viewer);
    expect((await adapter.record("tr-1")).label).toBe("Nightly check");
    expect(await adapter.form("tr-1", { values: { name: "Nightly check" }, changedField: "/effectKind" })).toEqual(triggerForm);
    expect(await adapter.createForm({ changedField: null })).toEqual(triggerForm);
    expect(sent).toEqual([
      { path: "/trigger/queryById", body: { id: "tr-1" } },
      { path: "/trigger/form", body: { target: { kind: "object", objectType: TRIGGER, primaryKey: "tr-1" }, values: { name: "Nightly check" }, changedField: "/effectKind" } },
      { path: "/trigger/form", body: { target: { kind: "draft" }, changedField: null } },
    ]);

    expect(panelOwnerOperationDescriptorSchema.parse(await adapter[`${SET_TRIGGER_STATUS}.describe`]()).handlerRef).toBe(SET_TRIGGER_STATUS);
    expect(panelOwnerOperationDescriptorSchema.parse(await adapter[`${DELETE_TRIGGER}.describe`]()).handlerRef).toBe(DELETE_TRIGGER);
  });

  it("restricts form status options to PUBLISHED and PENDING_REVIEW and maps UNUSED edit baseline to PENDING_REVIEW", async () => {
    ownerAnswering({
      "/trigger/form": ok(triggerFormWithStatus),
    });

    const adapter = createTriggerReadAdapter(owner, viewer);
    const editForm = await adapter.form("tr-2", { changedField: null });
    const statusField = editForm.fields.find(field => field.path === "/status");
    expect(statusField?.control).toMatchObject({
      kind: "select",
      options: [
        { value: "PUBLISHED", label: "Publish" },
        { value: "PENDING_REVIEW", label: "Draft" },
      ],
    });
    expect(statusField?.valueSchema).toMatchObject({ type: "string", enum: ["PUBLISHED", "PENDING_REVIEW"] });
    expect(editForm.values.status).toBe("PENDING_REVIEW");

    const createForm = await adapter.createForm({ changedField: null });
    const createStatusField = createForm.fields.find(field => field.path === "/status");
    expect(createStatusField?.control).toMatchObject({
      kind: "select",
      options: [
        { value: "PUBLISHED", label: "Publish" },
        { value: "PENDING_REVIEW", label: "Draft" },
      ],
    });
  });

  it("preserves coded owner refusals on missing trigger reads", async () => {
    ownerAnswering({
      "/trigger/queryById": () => Response.json({ success: false, code: "TRIGGER_NOT_FOUND", message: "Trigger not found" }),
    });
    const refused = await createTriggerReadAdapter(owner, viewer).record("missing").catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(HttpError);
    expect([(refused as HttpError).status, (refused as HttpError).code]).toEqual([404, "TRIGGER_NOT_FOUND"]);
  });
});
