// The platform primitives: the shell's context, the data clients and the component that binds a MetricView.
import "../styles.css";

export { createAppContext, type AppContext } from "../context";
export { default as MetricViewData } from "@ontomato/ontology-manager/app-components/MetricViewData.vue";
export type { ActionExecution, ActionsClient, MetricViewRead, MetricViewsClient } from "@ontomato/ontology-manager/clients";
export type { AppHostTheme, AppHostUser, AppPageContext, AppPageSelection } from "@ontomato/contracts/app-host";
