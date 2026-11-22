import { describe, expect, it } from "vitest";
import { panelOperationOutcomeSchema } from "@ontomato/contracts/panel-agent";
import { ATTRIBUTE, OBJECT_TYPE, RELATIONSHIP } from "@ontomato/contracts/platform-object-types";
import { configureI18n } from "../../../i18n";
import { en, enLocaleMeta } from "../../../i18n/locales/en";
import type { PanelOperationHost } from "../../product-panels/server-operations";
import { ontologyModelServerOperations } from "../model-operations";

configureI18n({
  defaultLocale: "en",
  appTextLocale: "en",
  languageSwitchEnabled: false,
  packs: { en: { ...enLocaleMeta, messages: en } },
});

const objectTypeView = {
  className: "Pump",
  showName: "Pump display",
  classDesc: "",
  attributeCount: 1,
  businessKeyCount: 0,
  relationshipCount: 0,
  primaryKey: { status: "ok", name: "pump_no" },
};

const attributeView = {
  className: "Device",
  name: "size",
  showName: "Size",
  type: "int",
  attrDesc: "",
  enable: true,
  businessKey: false,
  primaryKey: false,
};

const relationshipView = {
  relationship: "owns",
  fromclass: "Device",
  toclass: "Site",
  desc: "owns",
  fromField: "site_id",
  toField: "id",
};

function owner(answer: (path: string, init: NonNullable<Parameters<typeof fetch>[1]>) => { status: number; body: unknown }) {
  const requests: { path: string; method: string; body: Record<string, unknown> }[] = [];
  const actor = { owner: { domainId: "domain-1", userId: "user-1" }, credentials: { token: "token-1" } };
  const host: PanelOperationHost = {
    initiator: actor,
    executor: actor,
    requestWorkbench: async () => {
      throw new Error("The ontology model owner is reached through request");
    },
    async request(path, init) {
      requests.push({ path, method: init.method ?? "GET", body: JSON.parse(String(init.body ?? "{}")) });
      const { status, body } = answer(path, init);
      return new Response(JSON.stringify(body), { status });
    },
  };
  return { host, requests };
}

type ModelOperation = (typeof ontologyModelServerOperations)[number];
const saves = ontologyModelServerOperations.filter(
  (operation): operation is Extract<ModelOperation, { kind: "form.save" }> => operation.kind === "form.save",
);
const actions = ontologyModelServerOperations.filter(
  (operation): operation is Extract<ModelOperation, { kind: "action" }> => operation.kind === "action",
);
const [saveObjectType, saveAttribute, saveRelationship] = saves;
const [deleteObjectType, deleteAttribute, deleteRelationship, setPrimaryKey] = actions;

const objectTarget = { kind: "object", objectType: OBJECT_TYPE, primaryKey: "Device" } as const;
const attributeTarget = { kind: "object", objectType: ATTRIBUTE, primaryKey: '["Device","size"]' } as const;
const relationshipTarget = { kind: "object", objectType: RELATIONSHIP, primaryKey: "owns" } as const;

