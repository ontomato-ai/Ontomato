import type { RuntimeAgentDefinition, RuntimeStartRunRequest } from "@ontomato/contracts/agent-runtime";
import type { RuntimeToolDeclaration } from "@ontomato/contracts/agent-runtime-messages";
import type { RuntimeJsonObject } from "@ontomato/contracts/agent-runtime-values";
import type { PlatformTool } from "./platform-tools";

/** Builds engine-neutral declarations for a definition's product tools without binding secrets. */
export function productToolDeclarations(
  definition: Pick<RuntimeAgentDefinition, "productTools">,
): RuntimeToolDeclaration[] {
  return (definition.productTools ?? []).map((definition) => ({
    name: definition.name,
    description: definition.description,
    parameters: definition.inputSchema as RuntimeJsonObject,
  }));
}

/** Binds a run's product tools to its callback origin and run-scoped credential. */
export function productTools(request: RuntimeStartRunRequest, runId: string): PlatformTool[] {
  const definitions = request.definition.productTools ?? [];
  if (!definitions.length) return [];
  const callback = request.businessCallbacks?.product;
  const root = callback?.baseUrl ?? request.environment.values.ONTOMATO_WORKBENCH_URL;
  const credential = callback?.credential ?? request.environment.secrets.ONTOMATO_PRODUCT_CALLBACK;
  if (!root || !credential) throw new Error("Product tool callback delegation is missing");
  const base = new URL(root);
  if (!["http:", "https:"].includes(base.protocol) || base.search || base.hash || base.username || base.password) {
    throw new Error("Invalid product callback origin");
  }
  return definitions.map((definition) => {
    const target = callback
      ? new URL(definition.path, base.origin)
      : new URL(base.toString().replace(/\/$/, "") + definition.path);
    if (callback && !target.pathname.startsWith(base.pathname.replace(/\/$/, "") + "/"))
      throw new Error("Product tool is outside its declared callback path");
    return {
      declaration: {
        name: definition.name,
        description: definition.description,
        parameters: definition.inputSchema as RuntimeJsonObject,
      },
      label: definition.name,
      async execute(call) {
        const response = await fetch(target, {
          method: "POST",
          redirect: "error",
          headers: { "Content-Type": "application/json", tk: credential, "X-Ontomato-Run-Id": runId },
          body: JSON.stringify({ parameters: call.args }),
          signal: call.signal,
        });
        const result = await response.json();
        return {
          result: { content: [{ type: "text" as const, text: JSON.stringify(result) }], details: {} },
          isError: !response.ok,
        };
      },
    };
  });
}
