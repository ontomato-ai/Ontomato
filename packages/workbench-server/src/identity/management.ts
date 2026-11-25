import type { Request, RequestHandler } from "express";
import type { WorkbenchManagementOperation } from "@ontomato/contracts/workbench-management";
import { sendError } from "../api/utils/http";
import { config } from "../config/application";
import { environment } from "../config/environment";
import { backendPost, buildBackendHeaders } from "../utils/backend-client";
import { HttpError } from "../utils/errors";
import { credentialsFromRequest, type AuthenticatedRequest } from "../utils/request-identity";
import type { AssistantCredentials } from "../utils/assistant-credentials";

const path = "/internal/workbench-management/require";

type Actor = { domainId?: string | null };
type Operation = Pick<WorkbenchManagementOperation, "id">;

export async function assertManagement(
  operation: Operation, actor: Actor, credentials: AssistantCredentials,
): Promise<void> {
  if (!actor.domainId) throw new HttpError(403, "A business domain is required", "DOMAIN_REQUIRED");
  const serviceToken = environment.agentRuntime().queryServiceToken;
  if (!serviceToken) throw new Error("Workbench service credential is not configured");
  try {
    const response = await backendPost(
      path, config.dataQuery.baseUrl + path, { operationId: operation.id, domainId: actor.domainId },
      {
        headers: buildBackendHeaders(credentials.token, undefined, credentials.locale,
          credentials.token ? undefined : credentials.apiKey, {
            ...credentials.headers,
            "X-Requested-With": "XMLHttpRequest",
            "X-Ontomato-Query-Service-Token": serviceToken,
          }),
      },
    );
    if (response.status !== 204) throw new Error("Unexpected management authorization response");
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) throw error;
    if (error instanceof HttpError && error.status === 403 && error.code !== "WORKBENCH_SERVICE_REQUIRED")
      throw new HttpError(403, error.message, "PERMISSION_DENIED");
    const unavailable = new HttpError(502, "Management authorization is unavailable", "DEPENDENCY_UNAVAILABLE");
    unavailable.cause = error;
    throw unavailable;
  }
}

export function requireManagement(
  operation: Operation | ((req: Request) => Operation), onError: typeof sendError = sendError,
): RequestHandler {
  return (req, res, next) => {
    const actor = req as AuthenticatedRequest;
    void Promise.resolve().then(() => assertManagement(
      typeof operation === "function" ? operation(req) : operation, actor, credentialsFromRequest(actor),
    ))
      .then(() => next(), error => onError(res, error));
  };
}
