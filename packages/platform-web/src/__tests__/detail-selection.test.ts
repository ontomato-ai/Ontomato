import { expect, it } from "vitest";
import { panelAddressState } from "@ontomato/contracts/panel-host";
import { ACTION, AGENT_DEFINITION, FUNCTION, OBJECT_TYPE } from "@ontomato/contracts/platform-object-types";
import { DETAIL_SELECTIONS, detailSelectionAddress } from "../detail-selection";

/*
 * The actions page is the built-in actions panel now: an action's old detail address (a product asset's link to its
 * action, a bookmark, an agent's answer) opens the panel at the page's address with that action selected, and keeps a
 * draft it carried. What this rules out: such an address landing nowhere once the native page is gone.
 */

const open = (address: string) => {
  const converted = detailSelectionAddress(DETAIL_SELECTIONS, address);
  return converted && { path: converted.split("?")[0], state: panelAddressState(converted) };
};

it("opens an action's detail address as the actions panel with the action selected", () => {
  expect(open("/ontology/assets/actions/approve%20order?back=products")).toEqual({
    path: "/ontology/assets/actions", state: { selected: { className: ACTION, primaryKey: "approve order" } },
  });
  const drafted = detailSelectionAddress(DETAIL_SELECTIONS, "/ontology/assets/actions/approve?draftPath=outputs%2Fd.json")!;
  expect(new URL(drafted, "http://page.invalid").searchParams.get("draftPath")).toBe("outputs/d.json");
});

it("opens the old creation address as the catalog, and leaves the page's own address alone", () => {
  expect(open("/ontology/assets/actions/new")).toEqual({ path: "/ontology/assets/actions", state: {} });
  expect(open("/ontology/assets/actions")).toBeNull();
});

it("opens a function's detail address as the functions panel with the function selected, and the old creation address as its blank form", () => {
  expect(open("/ontology/assets/functions/fn%201?back=products")).toEqual({
    path: "/ontology/assets/functions", state: { selected: { className: FUNCTION, primaryKey: "fn 1" } },
  });
  expect(open("/ontology/assets/functions/new")).toEqual({ path: "/ontology/assets/functions", state: { creating: true } });
  expect(open("/ontology/assets/functions")).toBeNull();
});


it("opens a class's detail address as the object types panel with that class selected, and leaves the page's own address alone", () => {
  expect(open("/ontology/objects/Order?back=catalog")).toEqual({
    path: "/ontology/objects", state: { selected: { className: OBJECT_TYPE, primaryKey: "Order" } },
  });
  expect(open("/ontology/objects")).toBeNull();
  // A page deeper than the class's own is not a detail address of this page.
  expect(open("/ontology/objects/Order/view")).toBeNull();
});

it.each(["/ontology/agents", "/agents/settings"])("routes the settings detail at %s to the shared panel state", (prefix) => {
  expect(open(`${prefix}/new`)).toEqual({ path: prefix, state: { mode: "create" } });
  expect(open(`${prefix}/agent-1`)).toEqual({
    path: prefix, state: { mode: "edit", selected: { className: AGENT_DEFINITION, primaryKey: "agent-1" } },
  });
  const address = detailSelectionAddress(DETAIL_SELECTIONS, `${prefix}/agent-1?draftRunId=run&draftPath=outputs%2Fa.json`)!;
  const query = new URL(address, "http://page.invalid").searchParams;
  expect(query.get("draftRunId")).toBe("run");
  expect(query.get("draftPath")).toBe("outputs/a.json");
});

it.each(["capabilities", "skills", "mcp", "models"])("leaves the separate agent platform %s page address alone", (page) => {
  expect(open(`/agents/settings/${page}`)).toBeNull();
});
