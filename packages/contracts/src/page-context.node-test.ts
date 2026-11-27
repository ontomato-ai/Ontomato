import test from "node:test";
import assert from "node:assert/strict";
import { pageCatalogResponseSchema, pageSearchResponseSchema } from "./page-context";

const entry = {
  applicationId: "ontology",
  entryKey: "ontology-members",
  useId: "ontology-members",
  pageKey: "members",
  panelId: "members-panel",
  kind: "panel",
  path: "/ontology/members",
  name: "成员",
  description: "管理成员",
};

test("page discovery catalog carries one current-locale name and description", () => {
  const parsed = pageCatalogResponseSchema.parse({
    applications: [{ applicationId: "ontology", name: "本体管理器", description: "维护本体" }],
    entries: [entry],
  });
  assert.equal(parsed.applications[0]?.name, "本体管理器");
  assert.equal(pageCatalogResponseSchema.safeParse({
    applications: [{ applicationId: "ontology", names: { en: "Ontology" } }],
  }).success, false);
  assert.equal(pageCatalogResponseSchema.safeParse({
    applications: [{ applicationId: "ontology", name: "本体管理器" }],
    entries: [{ ...entry, names: { en: "Members" } }],
  }).success, false);
});

test("page discovery search results use the same compact localized shape", () => {
  const parsed = pageSearchResponseSchema.parse({
    results: [{ application: { applicationId: "ontology", name: "本体管理器" }, entry, breadcrumb: ["本体管理器", "治理层", "成员"] }],
  });
  assert.equal(parsed.results[0]?.entry.name, "成员");
  assert.equal(pageSearchResponseSchema.safeParse({
    results: [{ application: { applicationId: "ontology", names: { en: "Ontology" } }, entry, breadcrumb: ["Ontology"] }],
  }).success, false);
});
