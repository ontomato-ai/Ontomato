import type { DatasetPayload } from "@ontomato/contracts/data-retrieval";
import {
  datasetPlacement,
  type QueryRetrievalRef,
} from "@ontomato/contracts/query-execution";
import type { Dataset } from "../data-query/adapter";

/** The same immutable artifact projection feeds live output, stored history and downloads. */
export function projectDataset(
  id: string,
  payload: DatasetPayload,
  retrieval: QueryRetrievalRef,
): Dataset {
  const code =
    payload.recipe.kind === "python"
      ? payload.recipe.code
      : payload.recipe.executedCode;
  return {
    id,
    name: payload.title,
    description: payload.question,
    subQuestion: payload.question,
    columns: payload.columns.map((c) => c.key),
    data: payload.rows,
    retrieval,
    ...(payload.recipe.kind === "dsl" ? { dsl: payload.recipe.dsl } : {}),
    ...(code
      ? {
          abcProgram: {
            title: payload.title,
            code,
            outKeyRefs: payload.outKeyRefs,
            parameters: [],
          },
        }
      : {}),
    ...(payload.truncation ?? {}),
  };
}
const cell = (value: unknown) =>
  String(
    value === null
      ? "null"
      : typeof value === "object"
        ? JSON.stringify(value)
        : value,
  )
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ");
export function datasetMarkdown(dataset: Dataset) {
  const rows = dataset.data.slice(0, 10),
    columns = dataset.columns;
  const table = columns.length
    ? [
        `| ${columns.map(cell).join(" | ")} |`,
        `| ${columns.map(() => "---").join(" | ")} |`,
        ...rows.map(
          (row) => `| ${columns.map((key) => cell(row[key])).join(" | ")} |`,
        ),
      ].join("\n")
    : "";
  return `### ${dataset.description}\n\n${table}\n\n${dataset.truncationHint ?? ""}\n\n${datasetPlacement(dataset.id)}`;
}
