import { installContentLayout, installWorkbenchIdentity, installWorkbenchProduct, installRuntimeDefaults } from "../../../index";
import { ossContentLayout } from "../../../../../../apps/workbench/src/content";
import { ossIdentity } from "../../../../../../apps/workbench/src/identity";
import { ossProduct } from "../../../../../../apps/workbench/src/product";
import { ossRuntimeDefaults } from "../../../../../../apps/workbench/src/runtime-defaults";
import { configureOssI18n } from "../../../../../../apps/workbench/src/i18n";
import { ossWorkspaceArtifactText } from "../../../../../../apps/workbench/src/workspace-artifact-text";
import { installWorkspaceArtifactText } from "../../../platform/diagnosis/observe/workspace-artifact/artifact-text";
import type { AuthenticatedRequest } from "../../../utils/request-identity";
// Fixture identity isolates API ownership checks from the edition's login system.
installContentLayout(ossContentLayout(process.env.OPS_TEST_ROOT!));
installWorkbenchProduct(ossProduct); installRuntimeDefaults(ossRuntimeDefaults); configureOssI18n();
installWorkspaceArtifactText(ossWorkspaceArtifactText);
installWorkbenchIdentity({ ...ossIdentity,
  authenticate(req, res, next) {
    const token = req.header("tk") ?? "";
    const [userId, domainId] = token.split(":");
    if (!["alice", "bob", "denied"].includes(userId) || !["a", "b"].includes(domainId)) { res.status(401).json({ error: "Authentication required" }); return; }
    Object.assign(req as AuthenticatedRequest, { userId, domainId, token, apiKey: "", locale: "en", userName: userId, roles: [] }); next();
  },
  requireDomainId(identity) { if (!identity.domainId) throw new Error("Domain required"); return identity.domainId; },
  observeAccess(req, res, next) { if ((req as AuthenticatedRequest).userId === "denied") res.status(403).json({ error: "Observe permission required" }); else next(); },
  async resolveMcpCaller(req) { const [userId, domainId] = (req.header("tk") ?? "").split(":"); if (!["alice", "bob", "denied"].includes(userId) || !["a", "b"].includes(domainId)) throw new Error("Authentication required"); return { userId, domainId, token: req.header("tk") }; },
  async assertObserveAccess(identity) { if (identity.token?.startsWith("denied:")) throw new Error("Observe permission required"); },
});
const { initializeConnection, closeConnection } = await import("../../../infrastructure/connection");
const { syncDefaultPrompts } = await import("../../../core/prompts/loader");
const { createWorkbenchApp } = await import("../../../http/create-app");
syncDefaultPrompts(); await initializeConnection();
const { initializeWorkbenchLogging, getWorkbenchLogStore, closeWorkbenchLogging } = await import("../../../infrastructure/service-logs");
initializeWorkbenchLogging();
const logStore = getWorkbenchLogStore();
for (let attempt = 0; ; attempt++) {
  try { await logStore.query({}); break; } catch (error) { if (attempt >= 50) throw error; await new Promise((r) => setTimeout(r, 20)); }
}
const server = createWorkbenchApp().listen(Number(process.env.PORT), "127.0.0.1", () => process.stdout.write("OPS_TEST_READY\n"));
process.once("SIGTERM", () => { server.closeAllConnections(); server.close(); void Promise.all([closeConnection(), closeWorkbenchLogging()]); });
