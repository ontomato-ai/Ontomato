/**
 * Platform ontology schema seam for the composite query service.
 *
 * Once M1-A lands the shared declarations in `@ontomato/contracts/platform-object-types`
 * (`feature/m3-a-contracts`), this module re-exports them directly so the four-layer types
 * and 27 relation kinds have a single owner in contracts.
 */
import {
  AGENT_DEFINITION,
  ATTRIBUTE,
  OBJECT_TYPE,
  RELATIONSHIP,
  SKILL,
  USER,
} from "@ontomato/contracts/platform-object-types";

export type PlatformOntologyLayer = "fact" | "capability" | "governance" | "product";

export const PLATFORM_ONTOLOGY_LAYERS: readonly PlatformOntologyLayer[] = [
  "fact",
  "capability",
  "governance",
  "product",
];

export const METRIC_VIEW = "platform:MetricView";
export const FUNCTION = "platform:Function";
export const ACTION = "platform:Action";
export const WORKFLOW = "platform:Workflow";
export const TRIGGER = "platform:Trigger";
export const BUSINESS_KNOWLEDGE = "platform:BusinessKnowledge";
export const DEFINITION = "platform:Definition";
export const ROLE = "platform:Role";
export const SDK_COMPONENT = "platform:SDKComponent";
export const PRODUCT_PROJECTION = "platform:ProductProjection";
export const PRODUCT_PANEL = "platform:ProductPanel";
export const APPLICATION = "platform:Application";

export { AGENT_DEFINITION, ATTRIBUTE, OBJECT_TYPE, RELATIONSHIP, SKILL, USER };

export interface PlatformOntologyTypeSpec {
  readonly id: string;
  readonly layer: PlatformOntologyLayer;
  readonly labelKey: string;
}

export interface PlatformOntologyRelationKindSpec {
  readonly id: string;
  readonly from: string;
  /** Single target type ID or multiple target type IDs (for polymorphic bindings). */
  readonly to: string | readonly string[];
  readonly labelKey: string;
  readonly derived: boolean;
  readonly owner: string;
}

export const PLATFORM_ONTOLOGY_TYPES: readonly PlatformOntologyTypeSpec[] = [
  { id: OBJECT_TYPE, layer: "fact", labelKey: "platformOntology.type.objectType" },
  { id: ATTRIBUTE, layer: "fact", labelKey: "platformOntology.type.attribute" },
  { id: RELATIONSHIP, layer: "fact", labelKey: "platformOntology.type.relationship" },

  { id: METRIC_VIEW, layer: "capability", labelKey: "platformOntology.type.metricView" },
  { id: FUNCTION, layer: "capability", labelKey: "platformOntology.type.function" },
  { id: ACTION, layer: "capability", labelKey: "platformOntology.type.action" },
  { id: WORKFLOW, layer: "capability", labelKey: "platformOntology.type.workflow" },
  { id: TRIGGER, layer: "capability", labelKey: "platformOntology.type.trigger" },
  { id: SKILL, layer: "capability", labelKey: "platformOntology.type.skill" },
  { id: BUSINESS_KNOWLEDGE, layer: "capability", labelKey: "platformOntology.type.businessKnowledge" },
  { id: DEFINITION, layer: "capability", labelKey: "platformOntology.type.definition" },

  { id: USER, layer: "governance", labelKey: "platformOntology.type.user" },
  { id: ROLE, layer: "governance", labelKey: "platformOntology.type.role" },

  { id: SDK_COMPONENT, layer: "product", labelKey: "platformOntology.type.sdkComponent" },
  { id: PRODUCT_PROJECTION, layer: "product", labelKey: "platformOntology.type.productProjection" },
  { id: PRODUCT_PANEL, layer: "product", labelKey: "platformOntology.type.productPanel" },
  { id: APPLICATION, layer: "product", labelKey: "platformOntology.type.application" },
  { id: AGENT_DEFINITION, layer: "product", labelKey: "platformOntology.type.agentDefinition" },
];

export const PLATFORM_ONTOLOGY_TYPE_MAP: ReadonlyMap<string, PlatformOntologyTypeSpec> = new Map(
  PLATFORM_ONTOLOGY_TYPES.map((spec) => [spec.id, spec]),
);

const BINDING_TARGETS: readonly string[] = [
  OBJECT_TYPE,
  METRIC_VIEW,
  ACTION,
  DEFINITION,
  ATTRIBUTE,
  RELATIONSHIP,
  FUNCTION,
  WORKFLOW,
  TRIGGER,
  SKILL,
  BUSINESS_KNOWLEDGE,
  USER,
  ROLE,
  AGENT_DEFINITION,
];

