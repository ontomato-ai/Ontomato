import type { Dataset } from "./adapter";
import { combineResultTruncation } from "./protocol";
import { tForLocale } from "../../i18n";

/** Keep numeric answers in the executed tables instead of asking a model to recalculate them. */
export async function streamConclusion(
  _originalQuestion: string,
  datasets: Dataset[],
  prefix: string,
  push: (content: string) => void,
  signal?: AbortSignal,
  locale?: string
): Promise<string> {
  signal?.throwIfAborted();
  const truncation = combineResultTruncation(datasets);
  const empty = datasets.every((dataset) => dataset.data.length === 0) && !truncation;
  const conclusion = tForLocale(
    locale,
    empty ? "query.conclusion.noDataFound" : "query.conclusion.resultsAvailable"
  );
  const notice = truncation ? `\n\n> ${truncation.truncationHint}` : "";
  const content = `${prefix}\n\n${conclusion}${notice}\n`;
  push(content);
  return content;
}
