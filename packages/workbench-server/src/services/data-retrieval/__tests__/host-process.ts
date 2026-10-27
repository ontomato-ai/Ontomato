import {
  installContentLayout,
  installWorkbenchIdentity,
  installWorkbenchProduct,
  installRuntimeDefaults,
} from "../../../index";
import { ossContentLayout } from "../../../../../../apps/workbench/src/content";
import { ossIdentity } from "../../../../../../apps/workbench/src/identity";
import { ossProduct } from "../../../../../../apps/workbench/src/product";
import { ossRuntimeDefaults } from "../../../../../../apps/workbench/src/runtime-defaults";
import { configureOssI18n } from "../../../../../../apps/workbench/src/i18n";
import { runWithLogContext } from "../../../logging/log-context";
import type { AuthenticatedRequest } from "../../../utils/request-identity";

installContentLayout(ossContentLayout(process.env.RETRIEVAL_TEST_ROOT!));
installWorkbenchProduct(ossProduct);
installRuntimeDefaults(ossRuntimeDefaults);
configureOssI18n();
// A deterministic credential verifier replaces SSO only; routes, gates, persistence and execution are real.
installWorkbenchIdentity({
  ...ossIdentity,
  authenticate(req, res, next) {
    const token = req.header("tk") ?? "fixture-a";
    const actors: Record<string, { userId: string; domainId: string }> = {
      "fixture-a": { userId: "a", domainId: "domain-a" },
      "fixture-b": { userId: "b", domainId: "domain-a" },
      "fixture-other-domain": { userId: "a", domainId: "domain-b" },
    };
    const actor = actors[token];
    if (!actor) {
      res.status(401).end();
      return;
    }
    const request = req as AuthenticatedRequest;
    Object.assign(request, actor, {
      token,
      apiKey: "",
      locale: "en",
      roles: [],
      userName: actor.userId,
    });
    runWithLogContext({ domainId: actor.domainId, token }, () => next());
  },
  requireDomainId(identity) {
    if (!identity.domainId) throw new Error("Missing verified domain");
    return identity.domainId;
  },
});
const { createWorkbenchApp } = await import("../../../http/create-app");
const { initializeConnection, closeConnection } =
  await import("../../../infrastructure/connection");
const { syncDefaultPrompts } = await import("../../../core/prompts/loader");
const { registerRetrievalSkill } = await import("../skill");
syncDefaultPrompts();
await initializeConnection();
await registerRetrievalSkill();
const app = createWorkbenchApp();
const server = app.listen(Number(process.env.PORT), "127.0.0.1", () =>
  process.stdout.write("RETRIEVAL_TEST_READY\n"),
);
process.once("SIGTERM", () => {
  server.closeAllConnections();
  server.close();
  void closeConnection();
});
