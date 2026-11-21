/** The service's own client: every caller that reads or writes tasks uses it, so the contract is checked in one place. */
export { createSchedulesApi, scheduleFailure, ScheduleRequestError, type SchedulesApi } from "./api";
/** The page's host port: the request layer, the rail's applications and the way to a result. */
export type { PlatformSchedulesHost, PlatformSchedulesHostApp } from "./host";
