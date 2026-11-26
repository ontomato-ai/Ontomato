import { afterEach, describe, expect, it } from "vitest";
import { enableAutoUnmount, mount } from "@vue/test-utils";
import { computed, h } from "vue";
import type { DirectProjection } from "@ontomato/contracts/product-panels";
import EffectivePermissionsView from "../../../apps-sdk/src/base/EffectivePermissionsView.vue";
import ObjectHeader from "../../../apps-sdk/src/base/ObjectHeader.vue";
import ObjectRefCard from "../../../apps-sdk/src/base/ObjectRefCard.vue";
import RecordTemplate from "../../../apps-sdk/src/base/RecordTemplate.vue";
import TypedValue from "../../../apps-sdk/src/base/TypedValue.vue";
import { panelContextKey } from "../../../apps-sdk/src/panel/context";
import type { MemberData } from "../../../apps-sdk/src/panel/direct";
import { panelMemberKey } from "../../../apps-sdk/src/panel/member";
import type { MemberDataState } from "../../../apps-sdk/src/panel/member-data-state";
import type { PlatformObjectRecord } from "../../../apps-sdk/src/panel/platform-objects";
import { workbenchI18n } from "../i18n";

enableAutoUnmount(afterEach);

interface FakeMemberOptions {
  /** Datum names the member's projection declares, with the answer each read gives. */
  readonly data: Readonly<Record<string, unknown>>;
}

/**
 * A member as a component drawn inside one sees it, counting every datum the component makes the instance read. A
 * display reads a member datum only when its parent handed it no data, so `reads` is what this rule is about.
 */
function fakeMember(options: FakeMemberOptions) {
  const reads: string[] = [];
  const projection = {
    id: "member",
    data: Object.fromEntries(Object.keys(options.data).map((name) => [name, { read: name }])),
  } as unknown as DirectProjection;
  const member = {
    key: "member",
    projection,
    inputs: computed(() => ({})),
    data: {
      use(name: string) {
        reads.push(name);
        return computed<MemberDataState>(() => (options.data[name] ?? { status: "empty" }) as MemberDataState);
      },
      read: async () => ({ status: "empty" }) as MemberDataState,
    } as MemberData,
    operations: computed(() => ({ status: "ready" as const, value: {} })),
  };
  return { member, reads };
}

/** The panel a projection member is drawn in, as far as a component taking its data from a parent touches it. */
function fakePanel() {
  return {
    manifest: { members: {} },
    t: (key: string) => key,
    instance: {
      nameObjects: () => undefined,
      setMemberOutput: () => undefined,
      registerActionHandler: () => () => undefined,
      operationIdOf: (_slot: unknown, name: string) => name,
      checkedKeys: () => null,
      output: async () => undefined,
      state: { values: computed(() => ({})) },
      forms: {},
    },
  };
}

function mountIn(member: unknown, component: unknown, props: Record<string, unknown>) {
  return mount(component as never, {
    props: props as never,
    global: {
      plugins: [workbenchI18n()],
      provide: {
        [panelMemberKey as symbol]: () => member,
        [panelContextKey as symbol]: fakePanel(),
      },
    },
  });
}

const record = {
  className: "PlatformObjectType:Order",
  primaryKey: "SO-1",
  label: "Sales order",
  subtitle: "SO-1",
  fields: { status: "retired" },
  tones: { status: "danger" },
} as unknown as PlatformObjectRecord;

