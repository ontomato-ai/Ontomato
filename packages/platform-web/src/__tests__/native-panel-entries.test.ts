import { expect, it } from "vitest";
import { appDeclarations } from "../partition";
import { catalogPartition } from "../native-layouts";
import { catalogFixture, closedAccess, generatedNavigation } from "./fixtures";

/*
 * A native built-in application's panel entry in its own menu (big main's ruling, 2026-11-21): its native menu table
 * still places it, and where the table lists an address the application declares an entry at, the entry stands there —
 * named by its use relation, as a panel application's page is — instead of the native page it replaces. The rest of the
 * menu is the application's native pages, as before.
 *
 * What this rules out: a built-in application's entry that never reaches its menu because only panel applications'
 * entries are drawn, and an entry that moves its page to another place in the menu.
 */

const t = (key: string) => key;
const access = closedAccess(["ontology-modeling", "business-knowledge"]);

function ontologyPages(catalog: ReturnType<typeof catalogFixture>) {
  const apps = appDeclarations(generatedNavigation(), access, catalogPartition(catalog, "en"), t);
  return apps.find((app) => app.id === "ontology")!.groups!.flatMap((group) => group.pages.map((page) => ({ id: page.id, label: page.label })));
}

it("stands a built-in application's named entry where its menu table lists the address, by the entry's name", () => {
  const before = ontologyPages(catalogFixture());
  const knowledgeAt = before.findIndex((page) => page.id === "/ontology/knowledge");
  expect(knowledgeAt).toBeGreaterThanOrEqual(0);

  const catalog = catalogFixture().map((app) => app.id !== "ontology" ? app : {
    ...app,
    // Added to the entries the application already declares.
    panelUses: [...app.panelUses ?? [], {
      id: "use-knowledge", pageKey: "ontology-knowledge", panelId: "builtin-knowledge", path: "/ontology/knowledge",
      access: { permissionCode: "business-knowledge" }, names: { en: "Business knowledge" },
    }],
  });
  const after = ontologyPages(catalog);
  // The same place, the entry's own name; every other page as it was.
  expect(after.map((page) => page.id)).toEqual(before.map((page) => page.id));
  expect(after[knowledgeAt]).toEqual({ id: "/ontology/knowledge", label: "Business knowledge" });
  expect(after.filter((_, index) => index !== knowledgeAt)).toEqual(before.filter((_, index) => index !== knowledgeAt));
});

it("lists another application's entry where a native menu table names its address, as that use relation shows it", () => {
  // The ontology manager's facts layer, listing knowledge governance's business knowledge (big main's ruling, 2026-11-21).
  const renderers = { ontology: { sections: [{ key: "ontology:facts", titleKey: "platform.layers.facts", paths: ["/governance/knowledge"] }] } };
  const knowledge = {
    id: "use-governance-knowledge", pageKey: "governance-knowledge", panelId: "builtin-knowledge", path: "/governance/knowledge",
    access: { permissionCode: "business-knowledge" }, names: { en: "Business knowledge" },
  };
  const pagesFor = (catalog: ReturnType<typeof catalogFixture>) => appDeclarations(generatedNavigation(), access, catalogPartition(catalog, "en", renderers), t)
    .find((app) => app.id === "ontology")!.groups!.flatMap((group) => group.pages.map((page) => ({ id: page.id, label: page.label })));

  const granted = catalogFixture().map((app) => app.id === "governance" ? { ...app, panelUses: [...app.panelUses ?? [], knowledge] } : app);
  expect(pagesFor(granted)).toEqual([{ id: "/governance/knowledge", label: "Business knowledge" }]);
  // A reader the governance entry does not admit has no such item: the catalog does not list it for them.
  expect(pagesFor(catalogFixture())).toEqual([]);
});
