import { z } from "zod";
import type { PlatformOntologyType } from "@ontomato/contracts/platform-ontology";
import { ONTOLOGY_RELATION_KIND } from "@ontomato/contracts/platform-object-types";
import { platformTaskSchema } from "@ontomato/contracts/platform-schedules";
import { HttpError } from "../../utils/errors";
import type { AssistantCredentials } from "../../utils/assistant-credentials";
import type { JavaPanelReadResult, JavaPanelViewer, PreparedOwnerReadFacts } from "../product-panels/java-panel-reads";
import type { PanelReadSelection } from "../product-panels/panel-owner-reads";
import type { RegisteredDataReadRegistration } from "../product-panels/registered-data-read";
import { createPlatformOntologyCatalogueReads, requireOntologyCatalogueType } from "./catalogue-reads";
import { PlatformOntologyOwnerReaders, type OntologyReadFact } from "./owners";
import {
  createPlatformOntologyReadAdapter, platformOntologyInstanceRecordInput, platformOntologyInstanceSearchInput, platformOntologyInstancesInput,
} from "./panel-reads";
import {
  findPlatformOntologyInstance, planPlatformOntologyBrowserDirectory, planPlatformOntologyInstanceDirectory,
  platformOntologyInstanceDirectories, platformOntologyStartNode, presentPlatformOntologyCounts,
  searchPlatformOntologyInstancePage, triggerObject,
} from "./query";
import { prepareRegisteredOntologyNeighbors } from "./registered-neighbors";
import { ONTOLOGY_TYPE, PLATFORM_ONTOLOGY_TYPES, TRIGGER } from "./schema";

export async function prepareRegisteredOntologyRead(
  selection: PanelReadSelection, viewer: JavaPanelViewer, credentials: AssistantCredentials, params: Record<string, unknown> = {},
): Promise<PreparedOwnerReadFacts | undefined> {
  const { typeId, method, primaryKey } = selection;
  if (typeId !== ONTOLOGY_TYPE && typeId !== ONTOLOGY_RELATION_KIND) return;
  const local = (read: (catalogue: ReturnType<typeof createPlatformOntologyCatalogueReads>) => unknown): PreparedOwnerReadFacts => ({
    facts: [], present: owner => read(createPlatformOntologyCatalogueReads(owner, credentials)),
  });
  if (typeId === ONTOLOGY_RELATION_KIND) {
    switch (method) {
      case "list": return local(catalogue => catalogue.relationKinds());
      case "count": return local(catalogue => catalogue.relationCount());
      case "graphEdges": return local(catalogue => catalogue.graphEdges());
      case "record": return local(catalogue => catalogue.relationRecord(primaryKey!));
      default: return;
    }
  }
  const type = params.type as string;
  switch (method) {
    case "list": return local(catalogue => catalogue.list());
    case "count": return local(catalogue => catalogue.count());
    case "properties": return local(catalogue => catalogue.properties(type));
    case "typeRelations": return local(catalogue => catalogue.typeRelations(type));
    case "reads": return local(catalogue => catalogue.reads(type));
    case "operations": return local(catalogue => catalogue.operations(type));
    case "record": return prepareCounts(viewer, credentials, method, requireOntologyCatalogueType(primaryKey!));
    case "counts":
    case "countRows":
    case "graphNodes":
    case "instanceGraphClasses": return prepareCounts(viewer, credentials, method);
    case "instances": return prepareInstances(viewer, credentials, params);
    case "instanceRecord": return prepareInstanceRecord(viewer, credentials, params);
  }
  if (selection.method === "neighbors") return prepareRegisteredOntologyNeighbors(viewer, credentials, params);
  if (selection.method === "instanceSearch") return prepareInstanceSearch(viewer, credentials, params);
  if (selection.method !== "start") return;
  return {
    facts: [{ call: { type: ONTOLOGY_TYPE, name: "start", parameters: {} } }],
    present(viewer, [name]) {
      if (name.status === "error") throw new HttpError(502, name.error, name.code ?? undefined);
      const memberName = name.status === "ready" ? z.string().parse(name.payload) : undefined;
      return { node: platformOntologyStartNode(viewer.userId, viewer.userName, memberName) };
    },
  };
}

function collectOntologyReadFacts() {
  const facts: OntologyReadFact[] = [];
  const indexes = new Map<string, number>();
  return {
    facts,
    register(fact: OntologyReadFact) {
      const key = JSON.stringify(fact);
      const previous = indexes.get(key);
      if (previous !== undefined) return previous;
      const index = facts.push(fact) - 1;
      indexes.set(key, index);
      return index;
    },
  };
}

