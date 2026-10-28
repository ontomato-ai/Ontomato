import { randomUUID } from "node:crypto";
import type { AbcBranchContext, BaseQueryOutput } from "./types";
import { retrievalService } from "../../data-retrieval/service";
import {
  projectDataset,
  datasetMarkdown,
} from "../../data-retrieval/projection";
import { getLogContext } from "../../../logging/log-context";
import { requireDomainId } from "../../../utils/request-identity";
import { t } from "../../../i18n";

export async function runRetrievalBranch(
  ctx: AbcBranchContext,
): Promise<BaseQueryOutput | undefined> {
  const log = getLogContext(),
    owner = { domainId: requireDomainId(log ?? {}), userId: ctx.userId };
  const credentials = {
      token: ctx.token,
      apiKey: ctx.apiKey,
      locale: ctx.locale,
    },
    id = randomUUID();
  ctx.signal.throwIfAborted();
  ctx.thinking.ensureParallelStarted();
  ctx.thinking.set("running", t("query.progress.querying"));
  let snapshot = await retrievalService.start(
    id,
    owner,
    credentials,
    {
      question: ctx.queryQuestion,
      userQuotes: [],
      previousDatasetIds: [],
      classNames: ctx.classNames,
      interaction: "resumable",
    },
    log?.turn?.turnKey ?? log?.taskId ?? null,
  );
  const retrieval = {
    retrievalId: id,
    runtimeSessionId: snapshot.runtimeSessionId!,
    runtimeRunId: snapshot.runtimeRunId!,
  };
  ctx.reportRetrievalLocation?.(retrieval);
  ctx.reportFallback({ content: "", datasets: [], retrieval });
  const cancel = () => {
    void retrievalService.cancel(id, owner, credentials).catch(() => {});
  };
  ctx.signal.addEventListener("abort", cancel, { once: true });
  if (ctx.signal.aborted) cancel();
  try {
    while (snapshot.run?.status === "running") {
      ctx.signal.throwIfAborted();
      await new Promise((resolve) => setTimeout(resolve, 200));
      snapshot = await retrievalService.get(id, owner, credentials);
    }
    ctx.signal.throwIfAborted();
    const artifacts = await Promise.all(
      snapshot.datasetArtifactIds.map((id) =>
        retrievalService.dataset(owner, id),
      ),
    );
    const datasets = artifacts.map((item) =>
      projectDataset(item.id, item.payload, retrieval),
    );
    const content = datasets.map(datasetMarkdown).join("\n\n");
    const output: BaseQueryOutput = {
      content,
      datasets,
      retrieval,
      nodeIds: [],
      subQuestions: datasets.map((d) => d.subQuestion ?? d.description),
      abcCodes: artifacts.map(({ payload: p }) =>
        p.recipe.kind === "python"
          ? p.recipe.code
          : (p.recipe.executedCode ?? ""),
      ),
      abcDsls: artifacts.flatMap(({ payload: p }) =>
        p.recipe.kind === "dsl" ? [p.recipe.dsl] : [],
      ),
      abcOutKeyRefs: artifacts.map((a) => a.payload.outKeyRefs),
    };
    const answer = snapshot.messages
      .flatMap((m) =>
        m.message.role === "assistant"
          ? m.message.content.flatMap((c) =>
              c.type === "text" ? [c.text] : [],
            )
          : [],
      )
      .join("\n\n");
    output.content = [content, answer].filter(Boolean).join("\n\n");
    ctx.reportFallback(output);
    if (
      snapshot.run?.stopReason === "error" ||
      snapshot.run?.stopReason === "aborted"
    )
      throw new Error(snapshot.run.errorMessage ?? "Retrieval stopped");
    if (!datasets.length) {
      if (answer) ctx.pushContent(answer, false);
      return undefined;
    }
    ctx.pushEvent({ type: "query_datasets", datasets, nodeIds: [] });
    ctx.pushContent(content, false);
    ctx.thinking.set("success", t("query.status.completed"));
    return output;
  } finally {
    ctx.signal.removeEventListener("abort", cancel);
  }
}
