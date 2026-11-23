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

it("opens an action's detail address as the actions panel with the action selected", () => {
  expect(open("/ontology/assets/actions/approve%20order?back=products")).toEqual({
    path: "/ontology/assets/actions", state: { selected: "approve order" },
  });
});

it("opens the old creation address as the catalog, and leaves the page's own address alone", () => {
  expect(open("/ontology/assets/actions/new")).toEqual({ path: "/ontology/assets/actions", state: {} });
  expect(open("/ontology/assets/actions")).toBeNull();
});

it("opens a function's detail address as the functions panel with the function selected, and the old creation address as the catalog", () => {
  expect(open("/ontology/assets/functions/fn%201?back=products")).toEqual({
    path: "/ontology/assets/functions", state: { selected: "fn 1" },
  });
  expect(open("/ontology/assets/functions/new")).toEqual({ path: "/ontology/assets/functions", state: {} });
  expect(open("/ontology/assets/functions")).toBeNull();
});

it("opens a metric view's detail address as the metric views panel with that metric selected, and the old creation address as the catalog", () => {
  expect(open("/ontology/assets/metrics/mv%201?back=products")).toEqual({
    path: "/ontology/assets/metrics", state: { selected: "mv 1" },
  });
  expect(open("/ontology/assets/metrics/new")).toEqual({ path: "/ontology/assets/metrics", state: {} });
  expect(open("/ontology/assets/metrics")).toBeNull();
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

it.each(["/ontology/agents", "/agents/settings"])("routes the settings detail at %s to the shared panel state", (prefix) => {
  expect(open(`${prefix}/new`)).toEqual({ path: prefix, state: { mode: "create" } });
  expect(open(`${prefix}/agent-1`)).toEqual({
    path: prefix, state: { mode: "edit", selected: "agent-1" },
  });
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
