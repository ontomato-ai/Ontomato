import { expect, it } from "vitest";
import { panelAddressState } from "@ontomato/contracts/panel-host";
import { DETAIL_SELECTIONS, detailSelectionAddress } from "../detail-selection";

/*
 * The actions page is the built-in actions panel now: an action's old detail address (a product asset's link to its
 * action, a bookmark, an agent's answer) opens the panel at the page's address with that action selected. What this
 * rules out: such an address landing nowhere once the native page is gone.
 */

const open = (address: string) => {
  const converted = detailSelectionAddress(DETAIL_SELECTIONS, address);
  return converted && { path: converted.split("?")[0], state: panelAddressState(converted) };
};

it("opens an action's detail address and legacy selected catalog links at the non-menu action detail entry", () => {
  expect(open("/ontology/assets/actions/approve%20order?back=products")).toEqual({
    path: "/ontology/assets/actions/detail", state: { selected: "approve order" },
  });
  expect(open("/ontology/assets/actions?selected=approve%20order")).toEqual({
    path: "/ontology/assets/actions/detail", state: { selected: "approve order" },
  });
  expect(open("/ontology/assets/actions?selected=platform%3AAction~approve-order")).toEqual({
    path: "/ontology/assets/actions/detail", state: { selected: "approve-order" },
  });
});

it("opens the old creation address as the catalog, and leaves the catalog and detail addresses alone", () => {
  expect(open("/ontology/assets/actions/new")).toEqual({ path: "/ontology/assets/actions", state: {} });
  expect(open("/ontology/assets/actions")).toBeNull();
  expect(open("/ontology/assets/actions?keyword=approve")).toBeNull();
  expect(open("/ontology/assets/actions/detail")).toBeNull();
  expect(open("/ontology/assets/actions/detail?selected=approve-order")).toBeNull();
});

it("opens function detail, create, and legacy selected catalog links at the non-menu function detail entry", () => {
  expect(open("/ontology/assets/functions/fn%201?back=products")).toEqual({
    path: "/ontology/assets/functions/detail", state: { selected: "fn 1" },
  });
  expect(open("/ontology/assets/functions/new")).toEqual({
    path: "/ontology/assets/functions/detail", state: { mode: "create" },
  });
  expect(open("/ontology/assets/functions?selected=fn-1")).toEqual({
    path: "/ontology/assets/functions/detail", state: { selected: "fn-1" },
  });
  expect(open("/ontology/assets/functions?selected=platform%3AFunction~fn-2")).toEqual({
    path: "/ontology/assets/functions/detail", state: { selected: "fn-2" },
  });

  // The catalog itself (bare or searching) and the detail entry itself are not redirected.
  expect(open("/ontology/assets/functions")).toBeNull();
  expect(open("/ontology/assets/functions?search=revenue")).toBeNull();
  expect(open("/ontology/assets/functions?selected=platform%3AFunction~")).toBeNull();
  expect(open("/ontology/assets/functions/detail")).toBeNull();
  expect(open("/ontology/assets/functions/detail?selected=fn-1")).toBeNull();
  expect(open("/ontology/assets/functions/detail?mode=create")).toBeNull();
});

it("opens metric view detail, creation, and legacy selected catalog links at the non-menu detail entry", () => {
  expect(open("/ontology/assets/metrics/mv%201?back=products")).toEqual({
    path: "/ontology/assets/metrics/detail", state: { selected: "mv 1" },
  });
  expect(open("/ontology/assets/metrics/new")).toEqual({
    path: "/ontology/assets/metrics/detail", state: { mode: "create" },
  });
  expect(open("/ontology/assets/metrics?selected=mv%201")).toEqual({
    path: "/ontology/assets/metrics/detail", state: { selected: "mv 1" },
  });
  expect(open("/ontology/assets/metrics?selected=platform%3AMetricView~mv-1")).toEqual({
    path: "/ontology/assets/metrics/detail", state: { selected: "mv-1" },
  });
  expect(open("/ontology/assets/metrics?selected=platform%3AMetricView~")).toBeNull();

  // The catalog itself (bare or searching) and the detail entry itself are not redirected.
  expect(open("/ontology/assets/metrics")).toBeNull();
  expect(open("/ontology/assets/metrics?search=revenue")).toBeNull();
  expect(open("/ontology/assets/metrics/detail")).toBeNull();
  expect(open("/ontology/assets/metrics/detail?selected=mv-1")).toBeNull();
  expect(open("/ontology/assets/metrics/detail?mode=create")).toBeNull();
});


