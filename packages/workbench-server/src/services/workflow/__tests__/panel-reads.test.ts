import { afterEach, describe, expect, it, vi } from "vitest";
import { panelRecordListSchema } from "@ontomato/contracts/panel-projection";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import { HttpError } from "../../../utils/errors";
import { createWorkflowReadAdapter } from "../panel-reads";

vi.mock("../../../config/application", () => ({ config: { dataQuery: { baseUrl: "http://owner.test/" } } }));

configureI18n({
  defaultLocale: "en", appTextLocale: "en", languageSwitchEnabled: false,
  packs: { en: { ...enLocaleMeta, messages: en } },
});

const owner = { domainId: "domain-a", userId: "reader" };
const viewer = { token: "reader-token", locale: "en" };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("workflow minimal read-only list", () => {
  it("lists workflows from /workflow/query as panel records", async () => {
    const sent: { path: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: NonNullable<Parameters<typeof fetch>[1]>) => {
      sent.push({ path: new URL(url).pathname, body: JSON.parse(String(init.body)) as Record<string, unknown> });
      return Response.json({
        success: true,
        data: [
          { id: "wf-1", name: "Restock flow", description: "Approve and restock", status: "ACTIVE", version: 2, steps: [{ id: "s1" }, { id: "s2" }] },
          { id: "wf-2", name: "Draft flow", description: null, status: "DRAFT", version: 1, steps: [] },
        ],
      });
    }));

    const records = await createWorkflowReadAdapter(owner, viewer).list();
    expect(panelRecordListSchema.parse(records)).toEqual(records);
    expect(sent).toEqual([{ path: "/workflow/query", body: {} }]);
    expect(records).toEqual([
      {
        primaryKey: "wf-1",
        label: "Restock flow",
        subtitle: "Approve and restock",
        fieldLabels: { status: "Status", version: "Version", stepCount: "Steps" },
        fields: { status: "ACTIVE", version: "2", stepCount: "2" },
        tones: { status: "success" },
      },
      {
        primaryKey: "wf-2",
        label: "Draft flow",
        fieldLabels: { status: "Status", version: "Version", stepCount: "Steps" },
        fields: { status: "DRAFT", version: "1", stepCount: "0" },
        tones: { status: "warning" },
      },
    ]);
  });

  it("reports an owner failure as WORKFLOW_READ_FAILED", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ success: false, message: "Database down" })));
    const err = await createWorkflowReadAdapter(owner, viewer).list().catch((error: unknown) => error);
    expect(err).toBeInstanceOf(HttpError);
    expect([(err as HttpError).status, (err as HttpError).code]).toEqual([500, "WORKFLOW_READ_FAILED"]);
  });
});
