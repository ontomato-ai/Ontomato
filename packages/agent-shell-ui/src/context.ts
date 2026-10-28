import type { InjectionKey, Ref } from "vue";
import type { RuntimeArtifact } from "@ontomato/contracts/agent-runtime-artifacts";
import type { ArtifactRendererRegistration, OpenArtifact, ShellLabels } from "./types";

export interface ShellContext {
  labels: Ref<ShellLabels>;
  renderers: Ref<readonly ArtifactRendererRegistration[]>;
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
