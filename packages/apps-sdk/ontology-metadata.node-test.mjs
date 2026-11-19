import test from "node:test";
import assert from "node:assert/strict";

// The adapter and the contracts it parses are TypeScript; the contracts-local tsx loader reads them here, once,
// before any of the tests import them.
const { register } = await import("../contracts/node_modules/tsx/dist/esm/api/index.mjs");
const unregister = register();
const { ontologyMetadataAdapters } = await import("./src/panel/ontology-metadata.ts");
unregister();

const objectTypes = [
  { className: "Device", showName: "Device", classDesc: "", attributeCount: 3, businessKeyCount: 1,
    relationshipCount: 1, primaryKey: { status: "ok", name: "id" } },
  { className: "Site", showName: "Site", classDesc: "A site", attributeCount: 1, businessKeyCount: 0,
    relationshipCount: 1, primaryKey: { status: "missing" } },
];
const attributes = [
  { className: "Device", name: "id", showName: "id", type: "varchar", attrDesc: "", enable: true,
    businessKey: false, primaryKey: true },
  { className: "Device", name: "site_id", showName: "Site", type: "varchar", attrDesc: "", enable: true,
    businessKey: true, primaryKey: false },
];
const relationships = [
  { relationship: "owns", fromclass: "Device", toclass: "Site", desc: "owns", fromField: "site_id", toField: "id" },
];
const formDescription = {
  fields: [
    { path: "/className", label: "API name", control: { kind: "text" }, valueSchema: { type: "string" },
      required: true, readOnly: true },
    { path: "/showName", label: "Display name", control: { kind: "text" }, valueSchema: { type: "string" },
      required: true, readOnly: false },
  ],
  values: { className: "Device", showName: "Device" },
  save: { method: "POST", path: "/ontology/model/object-type/update", bodySchema: { type: "object" },
    draftOperation: "objectType.update" },
};

/** The frame's request path as a stand-in owner: it answers the routes it knows and records every request it saw. */
function fakeRequests(routes) {
  const seen = [];
  return {
    seen,
    async request(path, init, service) {
      seen.push({ path, method: init.method ?? "GET", service, body: init.body ? JSON.parse(init.body) : null });
      const route = routes.find(route => route.path === path);
      if (!route) throw new Error(`No stand-in owner for ${path}`);
      return new Response(JSON.stringify(route.answer), { status: route.status ?? 200 });
    },
  };
}

function adapters(routes) {
  const requests = fakeRequests(routes);
  return { requests, adapters: ontologyMetadataAdapters(requests) };
}

const routes = () => [
  { path: "/ontology/model/object-types", answer: objectTypes },
  { path: "/ontology/model/object-type?className=Device", answer: objectTypes[0] },
  { path: "/ontology/model/attributes", answer: attributes },
  { path: "/ontology/model/attributes?className=Device", answer: attributes },
  { path: "/ontology/model/relationships", answer: relationships },
  { path: "/ontology/model/relationships?className=Site", answer: relationships },
  { path: "/ontology/model/relationship?relationship=owns", answer: relationships[0] },
  { path: "/ontology/model/object-type/form", answer: formDescription },
  { path: "/ontology/model/attribute/form", answer: formDescription },
  { path: "/ontology/model/relationship/form", answer: formDescription },
  { path: "/ontology/model/object-type/create", answer: objectTypes[0] },
  { path: "/ontology/model/object-type/update", answer: objectTypes[0] },
  { path: "/ontology/model/attribute/create", answer: attributes[1] },
  { path: "/ontology/model/attribute/update", answer: attributes[1] },
  { path: "/ontology/model/relationship/create", answer: relationships[0] },
  { path: "/ontology/model/relationship/update", answer: relationships[0] },
];

test("lists, reads and offers the three objects through their typed interfaces", async () => {
  const { adapters: all } = adapters(routes());
  const [objectType, attribute, relationship] = all;

  const classes = await objectType.list();
  assert.deepEqual(classes.map(record => record.primaryKey), ["Device", "Site"]);
  assert.equal(classes[0].label, "Device");
  assert.equal(classes[0].fields.primaryKey, "ok");
  assert.deepEqual(classes[1].fields, {
    className: "Site", showName: "Site", classDesc: "A site", attributeCount: "1", businessKeyCount: "0",
    relationshipCount: "1", primaryKey: "missing",
  });

  const attrs = await attribute.list();
  assert.deepEqual(attrs.map(record => record.primaryKey), ["[\"Device\",\"id\"]", "[\"Device\",\"site_id\"]"]);
  assert.equal(attrs[1].label, "Site");
  assert.deepEqual(attrs[1].references.className, {
    className: "platform:ObjectType", primaryKey: "Device", label: "Device",
  });

  const relations = await relationship.list();
  assert.deepEqual(relations.map(record => record.fields), [{
    fromclass: "Device", toclass: "Site", desc: "owns", fromField: "site_id", toField: "id",
  }]);
  assert.equal(relations[0].label, "owns");

  assert.equal((await objectType.read("Device")).primaryKey, "Device");
  assert.equal((await relationship.read("owns")).primaryKey, "owns");
  assert.deepEqual((await objectType.options.resolve(["Device", "Gone"])), [
    { primaryKey: "Device", value: "Device", label: "Device" },
    { primaryKey: "Gone", value: "Gone", label: "Gone", unavailable: { reason: "assistant.unavailable" } },
  ]);
});