describe("one display reads a member once", () => {
  it("TypedValue draws the value its parent handed it and reads nothing", () => {
    const { member, reads } = fakeMember({
      data: {
        record: { status: "ready", value: record },
        result: { status: "ready", value: { columns: [{ key: "status", type: "string" }], rows: [{ status: "draft" }] } },
      },
    });

    const wrapper = mountIn(member, TypedValue, { value: "retired", field: "status" });

    expect(wrapper.text()).toBe("retired");
    expect(reads).toEqual([]);
  });

  it("TypedValue draws the empty text for a null value its parent handed it, never another row's value", () => {
    const { member, reads } = fakeMember({
      data: {
        result: {
          status: "ready",
          value: { columns: [{ key: "status", type: "string" }], rows: [{ status: "draft" }] },
        },
      },
    });

    const wrapper = mountIn(member, TypedValue, { value: null, field: "status" });

    expect(wrapper.text()).toBe("—");
    expect(reads).toEqual([]);
  });

  it("TypedValue takes the tone from the value or the parent, never from a read of its own", () => {
    const { member, reads } = fakeMember({
      data: { record: { status: "ready", value: record } },
    });

    const handed = mountIn(member, TypedValue, { value: "retired", field: "status" });
    expect(handed.find(".sdk-typed-value-text").attributes("data-tone")).toBeUndefined();

    const toned = mountIn(member, TypedValue, { value: "retired", field: "status", tone: "danger", kind: "tag" });
    expect(toned.find(".sdk-typed-value-tag").attributes("data-tone")).toBe("danger");
    expect(reads).toEqual([]);
  });

  it("TypedValue still reads its own datum, with that read's tones and states, when the parent hands nothing", () => {
    const { member, reads } = fakeMember({ data: { record: { status: "ready", value: record } } });
    const wrapper = mountIn(member, TypedValue, { field: "status" });
    expect(wrapper.find(".sdk-typed-value-tag").attributes("data-tone")).toBe("danger");
    expect(wrapper.text()).toBe("retired");
    expect(reads).toEqual(["record"]);

    const loading = fakeMember({ data: { record: { status: "loading" } } });
    expect(mountIn(loading.member, TypedValue, { field: "status" }).text()).toBe("…");
  });

  it("ObjectRefCard draws the record its parent handed it and reads nothing", () => {
    const { member, reads } = fakeMember({ data: { record: { status: "ready", value: record } } });

    const wrapper = mountIn(member, ObjectRefCard, { record });
    expect(wrapper.text()).toContain("Sales order");
    expect(reads).toEqual([]);

    const empty = mountIn(member, ObjectRefCard, { record: null });
    expect(empty.text()).toContain("—");
    expect(reads).toEqual([]);
  });

  it("ObjectHeader draws the record its parent handed it, and reads nothing for a title, a status or an error", () => {
    const { member, reads } = fakeMember({
      data: { record: { status: "error", message: "The owner refused the read" } },
    });

    const wrapper = mountIn(member, ObjectHeader, { record, subtitleField: "status" });
    expect(wrapper.find(".sdk-object-header-title").text()).toBe("Sales order");
    expect(wrapper.find(".sdk-object-header-subtitle").text()).toBe("retired");
    expect(reads).toEqual([]);

    const late = mountIn(member, ObjectHeader, { record: null, fallbackTitle: "Sales order" });
    expect(late.find(".sdk-object-header-title").text()).toBe("Sales order");
    // A parent's own read says whether it is loading or failed; the header does not say it a second time.
    expect(late.findComponent({ name: "DataState" }).exists()).toBe(false);
    expect(reads).toEqual([]);
  });

  it("ObjectHeader still reads its own record datum, and says loading from that read, when the parent hands nothing", () => {
    const { member, reads } = fakeMember({ data: { record: { status: "loading" } } });
    const wrapper = mountIn(member, ObjectHeader, {});
    expect(reads).toEqual(["record"]);
    expect(wrapper.find(".sdk-object-header-row").exists()).toBe(false);
  });

  it("EffectivePermissionsView reads only the datums its parent left to it", () => {
    const { member, reads } = fakeMember({
      data: {
        record: { status: "ready", value: { fields: { directRoles: ["Analyst"] } } },
        orgShares: { status: "empty" },
        managementOperations: { status: "empty" },
        subjectData: { status: "empty" },
        managedData: { status: "empty" },
        effectiveData: { status: "empty" },
      },
    });

    const wrapper = mountIn(member, EffectivePermissionsView, { record: { fields: { directRoles: ["Analyst"] } } });
    expect(wrapper.text()).toContain("Analyst");
    expect(reads).toEqual(["orgShares", "managementOperations", "subjectData", "managedData", "effectiveData"]);

    reads.length = 0;
    mountIn(member, EffectivePermissionsView, {
      record: { fields: { directRoles: ["Analyst"] } },
      orgShares: [],
      managementOperations: [],
      subjectData: [],
      managedData: [],
      effectiveData: [],
    });
    expect(reads).toEqual([]);
  });

  it("RecordTemplate draws the record its parent handed it, and an empty placeholder for a missing field", () => {
    const { member, reads } = fakeMember({
      data: { record: { status: "ready", value: record } },
    });

    const wrapper = mountIn(member, RecordTemplate, { template: "{label} ({status})", record: { ...record, fields: {} } });
    expect(wrapper.text()).toBe("Sales order (—)");
    expect(reads).toEqual([]);
  });

  it("RecordTemplate hands its placeholders the values it resolved, so they read no datum of their own", () => {
    const { member, reads } = fakeMember({ data: { record: { status: "ready", value: record } } });

    const wrapper = mount(
      { render: () => h(RecordTemplate, { template: "{label} / {missing}" }) },
      {
        global: {
          plugins: [workbenchI18n()],
          provide: { [panelMemberKey as symbol]: () => member, [panelContextKey as symbol]: fakePanel() },
        },
      },
    );

    expect(wrapper.text()).toBe("Sales order / —");
    expect(reads).toEqual(["record"]);
  });
});
