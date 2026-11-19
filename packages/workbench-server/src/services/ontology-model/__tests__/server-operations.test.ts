import { describe, expect, it } from "vitest";
import { isDeepStrictEqual } from "node:util";
import { panelServerOperation } from "../../product-panels/server-operations";
import { ontologyModelServerOperations } from "../server-operations";
import type { PanelOperationHost } from "../../product-panels/server-operations";

const objectTypeView = {
  className: "Pump", showName: "Pump", classDesc: "", attributeCount: 1, businessKeyCount: 0,
  relationshipCount: 0, primaryKey: { status: "ok", name: "pump_no" },
};
const attributeView = {
  className: "Device", name: "size", showName: "Size", type: "int", attrDesc: "", enable: true,
  businessKey: false, primaryKey: false,
};
const relationshipView = {
  relationship: "owns", fromclass: "Device", toclass: "Site", desc: "owns", fromField: "site_id", toField: "id",
};

/** A host whose Java owner answers what the test decides, recording every request it received. */
function owner(answer: (path: string, init: NonNullable<Parameters<typeof fetch>[1]>) => { status: number; body: unknown }) {
  const requests: { path: string; method: string; body: Record<string, unknown> }[] = [];
  const host: PanelOperationHost = {
    requestWorkbench: async () => { throw new Error("The ontology model owner is reached through request"); },
    async request(path, init) {
      requests.push({ path, method: init.method ?? "GET", body: JSON.parse(String(init.body)) });
      const { status, body } = answer(path, init);
      return new Response(JSON.stringify(body), { status });
    },
  };
  return { host, requests };
}

