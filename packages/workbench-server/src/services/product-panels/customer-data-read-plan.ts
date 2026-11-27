import { runtimeJsonObjectSchema } from "@ontomato/contracts/agent-runtime-values";
import { panelReadParameterSchemas } from "@ontomato/contracts/panel-projection";
import { OBJECT_TYPE } from "@ontomato/contracts/platform-object-types";
import { z } from "zod";
import { HttpError } from "../../utils/errors";
import {
  customerClassPageRequest, customerObjectRecordCall, customerQueryParams,
  prepareCustomerNeighborsRead,
  presentCustomerClassPage, presentCustomerCreateForm, presentCustomerEditForm, presentCustomerObjectRecord,
  withInstanceDetail, withInstanceDetailPaths,
} from "../ontology-model/customer-reads";
import {
  createInstanceGraphReadPresenter, instanceGraphConnectionsRequest, instanceGraphSearchRequest,
  instanceNeighborsParams, instanceNeighborsRequest,
} from "../ontology-model/instance-graph-reads";
import { presentObjectTypeLabel } from "../ontology-model/model-reads";
import { defaultRegisteredJavaCall, ownerReadPlan, readyPayload, RegisteredDataReadFailure, type RegisteredDataReadContext, type RegisteredDataReadRegistration } from "./registered-data-read";
import { panelMemberReadRefusal } from "./data-reads";
import type { JavaPanelReadResult } from "./java-panel-reads";
import { formParams, type PanelReadSelection } from "./registered-data-read";

const instanceRecordFacts = z.object({ record: z.unknown(), type: z.unknown() });

function prepareRead(method: string, type: string, parameters: object, present: (payload: unknown) => unknown) {
  return { call: { type, name: method, parameters: runtimeJsonObjectSchema.parse(parameters) }, present };
}

function prepareCustomerObjectRead(selection: PanelReadSelection, params: Record<string, unknown>) {
  const { kind, typeId, method } = selection;
  const read = (type: string, parameters: object, present: (payload: unknown) => unknown) =>
    prepareRead(method, type, parameters, present);

  if (kind === "customer") {
    const type = "customer:ObjectType";
    if (method === "query")
      return read(type, customerClassPageRequest(typeId, customerQueryParams(params)), raw => presentCustomerClassPage(typeId, raw));
    if (method === "createForm") {
      const form = formParams(params);
      return read(type, { className: typeId }, raw => presentCustomerCreateForm(typeId, raw, form));
    }
    if (method === "record" || method === "form") {
      const primaryKey = selection.primaryKey!;
      if (method === "record") return {
        call: customerObjectRecordCall(typeId, primaryKey),
        present: (raw: unknown) => presentCustomerObjectRecord(typeId, primaryKey, raw),
      };
      const form = formParams(params);
      return read(type, { className: typeId, primaryKey }, raw => presentCustomerEditForm(typeId, primaryKey, raw, form));
    }
    return;
  }

  if (typeId !== OBJECT_TYPE) return;
  if (method === "instances") {
    const className = panelReadParameterSchemas.className.parse(params.className);
    return read(typeId, customerClassPageRequest(className, customerQueryParams(params)), raw =>
      withInstanceDetailPaths(className, presentCustomerClassPage(className, raw)));
  }
  if (method === "instanceRecord") {
    const { className, primaryKey } = panelReadParameterSchemas.graphNode.parse(params.object);
    return read(typeId, { className, primaryKey }, raw => {
      const { record, type } = instanceRecordFacts.parse(raw);
      return withInstanceDetail(presentCustomerObjectRecord(className, primaryKey, record), className, primaryKey, presentObjectTypeLabel(type));
    });
  }
}

export function prepareCustomerDataRead(selection: PanelReadSelection, params: Record<string, unknown>, locale?: string) {
  const { kind, typeId, method } = selection;
  if (kind === "customer" && method === "neighbors") return prepareCustomerNeighborsRead(typeId, params, locale);
  const objectRead = prepareCustomerObjectRead(selection, params);
  if (objectRead || kind !== "platform" || typeId !== OBJECT_TYPE) return objectRead;

  const read = (parameters: object, present: (payload: unknown) => unknown) =>
    prepareRead(method, typeId, parameters, present);
  const graph = createInstanceGraphReadPresenter(locale);
  switch (method) {
    case "instanceNeighbors": {
      const { node, ...filters } = instanceNeighborsParams(params);
      return read(instanceNeighborsRequest(node, filters), raw => graph.neighbors(node, raw));
    }
    case "instanceGraphOverview":
      return read({}, graph.overview);
    case "instanceGraphConnections":
      return read(instanceGraphConnectionsRequest(params), graph.connections);
    case "instanceGraphStatistics":
      return read({}, graph.statistics);
    case "instanceGraphClasses":
      return read({}, graph.classes);
    case "instanceGraphSearch":
      return read(instanceGraphSearchRequest(params), graph.search);
  }
}


async function customerRegisteredPlan(context: RegisteredDataReadContext) {
  const ownerRead = prepareCustomerDataRead(context.selection, context.params, context.credentials.locale);
  const base = ownerRead
    ? ownerReadPlan(ownerRead, { messageOnlyCodes: ["OBJECT_TYPE_NOT_FOUND"] })
    : {
      reads: [{ call: defaultRegisteredJavaCall(context) }],
      present: (results: readonly JavaPanelReadResult[]) =>
        readyPayload(results[0], { messageOnlyCodes: ["OBJECT_TYPE_NOT_FOUND"] }).payload,
    };
  return {
    ...base,
    async present(results: Parameters<typeof base.present>[0], presentContext: RegisteredDataReadContext) {
      try {
        return await base.present(results, presentContext);
      } catch (error) {
        if (error instanceof HttpError) {
          const response = panelMemberReadRefusal(error);
          if (response) throw new RegisteredDataReadFailure(response);
        }
        throw error;
      }
    },
  };
}

const objectTypeInstanceReadMethods = [
  "instances",
  "instanceRecord",
  "instanceNeighbors",
  "instanceGraphOverview",
  "instanceGraphConnections",
  "instanceGraphStatistics",
  "instanceGraphClasses",
  "instanceGraphSearch",
] as const;

export const customerDataReadRegistrations: RegisteredDataReadRegistration[] = [
  { kind: "customer", plan: customerRegisteredPlan },
  ...objectTypeInstanceReadMethods.map(method => ({
    typeId: OBJECT_TYPE, method, plan: customerRegisteredPlan,
  })),
];
