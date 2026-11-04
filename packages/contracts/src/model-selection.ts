import type { ModelOption } from "./model-settings";

/*
 * The rule of choosing an agent's model (the stored `modelSelectionSchema` in model-settings.ts), shared by the pages
 * that offer the choice (the Agent Platform and the Ontology Service); each renders it with its own controls and
 * language. Null is the host-named choice (follow the domain default, or no default). A stored ID that is no longer
 * configured stays selected as it is and is reported, never replaced by the null choice: the reference fails
 * explicitly until someone chooses again.
 */

/** Options use the full provider/model-id reference; display names may repeat. */
export type ModelChoice = Pick<ModelOption, "ref" | "name" | "type">;

/** Texts of the options, supplied by the host in its own language. */
export interface ModelSelectionLabels {
  /** The null choice: follow the domain default, or no default when the selection is the default itself. */
  nullChoice: string;
  /** Option text of a selected ID that is no longer configured. */
  unavailable: (id: string) => string;
}

export interface ModelSelectionOption {
  value: string;
  label: string;
  disabled: boolean;
}

/** What a host's select shows for one stored selection. */
export interface ModelSelectionView {
  /** The select's value; the null choice is "", which no model ID can be. */
  value: string;
  options: ModelSelectionOption[];
  /** The selected ID when it is no longer configured; the host reports it under the select. */
  missingId: string | null;
  /** Nothing can be chosen while the models are not known (and nothing is reported missing). */
  disabled: boolean;
}

const NULL_CHOICE = "";

/** A model's name for people: the display name, followed by the ID when they differ. */
export function modelLabel(model: ModelChoice): string {
  return model.name === model.ref ? model.ref : `${model.name} (${model.ref})`;
}

/** The options and state of a selection; `models` is null while the domain's models are not known. */
export function modelSelectionView(
  modelId: string | null,
  models: readonly ModelChoice[] | null,
  labels: ModelSelectionLabels
): ModelSelectionView {
  const choices = models === null ? null : models.filter(model => model.type === "chat");
  const missingId =
    modelId !== null && choices !== null && !choices.some((model) => model.ref === modelId) ? modelId : null;
  return {
    value: modelId ?? NULL_CHOICE,
    options: [
      { value: NULL_CHOICE, label: labels.nullChoice, disabled: false },
      ...(choices ?? []).map((model) => ({ value: model.ref, label: modelLabel(model), disabled: false })),
      ...(missingId === null ? [] : [{ value: missingId, label: labels.unavailable(missingId), disabled: true }]),
    ],
    missingId,
    disabled: models === null,
  };
}

/** The stored selection for a value the select emitted: the null choice is null, anything else a model ID. */
export function selectedModelId(value: string): string | null {
  return value === NULL_CHOICE ? null : value;
}