describe("the ontology model's server operations", () => {
  it("registers each form save under the handler the SDK's resource module names", () => {
    expect(ontologyModelServerOperations.map(operation => operation.handlerRef)).toEqual([
      "platform:ObjectType.save", "platform:Attribute.save", "platform:Relationship.save",
    ]);
    expect(panelServerOperation("platform:ObjectType.save").resultSchema).toBeDefined();
    expect(() => panelServerOperation("platform:NoType.save")).toThrow(/no server owner client/);
  });

  it("names the draft operation by the target it saves", () => {
    const [objectType, attribute, relationship] = ontologyModelServerOperations;
    expect(objectType.draftOperation({ kind: "draft" })).toBe("objectType.create");
    expect(objectType.draftOperation({ kind: "object", objectType: "platform:ObjectType", primaryKey: "Device" }))
      .toBe("objectType.update");
    expect(attribute.draftOperation({ kind: "draft" })).toBe("attribute.create");
    expect(relationship.draftOperation({ kind: "object", objectType: "platform:Relationship", primaryKey: "owns" }))
      .toBe("relationship.update");
  });

  it("accepts only its own target type and carries a draft's values whole", () => {
    const [objectType] = ontologyModelServerOperations;
    const values = { className: "Pump", primaryKeyName: "pump_no", showName: "Pump", classDesc: "" };
    expect(() => objectType.targetSchema.parse(
      { kind: "object", objectType: "platform:Attribute", primaryKey: "Device" })).toThrow();
    expect(objectType.draftInput({ values })).toEqual(values);
    expect(isDeepStrictEqual(
      objectType.create!.draftValues(values, "d1"),
      objectType.create!.draftValues(objectType.draftInput({ values }), "d1"))).toBe(true);
    expect(objectType.create!.createdObject(objectTypeView)).toEqual({ objectType: "platform:ObjectType", primaryKey: "Pump" });
  });

  it("creates through the owner's create request and reports what the write reached", async () => {
    const { host, requests } = owner(() => ({ status: 200, body: objectTypeView }));
    const [objectType] = ontologyModelServerOperations;

    const outcome = await objectType.execute(host, { kind: "draft" }, {
      values: { className: "Pump", primaryKeyName: "pump_no", showName: "Pump", classDesc: "" },
    }, "intent-1");

    expect(outcome).toEqual({
      kind: "success", data: objectTypeView,
      affected: {
        objects: [{ objectType: "platform:ObjectType", primaryKey: "Pump" }],
        objectTypes: ["platform:ObjectType", "platform:Attribute"],
      },
    });
    expect(requests).toEqual([{
      path: "/api/data-query/ontology/model/object-type/create", method: "POST",
      body: { className: "Pump", primaryKeyName: "pump_no", showName: "Pump", classDesc: "" },
    }]);
  });

  it("updates through the owner's update request with the identity from the target", async () => {
    const { host, requests } = owner(() => ({ status: 200, body: objectTypeView }));
    const [objectType] = ontologyModelServerOperations;

    await objectType.execute(host, { kind: "object", objectType: "platform:ObjectType", primaryKey: "Device" }, {
      values: { className: "Whatever", showName: "Devices", classDesc: "A device" },
    }, "intent-1");

    expect(requests[0]).toEqual({
      path: "/api/data-query/ontology/model/object-type/update", method: "POST",
      body: { className: "Device", showName: "Devices", classDesc: "A device" },
    });
  });

  it("splits an attribute target's two-part key into the update body", async () => {
    const { host, requests } = owner(() => ({ status: 200, body: attributeView }));
    const [, attribute] = ontologyModelServerOperations;

    const outcome = await attribute.execute(host,
      { kind: "object", objectType: "platform:Attribute", primaryKey: "[\"Device\",\"size\"]" }, {
        values: { className: "Whatever", name: "Whatever", showName: "Size", attrDesc: "", enable: true, businessKey: false },
      }, "intent-1");

    expect(requests[0]).toEqual({
      path: "/api/data-query/ontology/model/attribute/update", method: "POST",
      body: { className: "Device", name: "size", showName: "Size", attrDesc: "", enable: true, businessKey: false },
    });
    expect(outcome).toEqual({
      kind: "success", data: attributeView,
      affected: {
        objects: [{ objectType: "platform:Attribute", primaryKey: "[\"Device\",\"size\"]" }],
        objectTypes: ["platform:Attribute", "platform:ObjectType"],
      },
    });
  });

  it("creates a relationship with all six values and reports the ends it reached", async () => {
    const { host, requests } = owner(() => ({ status: 200, body: relationshipView }));
    const [, , relationship] = ontologyModelServerOperations;

    const outcome = await relationship.execute(host, { kind: "draft" }, {
      values: { relationship: "owns", fromclass: "Device", toclass: "Site", desc: "owns", fromField: "site_id", toField: "id" },
    }, "intent-1");

    expect(requests[0]).toEqual({
      path: "/api/data-query/ontology/model/relationship/create", method: "POST",
      body: { relationship: "owns", fromclass: "Device", toclass: "Site", desc: "owns", fromField: "site_id", toField: "id" },
    });
    expect(outcome).toEqual({
      kind: "success", data: relationshipView,
      affected: {
        objects: [{ objectType: "platform:Relationship", primaryKey: "owns" }],
        objectTypes: ["platform:Relationship", "platform:ObjectType"],
      },
    });
  });

  it("carries the owner's refusal whole, with the per-field list it answered with", async () => {
    const { host } = owner(() => ({
      status: 422,
      body: { error: { code: "FIELD_VALIDATION_FAILED", message: "Some fields are invalid",
        fields: [{ field: "/values/showName", code: "required", message: "A display name is required" }] } },
    }));
    const [, attribute] = ontologyModelServerOperations;

    const outcome = await attribute.execute(host, { kind: "draft" }, {
      values: { className: "Device", name: "size", showName: "", type: "int", attrDesc: "", enable: true, businessKey: false, primaryKey: false },
    }, "intent-1");

    expect(outcome).toEqual({
      kind: "failure", code: "FIELD_VALIDATION_FAILED", message: "Some fields are invalid",
      details: {
        code: "FIELD_VALIDATION_FAILED", message: "Some fields are invalid",
        fields: [{ field: "/values/showName", code: "required", message: "A display name is required" }],
      },
    });
  });

  it("surfaces an answer that is not the owner's refusal instead of inventing one", async () => {
    const { host } = owner(() => ({ status: 502, body: { message: "bad gateway" } }));
    const [objectType] = ontologyModelServerOperations;

    await expect(objectType.execute(host, { kind: "draft" }, { values: {} }, "intent-1"))
      .rejects.toThrow("The ontology model service refused without a reason");
  });
});
