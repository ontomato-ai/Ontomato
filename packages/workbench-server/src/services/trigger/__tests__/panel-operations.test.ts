import { describe, expect, it } from "vitest";
import { DELETE_TRIGGER, SET_TRIGGER_STATUS, TRIGGER } from "@ontomato/contracts/panel-client-requests";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import type { PanelOperationHost } from "../../product-panels/server-operations";
import { triggerServerOperations } from "../panel-operations";

configureI18n({
  defaultLocale: "en", appTextLocale: "en", languageSwitchEnabled: false,
  packs: { en: { messages: en, ...enLocaleMeta } },
});

type TriggerOperation = (typeof triggerServerOperations)[number];
const write = (handlerRef: string) =>
  triggerServerOperations.find((item): item is Extract<TriggerOperation, { effect: "write" }> =>
    item.effect === "write" && item.handlerRef === handlerRef)!;
const action = (handlerRef: string) =>
  triggerServerOperations.find((item): item is Extract<TriggerOperation, { effect: "write"; kind: "action"; batch: false }> =>
    item.effect === "write" && item.kind === "action" && item.batch === false && item.handlerRef === handlerRef)!;

function hostWith(answer: (path: string, init: NonNullable<Parameters<typeof fetch>[1]>) => Response) {
  const sent: { path: string; init: NonNullable<Parameters<typeof fetch>[1]> }[] = [];
  const actor = { owner: { domainId: "d", userId: "U" }, credentials: { token: "U-token", locale: "en" } };
  const host: PanelOperationHost = {
    initiator: actor,
    executor: actor,
    async request(path, init) {
      sent.push({ path, init });
      return answer(path, init);
    },
    async requestWorkbench() {
      throw new Error("The trigger owner does not use the workbench request");
    },
  };
  return { host, sent };
}

const triggerTarget = { kind: "object" as const, objectType: TRIGGER, primaryKey: "tr-1" };

describe("trigger panel server operations", () => {
  it("declares save, draft operations, and forwards complete or partial submittedFields saves", async () => {
    const operation = write(`${TRIGGER}.save`);
    expect(operation.kind).toBe("form.save");
    if (operation.kind !== "form.save") throw new Error("not a form save");
    expect(operation.draftOperation({ kind: "draft" })).toBe("trigger.create");
    expect(operation.draftOperation(triggerTarget)).toBe("trigger.update");

    const { host, sent } = hostWith(() => Response.json({ success: true, data: { id: "tr-1", name: "Nightly check" } }));
    const outcome = await operation.execute(host, triggerTarget, {
      values: { name: "Nightly check" },
      submittedFields: ["/name"],
    });
    expect(outcome).toEqual({
      kind: "success",
      data: { id: "tr-1", name: "Nightly check" },
      affected: { objects: [{ objectType: TRIGGER, primaryKey: "tr-1" }], objectTypes: [TRIGGER] },
    });
    expect(sent[0]?.path).toBe("/api/data-query/trigger/save");
    expect(JSON.parse(String(sent[0]?.init.body))).toEqual({
      id: "tr-1", name: "Nightly check", submittedFields: ["/name"],
    });
  });

  it("keeps structured field refusals from /trigger/save", async () => {
    const operation = write(`${TRIGGER}.save`);
    const { host } = hostWith(() => Response.json({
      success: false,
      code: "TRIGGER_INVALID",
      message: "name is required",
      errors: [{ field: "/name", code: "required", message: "name is required" }],
    }));

    const outcome = await operation.execute(host, { kind: "draft" }, { values: { name: "" } });
    expect(outcome).toEqual({
      kind: "refusal",
      code: "TRIGGER_INVALID",
      message: "name is required",
      errors: [{ field: "/name", code: "required", message: "name is required" }],
    });
  });

  it("changes trigger status and preserves INTERACTIVE_LOGIN_REQUIRED refusals", async () => {
    const operation = action(SET_TRIGGER_STATUS);
    const { host, sent } = hostWith(() => Response.json({ success: true, data: { id: "tr-1", status: "PUBLISHED", enabled: true } }));

    const ok = await operation.execute(host, triggerTarget, { status: "PUBLISHED", enabled: true });
    expect(ok).toEqual({
      kind: "success",
      data: { id: "tr-1", status: "PUBLISHED", enabled: true },
      affected: { objects: [{ objectType: TRIGGER, primaryKey: "tr-1" }], objectTypes: [TRIGGER] },
    });
    expect(sent[0]?.path).toBe("/api/data-query/trigger/status");
    expect(JSON.parse(String(sent[0]?.init.body))).toEqual({ id: "tr-1", status: "PUBLISHED", enabled: true });

    const refusedHost = hostWith(() => Response.json({
      success: false, code: "INTERACTIVE_LOGIN_REQUIRED", message: "Sign in interactively first",
    })).host;
    const refused = await operation.execute(refusedHost, triggerTarget, { status: "PUBLISHED" });
    expect(refused).toEqual({
      kind: "refusal", code: "INTERACTIVE_LOGIN_REQUIRED", message: "Sign in interactively first",
    });
  });

  it("inspects delete impact with trigger label and removes the trigger", async () => {
    const operation = action(DELETE_TRIGGER);
    const { host, sent } = hostWith((path) => {
      if (path === "/api/data-query/trigger/queryById")
        return Response.json({ success: true, data: { id: "tr-1", name: "Nightly check" } });
      return Response.json({ success: true, data: {} });
    });

    const impact = await operation.inspectImpact?.inspect(host, [{
      target: triggerTarget, input: {},
    }]);
    expect(impact).toEqual({
      summary: en["panels.confirmation.deleteTriggerImpact"],
      objects: [{ target: { objectType: TRIGGER, primaryKey: "tr-1" }, label: "Nightly check" }],
      total: 1,
    });

    const removed = await operation.execute(host, triggerTarget, {});
    expect(removed).toEqual({
      kind: "success",
      data: {},
      affected: {
        objects: [{ objectType: TRIGGER, primaryKey: "tr-1" }],
        objectTypes: [TRIGGER],
        removed: [{ objectType: TRIGGER, primaryKey: "tr-1" }],
      },
    });
    expect(sent.map(item => item.path)).toEqual([
      "/api/data-query/trigger/queryById",
      "/api/data-query/trigger/delete",
    ]);
  });
});
