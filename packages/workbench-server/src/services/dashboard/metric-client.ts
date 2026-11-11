import { z } from "zod";
import {
  dashboardMetricDescriptionSchema, dashboardMetricOutputSchema,
  dashboardParameterFormSchema, dashboardParameterResultSchema,
  type DashboardMetricReference,
} from "@ontomato/contracts/dashboard";
import { runtimeJsonObjectSchema } from "@ontomato/contracts/agent-runtime-values";
import { config } from "../../config/application";
import { environment } from "../../config/environment";
import { backendPost, buildBackendHeaders, BackendResponseError, AuthFailedError } from "../../utils/backend-client";
import { HttpError } from "../../utils/errors";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";

const settledSchema = z.object({
  metricId: z.string(), parameters: runtimeJsonObjectSchema,
  status: z.string(), revision: z.string(), name: z.string(),
});
const errorSchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

/** Dashboard calls carry the original user and domain; Java owns all metric rules. */
export class DashboardMetricClient {
  constructor(readonly domainId: string, readonly credentials: AssistantCredentials) {}

  private async post<T>(path: string, body: unknown, schema: z.ZodType<T>, adoption = false): Promise<T> {
    try {
      const response = await backendPost(path, config.dataQuery.baseUrl.replace(/\/$/, "") + path, body, {
        headers: {
          ...buildBackendHeaders(this.credentials.token, undefined, this.credentials.locale, this.credentials.apiKey),
          "X-Domain-Id": this.domainId,
          ...(adoption ? { "X-Ontomato-Query-Service-Token": environment.agentRuntime().queryServiceToken } : {}),
        },
        retries: 1, errorDetailLimit: 16000,
      });
      return schema.parse(JSON.parse(response.text));
    } catch (error) {
      if (error instanceof AuthFailedError)
        throw new HttpError(error.status!, error.message, error.status === 401 ? "UNAUTHORIZED" : "FORBIDDEN");
      if (error instanceof BackendResponseError) {
        const parsed = errorSchema.parse(JSON.parse(error.detail));
        const code = error.status === 409 ? "METRIC_SPEC_CHANGED"
          : error.status === 404 ? "METRIC_UNAVAILABLE"
          : error.status === 400 ? "METRIC_PARAMETERS_INVALID" : parsed.error.code;
        throw new HttpError(error.status, parsed.error.message, code);
      }
      if (error instanceof z.ZodError || error instanceof SyntaxError)
        throw new HttpError(502, "Invalid response from the metric service", "INVALID_METRIC_RESPONSE");
      throw error;
    }
  }

  settle(input: { question: string; recipe: unknown; calculation?: string; outputShape: unknown }) {
    return this.post("/ontology/ai/metrics/settle-from-dataset", input, settledSchema, true);
  }
  describe(id: string) {
    return this.post("/ontology/query/metrics/describe", { id }, dashboardMetricDescriptionSchema);
  }
  execute(query: DashboardMetricReference, revision: string) {
    return this.post("/ontology/query/metrics/execute", {
      id: query.metricId, revision, parameters: query.parameters,
    }, dashboardMetricOutputSchema);
  }
  form(query: DashboardMetricReference) {
    return this.post("/ontology/query/metrics/parameter-form", {
      id: query.metricId, parameters: query.parameters,
    }, dashboardParameterFormSchema);
  }
  parameters(query: DashboardMetricReference, revision: string, values: Record<string, string>) {
    return this.post("/ontology/query/metrics/parse-parameters", {
      id: query.metricId, revision, parameters: query.parameters, values,
    }, dashboardParameterResultSchema);
  }
}