describe("ontology model server operations", () => {
  it("registers the three saves, three deletes and setPrimaryKey with aligned handlerRefs and bindings", () => {
    expect(ontologyModelServerOperations.map(operation => operation.handlerRef)).toEqual([
      "platform:ObjectType.save",
      "platform:Attribute.save",
      "platform:Relationship.save",
      "objectTypes.delete",
      "attributes.delete",
      "relationships.delete",
      "attributes.setPrimaryKey",
    ]);
    for (const save of saves) {
      expect(save.binding).toEqual({ kind: "PlatformObjectType", id: save.targetType });
      expect(save.batch).toBe(false);
    }
    for (const action of actions) {
      expect(action.binding).toEqual({ kind: "PlatformOperation", id: action.handlerRef });
      expect(action.batch).toBe(false);
    }
    expect(deleteObjectType.inspectImpact?.handlerRef).toBe("objectTypes.delete.inspect-impact");
    expect(actions.map(operation => operation.targetInput)).toEqual([
      "objectType",
      "attribute",
      "relationship",
      "attribute",
    ]);
  });

  it("names the draft operation and create identity for each form save", () => {
    expect(saveObjectType.draftOperation({ kind: "draft" })).toBe("objectType.create");
    expect(saveObjectType.draftOperation(objectTarget)).toBe("objectType.update");
    expect(saveAttribute.draftOperation({ kind: "draft" })).toBe("attribute.create");
    expect(saveAttribute.draftOperation(attributeTarget)).toBe("attribute.update");
    expect(saveRelationship.draftOperation({ kind: "draft" })).toBe("relationship.create");
    expect(saveRelationship.draftOperation(relationshipTarget)).toBe("relationship.update");

    expect(() => saveObjectType.targetSchema.parse({ kind: "object", objectType: ATTRIBUTE, primaryKey: "Device" })).toThrow();
    const values = { className: "Pump", primaryKeyName: "pump_no", showName: "Pump display", classDesc: "" };
    expect(saveObjectType.draftInput({ values })).toEqual(values);
    expect(saveObjectType.create.draftValues(values, "d1")).toEqual(values);
    expect(saveObjectType.create.createdObject(objectTypeView)).toEqual({
      objectType: OBJECT_TYPE,
      primaryKey: "Pump",
    });
    expect(saveAttribute.create.createdObject(attributeView)).toEqual({
      objectType: ATTRIBUTE,
      primaryKey: '["Device","size"]',
    });
    expect(saveRelationship.create.createdObject(relationshipView)).toEqual({
      objectType: RELATIONSHIP,
      primaryKey: "owns",
    });
  });

  it("creates and updates object types with matching affected objectTypes", async () => {
    const { host, requests } = owner(path => ({
      status: path.endsWith("/create") ? 201 : 200,
      body: objectTypeView,
    }));

    const created = panelOperationOutcomeSchema.parse(
      await saveObjectType.execute(
        host,
        { kind: "draft" },
        { values: { className: "Pump", primaryKeyName: "pump_no", showName: "Pump display", classDesc: "" } },
        "intent-1",
      ),
    );
    const updated = panelOperationOutcomeSchema.parse(
      await saveObjectType.execute(
        host,
        { kind: "object", objectType: OBJECT_TYPE, primaryKey: "Pump" },
        { values: { showName: "Pump display", classDesc: "Updated" } },
        "intent-2",
      ),
    );

    expect(requests).toEqual([
      {
        path: "/api/data-query/ontology/model/object-type/create",
        method: "POST",
        body: { className: "Pump", primaryKeyName: "pump_no", showName: "Pump display", classDesc: "" },
      },
      {
        path: "/api/data-query/ontology/model/object-type/update",
        method: "POST",
        body: { className: "Pump", showName: "Pump display", classDesc: "Updated" },
      },
    ]);
    expect(created).toEqual({
      kind: "success",
      data: objectTypeView,
      affected: { objects: [{ objectType: OBJECT_TYPE, primaryKey: "Pump" }], objectTypes: [OBJECT_TYPE, ATTRIBUTE] },
    });
    expect(updated).toEqual({
      kind: "success",
      data: objectTypeView,
      affected: { objects: [{ objectType: OBJECT_TYPE, primaryKey: "Pump" }], objectTypes: [OBJECT_TYPE] },
    });
  });

  it("creates and updates attributes and reports Attribute and ObjectType as affected", async () => {
    const { host, requests } = owner(path => ({
      status: path.endsWith("/create") ? 201 : 200,
      body: attributeView,
    }));

    const created = panelOperationOutcomeSchema.parse(
      await saveAttribute.execute(
        host,
        { kind: "draft" },
        {
          values: {
            className: "Device",
            name: "size",
            showName: "Size",
            type: "int",
            attrDesc: "",
            enable: true,
            businessKey: false,
            primaryKey: false,
          },
        },
        "intent-1",
      ),
    );
    const updated = panelOperationOutcomeSchema.parse(
      await saveAttribute.execute(
        host,
        attributeTarget,
        { values: { showName: "Size", attrDesc: "Updated", enable: true, businessKey: true } },
        "intent-2",
      ),
    );

    expect(requests).toEqual([
      {
        path: "/api/data-query/ontology/model/attribute/create",
        method: "POST",
        body: {
          className: "Device",
          name: "size",
          showName: "Size",
          type: "int",
          attrDesc: "",
          enable: true,
          businessKey: false,
          primaryKey: false,
        },
      },
      {
        path: "/api/data-query/ontology/model/attribute/update",
        method: "POST",
        body: { className: "Device", name: "size", showName: "Size", attrDesc: "Updated", enable: true, businessKey: true },
      },
    ]);
    expect(created.kind === "success" && created.affected).toEqual({
      objects: [{ objectType: ATTRIBUTE, primaryKey: '["Device","size"]' }],
      objectTypes: [ATTRIBUTE, OBJECT_TYPE],
    });
    expect(updated.kind === "success" && updated.affected).toEqual({
      objects: [{ objectType: ATTRIBUTE, primaryKey: '["Device","size"]' }],
      objectTypes: [ATTRIBUTE, OBJECT_TYPE],
    });
  });

  it("creates and updates relationships with matching affected objectTypes", async () => {
    const { host, requests } = owner(path => ({
      status: path.endsWith("/create") ? 201 : 200,
      body: relationshipView,
    }));

    const created = panelOperationOutcomeSchema.parse(
      await saveRelationship.execute(
        host,
        { kind: "draft" },
        {
          values: {
            relationship: "owns",
            fromclass: "Device",
            toclass: "Site",
            desc: "owns",
            fromField: "site_id",
            toField: "id",
          },
        },
        "intent-1",
      ),
    );
    const updated = panelOperationOutcomeSchema.parse(
      await saveRelationship.execute(
        host,
        relationshipTarget,
        { values: { desc: "owns", fromField: "site_id", toField: "id" } },
        "intent-2",
      ),
    );

    expect(requests).toEqual([
      {
        path: "/api/data-query/ontology/model/relationship/create",
        method: "POST",
        body: {
          relationship: "owns",
          fromclass: "Device",
          toclass: "Site",
          desc: "owns",
          fromField: "site_id",
          toField: "id",
        },
      },
      {
        path: "/api/data-query/ontology/model/relationship/update",
        method: "POST",
        body: { relationship: "owns", desc: "owns", fromField: "site_id", toField: "id" },
      },
    ]);
    expect(created.kind === "success" && created.affected).toEqual({
      objects: [{ objectType: RELATIONSHIP, primaryKey: "owns" }],
      objectTypes: [RELATIONSHIP, OBJECT_TYPE],
    });
    expect(updated.kind === "success" && updated.affected).toEqual({
      objects: [{ objectType: RELATIONSHIP, primaryKey: "owns" }],
      objectTypes: [RELATIONSHIP],
    });
  });

  it("keeps the stored value of every field an update did not submit", async () => {
    const stored = {
      "/ontology/model/object-type?className=Device": { ...objectTypeView, className: "Device", classDesc: "Kept description" },
      "/ontology/model/attributes?className=Device": [{ ...attributeView, attrDesc: "Kept", businessKey: true }],
      "/ontology/model/relationship?relationship=owns": relationshipView,
    } as Record<string, unknown>;
    const written = { "/object-type/update": objectTypeView, "/attribute/update": attributeView, "/relationship/update": relationshipView };
    const { host, requests } = owner((path, init) => {
      const resource = path.slice(path.indexOf("/ontology/model"));
      const write = Object.entries(written).find(([suffix]) => resource.endsWith(suffix));
      return { status: 200, body: init.method === "POST" ? write![1] : stored[resource] };
    });
    const write = (path: string) => requests.find(request => request.method === "POST" && request.path.endsWith(path))!.body;

    // A partial submission names what it changes; the rest comes from the owner, not from missing (empty) values.
    await saveObjectType.execute(host, objectTarget, { values: { showName: "Renamed" }, submittedFields: ["/showName"] }, "intent-1");
    expect(write("/object-type/update")).toEqual({ className: "Device", showName: "Renamed", classDesc: "Kept description" });

    await saveAttribute.execute(host, attributeTarget, { values: { showName: "Width", attrDesc: "" }, submittedFields: ["/showName"] }, "intent-2");
    expect(write("/attribute/update")).toEqual({
      className: "Device", name: "size", showName: "Width", attrDesc: "Kept", enable: true, businessKey: true,
    });

    await saveRelationship.execute(host, relationshipTarget, { values: { desc: "" }, submittedFields: ["/desc"] }, "intent-3");
    // A submitted field is written even when it clears the value; Java then decides whether it may be empty.
    expect(write("/relationship/update")).toEqual({ relationship: "owns", desc: "", fromField: "site_id", toField: "id" });
  });

  it("writes the submitted form as is when no submittedFields are named, and refuses an update of a vanished object", async () => {
    const { host, requests } = owner(() => ({ status: 200, body: objectTypeView }));
    await saveObjectType.execute(host, objectTarget, { values: { showName: "Pump display", classDesc: "" } }, "intent-4");
    expect(requests.map(request => request.method)).toEqual(["POST"]);

    const missing = owner(() => ({ status: 404, body: { error: { code: "ATTRIBUTE_NOT_FOUND", message: "Gone" } } }));
    const refused = await saveAttribute.execute(
      missing.host, attributeTarget, { values: { showName: "Width" }, submittedFields: ["/showName"] }, "intent-5",
    );
    expect(refused).toMatchObject({ kind: "refusal", code: "ATTRIBUTE_NOT_FOUND" });
    expect(missing.requests.every(request => request.method === "GET")).toBe(true);
  });

  it("keeps 422 field errors and 409 business refusals structured", async () => {
    const fieldRefusal = hostWithBody(422, {
      error: {
        code: "FIELD_VALIDATION_FAILED",
        message: "Validation failed",
        fields: [{ field: "/values/showName", code: "required", message: "Display name is required" }],
      },
    });
    expect(
      panelOperationOutcomeSchema.parse(await saveObjectType.execute(fieldRefusal, { kind: "draft" }, { values: {} }, "i1")),
    ).toEqual({
      kind: "refusal",
      code: "FIELD_VALIDATION_FAILED",
      message: "Validation failed",
      errors: [{ field: "/showName", code: "required", message: "Display name is required" }],
    });

    const locked = hostWithBody(409, {
      error: { code: "PRIMARY_KEY_LOCKED", message: "Primary key attribute cannot be deleted" },
    });
    expect(panelOperationOutcomeSchema.parse(await deleteAttribute.execute(locked, attributeTarget))).toEqual({
      kind: "refusal",
      code: "PRIMARY_KEY_LOCKED",
      message: "Primary key attribute cannot be deleted",
      details: { code: "PRIMARY_KEY_LOCKED", message: "Primary key attribute cannot be deleted" },
    });

    const inUse = hostWithBody(409, {
      error: {
        code: "ATTRIBUTE_IN_USE",
        message: "Attribute is used by relationships: owns",
        relationships: ["owns"],
      },
    });
    expect(panelOperationOutcomeSchema.parse(await deleteAttribute.execute(inUse, attributeTarget))).toEqual({
      kind: "refusal",
      code: "ATTRIBUTE_IN_USE",
      message: "Attribute is used by relationships: owns",
      details: {
        code: "ATTRIBUTE_IN_USE",
        message: "Attribute is used by relationships: owns",
        relationships: ["owns"],
      },
    });
  });

  it("deletes object types including cascading relationships in affected", async () => {
    const withCascade = owner(() => ({ status: 200, body: { relationships: ["owns", "runs"] } }));
    const withoutCascade = owner(() => ({ status: 200, body: { relationships: [] } }));

    const cascadedOutcome = panelOperationOutcomeSchema.parse(
      await deleteObjectType.execute(withCascade.host, objectTarget),
    );
    const plainOutcome = panelOperationOutcomeSchema.parse(
      await deleteObjectType.execute(withoutCascade.host, objectTarget),
    );

    expect(withCascade.requests[0]).toEqual({
      path: "/api/data-query/ontology/model/object-type/delete",
      method: "POST",
      body: { className: "Device" },
    });
    expect(cascadedOutcome).toEqual({
      kind: "success",
      data: { relationships: ["owns", "runs"] },
      affected: {
        objects: [
          { objectType: OBJECT_TYPE, primaryKey: "Device" },
          { objectType: RELATIONSHIP, primaryKey: "owns" },
          { objectType: RELATIONSHIP, primaryKey: "runs" },
        ],
        objectTypes: [OBJECT_TYPE, ATTRIBUTE, RELATIONSHIP],
        // The type, and the relationships that joined it, are gone.
        removed: [
          { objectType: OBJECT_TYPE, primaryKey: "Device" },
          { objectType: RELATIONSHIP, primaryKey: "owns" },
          { objectType: RELATIONSHIP, primaryKey: "runs" },
        ],
      },
    });
    expect(plainOutcome).toEqual({
      kind: "success",
      data: { relationships: [] },
      affected: {
        objects: [{ objectType: OBJECT_TYPE, primaryKey: "Device" }],
        objectTypes: [OBJECT_TYPE, ATTRIBUTE],
        removed: [{ objectType: OBJECT_TYPE, primaryKey: "Device" }],
      },
    });
  });

  it("deletes attributes and relationships and reports affected records", async () => {
    const { host, requests } = owner(() => ({ status: 200, body: {} }));

    const attribute = panelOperationOutcomeSchema.parse(
      await deleteAttribute.execute(host, { kind: "object", objectType: ATTRIBUTE, primaryKey: '["Device","site_id"]' }),
    );
    const relationship = panelOperationOutcomeSchema.parse(
      await deleteRelationship.execute(host, relationshipTarget),
    );

    expect(requests).toEqual([
      { path: "/api/data-query/ontology/model/attribute/delete", method: "POST", body: { className: "Device", name: "site_id" } },
      { path: "/api/data-query/ontology/model/relationship/delete", method: "POST", body: { relationship: "owns" } },
    ]);
    expect(attribute).toEqual({
      kind: "success",
      data: {},
      affected: {
        objects: [{ objectType: ATTRIBUTE, primaryKey: '["Device","site_id"]' }],
        objectTypes: [ATTRIBUTE, OBJECT_TYPE],
        removed: [{ objectType: ATTRIBUTE, primaryKey: '["Device","site_id"]' }],
      },
    });
    expect(relationship).toEqual({
      kind: "success",
      data: {},
      affected: {
        removed: [{ objectType: RELATIONSHIP, primaryKey: "owns" }],
        objects: [{ objectType: RELATIONSHIP, primaryKey: "owns" }],
        objectTypes: [RELATIONSHIP, OBJECT_TYPE],
      },
    });
  });

  it("sets the primary key and reports all class attributes as affected", async () => {
    const switched = [
      {
        className: "Device",
        name: "site_id",
        showName: "Site",
        type: "varchar",
        attrDesc: "",
        enable: true,
        businessKey: true,
        primaryKey: true,
      },
      {
        className: "Device",
        name: "id",
        showName: "",
        type: "varchar",
        attrDesc: "",
        enable: true,
        businessKey: false,
        primaryKey: false,
      },
    ];
    const { host, requests } = owner(() => ({ status: 200, body: switched }));

    const outcome = panelOperationOutcomeSchema.parse(
      await setPrimaryKey.execute(host, { kind: "object", objectType: ATTRIBUTE, primaryKey: '["Device","site_id"]' }),
    );

    expect(requests[0]).toEqual({
      path: "/api/data-query/ontology/model/attribute/primary-key",
      method: "POST",
      body: { className: "Device", name: "site_id" },
    });
    expect(outcome).toEqual({
      kind: "success",
      data: { attributes: switched },
      affected: {
        objects: [
          { objectType: ATTRIBUTE, primaryKey: '["Device","site_id"]' },
          { objectType: ATTRIBUTE, primaryKey: '["Device","id"]' },
        ],
        objectTypes: [ATTRIBUTE, OBJECT_TYPE],
      },
    });
  });

  it("reads target labels for confirmation and falls back to the key on 403/404", async () => {
    const { host } = owner(path => {
      if (path.includes("/object-type?className=Device")) return { status: 200, body: objectTypeView };
      if (path.includes("/attributes?className=Device")) return { status: 200, body: [attributeView] };
      if (path.includes("/relationship?relationship=owns")) return { status: 200, body: relationshipView };
      return { status: 404, body: { error: { code: "NOT_FOUND", message: "Not found" } } };
    });

    expect(await deleteObjectType.targetLabel(host, objectTarget)).toBe("Pump display");
    expect(await deleteObjectType.targetLabel(host, { kind: "object", objectType: OBJECT_TYPE, primaryKey: "Gone" })).toBe("Gone");
    expect(await deleteAttribute.targetLabel(host, attributeTarget)).toBe("Size");
    expect(
      await deleteAttribute.targetLabel(host, { kind: "object", objectType: ATTRIBUTE, primaryKey: '["Device","gone"]' }),
    ).toBe('["Device","gone"]');
    expect(await deleteRelationship.targetLabel(host, relationshipTarget)).toBe("owns");
    expect(
      await deleteRelationship.targetLabel(host, { kind: "object", objectType: RELATIONSHIP, primaryKey: "missing" }),
    ).toBe("missing");
  });

  it("describes a single attribute or relationship delete by the record's owner-read name", async () => {
    const { host } = owner(path => ({
      status: 200,
      body: path.includes("/attributes?") ? [attributeView] : relationshipView,
    }));
    expect(await deleteAttribute.inspectImpact!.inspect(host, [{ target: attributeTarget, input: {} }])).toEqual({
      summary: "This deletes the selected attribute; the owner refuses the primary key and an attribute a relationship joins on.",
      objects: [{ target: { objectType: ATTRIBUTE, primaryKey: attributeTarget.primaryKey }, label: "Size" }],
      total: 1,
    });
    expect(await deleteRelationship.inspectImpact!.inspect(host, [{ target: relationshipTarget, input: {} }])).toEqual({
      summary: "This deletes the selected relationship.",
      objects: [{ target: { objectType: RELATIONSHIP, primaryKey: "owns" }, label: "owns" }],
      total: 1,
    });
    expect([deleteAttribute, deleteRelationship].map(operation => operation.inspectImpact!.handlerRef))
      .toEqual(["attributes.delete.inspect-impact", "relationships.delete.inspect-impact"]);
  });

  it("names the attribute that becomes the primary key and the one that stops being it", async () => {
    const { host } = owner(() => ({
      status: 200,
      body: [
        { ...attributeView, name: "id", showName: "ID", primaryKey: true },
        attributeView,
        { ...attributeView, name: "note", showName: "Note" },
      ],
    }));
    expect(await setPrimaryKey.inspectImpact!.inspect(host, [{ target: attributeTarget, input: {} }])).toEqual({
      summary: "This makes the selected attribute the primary key of its object type; the current primary key stops being one.",
      objects: [
        { target: { objectType: ATTRIBUTE, primaryKey: '["Device","id"]' }, label: "ID" },
        { target: { objectType: ATTRIBUTE, primaryKey: '["Device","size"]' }, label: "Size" },
      ],
      total: 2,
    });
  });

  it("inspects object type deletion impact and propagates 404 errors", async () => {
    const impact = {
      relationships: [
        { relationship: "owns", fromclass: "Device", toclass: "Site", desc: "owns the site", fromField: "site_id", toField: "id" },
      ],
    };
    const { host } = owner(path =>
      path.includes("/object-type/deletion-impact") && path.includes("className=Device")
        ? { status: 200, body: impact }
        : { status: 404, body: { error: { code: "OBJECT_TYPE_NOT_FOUND", message: "Class not found" } } },
    );

    const inspected = await deleteObjectType.inspectImpact!.inspect(host, [{ target: objectTarget, input: {} }]);
    expect(inspected).toEqual({
      summary: "This deletes the selected object type, together with the relationships that touch it (1 in total).",
      objects: [{ target: { objectType: RELATIONSHIP, primaryKey: "owns" }, label: "owns the site" }],
      total: 1,
    });
    await expect(
      deleteObjectType.inspectImpact!.inspect(host, [{ target: { kind: "object", objectType: OBJECT_TYPE, primaryKey: "Gone" }, input: {} }]),
    ).rejects.toMatchObject({ status: 404, code: "OBJECT_TYPE_NOT_FOUND" });
  });

  it("surfaces unexpected transport answers instead of inventing an owner refusal", async () => {
    const host = hostWithBody(502, { message: "bad gateway" });

    await expect(saveObjectType.execute(host, { kind: "draft" }, { values: {} }, "intent-1")).rejects.toThrow();
  });
});

function hostWithBody(status: number, body: unknown): PanelOperationHost {
  return owner(() => ({ status, body })).host;
}
