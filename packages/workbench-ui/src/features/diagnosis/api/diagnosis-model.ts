import { z } from "zod";
import { modelSelectionSchema, type ModelSelection } from "@ontomato/contracts/model-settings";
import { nodeApiGet, nodeApiPut } from "../../../utils/api";

const diagnosisModelSchema = z.object({ modelSelection: modelSelectionSchema }).strict();

/**
 * The model the operations agent runs on, and nothing else: it is the one setting of the built-in agent, saved as soon
 * as it is chosen. Read and written with the analysis-agent code, like the agent definitions.
 *
 * It lives with the application that shows it. The domain's model list (`loadModelOptions`) stays with the agent editor,
 * which is the other reader.
 */
export const diagnosisModelApi = {
  async get(): Promise<ModelSelection> {
    return diagnosisModelSchema.parse(await nodeApiGet("/assistant/diagnosis-model")).modelSelection;
  },
  async save(modelSelection: ModelSelection): Promise<ModelSelection> {
    return diagnosisModelSchema.parse(await nodeApiPut("/assistant/diagnosis-model", { modelSelection })).modelSelection;
  },
};
