import type {
  RuntimeBusinessCallback,
  RuntimeBusinessCallbacks,
} from "@ontomato/contracts/agent-runtime-business-callbacks";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { environment } from "../../config/environment";
import { getQueryTimeoutMs } from "../../config/query-settings";
import { callbackCredential } from "../agent-runtime/callback-credential";
import type { AssistantOwner } from "./store";

function sealedCallback(
  basePath: string,
  pathPrefix: string,
  runId: string,
  expiresAt: number,
  initiatorCredentials: AssistantCredentials,
): RuntimeBusinessCallback {
  const root = environment.agentRuntime().callbackUrl.replace(/\/$/, "");
  const baseUrl = root + basePath;
  return {
    owner: "workbench", baseUrl, pathPrefix: new URL(baseUrl).pathname,
    credentialHeader: "X-Ontomato-Callback-Credential",
    credential: callbackCredential({
      pathPrefix,
      runId,
      expiresAt,
      token: initiatorCredentials.token ?? "",
      apiKey: initiatorCredentials.apiKey ?? "",
    }).value,
  };
}

/**
 * Declares run-scoped business callbacks outside the sandbox instead of injecting
 * URLs or user credentials into the persistent runtime environment.
 */
export function executionBusinessCallbacks(
  _owner: AssistantOwner,
  initiatorCredentials: AssistantCredentials,
  runId: string,
  options: { scope?: "full" | "app-builder" | "authoring-only"; expiresAt?: number; pageControl?: boolean } = {},
): RuntimeBusinessCallbacks {
  const scope = options.scope ?? "full";
  const expiresAt = options.expiresAt ?? Date.now() + getQueryTimeoutMs();
  const base = `/api/assistant/executions/${runId}`;
  const authoring = sealedCallback(`${base}/authoring`, `${base}/authoring/`, runId, expiresAt, initiatorCredentials);
  if (scope === "authoring-only") return { authoring };
  const workbench = sealedCallback(`${base}/workbench`, `${base}/workbench/`, runId, expiresAt, initiatorCredentials);
  const ontology = sealedCallback(`${base}/ontology`, `${base}/ontology/`, runId, expiresAt, initiatorCredentials);
  const panelCallbacks = scope === "full" || options.pageControl ? {
    panelOperations: sealedCallback(`${base}/panels`, `${base}/panels/`, runId, expiresAt, initiatorCredentials),
  } : {};
  if (scope === "app-builder") return { workbench, ontology, authoring, ...panelCallbacks };
  return {
    workbench,
    ontology,
    ...panelCallbacks,
    authoring,
    retrieval: sealedCallback(`${base}/retrieval`, `${base}/retrieval`, runId, expiresAt, initiatorCredentials),
  };
}

/** Declares the session governance-window callback bound to the run's lifetime. */
export function governanceBusinessCallback(
  sessionId: string,
  runId: string,
  expiresAt: number,
  initiatorCredentials: AssistantCredentials,
): RuntimeBusinessCallback {
  const callbackPath = `/api/assistant/sessions/${sessionId}/governance-window`;
  return sealedCallback(callbackPath, callbackPath, runId, expiresAt, initiatorCredentials);
}

/** Declares the pinned product-profile tool callback under the tools prefix. */
export function productBusinessCallback(
  profileId: string,
  releaseId: string,
  runId: string,
  expiresAt: number,
  initiatorCredentials: AssistantCredentials,
): RuntimeBusinessCallback {
  const basePath = `/api/product-assets/${encodeURIComponent(profileId)}/releases/${encodeURIComponent(releaseId)}/tools`;
  return sealedCallback(basePath, `${basePath}/`, runId, expiresAt, initiatorCredentials);
}