test("concurrent readers share the one in-flight object type read", async () => {
  const { requests, adapters: all } = adapters(routes());

  await Promise.all([all[0].list(), all[0].list(), all[0].options.list()]);

  assert.equal(requests.seen.filter(request => request.path === "/ontology/model/object-types").length, 1);
});

test("query searches the owner's own texts, filters by class and pages over the real total", async () => {
  const { requests, adapters: all } = adapters(routes());
  const [objectType, attribute, relationship] = all;

  assert.deepEqual((await objectType.query({ search: "site" })).items.map(record => record.primaryKey), ["Site"]);
  assert.equal((await objectType.query({ search: "nothing" })).total, 0);
  const paged = await objectType.query({ page: { offset: 1, limit: 1 } });
  assert.deepEqual(paged.items.map(record => record.primaryKey), ["Site"]);
  assert.equal(paged.total, 2);

  assert.equal((await attribute.query({ filters: { className: "Device" }, search: "site_id" })).total, 1);
  assert.equal((await attribute.query({ search: "Site" })).total, 1);
  assert.equal((await attribute.query({ search: "varchar" })).total, 2);
  assert.equal((await attribute.query({})).total, 2);
  assert.equal(requests.seen.some(request => request.path === "/ontology/model/attributes?className=Device"), true);

  assert.equal((await relationship.query({ filters: { className: "Site" }, search: "owns" })).total, 1);
  assert.equal((await relationship.query({ search: "nothing" })).total, 0);
  assert.equal(requests.seen.some(request => request.path === "/ontology/model/relationships?className=Site"), true);
});

test("describes a form for a target, and again after a field that changes its options", async () => {
  const { requests, adapters: all } = adapters(routes());

  const described = await all[2].forms.describe({
    target: { kind: "object", objectType: "platform:Relationship", primaryKey: "owns" }, changedField: null,
  });
  assert.equal(described.fields[0].path, "/className");
  assert.equal(described.save.draftOperation, "objectType.update");
  assert.equal(described.revision, undefined);

  await all[2].forms.describe({
    target: { kind: "draft" }, values: { fromclass: "Site" }, changedField: "/fromclass",
  });
  const asked = requests.seen.filter(request => request.path === "/ontology/model/relationship/form").at(-1);
  assert.equal(asked.method, "POST");
  assert.deepEqual(asked.body, {
    target: { kind: "draft" }, values: { fromclass: "Site" }, changedField: "/fromclass",
  });
});

test("saves a draft through the owner's create and an object through its update, keyed by the target", async () => {
  const { requests, adapters: all } = adapters(routes());
  const [objectType, attribute, relationship] = all;

  const created = await objectType.forms.save({ kind: "draft" }, { values: {
    className: "Pump", primaryKeyName: "pump_no", showName: "Pump", classDesc: "",
  } });
  assert.equal(created.primaryKey, "Device");
  const create = requests.seen.find(request => request.path === "/ontology/model/object-type/create");
  assert.deepEqual(create.body, {
    className: "Pump", primaryKeyName: "pump_no", showName: "Pump", classDesc: "",
  });

  await objectType.forms.save({ kind: "object", objectType: "platform:ObjectType", primaryKey: "Device" },
    { values: { className: "ignored", showName: "Devices", classDesc: "A device" } });
  assert.deepEqual(requests.seen.find(request => request.path === "/ontology/model/object-type/update").body, {
    className: "Device", showName: "Devices", classDesc: "A device",
  });

  const saved = await attribute.forms.save(
    { kind: "object", objectType: "platform:Attribute", primaryKey: "[\"Device\",\"site_id\"]" },
    { values: { showName: "Site link", attrDesc: "", enable: false, businessKey: true } });
  assert.equal(saved.references.className.label, "Device");
  assert.deepEqual(requests.seen.find(request => request.path === "/ontology/model/attribute/update").body, {
    className: "Device", name: "site_id", showName: "Site link", attrDesc: "", enable: false, businessKey: true,
  });

  await relationship.forms.save({ kind: "object", objectType: "platform:Relationship", primaryKey: "owns" },
    { values: { desc: "held by", fromField: "id", toField: "id" } });
  assert.deepEqual(requests.seen.find(request => request.path === "/ontology/model/relationship/update").body, {
    relationship: "owns", desc: "held by", fromField: "id", toField: "id",
  });
});

test("raises the owner's refusal, with each named field's message on the field's own path", async () => {
  const refused = routes();
  refused.find(route => route.path === "/ontology/model/attribute/form").status = 422;
  refused.find(route => route.path === "/ontology/model/attribute/form").answer = {
    error: { code: "FIELD_VALIDATION_FAILED", message: "Some fields are invalid",
      fields: [{ field: "/values/showName", code: "required", message: "A display name is required" }] },
  };
  refused.find(route => route.path === "/ontology/model/object-types").status = 404;
  refused.find(route => route.path === "/ontology/model/object-types").answer = {
    error: { code: "OBJECT_TYPE_NOT_FOUND", message: "Class not found" },
  };
  const { adapters: all } = adapters(refused);

  await assert.rejects(all[1].forms.describe({ target: { kind: "draft" }, changedField: null }), (error) => {
    assert.equal(error.name, "PlatformObjectRefusal");
    assert.equal(error.message, "Some fields are invalid");
    assert.deepEqual(error.fields, { "/showName": "A display name is required" });
    return true;
  });
  await assert.rejects(all[0].list(), (error) => {
    assert.equal(error.message, "Class not found");
    return true;
  });
});