export const PLATFORM_ONTOLOGY_RELATION_KINDS: readonly PlatformOntologyRelationKindSpec[] = [
  { id: "object-type.has-attribute", from: OBJECT_TYPE, to: ATTRIBUTE, labelKey: "platformOntology.relation.hasAttribute", derived: false, owner: "java-ontology" },
  { id: "relationship.from-object-type", from: RELATIONSHIP, to: OBJECT_TYPE, labelKey: "platformOntology.relation.fromObjectType", derived: false, owner: "java-ontology" },
  { id: "relationship.to-object-type", from: RELATIONSHIP, to: OBJECT_TYPE, labelKey: "platformOntology.relation.toObjectType", derived: false, owner: "java-ontology" },
  { id: "metric-view.uses-function", from: METRIC_VIEW, to: FUNCTION, labelKey: "platformOntology.relation.usesFunction", derived: false, owner: "java-metric" },
  { id: "action.uses-function", from: ACTION, to: FUNCTION, labelKey: "platformOntology.relation.usesFunction", derived: false, owner: "java-action" },
  { id: "function.reads-object-type", from: FUNCTION, to: OBJECT_TYPE, labelKey: "platformOntology.relation.readsObjectType", derived: false, owner: "java-function" },
  { id: "action.targets-object-type", from: ACTION, to: OBJECT_TYPE, labelKey: "platformOntology.relation.targetsObjectType", derived: false, owner: "java-action" },
  { id: "definition.based-on-object-type", from: DEFINITION, to: OBJECT_TYPE, labelKey: "platformOntology.relation.basedOnObjectType", derived: false, owner: "node-business-definitions" },
  { id: "workflow.step-references-action", from: WORKFLOW, to: ACTION, labelKey: "platformOntology.relation.stepReferencesAction", derived: false, owner: "java-workflow" },
  { id: "trigger.targets-workflow", from: TRIGGER, to: WORKFLOW, labelKey: "platformOntology.relation.targetsWorkflow", derived: false, owner: "java-trigger" },
  { id: "trigger.targets-action", from: TRIGGER, to: ACTION, labelKey: "platformOntology.relation.targetsAction", derived: false, owner: "java-trigger" },
  { id: "user.holds-role", from: USER, to: ROLE, labelKey: "platformOntology.relation.holdsRole", derived: false, owner: "java-identity" },
  { id: "role.can-execute-action", from: ROLE, to: ACTION, labelKey: "platformOntology.relation.canExecuteAction", derived: false, owner: "java-grants" },
  { id: "role.can-author-workflow", from: ROLE, to: WORKFLOW, labelKey: "platformOntology.relation.canAuthorWorkflow", derived: true, owner: "java-platform-access" },
  { id: "role.owns-workflow-step", from: ROLE, to: WORKFLOW, labelKey: "platformOntology.relation.ownsWorkflowStep", derived: true, owner: "java-workflow" },
  { id: "user.created-action", from: USER, to: ACTION, labelKey: "platformOntology.relation.created", derived: false, owner: "java-action" },
  { id: "user.created-workflow", from: USER, to: WORKFLOW, labelKey: "platformOntology.relation.created", derived: false, owner: "java-workflow" },
  { id: "user.created-metric-view", from: USER, to: METRIC_VIEW, labelKey: "platformOntology.relation.created", derived: false, owner: "java-metric" },
  { id: "user.published-action", from: USER, to: ACTION, labelKey: "platformOntology.relation.published", derived: false, owner: "java-action" },
  { id: "user.published-workflow", from: USER, to: WORKFLOW, labelKey: "platformOntology.relation.published", derived: false, owner: "java-workflow" },
  { id: "user.published-metric-view", from: USER, to: METRIC_VIEW, labelKey: "platformOntology.relation.published", derived: false, owner: "java-metric" },
  { id: "projection.uses-component", from: PRODUCT_PROJECTION, to: SDK_COMPONENT, labelKey: "platformOntology.relation.usesComponent", derived: false, owner: "node-product-panels" },
  { id: "projection.binds-target", from: PRODUCT_PROJECTION, to: BINDING_TARGETS, labelKey: "platformOntology.relation.bindsTarget", derived: false, owner: "node-product-panels" },
  { id: "panel.contains-projection", from: PRODUCT_PANEL, to: PRODUCT_PROJECTION, labelKey: "platformOntology.relation.containsProjection", derived: false, owner: "node-product-panels" },
  { id: "application.uses-panel", from: APPLICATION, to: PRODUCT_PANEL, labelKey: "platformOntology.relation.usesPanel", derived: false, owner: "java-application-catalog" },
  { id: "agent.uses-skill", from: AGENT_DEFINITION, to: SKILL, labelKey: "platformOntology.relation.usesSkill", derived: false, owner: "node-assistant" },
  { id: "agent.executes-as-user", from: AGENT_DEFINITION, to: USER, labelKey: "platformOntology.relation.executesAsUser", derived: false, owner: "node-assistant" },
];

export function relationTargets(spec: PlatformOntologyRelationKindSpec): readonly string[] {
  return typeof spec.to === "string" ? [spec.to] : spec.to;
}
