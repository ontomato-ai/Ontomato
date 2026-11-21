import type { ZodIssue } from "zod";
import { HttpError } from "../../utils/errors";

export function invalidPageDraft(runId: string, path: string | undefined, issues: readonly Pick<ZodIssue, "path" | "message">[]) {
  const record = path === undefined ? `in run '${runId}'` : `'${path}' in run '${runId}'`;
  const fields = issues.map(issue => `${issue.path.join(".") || "draft"}: ${issue.message}`).join(", ");
  return new HttpError(400, `Page draft ${record}: ${fields}`, "INVALID_REQUEST", {
    runId, ...(path !== undefined && { path }), issues: issues.map(({ path, message }) => ({ path, message })),
  });
}
