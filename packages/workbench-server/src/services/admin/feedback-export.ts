import type { FeedbackRecord } from "@ontomato/contracts/feedback";
import { tForLocale } from "../../i18n";
import { HttpError } from "../../utils/errors";
import { listFeedback } from "./feedback-store";

/** One CSV cell, quoted as the admin page's own export quoted them. */
const cell = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;

/**
 * The feedback records of one filter as a CSV file: the same columns, labels and UTF-8 BOM the admin page used to
 * assemble in the browser, now answered by the feedback owner in the request's language and time zone.
 */
export function feedbackCsv(
  records: readonly FeedbackRecord[],
  locale: string | undefined,
  timeZone: string,
): string {
  const column = (key: string) => tForLocale(locale, `api.feedbackExport.${key}`);
  const label = (key: string) => tForLocale(locale, `api.feedback.${key}`);
  const headers = [
    column("columns.updatedAt"),
    column("columns.source"),
    column("columns.rating"),
    column("columns.user"),
    column("columns.turnKey"),
    column("columns.input"),
    column("columns.output"),
    column("columns.feedback"),
  ];
  const lines = records.map((record) =>
    [
      new Date(record.updatedAt).toLocaleString(locale, { timeZone }),
      label(`sources.${record.sourceType}`),
      label(`ratings.${record.rating}`),
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

/** The viewer's time zone is used for the exported timestamps. */
export function feedbackExportTimeZone(value: unknown): string {
  const timeZone = typeof value === "string" ? value.trim() : "";
  try {
    new Intl.DateTimeFormat("en", { timeZone }).format();
  } catch {
    throw new HttpError(400, "A valid IANA time zone is required", "INVALID_REQUEST");
  }
  return timeZone;
}

type ExportFilters = Pick<Parameters<typeof listFeedback>[0], "domainId" | "sourceType" | "rating" | "keyword" | "locale">;

export async function exportFeedback({ timeZone, ...filters }: ExportFilters & { timeZone: string }) {
  const { records } = await listFeedback({ ...filters, all: true });
  return {
    bytes: Buffer.from(feedbackCsv(records, filters.locale, timeZone), "utf8"),
    suggestedName: `feedback_records_${new Date().toISOString().slice(0, 10)}.csv`,
    mime: "text/csv" as const,
  };
}
