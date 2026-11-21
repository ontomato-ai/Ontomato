import { expect, it } from "vitest";
import { effectScope, nextTick, type ComputedRef } from "vue";
import { definePanel } from "@ontomato/contracts/panel-manifest";
import { BUSINESS_KNOWLEDGE } from "@ontomato/contracts/platform-object-types";
import type { ProductProjection } from "@ontomato/contracts/product-panels";
import { createDirectPanelInstance, type MemberDataState, type MemberInputs } from "../../../../../packages/apps-sdk/src/panel/direct";
import { slotInputValues } from "../../../../../packages/apps-sdk/src/panel/ports";
import { createPanelText } from "../../../../../packages/apps-sdk/src/panel/text";
import { noOperations } from "./panel-frame";
import type { PanelMemberReadRequest } from "../../../../../packages/apps-sdk/src/panel/direct";

/*
 * A member's parameters, as its component sets them through one interface (big main's rule, 2026-11-20): a read's
 * parameter the projection does not map is an input of the same name. Its value is the projection's mapping if it has
 * one; else the panel state the member binds it to (its input, or its output, of that name), which is the author's
 * binding and goes to the owner as an input; else the member's own value, which lives in the member alone and goes as a
 * run-time parameter. A datum is read again whenever a value it takes changes.
 *
 * What this rules out: a search the author bound to the panel's state sent as the component's own; a page the component
 * keeps sent as the author's; an output (the selection) sent to the owner as if it were a read's input; a read that does
 * not follow a value it takes; a member's own value leaking to another; a form's values the projection does not map
 * lost instead of going as the component's own.
 */

const record = { domainId: "d", ownerId: "o", revision: 1, createdAt: "", updatedAt: "", editable: false, visibility: "domain" as const, description: "" };
const knowledge: ProductProjection = {
  ...record, id: "knowledge-list", name: "Knowledge", componentId: "@ontomato/sdk:ObjectList",
  inputs: {}, outputs: {}, config: {},
  data: { rows: { source: { type: { kind: "PlatformObjectType", id: BUSINESS_KNOWLEDGE } }, read: "query", params: {} } },
};
const manifest = definePanel({
  state: {
    q: { type: { kind: "scalar", type: "string" }, deepLink: true },
    picked: { type: { kind: "object", objectType: BUSINESS_KNOWLEDGE } },
  },
  members: {
    // The author binds the search to the page's own state, and the selection to an output; the page is the list's own.
    list: { target: { projectionId: knowledge.id }, inputs: { search: { state: "q" } }, outputs: { selected: { state: "picked" } } },
    other: { target: { projectionId: knowledge.id } },
  },
  commands: {},
});

it("sends what the panel's state binds as the author's input and what the member keeps as its own run-time value", async () => {
  const reads: PanelMemberReadRequest[] = [];
  const instance = createDirectPanelInstance(manifest, {
    pageKey: "knowledge", url: () => "/ontology/knowledge", label: () => "Knowledge", initial: {},
    text: createPanelText({}, { value: "en" } as never, "en"), ...noOperations, recordDraftCreated: async () => {},
    readProjection: async () => knowledge,
    read: async (request) => {
      reads.push(request);
      return { status: "ready", value: { rows: [] } as never };
    },
  });
  const inputsOf = (member: string) => () => slotInputValues(manifest, member, instance.state.values.value) as MemberInputs;
  const scope = effectScope();
  let rows!: ComputedRef<MemberDataState>;
  scope.run(() => { rows = instance.memberData("list", knowledge, inputsOf("list")).use("rows"); });
  await nextTick();
  expect(reads).toEqual([{ memberPath: [{ member: "list" }], dataName: "rows", inputs: { search: null } }]);

  // The search box sets the bound state; the address carries it, and the list is read with it as the author's input.
  const search = instance.memberParam("list", "search");
  search.set("refund");
  await nextTick();
  expect(instance.state.values.value.q).toBe("refund");
  expect(reads.at(-1)).toEqual({ memberPath: [{ member: "list" }], dataName: "rows", inputs: { search: "refund" } });

  // The next page is the list's own: it goes as a run-time value, and no other member sees it.
  instance.memberParam("list", "cursor").set("c-2");
  await nextTick();
  expect(reads.at(-1)).toEqual({
    memberPath: [{ member: "list" }], dataName: "rows", inputs: { search: "refund" }, runtimeParams: { cursor: "c-2" },
  });
  expect(instance.memberParam("other", "cursor").value.value).toBeNull();

  // The selection is bound once, by the output: setting it writes that state, and reads it back by the same name.
  instance.memberParam("list", "selected").set({ className: BUSINESS_KNOWLEDGE, primaryKey: "k-1" });
  await nextTick();
  expect(instance.state.values.value.picked).toEqual({ className: BUSINESS_KNOWLEDGE, primaryKey: "k-1" });
  expect(instance.memberParam("list", "selected").value.value).toEqual({ className: BUSINESS_KNOWLEDGE, primaryKey: "k-1" });
  expect(rows.value.status).toBe("ready");

  // A one-off read with the component's own values: those the projection does not map go as run-time values.
  await instance.memberData("list", knowledge, inputsOf("list")).read("rows", { cursor: "c-3", size: 5 });
  expect(reads.at(-1)).toEqual({
    memberPath: [{ member: "list" }], dataName: "rows", inputs: { search: "refund" }, runtimeParams: { cursor: "c-3", size: 5 },
  });
  scope.stop();
});
