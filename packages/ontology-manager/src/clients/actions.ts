import type { ManagerRequest } from "../api";

/** One Action execution with parameters already in their declared types; Java validates them again. */
export interface ActionExecution {
  id: string;
  parameters: Record<string, unknown>;
}

/** Executes Actions, the only write entry for business data, for the Manager's object views and SDK apps alike. */
export function createActionsClient(request: Pick<ManagerRequest, "send">) {
  async function execute(input: ActionExecution) {
    const body = new FormData();
    body.set("id", input.id);
    body.set("param", JSON.stringify(input.parameters));
    return (await request.send("/action/execute", { method: "POST", body })).data;
  }

  return { execute };
}

export type ActionsClient = ReturnType<typeof createActionsClient>;
