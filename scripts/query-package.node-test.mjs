import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir, symlink, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectPackage, relatedCountPackage, relatedEntityQuery, uniqueRelatedKey } from "../agent-skills/data-retrieval/scripts/query-package.mjs";

test("related count preserves an exact entity filter and groups distinct objects", () => {
  const spec = {
    objectClass: "/staff", objectKey: "id", relatedClass: "/department", relatedKey: "code",
    value: "CS", relationship: "belongs_to", groupField: "status",
  };
  const schema = {
    classes: [
      { className: "/staff", attrs: [{ name: "id", primaryKey: true }, { name: "status" }] },
      { className: "/department", attrs: [{ name: "code", primaryKey: true }] },
    ],
    relationships: [{ name: "belongs_to", fromclass: "/staff", toclass: "/department" }],
  };
  const { files } = relatedCountPackage(spec, schema);
  const [input, output] = JSON.parse(files[0].content).answer.steps;
  assert.deepEqual(input.graph.patterns[0].objects[1].conditions.properties,
    { field: "code", operator: "=", value: "CS" });
  assert.equal(input.output.fields.find(field => field.field === "id").distinct, true);
  assert.equal(output.graph.patterns[0].objects[0].class, input.output.save_table);
  assert.equal(output.output.group_by.fields[0].field, "category");
  assert.throws(() => relatedCountPackage({ ...spec, objectKey: "status" }, schema), /primary key/);
  assert.throws(() => relatedCountPackage({ ...spec, relatedClass: "/other" }, schema), /relationship must connect/);
  const filtered = relatedCountPackage({ ...spec, filters: [{ field: "status", operator: "=", value: "active" }] }, schema);
  assert.deepEqual(JSON.parse(filtered.files[0].content).answer.steps[0].graph.patterns[0].objects[0].conditions.properties.and,
    [{ field: "status", operator: "=", value: "active" }]);
  assert.throws(() => relatedCountPackage({ ...spec, filters: [{ field: "unknown", operator: "=", value: 1 }] }, schema), /enabled object field/);
});
import { generationCommand } from "../agent-skills/ontology-generation/scripts/generation.mjs";
test("date coverage keeps the original scope and publishes aggregates only", () => {
  const spec = { objectClass: "/staff", objectKey: "id", relatedClass: "/org", relatedKey: "id",
    value: "CS", relationship: "belongs_to", coverageField: "joined",
    filters: [{ field: "status", operator: "=", value: "active" }] };
  const schema = {
    classes: [
      { className: "/staff", attrs: [{ name: "id", primaryKey: true }, { name: "joined", type: "date" }, { name: "status", type: "varchar" }] },
      { className: "/org", attrs: [{ name: "id", primaryKey: true }] },
    ],
    relationships: [{ name: "belongs_to", fromclass: "/staff", toclass: "/org" }],
  };
  const [scope, summary] = JSON.parse(relatedCountPackage(spec, schema).files[0].content).answer.steps;
  assert.deepEqual(scope.graph.patterns[0].objects[0].conditions.properties.and, spec.filters);
  assert.deepEqual(scope.output.fields.map(({ field, distinct }) => [field, distinct]), [["id", true], ["joined", undefined]]);
  assert.equal(scope.output.to_user, false);
  assert.deepEqual(summary.output.fields.map(({ as, field, function: aggregate }) => [as, field, aggregate]),
    [["scope_count", "object_key", "count"], ["known_count", "required_value", "count"]]);
  assert.throws(() => relatedCountPackage({ ...spec, coverageField: "status" }, schema), /date\/time/);
  assert.throws(() => relatedCountPackage({ ...spec, filters: [{ field: "joined", operator: ">=", value: "2020-01-01" }] }, schema), /out of filters/);
});
test("exact related entity resolution rejects ambiguous, empty and partial matches", () => {
  const schema = { classes: [{ className: "/org", attrs: [{ name: "id", primaryKey: true }, { name: "name" }] }] };
  const query = relatedEntityQuery({ relatedClass: "/org", relatedKey: "id", matchField: "name", matchValue: "Computing" }, schema);
  assert.deepEqual(query.answer.steps[0].graph.patterns[0].objects[0].conditions.properties,
    { field: "name", operator: "=", value: "Computing" });
  assert.equal(uniqueRelatedKey({ data: [{ answer: [{ entity_key: "org:1" }] }] }), "org:1");
  for (const answer of [[], [{ entity_key: "one" }, { entity_key: "two" }]])
    assert.throws(() => uniqueRelatedKey({ data: [{ answer }] }));
  assert.throws(() => uniqueRelatedKey({ data: [{ answer: [{ entity_key: "one" }], truncated: true }] }));
});
import { metricViewCommand } from "../agent-skills/metricview-generation/scripts/generation.mjs";
const fixture = JSON.parse(await readFile(new URL("../packages/contracts/examples/query-packages.json", import.meta.url), "utf8")).pythonAggregate;
const runId = "00000000-0000-4000-8000-000000000001";
const env = { ONTOMATO_GENERATION_URL: "http://ontology.invalid/generation", ONTOMATO_EXECUTION_CALLBACK: "fixture" };
test("collector closes the manifest over exact source files and rejects links and traversal", async () => {
  const dir = await mkdtemp(join(tmpdir(), "query-package-"));
  try {
    for (const file of fixture.files) {
      await mkdir(join(dir, "queries"), { recursive: true });
      await writeFile(join(dir, file.path), file.content);
    }
    const manifest = join(dir, "package.json");
    await writeFile(manifest, JSON.stringify(fixture.manifest));
    assert.deepEqual(await collectPackage(manifest), fixture);
    const plain = await collectPackage(join(dir, "queries/employees.json"));
    assert.equal(plain.manifest.entry.kind, "dsl"); assert.equal(plain.files.length, 1);
    await symlink(join(dir, "calculate.py"), join(dir, "linked.py"));
    const linked = structuredClone(fixture.manifest); linked.entry.path = "linked.py";
    await writeFile(manifest, JSON.stringify(linked));
    await assert.rejects(collectPackage(manifest), /links/);
    linked.entry.path = "../outside.py";
    await writeFile(manifest, JSON.stringify(linked));
    await assert.rejects(collectPackage(manifest), /relative/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("both generation clients submit the whole bundle, never source paths", async () => {
  const dir = await mkdtemp(join(tmpdir(), "query-generation-"));
  try {
    for (const file of fixture.files) {
      await mkdir(join(dir, "queries"), { recursive: true });
      await writeFile(join(dir, file.path), file.content);
    }
    const manifest = join(dir, "package.json"), labels = join(dir, "labels.json");
    await writeFile(manifest, JSON.stringify(fixture.manifest)); await writeFile(labels, '{"total":"Total"}');
    for (const command of [generationCommand, metricViewCommand]) {
      let calls = 0;
      await command(["test-package", manifest, labels], env, async (url, options) => {
        if (url.endsWith("/runtime-context")) return Response.json({ runId, kind: "metric" });
        calls++; assert.equal(url, `${env.ONTOMATO_GENERATION_URL}/${runId}/test`);
        assert.deepEqual(JSON.parse(options.body), { queryPackage: fixture, columnLabels: { total: "Total" } });
        return Response.json({ result: "ok" });
      });
      assert.equal(calls, 1);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
