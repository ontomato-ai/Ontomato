import { answerBodyText } from "@ontomato/contracts/query-execution";
import { workspaceArtifactText } from "../observe/workspace-artifact/artifact-text";
export function toResponseSnapshotMarkdown(answer: string): {
  content: string;
  foldedTablesRemoved: number;
} {
  const markdown = answerBodyText(answer);
  let foldedTablesRemoved = 0;
  let output = "";
  let cursor = 0;
  const lower = markdown.toLowerCase();

  while (cursor < markdown.length) {
    const start = lower.indexOf("<details", cursor);
    if (start < 0) {
      output += markdown.slice(cursor);
      break;
    }

    const tagEnd = markdown.indexOf(">", start);
    if (tagEnd < 0) {
      output += markdown.slice(cursor);
      break;
    }

    const openTag = markdown.slice(start, tagEnd + 1);
    const isFoldedTable =
      /data-ai-table-details\s*=/i.test(openTag) ||
      /class\s*=\s*["'][^"']*\bda-ts-more\b/i.test(openTag);

    if (!isFoldedTable) {
      output += markdown.slice(cursor, tagEnd + 1);
      cursor = tagEnd + 1;
      continue;
    }

    output += markdown.slice(cursor, start);
    const end = lower.indexOf("</details>", tagEnd + 1);
    const block =
      end >= 0 ? markdown.slice(start, end + "</details>".length) : markdown.slice(start);
    const notice = buildFoldedTableNotice(block);
    if (notice) {
      output = output.replace(/[ \t]*$/u, "");
      output += `\n\n> ${notice}\n`;
    }
    foldedTablesRemoved++;

    if (end < 0) {
      break;
    }
    cursor = end + "</details>".length;
  }

  return { content: output, foldedTablesRemoved };
}

function buildFoldedTableNotice(detailsBlock: string): string | null {
  const summaryMatch = /<summary\b[^>]*>([\s\S]*?)<\/summary>/i.exec(detailsBlock);
  if (!summaryMatch) return null;
  const summary = summaryMatch[1]
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!summary) return null;
  const hint = workspaceArtifactText().foldedTableHint;
  return summary.replace(hint.pattern, hint.replacement);
}
