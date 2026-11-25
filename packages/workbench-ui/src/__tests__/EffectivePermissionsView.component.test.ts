import { afterEach, describe, expect, it } from "vitest";
import { enableAutoUnmount, mount } from "@vue/test-utils";
import EffectivePermissionsView from "../../../apps-sdk/src/base/EffectivePermissionsView.vue";
import { workbenchI18n } from "../i18n";

enableAutoUnmount(afterEach);

describe("EffectivePermissionsView", () => {
  it("renders bordered descriptions with paired role grants, indented shares, app-grouped menus, searchable APIs, and data tabs", async () => {
    const wrapper = mount(EffectivePermissionsView, {
      props: {
        record: {
          fields: {
            directRoles: [{ label: "Analyst" }],
            organizationRoleGrants: ["Dept Manager — Engineering / Platform"],
            groupedMenuPermissions: ["Platform — Governance / Members · Governance / Roles"],
            outsideTreeMenuPermissions: ["LEGACY_MENU_CODE"],
            apiPermissionCount: 2,
          },
        },
        orgShares: [
          {
            id: "share-1",
            fields: {
              shareScope: "Self subtree",
              recipient: "Position: Tech Lead",
              shareBase: "HQ / R&D",
              coveredOrganizations: ["HQ / R&D", "HQ / R&D / Platform"],
              coveredUsers: 12,
              roleContributions: [
                'Reporter (3 contributors) — Order — {"op":"eq","field":"region","value":"CN"} · Invoice — All rows',
              ],
            },
          },
        ],
        apiPermissions: [
          { id: "api-1", fields: { method: "GET", urlPattern: "/api/users", permission: "USER_READ" } },
          { id: "api-2", fields: { method: "POST", urlPattern: "/api/roles", permission: "ROLE_WRITE" } },
        ],
        subjectData: [
          { id: "no-rules", fields: { fullData: false, coverage: "No rules" } },
        ],
        managedData: [],
        effectiveData: [
          {
            id: "Order",
            fields: {
              className: "Order",
              classLabel: "Sales Order",
              fullData: false,
              rowFilter: ['{"field":"region","op":"eq","value":"CN"}'],
              columnDetails: [
                "Amount (amount) · 1 — Visible",
                "Region (region) · 2 — Group only",
                "Secret (secret) · 0 — No access",
              ],
            },
          },
        ],
      },
      global: { plugins: [workbenchI18n()] },
    });

    // Direct roles and organization role grants.
    expect(wrapper.text()).toContain("Analyst");
    expect(wrapper.text()).toContain("Dept Manager");
    expect(wrapper.text()).toContain("Engineering / Platform");

    // Indented shared data sources with row rule popover trigger.
    expect(wrapper.text()).toContain("Self subtree");
    expect(wrapper.text()).toContain("HQ / R&D / Platform");
    expect(wrapper.text()).toContain("Reporter");
    expect(wrapper.text()).toContain("Order · Rule 1");

    // App-grouped menus and outside-tree legacy menu code.
    expect(wrapper.get(".sdk-epv-menu-group-name").text()).toBe("Platform");
    expect(wrapper.text()).toContain("Governance / Members");
    expect(wrapper.text()).toContain("LEGACY_MENU_CODE");

    // Collapsible searchable API list.
    expect(wrapper.find(".sdk-epv-api-list").exists()).toBe(false);
    const expandBtn = wrapper.findAll("button").find(btn => btn.text().trim() === "Expand")!;
    await expandBtn.trigger("click");
    expect(wrapper.findAll(".sdk-epv-api-row")).toHaveLength(2);
    await wrapper.get(".sdk-epv-api-search input").setValue("roles");
    expect(wrapper.findAll(".sdk-epv-api-row")).toHaveLength(1);
    expect(wrapper.get(".sdk-epv-api-row").text()).toContain("/api/roles");

    // Data permission tabs: effective tab shows visible + group-only tags and skips no-access column.
    expect(wrapper.text()).toContain("Sales Order");
    expect(wrapper.text()).toContain("Amount (amount)");
    expect(wrapper.text()).toContain("Region (region) · Group only");
    expect(wrapper.text()).not.toContain("Secret (secret)");
  });
});
