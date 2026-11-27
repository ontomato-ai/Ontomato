import { z } from "zod";
import { applicationCatalogSchema } from "@ontomato/contracts/platform-identity";
import { localizedApplicationText } from "@ontomato/contracts/application-metadata";
import type { PlatformScheduleFormRequest, PlatformTask } from "@ontomato/contracts/platform-schedules";
import type { ScheduledApplicationsStatus } from "@ontomato/platform-schedules/panel-reads";
import { config } from "../../config/application";
import { resolveLocale } from "../../i18n";
import { backendGet, buildBackendHeaders } from "../../utils/backend-client";
import { HttpError } from "../../utils/errors";
import { assistantScheduleApplication } from "../assistant/scheduling";
import { operationsScheduleApplication } from "../ops-diagnosis/scheduling";
import type { ScheduleApplication, ScheduleContext, ScheduleTargetLabelAccess } from "./application";

// The workbench installs the scheduling declarations owned by its applications.
const declarations: readonly ScheduleApplication[] = [assistantScheduleApplication, operationsScheduleApplication];
const applications = new Map(declarations.map((application) => [application.id, application]));
if (applications.size !== declarations.length) throw new Error("Duplicate scheduled application ID");
export function scheduleApplication(id: string): ScheduleApplication {
  const application = applications.get(id);
  if (!application) throw new HttpError(404, "Scheduled application not found", "APPLICATION_NOT_FOUND");
  return application;
}

export const triggerApplicationDirectorySchema = z.array(applicationCatalogSchema.element.extend({ entryAvailable: z.boolean() }));
const directoryResponse = z.object({
  success: z.literal(true),
  data: triggerApplicationDirectorySchema,
});

export function readTriggerApplicationForm(
  app: z.infer<typeof triggerApplicationDirectorySchema.element>, input: PlatformScheduleFormRequest,
  context: ScheduleContext, access: ScheduleTargetLabelAccess,
) {
  const provider = scheduleApplication(app.id);
  // The Java agent adapter only adds the execution quota and delegates its form here.
  if (app.scheduleAdapter !== `workbench:${provider.id}` &&
      !(provider === assistantScheduleApplication && app.scheduleAdapter === `java:${provider.id}`)) {
    throw new HttpError(502, "The scheduled application's form owner is unavailable in this batch", "DEPENDENCY_UNAVAILABLE");
  }
  return provider.form(input, context, access);
}

async function applicationRefusal(application: ScheduleApplication, context: ScheduleContext): Promise<string | null> {
  try {
    await application.authorize(context);
    return null;
  } catch (error) {
    if (error instanceof HttpError && error.status === 403) return error.message;
    throw error;
  }
}

/** The application catalog owns entry admission; each provider owns target admission and description. */
export async function readTriggerApplications(context: ScheduleContext, signal?: AbortSignal): Promise<ScheduledApplicationsStatus> {
  const { token, locale, apiKey, headers } = context.credentials;
  const response = await backendGet("trigger-application-directory",
    `${config.dataQuery.baseUrl.replace(/\/$/, "")}/platform/applications?purpose=schedules`, {
      headers: buildBackendHeaders(token, undefined, locale, apiKey, headers), signal,
    });
  const { data } = directoryResponse.parse(JSON.parse(response.text));
  return presentTriggerApplications(data, context);
}

export async function presentTriggerApplications(
  data: z.infer<typeof triggerApplicationDirectorySchema>, context: ScheduleContext, access?: ScheduleTargetLabelAccess,
): Promise<ScheduledApplicationsStatus> {
  const { locale } = context.credentials;
  const missingIds: string[] = [];
  const providers = data.flatMap(entry => {
    const provider = applications.get(entry.id);
    if (provider) return [{ entry, provider }];
    missingIds.push(entry.id);
    return [];
  });
  const named = await Promise.all(providers.map(async ({ entry, provider }) => {
    const unavailableReason = entry.entryAvailable
      ? access
        ? provider === operationsScheduleApplication && !access.inspection.allowed && !access.caseSets.allowed
          ? access.caseSets.reason! : null
        : await applicationRefusal(provider, context)
      : locale?.startsWith("zh") ? "没有应用入口权限" : "Application entry permission is required";
    return {
      id: entry.id,
      name: localizedApplicationText(entry.names, resolveLocale(locale)) ?? entry.id,
      ...(entry.icon ? { icon: entry.icon } : {}),
      description: provider.description(locale),
      available: unavailableReason === null,
      unavailableReason,
      taskCount: 0,
    };
  }));
  return { applications: named, missingIds };
}

export async function describeTriggerTargets(
  tasks: readonly PlatformTask[], directory: ScheduledApplicationsStatus, context: ScheduleContext, access?: ScheduleTargetLabelAccess,
): Promise<PlatformTask[]> {
  const groups = new Map<string, { task: Extract<PlatformTask, { targetKind: "application" }>; index: number }[]>();
  const resolved = [...tasks];
  for (const [index, task] of tasks.entries()) {
    if (task.targetKind !== "application") continue;
    const group = groups.get(task.appId) ?? [];
    group.push({ task, index });
    groups.set(task.appId, group);
  }
  await Promise.all(directory.applications.map(async app => {
    const group = groups.get(app.id);
    if (!group) return;
    const descriptions = app.available
      ? await scheduleApplication(app.id).describeTargets(group.map(({ task }) => task.content), context, access)
      : undefined;
    for (const [i, { task, index }] of group.entries()) {
      const display = descriptions?.[i];
      resolved[index] = { ...task, targetName: display?.name ?? app.name, summary: display?.summary ?? [] };
    }
  }));
  return resolved;
}
