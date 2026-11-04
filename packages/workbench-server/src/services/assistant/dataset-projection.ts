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
  const bundle = "package" in payload.recipe ? payload.recipe.package : undefined;
  const values = "parameters" in payload.recipe ? payload.recipe.parameters : {};
  const legacySource = "legacySource" in payload.recipe ? payload.recipe.legacySource : undefined;
  const code = legacySource
    ? legacySource.files.find((file) => file.path === legacySource.manifest.entry.path)?.content
    : historicalCode(payload);
  return {
    id,
    name: payload.title,
    description: payload.question,
    subQuestion: payload.question,
    columns: payload.columns.map((c) => c.key),
    data: payload.rows,
    sourceAnalysis: payload.sourceAnalysis,
    retrieval,
    ...(payload.recipe.kind === "dsl" ? { dsl: payload.recipe.dsl } : {}),
    ...(bundle ? { abcProgram: {
      title: payload.title, code: "", queryPackage: bundle, parameterValues: values,
      sourceAnalysis: payload.sourceAnalysis, outKeyRefs: [],
      parameters: bundle.manifest.parameterDefs.map((p) => ({ key: String(p.name),
        type: typeof p.type === "string" ? p.type.replace(/^TYPE_/, "") : undefined, value: values[String(p.name)] })),
    } } : code
      ? {
          abcProgram: {
            title: payload.title,
            code,
            sourceAnalysis: payload.sourceAnalysis,
            outKeyRefs: payload.outKeyRefs ?? [],
            parameterValues: values,
            parameters: [],
          },
        }
      : {}),
    ...(payload.truncation ?? {}),
  };
}
/** Decode original v1 source text only while reading an immutable historical snapshot. */
function historicalCode(payload: DatasetPayload) {
  if (payload.schema !== "workbench.dataset.v1") return undefined;
  if (payload.recipe.kind === "python") return payload.recipe.code;
  return "executedCode" in payload.recipe ? payload.recipe.executedCode : undefined;
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
