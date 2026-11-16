import { actionFormSchema, type ActionFormRequest } from "@ontomato/contracts/action-forms";
import type { ManagerRequest } from "../api";
import {invalidateProductData} from '@ontomato/contracts/product-invalidation';

/** One Action execution with parameters already in their declared types; Java validates them again. */
export interface ActionExecution {
  id: string;
  parameters: Record<string, unknown>;
}

/** Executes Actions, the only write entry for business data, for the Manager's object views and SDK apps alike. */
export function createActionsClient(request: Pick<ManagerRequest, "send" | "post">) {
  async function execute(input: ActionExecution) {
    const body = new FormData();
    body.set("id", input.id);
    body.set("param", JSON.stringify(input.parameters));
    const result=(await request.send("/action/execute", { method: "POST", body })).data;
    if(Array.isArray(result?.affects))invalidateProductData({actionId:input.id,objectTypes:result.affects.filter((value:unknown):value is string=>typeof value==='string')});
    return result;
  }

  /**
   * An Action's form: its fields and their initial text, or with `values` the field errors or the typed parameters
   * that `execute` takes. The data engine interprets the text; a page that already has typed values calls `execute`.
   */
  async function form(input: ActionFormRequest) {
    return actionFormSchema.parse((await request.post("/action/form", input)).data);
  }

  return { execute, form };
}

export type ActionsClient = ReturnType<typeof createActionsClient>;
