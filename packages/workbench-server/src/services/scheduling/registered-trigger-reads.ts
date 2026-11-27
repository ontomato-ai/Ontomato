import { z } from "zod";
import { APPLICATION, TRIGGER, USER } from "@ontomato/contracts/platform-object-types";
import type { RuntimeJsonValue } from "@ontomato/contracts/agent-runtime-values";
import { panelReadParameterSchemas } from "@ontomato/contracts/panel-projection";
import { principalDirectoryResponseSchema } from "@ontomato/contracts/principal-directory";
import {
  platformScheduleFormRequestSchema, platformTaskListSchema, platformTaskRunPageSchema, platformTaskRunSchema,
  platformTaskSchema, platformTriggerTargetsSchema,
  type PlatformTask,
} from "@ontomato/contracts/platform-schedules";
import {
  createTriggerReadPresenter, findTriggerMember, presentTriggerForm, triggerMemberIds, triggerMemberSearchLimit,
  TRIGGER_MEMBER_SEARCH_MAX,
} from "@ontomato/platform-schedules/panel-reads";
import { resolveLocale, tForLocale } from "../../i18n";
import type { AssistantCredentials } from "../../utils/assistant-credentials";
import { HttpError } from "../../utils/errors";
import type { JavaPanelReadResult, PreparedOwnerReadFacts } from "../product-panels/java-panel-reads";
import { formParams, type PanelReadSelection } from "../product-panels/panel-owner-reads";
import type { RegisteredDataReadRegistration } from "../product-panels/registered-data-read";
import { withReadDirective } from "../product-panels/read-directive";
import {
  describeTriggerTargets, presentTriggerApplications, readTriggerApplicationForm, triggerApplicationDirectorySchema,
} from "./applications";
import { SCHEDULE_LIST_REREAD_MS, SCHEDULE_RUN_REREAD_MS, triggerCatalogueParams } from "./panel-reads";

const decision = z.object({ allowed: z.boolean(), reason: z.string().nullish() });
const applicationAccess = z.object({ inspection: decision, caseSets: decision });
const runRecordFacts = z.union([
  z.object({ run: platformTaskRunSchema }),
  z.object({ task: platformTaskSchema, history: platformTaskRunPageSchema }),
]);
const storedForm = z.object({ task: platformTaskSchema, edit: decision });
const draftForm = platformTaskListSchema.pick({ timeZone: true });
const applicationFacts: PreparedOwnerReadFacts["facts"] = [
  { call: { type: APPLICATION, name: "scheduleTargets", parameters: {} } },
  { call: { type: TRIGGER, name: "applicationLabelAccess", parameters: {} },
    visibleKinds: [{ kind: "AGENT", verbs: ["USE"] }] },
];

function triggerFact(result: JavaPanelReadResult): unknown {
  if (result.status === "ready") return result.payload;
  if (result.status === "forbidden") throw new HttpError(403, result.error);
  if (result.status === "error") throw new HttpError(502, result.error, result.code ?? undefined);
  throw new HttpError(502, "Missing trigger owner facts", "PANEL_READ_OWNER_RESPONSE_INVALID");
}

function memberSearch(keyword: string | undefined, limit: number): PreparedOwnerReadFacts["facts"][number] {
  return { call: { type: USER, name: "principalDirectory", parameters: {
    kind: "member", limit, ...(keyword !== undefined && { keyword }),
  } } };
}

function memberChoices(result: JavaPanelReadResult) {
  return principalDirectoryResponseSchema.parse(triggerFact(result)).options;
}

function readApplicationFacts(directory: JavaPanelReadResult, result: JavaPanelReadResult) {
  const permissions = applicationAccess.parse(triggerFact(result));
  const range = result.status === "ready" ? result.visibility?.AGENT?.USE : undefined;
  if (!range) throw new HttpError(502, "Missing trigger application AGENT/USE facts", "PANEL_READ_OWNER_RESPONSE_INVALID");
  return {
    entries: triggerApplicationDirectorySchema.parse(triggerFact(directory)),
    access: { ...permissions, agentUse: range },
  };
}

function prepareTriggerForm(
  selection: PanelReadSelection, params: Record<string, unknown>, credentials: AssistantCredentials, locale: string,
): PreparedOwnerReadFacts {
  const draft = selection.method === "createForm";
  const changes = {
    ...formParams(params),
    ...(draft && {
      defaultAppId: panelReadParameterSchemas.keyword.optional().parse(params.defaultAppId),
      defaultAgentId: panelReadParameterSchemas.keyword.optional().parse(params.defaultAgentId),
    }),
  };
  return {
    facts: [
      { call: { type: TRIGGER, name: selection.method, parameters: draft ? {} : { primaryKey: selection.primaryKey! } } },
      { call: { type: TRIGGER, name: "targets", parameters: {} } },
      ...applicationFacts,
    ],
    async present(owner, [state, targets, directory, permissions]) {
      const payload = triggerFact(state);
      const current = draft ? undefined : storedForm.parse(payload);
      const timeZone = current ? current.task.timeZone : draftForm.parse(payload).timeZone;
      const context = { owner, credentials: { ...credentials, locale } };
      const { entries, access } = readApplicationFacts(directory, permissions);
      const options = platformTriggerTargetsSchema.parse(triggerFact(targets));
      const { applications } = await presentTriggerApplications(entries, context, access);
      return presentTriggerForm(current?.task, timeZone, changes, { ...options, applications }, (appId, input) => {
        if (input.taskId !== null && !current!.edit.allowed)
          throw new HttpError(403, current!.edit.reason!, "PERMISSION_DENIED");
        const app = entries.find(entry => entry.id === appId)!;
        return readTriggerApplicationForm(app, platformScheduleFormRequestSchema.parse(input), context, access);
      }, (key, values) => tForLocale(locale, key, values));
    },
  };
}

