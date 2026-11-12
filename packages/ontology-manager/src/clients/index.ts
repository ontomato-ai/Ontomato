/*
 * The data clients apps reach through the SDK, with the request layer they run on. Only leaves: this entry must not
 * pull in the Manager's routes, pages or modeling canvas.
 */
export {
  createManagerRequest,
  type ManagerAuthFailureStatus,
  type ManagerCredential,
  type ManagerRequest,
  type ManagerRequestContext,
} from "../api";
export { createActionsClient, type ActionExecution, type ActionsClient } from "./actions";
export { createMetricViewsClient, metricViewsKey, type MetricViewRead, type MetricViewsClient } from "./metric-views";
export { createProductsClient } from "./products";