it("opens a class's detail address as the object types panel with that class selected, and leaves the page's own address alone", () => {
  expect(open("/ontology/objects/Order?back=catalog")).toEqual({
    path: "/ontology/objects", state: { selected: "Order" },
  });
  expect(open("/ontology/objects")).toBeNull();
  // A page deeper than the class's own is not a detail address of this page.
  expect(open("/ontology/objects/Order/view")).toBeNull();
});

it("opens a relationship's detail address and selected catalog links at the non-menu relation detail entry", () => {
  expect(open("/ontology/relations/belongs_to?back=catalog")).toEqual({
    path: "/ontology/relations/detail", state: { selected: "belongs_to" },
  });

  const selectedCatalog = "/ontology/relations?selected=belongs_to";
  expect(open(selectedCatalog)).toEqual({
    path: "/ontology/relations/detail", state: { selected: "belongs_to" },
  });

  // The catalog itself (bare or searching) and the detail entry itself are not redirected.
  expect(open("/ontology/relations")).toBeNull();
  expect(open("/ontology/relations?search=order")).toBeNull();
  expect(open("/ontology/relations/detail")).toBeNull();
  expect(open("/ontology/relations/detail?selected=belongs_to")).toBeNull();
});

it("opens a skill's detail address and selected catalog links at the non-menu skill detail entry", () => {
  expect(open("/ontology/skills/code-review?back=catalog")).toEqual({
    path: "/ontology/skills/detail", state: { selected: "code-review" },
  });
  expect(open("/ontology/skills/my%20skill")).toEqual({
    path: "/ontology/skills/detail", state: { selected: "my skill" },
  });

  expect(open("/ontology/skills?selected=code-review")).toEqual({
    path: "/ontology/skills/detail", state: { selected: "code-review" },
  });
  expect(open("/ontology/skills?selected=platform%3ASkill~code-review")).toEqual({
    path: "/ontology/skills/detail", state: { selected: "code-review" },
  });

  // The catalog itself (bare or searching) and the detail entry itself are not redirected.
  expect(open("/ontology/skills")).toBeNull();
  expect(open("/ontology/skills?search=review")).toBeNull();
  expect(open("/ontology/skills/detail")).toBeNull();
  expect(open("/ontology/skills/detail?selected=code-review")).toBeNull();
});

it.each(["/ontology/agents", "/agents/settings"])("routes agent detail, legacy selected links, and /new at %s to the two-entry catalog and detail panels", (prefix) => {
  expect(open(`${prefix}/new`)).toEqual({ path: prefix, state: {} });
  expect(open(`${prefix}/agent-1`)).toEqual({
    path: `${prefix}/detail`, state: { selected: "agent-1" },
  });
  expect(open(`${prefix}?selected=agent-1`)).toEqual({
    path: `${prefix}/detail`, state: { selected: "agent-1" },
  });
  expect(open(`${prefix}?selected=platform%3AAgentDefinition~agent-2`)).toEqual({
    path: `${prefix}/detail`, state: { selected: "agent-2" },
  });
  expect(open(`${prefix}?selected=platform%3AAgentDefinition~`)).toBeNull();
  // The catalog itself (bare or searching) and the detail entry itself are not redirected.
  expect(open(prefix)).toBeNull();
  expect(open(`${prefix}?search=ops`)).toBeNull();
  expect(open(`${prefix}/detail`)).toBeNull();
  expect(open(`${prefix}/detail?selected=agent-1`)).toBeNull();
});

it.each(["capabilities", "skills", "mcp", "models"])("leaves the separate agent platform %s page address alone", (page) => {
  expect(open(`/agents/settings/${page}`)).toBeNull();
});

it("moves legacy schedule taskId into flat selectedTask without losing other query parameters", () => {
  const query = new URLSearchParams({
    app: "operations", taskId: "task-1", runId: "run-1", external: "true",
  });
  const converted = detailSelectionAddress(DETAIL_SELECTIONS, `/schedules?${query}`)!;
  expect(panelAddressState(converted)).toEqual({
    app: "operations", selectedTask: "task-1", runId: "run-1", external: "true",
  });
  const result = new URL(converted, "http://page.invalid");
  expect(result.searchParams.get("taskId")).toBeNull();
  expect(detailSelectionAddress(DETAIL_SELECTIONS, converted)).toBeNull();
});
