import type { FeedbackRecord } from "@ontomato/contracts/feedback";
import { tForLocale } from "../../i18n";

/** One CSV cell, quoted as the admin page's own export quoted them. */
const cell = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;

/**
 * The feedback records of one filter as a CSV file: the same columns, labels and UTF-8 BOM the admin page used to
 * assemble in the browser, now answered by the feedback owner in the request's language.
 */
export function feedbackCsv(records: readonly FeedbackRecord[], locale: string | undefined): string {
  const text = (key: string) => tForLocale(locale, `api.feedbackExport.${key}`);
  const headers = [
    text("columns.time"),
    text("columns.source"),
    text("columns.rating"),
    text("columns.user"),
    text("columns.turnKey"),
    text("columns.input"),
    text("columns.output"),
    text("columns.feedback"),
  ];
  const lines = records.map((record) =>
    [
      new Date(record.createdAt).toLocaleString(locale),
      text(`sources.${record.sourceType}`),
      text(`ratings.${record.rating}`),
      record.userName || record.userId,
      record.turnKey,
      record.userInput ?? "",
      record.assistantOutput ?? "",
      record.feedbackText ?? "",
    ]
      .map(cell)
      .join(","),
  );
  return `\uFEFF${[headers.map(cell).join(","), ...lines].join("\n")}`;
}
