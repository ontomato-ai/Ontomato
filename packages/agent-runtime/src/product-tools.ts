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
  if (!callback) throw new Error("Product tool callback delegation is missing");
  const base = new URL(callback.baseUrl);
  const prefix = base.pathname.replace(/\/$/, "");
  const deploymentPath = prefix.slice(0, prefix.lastIndexOf("/api/product-assets/"));
  return definitions.map((definition) => {
    const target = new URL(deploymentPath + definition.path, base.origin);
    if (!target.pathname.startsWith(prefix + "/"))
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
          headers: { "Content-Type": "application/json", tk: callback.credential, "X-Ontomato-Run-Id": runId },
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
