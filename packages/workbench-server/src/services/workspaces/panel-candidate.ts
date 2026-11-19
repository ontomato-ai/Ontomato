import { access } from "node:fs/promises";
import { z } from "zod";
import { candidatePanelSourceSchema, type CandidatePanelSource } from "@ontomato/contracts/panel-host";
import { panelDefinitionContentSchema } from "@ontomato/contracts/product-panels";
import { runtimeDataDir } from "../../content/layout";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";
import { assertAppBuilderAccess } from "../app-builder/access";
import { WorkspaceBuildTests } from "../app-builder/build-tests";
import type { AssistantOwner } from "../assistant/store";
import { readCurrentProjection } from "../product-panels/current";

const descriptorSchema = panelDefinitionContentSchema.omit({ content: true });
const treeSchema = z.object({ files: z.array(z.object({ path: z.string() })) });

async function requireInstalledSdk(version: string) {
  await access(runtimeDataDir("apps-sdk", version)).catch((error: { code?: string }) => {
    if (error.code === "ENOENT") throw new HttpError(404, `Panel SDK version is not installed: ${version}`, "PANEL_SDK_UNAVAILABLE");
    throw error;
  });
}

export async function readPanelCandidate(
  owner: AssistantOwner, credentials: AssistantCredentials, { id, ref }: CandidatePanelSource["workspace"],
): Promise<CandidatePanelSource> {
  await assertAppBuilderAccess(credentials);
  const tests = new WorkspaceBuildTests(owner, credentials, id);
  const workspace = `/v1/workspaces/${id}`;
  const revision: Record<string, string> = ref === "working" ? {} : { commit: ref };
  // Runtime checks the author and, for a commit, membership in the workspace history.
  const tree = treeSchema.parse(await tests.runtime.request(`${workspace}/tree?${new URLSearchParams(revision)}`));
  const read = async (path: string) =>
    (await tests.runtime.bytes(`${workspace}/files/content?${new URLSearchParams({ ...revision, path })}`)).toString("utf8");
  const [html, module, descriptorText, recipes] = await Promise.all([
    read("panel.html"), read("panel.mjs"), read("panel.json"),
    tree.files.some(file => file.path === "recipes.md") ? read("recipes.md") : undefined,
  ]);
  let descriptor: unknown;
  try {
    descriptor = JSON.parse(descriptorText);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new HttpError(400, `Invalid panel.json: ${error.message}`, "PANEL_CANDIDATE_INVALID");
  }
  const panel = panelDefinitionContentSchema.parse({
    ...descriptorSchema.parse(descriptor),
    content: { html, module, ...(recipes === undefined ? {} : { recipes }) },
  });
  await requireInstalledSdk(panel.sdkVersion);
  const projectionIds = new Set(Object.values(panel.manifest.slots).map(slot => slot.projectionId));
  await Promise.all([...projectionIds].map(projectionId => readCurrentProjection(owner, credentials, projectionId)));
  const test = await tests.current();
  return { kind: "candidate", workspace: { id, ref }, panel, previewContext: { kind: "build-test", test } };
}

export const panelCandidateQuerySchema = candidatePanelSourceSchema.shape.workspace.pick({ ref: true });
