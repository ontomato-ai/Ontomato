import { afterEach, describe, expect, it, vi } from "vitest";
import { ElMessage } from "element-plus";
import publicEn from "@ontomato/workbench-ui/locales/en";
import { agentHostObjectChangedFrameSchema } from "@ontomato/contracts/agent-host";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import { EXECUTE_OBJECT_ACTION } from "@ontomato/contracts/platform-object-types";
import {
  createOrderAction, customerActionDispatchFixture, customerActionRequest, orderPanel,
  orderFormProjection, owner, root, uuid,
} from "../../../../../packages/workbench-server/src/services/product-panels/__tests__/customer-action-dispatch-fixture";
import { describeObjectAction, objectActionDeclaration } from "../../../../../packages/workbench-server/src/services/action/object-actions";
import { openPresentationView } from "../../../../../packages/workbench-server/src/services/agent-host/presentation";
import { baseRecord, mountCreatePanel, ready } from "./customer-action-form-fixture";

afterEach(() => {
  ElMessage.closeAll();
  document.body.innerHTML = "";
});

describe("customer form save over /operate", () => {
  const fixture = customerActionDispatchFixture();

  it("invalidates on Discard, rejects invalidation during claim, and settles the mounted form on success", async () => {
    const projection: DirectProjection = { ...baseRecord, ...orderFormProjection };
    const descriptor = describeObjectAction({
      object: null, keyParameter: null, actionId: createOrderAction.id, codeHash: createOrderAction.codeHash,
      name: createOrderAction.name, declaration: objectActionDeclaration(createOrderAction),
      affects: ["Order", "AuditLog"],
    });
    expect(descriptor.handlerRef).toBe(EXECUTE_OBJECT_ACTION);
    let listReads = 0;
    const harness = mountCreatePanel({
      manifest: {
        ...orderPanel.manifest,
        members: { ...orderPanel.manifest.members, orderList: { target: { projectionId: "orders" } } },
      },
      projections: {
        [projection.id]: projection,
        orders: {
          ...baseRecord, id: "orders", name: "Orders", componentId: "@ontomato/sdk:ObjectList",
          inputs: {}, outputs: { selected: { kind: "object", objectType: "Order" } }, config: {},
          data: { rows: { source: { type: { kind: "ObjectType", id: "Order" } }, read: "query", params: {} } },
        },
      },
      answer: (request) => {
        if (request.operations) return ready({ save: descriptor });
        if (request.dataName === "rows") {
          listReads++;
          return ready({ rows: listReads === 1 ? [] : [{ primaryKey: "created", label: "Live order", fields: {} }], total: listReads - 1 });
        }
        return ready({
          fields: [
            { path: "/customer", label: "Customer", valueSchema: { type: "string" }, required: true, readOnly: false, control: { kind: "text" } },
            { path: "/amount", label: "Amount", valueSchema: { type: "number" }, required: true, readOnly: false, control: { kind: "number" } },
          ],
          values: request.runtimeParams?.values ?? { customer: "", amount: 0 },
          errors: [],
          save: { method: "POST", path: "/ontology/objects/Order", bodySchema: {}, draftOperation: "Order.create" },
        });
      },
    });
    const view = new AbortController();
    const receiveFrame = vi.fn((value: unknown) => {
      const frame = agentHostObjectChangedFrameSchema.parse(value);
      expect(frame.session).toEqual(root);
      expect(frame.operation?.operationId).toBe("orderForm.save");
      harness.instance.refresh(frame.affected!, frame.operation);
    });
    openPresentationView("workbench", owner, "test-view", receiveFrame, view.signal);
    let edited: Promise<unknown>;
    harness.instance.onFormEdited((target) => {
      edited = customerActionRequest("/panel-operations/form-edited", { rootSession: root, target });
    });
    const operationPath = `/${uuid(2)}/panels`;
    const dispatch = (id: string) => customerActionRequest(`${operationPath}/intents/${id}/dispatch`, {});
    const customerInput = () => harness.element.querySelector<HTMLInputElement>('[data-field="/customer"] input')!;
    async function requestSave(intentId: string, customer: string) {
      const draft = { pageKey: "customer-orders", operation: "Order.create", target: { objectType: "Order" }, form: { customer, amount: 42 } };
      const link = { sessionId: root.sessionId, runId: uuid(2), path: `outputs/drafts/${intentId}.page-draft.json` };
      const instance = harness.instance;
      instance.forms.hold(draft, link, instance.receiveDraft, () => true, () => {}, instance.rollbackDraft);
      await vi.waitFor(() => expect(customerInput()?.value).toBe(customer));
      const { save } = instance.pageContext.value.forms!.find(({ member }) => member === "orderForm")!;
      expect(save?.call.input).toEqual({ values: { customer, amount: "42" } });
      expect(await customerActionRequest(`${operationPath}/operate`, {
        applicationId: "app-1", useId: "orders-use", intentId, ...save,
      })).toMatchObject({ kind: "confirmation-required", intentId });
      fixture.approve(intentId);
    }

    try {
      await vi.waitFor(() => expect(listReads).toBe(1));
      const discarded = uuid(31);
      await requestSave(discarded, "Discarded order");
      harness.instance.forms.discard("orderForm");
      expect(await edited!).toEqual({ invalidated: 1 });
      expect(await dispatch(discarded)).toMatchObject({ kind: "not-dispatched", code: "FORM_CONFIRMATION_STALE" });

      const raced = uuid(32);
      await requestSave(raced, "Raced order");
      const restoreQuery = fixture.invalidateAtClaim(raced);
      expect(await dispatch(raced)).toMatchObject({ kind: "not-dispatched", code: "FORM_CONFIRMATION_STALE" });
      restoreQuery();
      expect(receiveFrame).not.toHaveBeenCalled();
      expect(harness.savedEvents).toEqual([]);
      expect(listReads).toBe(1);
      harness.instance.forms.discard("orderForm");
      await edited!;

      const confirmed = uuid(33);
      await requestSave(confirmed, "Live order");
      expect(await dispatch(confirmed)).toMatchObject({ kind: "dispatched", outcome: { kind: "success" } });
      expect(receiveFrame).toHaveBeenCalledTimes(1);
      expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith("/action/execute"))).toHaveLength(1);
      expect(harness.savedEvents).toEqual([{ className: "Order", primaryKey: null }]);
      expect(harness.prepared).toHaveLength(0);
      expect(harness.instance.forms.dirty("orderForm")).toBe(false);
      expect(harness.instance.draft.value).toBeNull();
      expect(harness.instance.pageContext.value.forms?.[0]).toMatchObject({ dirty: false, values: { customer: "", amount: 0 } });
      expect(harness.instance.pageContext.value.forms?.[0]?.save).toBeUndefined();
      await vi.waitFor(() => expect(listReads).toBe(2));
      await vi.waitFor(() => expect(customerInput().value).toBe(""));
      const cancel = [...harness.element.querySelectorAll("button")].find(button => button.textContent?.trim() === publicEn.platform.cancel)!;
      cancel.click();
      expect(await edited!).toEqual({ invalidated: 0 });
    } finally {
      view.abort();
      harness.unmount();
    }
  });
});
