import { createScheduledTaskServerOperations } from "@ontomato/platform-schedules/panel-server-operations";
import { tForLocale } from "../../i18n";

export const scheduledTaskServerOperations = createScheduledTaskServerOperations(tForLocale);
