import type { AgentTool } from "../../../core/agent-loop/types";
import { applyFieldDisplayPlan } from "../../data-query/adapter";
import type { QueryResultDatasetEntry } from "../runtime/query-result";

export function createReadEvidenceTool(
  resolve: (questionId: string) => { entries: QueryResultDatasetEntry[] } | undefined,
  locale?: string,
): AgentTool {
  return {
    name: "read_evidence",
    description: "Read another page of an already collected question_id without rerunning a database query. Use this when dataView omits middle rows. Preview omission is not source truncation. Skills and charts already receive the stored full dataset: do not split and recollect the same query just to bypass a preview. Check required skill inputs before collecting more evidence.",
    parameters: {
      type: "object",
      properties: {
        question_id: { type: "string" },
        dataset_index: { type: "integer", minimum: 0, default: 0 },
        offset: { type: "integer", minimum: 0, default: 0 },
        limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
      },
      required: ["question_id"],
    },
    async execute(_id, params, signal) {
      signal?.throwIfAborted();
      const index = params.dataset_index ?? 0;
      const offset = params.offset ?? 0;
      const limit = params.limit ?? 50;
      if (![index, offset, limit].every(Number.isSafeInteger) || Number(index) < 0 || Number(offset) < 0 || Number(limit) < 1 || Number(limit) > 100) {
        throw new Error("Invalid evidence page: use non-negative dataset_index/offset and limit 1..100.");
      }
      const record = typeof params.question_id === "string" ? resolve(params.question_id) : undefined;
      const entry = record?.entries[Number(index)];
      if (!entry) throw new Error("Stored evidence dataset not found; use a collected question_id and valid dataset_index.");
      const rows = entry.data.slice(Number(offset), Number(offset) + Number(limit));
      const data = entry.fieldDisplayPlan ? applyFieldDisplayPlan(rows, entry.fieldDisplayPlan, locale) : rows;
      return { content: [{ type: "text", text: JSON.stringify({
        questionId: params.question_id, datasetIndex: index, datasetCount: record!.entries.length,
        title: entry.title, totalRows: entry.data.length, offset, returnedRows: rows.length,
        nextOffset: Number(offset) + rows.length < entry.data.length ? Number(offset) + rows.length : null,
        truncated: entry.truncated === true, rowLimit: entry.rowLimit, truncationHint: entry.truncationHint, data,
      }) }] };
    },
  };
}
