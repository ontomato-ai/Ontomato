import type { Component } from "vue";
import { components } from "./catalogue";
import type { ComponentMetadata } from "./components";
import ObjectList from "./base/ObjectList.vue";
import ObjectSummary from "./base/ObjectSummary.vue";
import ObjectForm from "./base/ObjectForm.vue";
import OperationButton from "./base/OperationButton.vue";

/*
 * The components of this SDK version, resolved by the `componentId` a projection record names: the metadata beside each
 * export is what a projection's ports come from, and this map is what draws it. Both are this version's, bundled with
 * it — a record that names a component this version does not have fails visibly instead of drawing something else.
 */

/*
 * What draws each component, and when it is fetched.
 *
 * The four a panel composes everywhere are bundled with the panel entry; every other one is a separate file the frame
 * fetches when a projection first names it. The reason is measured, not guessed: a panel that names only these four used
 * to take thirteen seconds to show, because the catalogue imported the conversation shell, the markdown renderer, the
 * code editor and the preview (with its diagram libraries) up front — about twelve megabytes for four components. A
 * projection then draws what it names; nothing fetches what no slot names.
 */
const BUNDLED: Record<string, Component> = { ObjectList, ObjectSummary, ObjectForm, OperationButton };

/** One fetch per component, shared by every projection of every panel that names it. */
const LAZY: Record<string, () => Promise<Component>> = {
  MetricViewData: () => import("@ontomato/ontology-manager/app-components/MetricViewData.vue"),
  ProductAsset: () => import("./ProductAsset.vue").then((module) => module.default),
  EChart: () => import("@ontomato/foundation-ui/chart").then((module) => module.EChart),
  FormFields: () => import("@ontomato/foundation-ui/form").then((module) => module.FormFields),
  CodeEditor: () => import("@ontomato/foundation-ui/code").then((module) => module.CodeEditor),
  MarkdownView: () => import("@ontomato/foundation-ui/markdown").then((module) => module.MarkdownView),
  TablePreview: () => import("@ontomato/foundation-ui/preview").then((module) => module.TablePreview),
  HtmlPreview: () => import("@ontomato/foundation-ui/preview").then((module) => module.HtmlPreview),
  AgentChatPanel: () => import("@ontomato/agent-shell-ui").then((module) => module.AgentChatPanel),
  AgentShell: () => import("@ontomato/agent-shell-ui").then((module) => module.AgentShell),
  ShellColumn: () => import("@ontomato/agent-shell-ui").then((module) => module.ShellColumn),
  ShellNavBody: () => import("@ontomato/agent-shell-ui").then((module) => module.ShellNavBody),
  ShellDockRoom: () => import("@ontomato/agent-shell-ui").then((module) => module.ShellDockRoom),
  AgentPicker: () => import("@ontomato/agent-shell-ui").then((module) => module.AgentPicker),
  AgentAvatar: () => import("@ontomato/agent-shell-ui").then((module) => module.AgentAvatar),
  DatasetSelectionButton: () => import("@ontomato/agent-shell-ui").then((module) => module.DatasetSelectionButton),
  ToolStep: () => import("@ontomato/agent-shell-ui").then((module) => module.ToolStep),
  ShellComposer: () => import("@ontomato/agent-shell-ui").then((module) => module.ShellComposer),
  PageComposer: () => import("@ontomato/agent-shell-ui").then((module) => module.PageComposer),
};

/** A component already fetched, by ID, so a second projection of the same one draws at once. */
const fetched = new Map<string, Component>();

/** Each declared component's metadata, by the ID a projection record names. */
const META = new Map(components.map((component) => [component.componentId, component]));

/**
 * Registers one more component of this version: its metadata and the export that draws it. The version's own modules
 * call this when they bring a component with them, so the catalogue a projection resolves against is what this version
 * actually has — never a list kept somewhere else.
 */
export function registerComponent(componentId: string, component: Component): void {
  if (!META.has(componentId)) throw new Error(`The catalogue declares no component '${componentId}'`);
  if (BUNDLED[componentId] || LAZY[componentId] || fetched.has(componentId))
    throw new Error(`Component '${componentId}' is already registered`);
  fetched.set(componentId, component);
}

/** The catalogue entry of one component of this version. */
export function componentMeta(componentId: string): ComponentMetadata {
  const found = META.get(componentId);
  if (!found) throw new Error(`This SDK version has no component '${componentId}'; its catalogue declares ${[...META.keys()].join(", ")}`);
  return found;
}

/**
 * The component a projection record draws, fetched if this frame has not drawn it yet. A component this version does not
 * export fails here, visibly, rather than drawing something else.
 */
export async function componentFor(componentId: string): Promise<Component> {
  componentMeta(componentId);
  const already = BUNDLED[componentId] ?? fetched.get(componentId);
  if (already) return already;
  const load = LAZY[componentId];
  if (!load) throw new Error(`The catalogue describes '${componentId}' but this version exports no such component`);
  const component = await load();
  fetched.set(componentId, component);
  return component;
}

/** The components this version draws projections with, by ID. */
export function catalogueComponents(): readonly string[] {
  return [...META.keys()];
}