export function prepareRegisteredTriggerRead(
  selection: PanelReadSelection, params: Record<string, unknown>, credentials: AssistantCredentials,
): PreparedOwnerReadFacts | undefined {
  if (selection.typeId !== TRIGGER) return;
  const locale = resolveLocale(credentials.locale);
  const presenter = createTriggerReadPresenter(locale, (key, values) => tForLocale(locale, key, values));
  const read = (
    name: string, parameters: Record<string, RuntimeJsonValue>, present: (payload: unknown) => unknown,
  ): PreparedOwnerReadFacts => ({
    facts: [{ call: { type: TRIGGER, name, parameters } }],
    present: (_owner, [result]) => present(triggerFact(result)),
  });
  const rowRead = (method: "list" | "record"): PreparedOwnerReadFacts => ({
    facts: [
      { call: { type: TRIGGER, name: method, parameters: method === "record" ? { primaryKey: selection.primaryKey! } : {} } },
      ...applicationFacts,
    ],
    async present(owner, [result, directoryResult, accessResult]) {
      const context = { owner, credentials: { ...credentials, locale } };
      const rows = async (tasks: PlatformTask[]) => {
        if (!tasks.some(task => task.targetKind === "application")) return presenter.rows(tasks);
        const { entries, access } = readApplicationFacts(directoryResult, accessResult);
        const directory = await presentTriggerApplications(entries, context, access);
        return presenter.rows(await describeTriggerTargets(tasks, directory, context, access), directory);
      };
      const payload = triggerFact(result);
      if (method === "record") {
        const [record] = await rows([platformTaskSchema.parse(payload)]);
        return record.outputs?.isRunning === true ? withReadDirective(record, { rereadAfterMs: SCHEDULE_RUN_REREAD_MS }) : record;
      }
      const list = await presenter.list(platformTaskListSchema.parse(payload).tasks, triggerCatalogueParams(params), rows);
      return list.some(row => row.outputs?.isRunning === true)
        ? withReadDirective(list, { rereadAfterMs: SCHEDULE_LIST_REREAD_MS }) : list;
    },
  });
  switch (selection.method) {
    case "form":
    case "createForm": return prepareTriggerForm(selection, params, credentials, locale);
    case "list":
    case "catalogue": return rowRead("list");
    case "record": return rowRead("record");
    case "counts": return read("list", {}, payload =>
      presenter.counts(platformTaskListSchema.parse(payload).tasks, panelReadParameterSchemas.keyword.optional().parse(params.by)));
    case "status": return read("status", {}, payload => presenter.status(platformTaskListSchema.parse(payload)));
    case "runs":
    case "runRecords": {
      const cursor = panelReadParameterSchemas.cursor.optional().parse(params.cursor);
      return read("runs", { primaryKey: selection.primaryKey!, ...(cursor !== undefined && { cursor }) }, payload => {
        const page = platformTaskRunPageSchema.parse(payload);
        if (selection.method === "runs") return page;
        const records = presenter.runRecords(page);
        return records.rows.some(row => row.outputs?.isRunning === true)
          ? withReadDirective(records, { rereadAfterMs: SCHEDULE_RUN_REREAD_MS }) : records;
      });
    }
    case "run": return read("run", { primaryKey: selection.primaryKey!, runId: panelReadParameterSchemas.scheduledRunId.parse(params.runId) },
      payload => platformTaskRunSchema.parse(payload));
    case "runRecord": {
      const runId = panelReadParameterSchemas.scheduledRunId.optional().parse(params.runId);
      const id = selection.primaryKey!;
      return read("runRecord", { primaryKey: id, ...(runId !== undefined && { runId }) }, payload => {
        const facts = runRecordFacts.parse(payload);
        const record = "run" in facts ? presenter.runRecord(id, facts.run)
          : presenter.runRecord(id, facts.history.runs[0], facts.task);
        return record.outputs?.isRunning === true ? withReadDirective(record, { rereadAfterMs: SCHEDULE_RUN_REREAD_MS }) : record;
      });
    }
    case "memberOptions": {
      const keyword = panelReadParameterSchemas.keyword.optional().parse(params.keyword);
      const page = panelReadParameterSchemas.page.optional().parse(params.page);
      return {
        facts: [memberSearch(keyword, triggerMemberSearchLimit(page))],
        present: (_owner, [result]) => presenter.memberOptions(memberChoices(result), page),
      };
    }
    case "memberResolve": {
      const ids = triggerMemberIds(panelReadParameterSchemas.optionValues.parse(params.values));
      const unique = [...new Set(ids)];
      return {
        facts: unique.map(id => memberSearch(id, TRIGGER_MEMBER_SEARCH_MAX)),
        present(_owner, results) {
          const names = new Map<string, string>();
          unique.forEach((id, index) => {
            const member = findTriggerMember(id, memberChoices(results[index]));
            if (member) names.set(id, member.name);
          });
          return presenter.memberResolve(ids, names);
        },
      };
    }
  }
}

function prepareRegisteredTriggerEntry(context: Parameters<NonNullable<RegisteredDataReadRegistration["facts"]>>[0]) {
  return prepareRegisteredTriggerRead(context.selection, context.params, context.credentials);
}

export const triggerDataReadRegistrations: RegisteredDataReadRegistration[] = [
  ...([
    "form", "createForm", "list", "catalogue", "record", "counts", "status", "runs", "runRecords", "run", "runRecord",
    "memberOptions", "memberResolve",
  ] as const).map(method => ({
    typeId: TRIGGER, method,
    facts: prepareRegisteredTriggerEntry,
    ...(method === "record" && { messageOnlyCodes: ["TASK_NOT_FOUND"] }),
  })),
];
