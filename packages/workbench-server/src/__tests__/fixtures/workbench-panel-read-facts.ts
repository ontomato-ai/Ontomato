import { ACTION, APPLICATION, ATTRIBUTE, METRIC_VIEW, OBJECT_TYPE, PRODUCT_PANEL, PRODUCT_PROJECTION, RELATIONSHIP, USER } from "@ontomato/contracts/platform-object-types";
import { ownerData, type PanelFixtureRead } from "./workbench-panel-reads-owner";

export const modelOwnerRead: PanelFixtureRead = async ({ type, name, parameters }, owner) => {
  const className = typeof parameters.className === "string" ? { className: parameters.className } : undefined;
  const routes = {
    [OBJECT_TYPE]: { list: "object-types", record: "object-type", key: "className", labels: "objectType" },
    [ATTRIBUTE]: { list: "attributes", record: "attribute", key: "name", labels: "attribute" },
    [RELATIONSHIP]: { list: "relationships", record: "relationship", key: "relationship", labels: "relationship" },
  } as const;
  const route = routes[type as keyof typeof routes];
  if (!route) return;
  if (name === "options" && type === OBJECT_TYPE) return owner.get("/ontology/model/object-types");
  if (name === "list" || name === "record") {
    const [raw, labels] = await Promise.all([
      name === "list" ? owner.get(`/ontology/model/${route.list}`, className)
        : owner.get(`/ontology/model/${route.record}`, { [route.key]: String(parameters.primaryKey) }),
      owner.get("/ontology/model/field-labels"),
    ]);
    const facts = { [name === "list" ? "views" : "view"]: raw, fieldLabels: labels[route.labels] };
    if (type !== ATTRIBUTE) return facts;
    const views = await owner.get("/ontology/model/object-types") as { className: string; showName?: string }[];
    return { ...facts, classLabels: Object.fromEntries(views.map(view => [view.className, view.showName || view.className])) };
  }
  if (name === "createForm" || name === "form") return owner.post(`/ontology/model/${route.record}/form`, {
    target: name === "createForm" ? { kind: "draft" } : { kind: "object", objectType: type, primaryKey: parameters.primaryKey },
    values: parameters.values, changedField: parameters.changedField ?? null,
  });
};

export const actionOwnerRead: PanelFixtureRead = async ({ type, name, parameters }, owner) => {
  if (type !== ACTION) return;
  if (name === "list") return ownerData(await owner.post("/action/queryList", { purpose: "manage" }));
  if (name === "executionDefinition") {
    const action = ownerData(await owner.post("/action/queryById", { id: parameters.primaryKey, purpose: "execute" })) as {
      target?: { keyParameter: string } | null;
    };
    const object = parameters.object as { primaryKey: string } | undefined;
    const key = action.target?.keyParameter;
    ownerData(await owner.post("/action/form", {
      id: parameters.primaryKey, parameters: key && object ? { [key]: object.primaryKey } : {},
      readOnlyParameters: key && object ? [key] : [],
    }));
    return action;
  }
};

export const metricOwnerRead: PanelFixtureRead = async ({ type, name, parameters }, owner) => {
  if (type !== METRIC_VIEW || name !== "result") return;
  const description = await owner.post("/ontology/query/metrics/describe", { id: parameters.primaryKey });
  return owner.post("/ontology/query/metrics/execute", {
    id: parameters.primaryKey, revision: description.revision, parameters: parameters.parameters,
  });
};

export const customerOwnerRead: PanelFixtureRead = async ({ type, name, parameters }, owner) => {
  if (type === OBJECT_TYPE && name === "instanceNeighbors")
    return owner.post("/data/instance-graph/neighborhood", parameters);
  if (type === OBJECT_TYPE && name === "instanceRecord") {
    const className = String(parameters.className);
    const [attributes, answer, view] = await Promise.all([
      owner.get("/ontology/model/attributes", { className }),
      owner.post("/data/queryInfoByNode", { class: className, id: `${className}:${parameters.primaryKey}` }),
      owner.get("/ontology/model/object-type", { className }),
    ]);
    return { record: { attributes, answer }, type: view };
  }
  if (type !== "customer:ObjectType" && (type !== OBJECT_TYPE || name !== "instances")) return;
  if (name === "query" || name === "instances") {
    const attributes = await owner.get("/ontology/model/attributes", { className: String(parameters.classname) });
    return { attributes, answer: await owner.post("/data/getWholeClassDataByPage", parameters) };
  }
  if (name === "record" || name === "form" || name === "createForm") {
    const className = String(parameters.className);
    const attributes = await owner.get("/ontology/model/attributes", { className });
    if (name === "createForm") return { attributes };
    return { attributes, answer: await owner.post("/data/queryInfoByNode", { class: className, id: `${className}:${parameters.primaryKey}` }) };
  }
};

export const catalogueOwnerRead: PanelFixtureRead = async ({ type, name, parameters }, owner, viewer) => {
  if (type === USER && name === "principalDirectory") return owner.post("/platform/identity/principals", parameters);
  if ((type === PRODUCT_PANEL || type === PRODUCT_PROJECTION) && name === "grantRows")
    return owner.post("/authorization/objects/product-access", parameters);
  if (type === PRODUCT_PANEL && (name === "usedByRows" || name === "referenceGraph"))
    return ownerData(await owner.get("/platform/applications/panel-uses/by-panel", { domainId: viewer.domainId, panelId: String(parameters.primaryKey) }));
  if (type !== APPLICATION) return;
  if (name === "query") return ownerData(await owner.get("/platform/applications/catalogue",
    Object.fromEntries(Object.entries(parameters).map(([key, value]) => [key, String(value)]))));
  if (name === "record" || name === "entries") {
    const record = ownerData(await owner.get(`/platform/applications/catalogue/${String(parameters.primaryKey)}`)) as Record<string, unknown>;
    if (name === "record") return record;
    const { id, entry, panelUses, groups } = record;
    return { applicationId: id, entry, panelUses, groups };
  }
  if (name === "form" || name === "createForm") {
    const { target, values, changedField, section, entryId, mergeCurrentValues } = parameters;
    return ownerData(await owner.post("/platform/applications/catalogue/form", {
      target, values, changedField, section, entryId, mergeCurrentValues,
    }));
  }
};
