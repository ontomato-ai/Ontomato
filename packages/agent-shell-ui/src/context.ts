import type { InjectionKey, Ref, Slot } from "vue";
import type { RuntimeArtifact } from "@ontomato/contracts/agent-runtime-artifacts";
import type { ChartTheme } from "./chart-theme";
import type {
  ArtifactRendererOverride,
  OpenArtifact,
  ShellLabels,
  ToolRendererOverride,
} from "./types";

export interface ShellContext {
  labels: Ref<ShellLabels>;
  artifactRenderers: Ref<readonly ArtifactRendererOverride[]>;
  toolRenderers: Ref<readonly ToolRendererOverride[]>;
  chartTheme: Ref<ChartTheme>;
  /** Host slots for business actions: `artifact-actions` ({artifact}) and `message-actions`. */
  slots: { artifactActions?: Slot; messageActions?: Slot };
  resolveArtifact(runId: string, path: string): Promise<RuntimeArtifact | null>;
  /** Changes whenever a run registers new artifacts, so unresolved references retry. */
  artifactRevision: Ref<number>;
  readArtifact(artifact: RuntimeArtifact): Promise<Blob>;
  openArtifact(open: OpenArtifact): void;
  openArtifactKey: Ref<string | null>;
}

/** The message whose Markdown is rendering; artifact references resolve within its run. */
export interface MessageContext {
  runId: string;
}

export const shellContextKey: InjectionKey<ShellContext> = Symbol("agent-shell");
export const messageContextKey: InjectionKey<Ref<MessageContext>> = Symbol("agent-shell-message");
