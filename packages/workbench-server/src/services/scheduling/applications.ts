import type { PlatformScheduleApplication } from "@ontomato/contracts/platform-schedules";
import { assistantScheduleApplication } from "../assistant/scheduling";
import { operationsScheduleApplication } from "../ops-diagnosis/scheduling";
import { HttpError } from "../../utils/errors";
import type { ScheduleApplication, ScheduleContext } from "./application";

// The workbench installs the scheduling declarations owned by its applications.
const declarations: readonly ScheduleApplication[] = [assistantScheduleApplication, operationsScheduleApplication];
const applications = new Map(declarations.map((application) => [application.id, application]));
if (applications.size !== declarations.length) throw new Error("Duplicate scheduled application ID");
export function scheduleApplicationIds(): string[] { return [...applications.keys()]; }
export function scheduleApplication(id: string): ScheduleApplication {
  const application = applications.get(id);
  if (!application) throw new HttpError(404, "Scheduled application not found", "APPLICATION_NOT_FOUND");
  return application;
}
export async function describeScheduleApplication(id: string, context: ScheduleContext): Promise<PlatformScheduleApplication> {
  const application = scheduleApplication(id);
  let unavailableReason: string | null = null;
  try { await application.authorize(context); }
  catch (error) {
    if (!(error instanceof HttpError) || error.status !== 403) throw error;
    unavailableReason = error.message;
  }
  return { id, description: application.description(context.credentials.locale), available: unavailableReason === null, unavailableReason, taskCount: 0 };
}
