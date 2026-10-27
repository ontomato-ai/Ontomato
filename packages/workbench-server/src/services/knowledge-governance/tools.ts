import { createHash } from "node:crypto";
import { z } from "zod";
import {
  governanceWorkPatchSchema,
  type GovernanceSource,
  type GovernanceSkillCallIdentity,
  type GovernanceWork,
} from "@ontomato/contracts/knowledge-governance";
import { getCheckpointer } from "../../infrastructure/connection";
import { parseTurnKey } from "../../logging/log-context";
import { collectTurnArtifacts } from "../../platform/diagnosis/observe/workspaces/collect";
import {
  getFileTree,
  readWorkspaceFile,
} from "../../platform/diagnosis/observe/workspaces/artifact-file";
import { loadManifest } from "../../platform/diagnosis/observe/workspaces/store";
import {
  materialPage,
  materialPageInput,
  readKnowledge,
  readOntology,
  readHistory,
  searchHistory,
  type GovernanceCredentials,
} from "./materials";
import {
  governanceStore,
  type GovernanceOwner,
  type GovernanceRecord,
} from "./store";

// These schemas own both HTTP validation and the generated runtime tool manifest.
export const governanceActions = {
  search_history: {
    description:
      "Find relevant questions in a page of current-domain users' conversations. Empty matches describe only the scanned page, not all history.",
    schema: z
      .object({
        query: z.string().default(""),
        offset: z.number().int().nonnegative().default(0),
        limit: z.number().int().min(1).max(20).default(10),
      })
      .strict(),
  },
  read_history: {
    description:
      "Read current-domain conversation history by character offset. Returned turn keys can be used for diagnostic evidence. System output is execution evidence, not business truth.",
    schema: z
      .object({
        threadId: z.string().min(1),
        offset: z.number().int().nonnegative().default(0),
        maxChars: z.number().int().min(1000).max(20000).default(12000),
      })
      .strict(),
  },
  read_evidence: {
    description:
      "Read diagnostic files of a current-domain turn. Omit path to list files. Missing artifacts are an evidence gap. Never print raw prompts in the user conversation.",
    schema: z
      .object({
        turnKey: z.string().min(1),
        path: z.string().optional(),
        offset: z.number().int().nonnegative().default(0),
        maxChars: z.number().int().min(1000).max(20000).default(12000),
      })
      .strict(),
  },
  read_work_record: {
    description:
      "Read saved work, reviewed identities, sources and issues after compaction or resuming. Follow pagination to recover originals.",
    schema: materialPageInput,
  },
  update_work_record: {
    description:
      "Save this governance run's progress, notes and findings only. Omitted fields retain content. Reviewed identities are merged, issues upsert by stable ID. Cite previously read source IDs. Confirmation never changes production knowledge, ontology or data.",
    schema: governanceWorkPatchSchema,
  },
  read_knowledge: {
    description:
      "Read current-domain knowledge originals by character budget. Query searches all records. Follow next.index/offset. Returned sourceId can be cited in findings.",
    schema: materialPageInput,
  },
  read_ontology: {
    description:
      "Read current-domain ontology originals by character budget. Query searches all records. Follow next.index/offset. Returned sourceId can be cited in findings.",
    schema: materialPageInput,
  },
  collect_turn_artifacts: {
    description:
      "Collect current-domain execution evidence for a turnKey, then read it using read_evidence. Collection may rebuild existing diagnostic files.",
    schema: z.object({ turnKey: z.string().min(1) }).strict(),
  },
};
export type GovernanceAction = keyof typeof governanceActions;
export function sourceId(kind: GovernanceSource["kind"], target: string) {
  return createHash("sha256")
    .update(`${kind}:${target}`)
    .digest("hex")
    .slice(0, 20);
}
const source = (
  kind: GovernanceSource["kind"],
  target: string,
  title: string,
  excerpt: string,
): GovernanceSource => ({
  id: sourceId(kind, target),
  kind,
  target,
  title,
  excerpt: excerpt.slice(0, 1200),
});
function remember(work: GovernanceWork, sources: GovernanceSource[]) {
  for (const item of sources)
    if (!work.sources.some((s) => s.id === item.id)) work.sources.push(item);
}

