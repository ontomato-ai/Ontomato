export { default as PlatformSchedulesPage } from "./pages/PlatformSchedulesPage.vue";
/** The service's own client: every caller that reads or writes tasks uses it, so the contract is checked in one place. */
export { createSchedulesApi, scheduleFailure, ScheduleRequestError, type SchedulesApi } from "./api";
/** One application's form while a task is written: the answer replaces the form and the draft whole. */
export { useApplicationForm, type ApplicationForm } from "./form-session";
/** The page's host port: the request layer, the rail's applications and the way to a result. */
export type { PlatformSchedulesHost, PlatformSchedulesHostApp } from "./host";