function prepareInstanceSearch(
  viewer: JavaPanelViewer, credentials: AssistantCredentials, params: Record<string, unknown>,
): PreparedOwnerReadFacts {
  const input = platformOntologyInstanceSearchInput(params);
  const { all, types } = platformOntologyInstanceDirectories(input);
  const readers = new PlatformOntologyOwnerReaders(viewer, credentials);
  const { facts, register } = collectOntologyReadFacts();
  const directories = new Map(types.flatMap(({ id }) => {
    const plan = planPlatformOntologyInstanceDirectory(readers, id, !all);
    if (!plan) return [];
    return [[id, { plan, positions: plan.facts.map(register) }] as const];
  }));
  return {
    facts,
    async present(owner, results) {
      const page = await searchPlatformOntologyInstancePage(input, credentials.locale, async type => {
        const directory = directories.get(type);
        if (!directory) return { ok: false, status: "failed", reason: `Missing ontology instance directory fact: ${type}` };
        const { plan, positions } = directory;
        return plan.read(positions.map(index => results[index]));
      });
      return createPlatformOntologyReadAdapter(owner, credentials).presentInstanceSearchPage(page);
    },
  };
}

function prepareInstances(
  viewer: JavaPanelViewer, credentials: AssistantCredentials, params: Record<string, unknown>,
): PreparedOwnerReadFacts {
  const input = platformOntologyInstancesInput(params);
  const readers = new PlatformOntologyOwnerReaders(viewer, credentials);
  const directory = planPlatformOntologyBrowserDirectory(readers, input.type);
  return {
    facts: directory.facts,
    async present(owner, facts) {
      const page = await searchPlatformOntologyInstancePage(input, credentials.locale, () => directory.read(facts));
      return createPlatformOntologyReadAdapter(owner, credentials).presentInstancesPage(page);
    },
  };
}

function readTriggerInstance(result: JavaPanelReadResult) {
  switch (result.status) {
    case "ready": return triggerObject(platformTaskSchema.parse(result.payload));
    case "forbidden": throw new HttpError(403, result.error);
    case "error": {
      const status = result.code === "TASK_NOT_FOUND" ? 404 : result.code === "UNAUTHENTICATED" ? 401 : 502;
      throw new HttpError(status, result.error, result.code ?? undefined);
    }
    case "empty": throw new HttpError(502, "Missing trigger owner facts", "PANEL_READ_OWNER_RESPONSE_INVALID");
  }
}

function prepareInstanceRecord(
  viewer: JavaPanelViewer, credentials: AssistantCredentials, params: Record<string, unknown>,
): PreparedOwnerReadFacts {
  const object = platformOntologyInstanceRecordInput(params);
  if (object.className === TRIGGER) {
    return {
      facts: [{ call: { type: TRIGGER, name: "record", parameters: { primaryKey: object.primaryKey } } }],
      present: (owner, [result]) =>
        createPlatformOntologyReadAdapter(owner, credentials).presentInstanceRecord(object, readTriggerInstance(result)),
    };
  }
  const readers = new PlatformOntologyOwnerReaders(viewer, credentials);
  const directory = planPlatformOntologyBrowserDirectory(readers, object.className);
  return {
    facts: directory.facts,
    async present(owner, facts) {
      const item = findPlatformOntologyInstance(object, await directory.read(facts));
      return createPlatformOntologyReadAdapter(owner, credentials).presentInstanceRecord(object, item);
    },
  };
}

async function prepareCounts(
  viewer: JavaPanelViewer, credentials: AssistantCredentials, method: string,
  selectedType?: PlatformOntologyType,
): Promise<PreparedOwnerReadFacts> {
  const readers = new PlatformOntologyOwnerReaders(viewer, credentials);
  const types = selectedType ? [selectedType] : PLATFORM_ONTOLOGY_TYPES;
  const { facts, register } = collectOntologyReadFacts();
  const cells = new Map(types.map(({ id }) => {
    const plan = readers.planCount(id);
    const positions = plan.facts.map(register);
    return [id, { plan, positions }];
  }));
  return {
    facts,
    async present(owner, results) {
      const response = await presentPlatformOntologyCounts(types, type => {
        const { plan, positions } = cells.get(type)!;
        return plan.read(positions.map(index => results[index]));
      });
      if (method === "counts") return response;
      const catalogue = createPlatformOntologyCatalogueReads(owner, credentials);
      if (selectedType) return catalogue.presentTypeRecord(selectedType, response.counts[0]);
      const present = {
        countRows: catalogue.presentCountRows,
        graphNodes: catalogue.presentGraphNodes,
        instanceGraphClasses: catalogue.presentInstanceGraphClasses,
      };
      return present[method as keyof typeof present](response.counts);
    },
  };
}

function prepareRegisteredOntologyEntry(context: Parameters<NonNullable<RegisteredDataReadRegistration["facts"]>>[0]) {
  return prepareRegisteredOntologyRead(context.selection, context.owner, context.credentials, context.params);
}

export const ontologyDataReadRegistrations: RegisteredDataReadRegistration[] = [
  ...([
    "list", "count", "properties", "typeRelations", "reads", "operations", "record", "counts", "countRows", "graphNodes",
    "instanceGraphClasses", "instances", "instanceRecord", "neighbors", "instanceSearch", "start",
  ] as const).map(method => ({ typeId: ONTOLOGY_TYPE, method, facts: prepareRegisteredOntologyEntry })),
  ...(["list", "count", "graphEdges", "record"] as const).map(method => ({
    typeId: ONTOLOGY_RELATION_KIND, method, facts: prepareRegisteredOntologyEntry,
  })),
];
