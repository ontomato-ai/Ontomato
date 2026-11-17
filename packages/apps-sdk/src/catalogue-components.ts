import type { Component } from "vue";
import { components } from "./catalogue";
import type { ComponentMetadata } from "./components";
import { EChart } from "@ontomato/foundation-ui/chart";
import { FormFields } from "@ontomato/foundation-ui/form";
import { CodeEditor } from "@ontomato/foundation-ui/code";
import { MarkdownView } from "@ontomato/foundation-ui/markdown";
import { HtmlPreview, TablePreview } from "@ontomato/foundation-ui/preview";
import ProductAsset from "./ProductAsset.vue";
import MetricViewData from "@ontomato/ontology-manager/app-components/MetricViewData.vue";
import {
  AgentAvatar,
  AgentChatPanel,
  AgentPicker,
  AgentShell,
  DatasetSelectionButton,
  PageComposer,
  ShellColumn,
  ShellComposer,
  ShellDockRoom,
  ShellNavBody,
  ToolStep,
} from "@ontomato/agent-shell-ui";

/*
 * The components of this SDK version, resolved by the `componentId` a projection record names: the metadata beside each
 * export is what a projection's ports come from, and this map is what draws it. Both are this version's, bundled with
 * it — a record that names a component this version does not have fails visibly instead of drawing something else.
 */

const EXPORTS: Record<string, Component> = {
  MetricViewData,
  ProductAsset,
  EChart,
  FormFields,
  CodeEditor,
  MarkdownView,
  TablePreview,
  HtmlPreview,
  AgentChatPanel,
  AgentShell,
  ShellColumn,
  ShellNavBody,
  ShellDockRoom,
  AgentPicker,
  AgentAvatar,
  DatasetSelectionButton,
  ToolStep,
  ShellComposer,
  PageComposer,
};

/** Each declared component's metadata, by the ID a projection record names. */
const META = new Map(components.map((component) => [component.componentId, component]));

/**
 * Registers one more component of this version: its metadata and the export that draws it. The version's own modules
 * call this when they bring a component with them, so the catalogue a projection resolves against is what this version
 * actually has — never a list kept somewhere else.
 */
export function registerComponent(componentId: string, component: Component): void {
  if (!META.has(componentId)) throw new Error(`The catalogue declares no component '${componentId}'`);
  if (EXPORTS[componentId]) throw new Error(`Component '${componentId}' is already registered`);
  EXPORTS[componentId] = component;
}

/** The catalogue entry of one component of this version. */
export function componentMeta(componentId: string): ComponentMetadata {
  const found = META.get(componentId);
  if (!found) throw new Error(`This SDK version has no component '${componentId}'; its catalogue declares ${[...META.keys()].join(", ")}`);
  return found;
}

/** The component a projection record draws. */
export function componentFor(componentId: string): Component {
  componentMeta(componentId);
  const component = EXPORTS[componentId];
  if (!component) throw new Error(`The catalogue describes '${componentId}' but this version exports no such component`);
  return component;
}

/** The components this version draws projections with, by ID. */
export function catalogueComponents(): readonly string[] {
  return [...META.keys()];
}
