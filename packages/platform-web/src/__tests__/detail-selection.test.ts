import { expect, it } from "vitest";
import { panelAddressState } from "@ontomato/contracts/panel-host";
import { ACTION } from "@ontomato/contracts/platform-object-types";
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
