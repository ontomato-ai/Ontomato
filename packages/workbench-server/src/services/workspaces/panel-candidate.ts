import { z } from "zod";
import { candidatePanelSourceSchema, type CandidatePanelSource } from "@ontomato/contracts/panel-host";
import { panelManifestSchema } from "@ontomato/contracts/panel-manifest";
import { panelDefinitionContentSchema, productPanelContentSchema } from "@ontomato/contracts/product-panels";
import type { AssistantCredentials } from "../../platform/agent-runtime/runtime";
import { HttpError } from "../../utils/errors";
import { assertAppBuilderAccess } from "../app-builder/access";
import { WorkspaceBuildTests } from "../app-builder/build-tests";
import type { AssistantOwner } from "../assistant/store";
import { readCurrentPanelRecord, readCurrentProjectionRecord } from "../product-panels/current";

const descriptorSchema = z.object({
  manifest: panelManifestSchema,
  content: productPanelContentSchema.pick({ messages: true }).optional(),
}).strict();
const treeSchema = z.object({ files: z.array(z.object({ path: z.string() })) });

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
  const readOptional = (path: string) => tree.files.some(file => file.path === path) ? read(path) : undefined;
  const [html, module, descriptorText, recipes] = await Promise.all([
    read("panel.html"), readOptional("panel.mjs"), read("panel.json"), readOptional("recipes.md"),
  ]);
  let descriptor: unknown;
  try {
    descriptor = JSON.parse(descriptorText);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new HttpError(400, `Invalid panel.json: ${error.message}`, "PANEL_CANDIDATE_INVALID");
  }
  const { manifest, content } = descriptorSchema.parse(descriptor);
  const panel = panelDefinitionContentSchema.parse({ manifest, content: { html, module, recipes, ...content } });
  const projectionIds = new Set<string>();
  const panelIds = new Set<string>();
  for (const { target } of Object.values(panel.manifest.members)) {
    if ("projectionId" in target) projectionIds.add(target.projectionId);
    if ("panelId" in target) panelIds.add(target.panelId);
  }
  await Promise.all([
    ...[...projectionIds].map(id => readCurrentProjectionRecord(owner, credentials, id)),
    ...[...panelIds].map(id => readCurrentPanelRecord(owner, credentials, id)),
  ]);
  const test = await tests.current();
  return { kind: "candidate", workspace: { id, ref }, panel, previewContext: { kind: "build-test", test } };
}

export const panelCandidateQuerySchema = candidatePanelSourceSchema.shape.workspace.pick({ ref: true });
