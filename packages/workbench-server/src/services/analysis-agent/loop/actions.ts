import type { AgentTool, AgentToolResult } from "../../../core/agent-loop/types";
import { errorMessage, isRecord, postDataEngine, type DataEngineCaller } from "./data-engine";
import type { DeepAnalysisArtifactStore } from "../task/artifacts";
import { tApp } from "../../../i18n";

/** Shown as the service of an Action call in the trajectory; the Action name is the tool. */
const ACTION_SERVICE_NAME = "Action";

interface LoopActionDeps extends DataEngineCaller {
  selectedActionIds: readonly string[];
  signal: AbortSignal;
  trajectory: Pick<DeepAnalysisArtifactStore, "start" | "settle">;
}

interface LoopActionDefinition {
  id: string;
  name: string;
  description: string;
  parameters: Array<{ name: string; type?: string; description?: string }>;
}

const textResult = (text: string): AgentToolResult => ({ content: [{ type: "text", text }] });

/** An Action writes business data, so a failed execution is never retried. */
const callDataEngine = async (
  deps: LoopActionDeps,
  endpoint: string,
  body: Record<string, unknown> | URLSearchParams,
  signal: AbortSignal
): Promise<unknown> => (await postDataEngine(deps, endpoint, body, signal, 1)).data;

function toDefinition(action: unknown): LoopActionDefinition | null {
  if (!isRecord(action) || typeof action.id !== "string") return null;
  const fn = isRecord(action.function) ? action.function : {};
  const parameters = Array.isArray(fn.parameters) ? fn.parameters.filter(isRecord) : [];
  return {
    id: action.id,
    name: typeof action.name === "string" ? action.name : action.id,
    description: [action.description, fn.logic].filter((part) => typeof part === "string" && part.trim()).join("\n"),
    parameters: parameters.map((parameter) => ({
      name: String(parameter.name ?? ""),
      ...(typeof parameter.type === "string" ? { type: parameter.type } : {}),
      ...(typeof parameter.description === "string" ? { description: parameter.description } : {}),
    })),
  };
}

/**
 * Exposes the agent's selected, currently published Actions to a regular session. The prompt requires the agent to
 * list the Action and its parameter values and wait for the user's explicit confirmation in a later message before
 * calling the tool; the data engine executes it with the caller's own credentials and permissions.
 */
export async function assembleLoopActionCapability(deps: LoopActionDeps) {
  const none = { prompt: "", supervisorTools: [] as AgentTool[] };
  if (deps.selectedActionIds.length === 0) return none;

  let actions: LoopActionDefinition[];
  try {
    const published = await callDataEngine(deps, "/action/queryList", { status: "PUBLISHED" }, deps.signal);
    const selected = new Set(deps.selectedActionIds);
    actions = (Array.isArray(published) ? published : [])
      .map(toDefinition)
      .filter((action): action is LoopActionDefinition => !!action && selected.has(action.id));
  } catch (error) {
    if (deps.signal.aborted) throw error;
    const activityId = deps.trajectory.start("external_tool", { serviceName: ACTION_SERVICE_NAME });
    deps.trajectory.settle(activityId, "failed", {
      error: tApp("analysis.loop.actions.unavailable", { message: errorMessage(error) }),
    });
    return none;
  }
  if (actions.length === 0) return none;

  const byId = new Map(actions.map((action) => [action.id, action]));
  const executeAction: AgentTool = {
    name: "execute_action",
    description: tApp("analysis.loop.actions.tool"),
    parameters: {
      type: "object",
      properties: {
        action_id: { type: "string", enum: actions.map((action) => action.id) },
        parameters: { type: "object", description: tApp("analysis.loop.actions.parameters") },
      },
      required: ["action_id", "parameters"],
    },
    async execute(toolCallId, params, signal) {
      const action = typeof params.action_id === "string" ? byId.get(params.action_id) : undefined;
      const toolArguments = isRecord(params.parameters) ? params.parameters : {};
      const activityId = deps.trajectory.start("external_tool", {
        serviceName: ACTION_SERVICE_NAME,
        toolName: action?.name ?? String(params.action_id ?? ""),
        toolArguments,
        toolCallId,
      });
      if (!action) {
        const message = tApp("analysis.loop.actions.unknown", { actionId: String(params.action_id ?? "") });
        deps.trajectory.settle(activityId, "failed", { error: message });
        return textResult(message);
      }
      const requestSignal = signal || deps.signal;
      try {
        const form = new URLSearchParams({ id: action.id, param: JSON.stringify(toolArguments) });
        const result = await callDataEngine(deps, "/action/execute", form, requestSignal);
        deps.trajectory.settle(activityId, "completed");
        return textResult(JSON.stringify(result ?? null));
      } catch (error) {
        const message = errorMessage(error);
        deps.trajectory.settle(activityId, requestSignal.aborted ? "cancelled" : "failed", { error: message });
        if (requestSignal.aborted) throw error;
        return textResult(tApp("analysis.loop.actions.failed", { message }));
      }
    },
  };

  return {
    prompt: tApp("analysis.loop.actions.prompt", { actions: JSON.stringify(actions) }),
    supervisorTools: [executeAction],
  };
}
