export { default as OntologyManager } from "./OntologyManager.vue";
export { default as ObjectViewRuntime } from "./object-views/ObjectViewRuntime.vue";
export { default as OntomatoObjectView } from "./object-views/OntomatoObjectView.vue";
export type { ObjectViewEmbed, ObjectViewReference, ObjectViewActionEvent } from "@ontomato/contracts/object-views";
export { objectViewEmbedSchema } from "@ontomato/contracts/object-views";
export type { ManagerAuthFailureStatus, ManagerCredential, ManagerDataFallbacks } from "./api";
export type {
  ManagerHostContext,
  ManagerKnowledgeTagValues,
  ManagerPresentation,
  ManagerTheme,
} from "./context";
