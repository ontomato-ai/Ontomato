/*
 * Model selection rule shared by the hosts that let people choose an agent's model. A separate entry, so a host
 * importing it does not load the agent shell.
 */
export {
  modelLabel,
  modelSelectionView,
  selectedModelId,
  type ModelChoice,
  type ModelSelectionLabels,
  type ModelSelectionOption,
  type ModelSelectionView,
} from "./model-selection";