/** Every business mutation goes through one owner transaction, after external reads have finished. */
export async function executeGovernanceAction(
  name: GovernanceAction,
  raw: unknown,
  identity: GovernanceSkillCallIdentity,
  owner: GovernanceOwner,
  credentials: GovernanceCredentials,
  signal?: AbortSignal,
): Promise<unknown> {
  const current = await governanceStore.runWork(identity, owner);
  if (name === "search_history") {
    const a = governanceActions[name].schema.parse(raw);
    return searchHistory(owner.domainId, a.query, a.offset, a.limit, signal);
  }
  if (name === "read_work_record") {
    const a = governanceActions[name].schema.parse(raw);
    return materialPage(
      [
        {
          id: identity.governanceSessionId,
          title: "Work record",
          text: JSON.stringify(current.work, null, 2),
        },
      ],
      a,
    );
  }
  if (name === "collect_turn_artifacts") {
    const a = governanceActions[name].schema.parse(raw);
    return collectTurnArtifacts(credentials, a.turnKey, signal);
  }
  if (name === "read_knowledge" || name === "read_ontology") {
    const a = governanceActions[name].schema.parse(raw),
      kind = name === "read_knowledge" ? "knowledge" : "ontology";
    const materials = await (kind === "knowledge"
      ? readKnowledge(credentials, signal)
      : readOntology(credentials, signal));
    signal?.throwIfAborted();
    const page = materialPage(materials, a),
      sources = page.items.map((item) =>
        source(kind, item.id, item.title, item.text),
      );
    await governanceStore.mutate(identity, owner, (work) => {
      remember(work, sources);
      if (kind === "knowledge") work.knowledgeTotal = materials.length;
    });
    return {
      ...page,
      items: page.items.map((item, index) => ({
        ...item,
        sourceId: sources[index]!.id,
      })),
    };
  }
  if (name === "read_history") {
    const a = governanceActions[name].schema.parse(raw),
      history = await readHistory(a.threadId, owner.domainId);
    signal?.throwIfAborted();
    const item = source(
      "history",
      a.threadId,
      a.threadId,
      history.messages
        .filter((m) => m.role === "user")
        .map((m) => m.content)
        .join("\n"),
    );
    await governanceStore.mutate(identity, owner, (work) =>
      remember(work, [item]),
    );
    return {
      ...materialPage(
        [
          {
            id: a.threadId,
            title: a.threadId,
            text: JSON.stringify(history, null, 2),
          },
        ],
        a,
      ),
      sourceId: item.id,
      turns: history.turns,
    };
  }
  if (name === "read_evidence") {
    const a = governanceActions[name].schema.parse(raw),
      turn = parseTurnKey(a.turnKey);
    if (!turn) throw new Error("Invalid turnKey");
    const manifest = loadManifest(a.turnKey);
    if (!manifest) {
      const checkpointer = getCheckpointer();
      if (!checkpointer) throw new Error("Thread storage unavailable");
      await checkpointer.verifyThreadDomain(turn.threadId, owner.domainId);
      return { evidenceGap: "No diagnostic workspace exists for this turn." };
    }
    if (manifest.domainId !== owner.domainId)
      throw new Error("Diagnostic artifact belongs to another domain");
    if (!a.path)
      return { tree: getFileTree(a.turnKey), status: manifest.status };
    const text = readWorkspaceFile(a.turnKey, a.path);
    if (text === null)
      return {
        evidenceGap:
          "Artifact unavailable; absence does not prove the knowledge was absent from the original input.",
      };
    const item = source("artifact", `${a.turnKey}/${a.path}`, a.path, "");
    signal?.throwIfAborted();
    await governanceStore.mutate(identity, owner, (work) =>
      remember(work, [item]),
    );
    return {
      ...materialPage([{ id: item.id, title: a.path, text }], a),
      sourceId: item.id,
    };
  }
  const patch = governanceActions.update_work_record.schema.parse(raw);
  signal?.throwIfAborted();
  const saved = await governanceStore.mutate(identity, owner, (work) => {
    for (const issue of patch.issues ?? [])
      if (issue.sourceIds.some((id) => !work.sources.some((s) => s.id === id)))
        throw new Error(
          "Read the cited original before referencing its sourceId",
        );
    if (patch.summary !== undefined) work.summary = patch.summary;
    if (patch.notes !== undefined) work.notes = patch.notes;
    work.reviewedKnowledgeIds = [
      ...new Set([
        ...work.reviewedKnowledgeIds,
        ...(patch.reviewedKnowledgeIds ?? []),
      ]),
    ];
    for (const issue of patch.issues ?? []) {
      const index = work.issues.findIndex((old) => old.id === issue.id);
      if (index < 0) work.issues.push(issue);
      else work.issues[index] = issue;
    }
  });
  return {
    saved: true,
    reviewed: saved.work.reviewedKnowledgeIds.length,
    issues: saved.work.issues.length,
  };
}

/** User-facing source reads keep diagnostic prompts and raw tool dumps private. */
export async function readGovernanceSource(
  record: GovernanceRecord,
  credentials: GovernanceCredentials,
  id: string,
  offset: number,
) {
  const item = record.work.sources.find((s) => s.id === id);
  if (!item) throw new Error("Source not found");
  if (item.kind === "artifact") return { source: item, page: null };
  const materials =
    item.kind === "knowledge"
      ? await readKnowledge(credentials)
      : item.kind === "ontology"
        ? await readOntology(credentials)
        : [
            {
              id: item.target,
              title: item.title,
              text: JSON.stringify(
                await readHistory(item.target, record.domainId),
                null,
                2,
              ),
            },
          ];
  return {
    source: item,
    page: materialPage(
      materials,
      materialPageInput.parse({ id: item.target, offset }),
    ),
  };
}
