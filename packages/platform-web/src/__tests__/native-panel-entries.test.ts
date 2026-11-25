import { expect, it } from "vitest";
import { BookOpen, Network } from "lucide-vue-next";
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
      names: { en: "Business knowledge" },
    }],
  });
  const after = ontologyPages(catalog);
  // The same place, the entry's own name; every other page as it was.
  expect(after.map((page) => page.id)).toEqual(before.map((page) => page.id));
  expect(after[knowledgeAt]).toEqual({ id: "/ontology/knowledge", label: "Business knowledge" });
  expect(after.filter((_, index) => index !== knowledgeAt)).toEqual(before.filter((_, index) => index !== knowledgeAt));
});

it("draws an entry's row with the look of the native page it replaced: the listed page's, else its navigation row's", () => {
  const catalog = catalogFixture().map((app) => app.id !== "ontology" ? app : {
    ...app,
    panelUses: [...app.panelUses ?? [], {
      id: "use-knowledge", pageKey: "ontology-knowledge", panelId: "builtin-knowledge", path: "/ontology/knowledge",
      names: { en: "Business knowledge" },
    }],
  });
  const row = (navigation: ReturnType<typeof generatedNavigation>) => appDeclarations(navigation, access, catalogPartition(catalog, "en"), t)
    .find((app) => app.id === "ontology")!.groups!.flatMap((group) => group.pages).find((page) => page.id === "/ontology/knowledge")!;
  const navigation = generatedNavigation();
  const pageGone = { ...navigation, pages: navigation.pages.filter((page) => page.path !== "/ontology/knowledge") };

  // The navigation still lists the page there: its icon stays on the row.
  expect(row(navigation)).toMatchObject({ label: "Business knowledge", icon: BookOpen });
  // The page is gone: the row the navigation declares for the entry.
  expect(row({ ...pageGone, entries: [{ path: "/ontology/knowledge", icon: Network }] }))
    .toMatchObject({ icon: Network });
  expect(row(pageGone)).toMatchObject({ icon: "pages" });
});

it("lists a permissions panel entry in both the owning menu and ontology governance after native removal", () => {
  const path = "/permissions/organization";
  const catalog = catalogFixture([{
    id: "permissions", kind: "native", rail: "bottom", category: "admin", sort: 10,
    entry: { path: "/permissions", renderer: "permissions", entryKey: "organization" },
    scheduleAdapter: null, allowStandalone: false,
    declaration: {
      names: { en: "Permissions" }, descriptions: {}, icon: "permissions", groups: [],
      panelUses: [{
        id: "organization", pageKey: "organization", panelId: "builtin-organization", path,
        names: { en: "Organization" },
      }],
    },
  }]);
  const partition = catalogPartition(catalog, "en", {
    permissions: { sections: [{ key: "permissions:pages", paths: [path] }] },
  });
  const navigation = { ...generatedNavigation(), entries: [{ path, icon: Network }] };
  const apps = appDeclarations(navigation, access, partition, t);
  for (const [id, group] of [["permissions", "permissions:pages"], ["ontology", "ontology:governance"]]) {
    expect(apps.find(app => app.id === id)?.groups?.find(section => section.key === group)?.pages)
      .toContainEqual({ id: path, label: "Organization", icon: Network });
  }
});
