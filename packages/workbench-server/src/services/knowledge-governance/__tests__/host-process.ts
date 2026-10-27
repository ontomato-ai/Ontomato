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
import { ossWorkspaceArtifactText } from "../../../../../../apps/workbench/src/workspace-artifact-text";
import { installWorkspaceArtifactText } from "../../../platform/diagnosis/observe/workspace-artifact/artifact-text";
import { installM3DiagnosticSupport } from "../../../platform/diagnosis/observe/m3-support";

// Real product owners and HTTP routes, with all mutable files confined to the test directory.
installContentLayout(ossContentLayout(process.env.GOVERNANCE_TEST_ROOT!));
installWorkbenchProduct(ossProduct);
installRuntimeDefaults(ossRuntimeDefaults);
installWorkbenchIdentity(ossIdentity);
configureOssI18n();
installWorkspaceArtifactText(ossWorkspaceArtifactText);
installM3DiagnosticSupport(null);
const { createWorkbenchApp } = await import("../../../http/create-app");
const { initializeConnection, closeConnection } =
  await import("../../../infrastructure/connection");
const { syncDefaultPrompts } = await import("../../../core/prompts/loader");
const { registerGovernanceSkill } = await import("../skill");
syncDefaultPrompts();
await initializeConnection();
await registerGovernanceSkill();
const app = createWorkbenchApp();
const server = app.listen(Number(process.env.PORT), "127.0.0.1", () =>
  process.stdout.write("GOVERNANCE_TEST_READY\n"),
);
process.once("SIGTERM", () => {
  server.closeAllConnections();
  server.close();
  void closeConnection();
});
