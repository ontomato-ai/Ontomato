import { apiGet, apiPost, nodeApiGet, nodeApiPost } from "../../utils/api";
import type { SystemModelConfig } from "@ontomato/contracts/system-model";
import type { ModelEntry, RoleModels } from "../system";
import { vectorRebuildStatusSchema } from "../system";

export const adminApi = {
  getBusinessConfig: () => apiGet("/businessConfig/getConfig"),
  getModelSettings: () => nodeApiGet("/model-settings"),
  saveModelSettings: (payload: { models: ModelEntry[]; agents: RoleModels }) =>
    nodeApiPost("/model-settings/save", payload),
  testModel: (model: ModelEntry, prompt: string) =>
    nodeApiPost("/model-settings/test", { model, prompt }),
  saveEmbeddingModel: (payload: unknown) => apiPost("/businessConfig/saveEmbeddingModel", payload),
  testEmbeddingModel: (payload: unknown) => apiPost("/businessConfig/testEmbeddingModel", payload),
  getVectorRebuildStatus: async () =>
    vectorRebuildStatusSchema.parse((await apiGet("/businessConfig/vectorRebuildStatus")).data),
  rebuildVectors: () => apiPost("/businessConfig/rebuildVectors"),
  pauseVectorRebuild: () => apiPost("/businessConfig/pauseVectorRebuild"),
  getSystemModelConfig: () => nodeApiGet("/system-model-config"),
  saveSystemModelConfig: (payload: Pick<SystemModelConfig, "queryTimeoutSeconds">) =>
    nodeApiPost("/system-model-config/save", payload),
  editClassDescription: (payload: unknown) => apiPost("/admin/editClassDesc", payload),
  editClassShowName: (payload: unknown) => apiPost("/admin/editClassShowName", payload),
  editClassAttributeDescription: (payload: unknown) => apiPost("/admin/editClassAttrDesc", payload),
  editClassAttributeShowName: (payload: unknown) =>
    apiPost("/admin/editClassAttrShowName", payload),
  editClassAttributeShouldReturn: (payload: unknown) =>
    apiPost("/admin/editClassAttrShouldReturn", payload),
  addClass: (payload: unknown) => apiPost("/admin/addClass", payload),
  deleteClass: (className: string) => apiPost("/admin/delClass", { className }),
  addClassAttribute: (payload: unknown) => apiPost("/admin/addClassAttr", payload),
  editClassAttrPrimaryKey: (payload: unknown) => apiPost("/admin/editClassAttrPrimaryKey", payload),
  deleteClassAttribute: (payload: unknown) => apiPost("/admin/delClassAttr", payload),
  editClassInStarChart: (payload: unknown) => apiPost("/admin/editClassInStarChart", payload),
  addBucketIndicator: (payload: unknown) => apiPost("/admin/addBucketIndicator", payload),
  deleteBucketIndicator: (payload: unknown) => apiPost("/admin/delBucketIndicator", payload),
  addRelationship: (payload: unknown) => apiPost("/admin/addRelationship", payload),
  deleteRelationship: (relationName: string) => apiPost("/admin/delRelationship", { relationName }),
  editRelationshipDescription: (payload: unknown) =>
    apiPost("/admin/editRelationshipDesc", payload),
  editBucketIndicatorDescription: (payload: unknown) =>
    apiPost("/admin/editBucketIndicatorDesc", payload),
  editBucketIndicatorUnit: (payload: unknown) => apiPost("/admin/editBucketIndicatorUnit", payload),
};
