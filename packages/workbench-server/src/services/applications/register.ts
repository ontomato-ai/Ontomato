import { setTimeout as sleep } from "node:timers/promises";
import { z } from "zod";
import { builtinApplicationSchema, type BuiltinApplication } from "@ontomato/contracts/platform-identity";
import { config } from "../../config/application";
import { environment } from "../../config/environment";
import { createLogger } from "../../logging/logger";
import { workbenchApplications } from "./builtins";
const logger = createLogger("application-catalog");
const registration = z.object({ success: z.literal(true), data: z.object({ serviceId: z.literal("workbench"), applicationIds: z.array(z.string()) }) });
export class ApplicationCatalogClient {
  constructor(private readonly baseUrl: string, private readonly token: string) {}
  async register(applications: BuiltinApplication[], timeoutMs: number) {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/platform/applications/self/declarations`, {
      method: "POST", redirect: "error", headers: { "Content-Type": "application/json", "X-Ontomato-Query-Service-Token": this.token },
      body: JSON.stringify({ applications }), signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`Application registration failed (HTTP ${response.status})`);
    registration.parse(await response.json());
  }
}
/** Java may still be starting. Each attempt and the entire registration wait have finite deadlines. */
export async function registerWorkbenchApplications(
  client: Pick<ApplicationCatalogClient, "register">, declaration: BuiltinApplication[], timeoutMs = 120_000,
) {
  const parsed = z.array(builtinApplicationSchema).parse(declaration);
  const deadline = Date.now() + timeoutMs;
  let delay = 500;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      await client.register(parsed, Math.max(1, Math.min(10_000, deadline - Date.now())));
      return;
    } catch (error) {
      lastError = error;
      logger.warn("Waiting for platform application registration", { error: error instanceof Error ? error.message : String(error) });
    }
    await sleep(Math.max(0, Math.min(delay, deadline - Date.now())));
    delay = Math.min(delay * 2, 5_000);
  }
  throw new Error("Platform application registration timed out", { cause: lastError });
}


export async function registerApplications() {
  await registerWorkbenchApplications(new ApplicationCatalogClient(config.dataQuery.baseUrl, environment.agentRuntime().queryServiceToken), workbenchApplications);
}
