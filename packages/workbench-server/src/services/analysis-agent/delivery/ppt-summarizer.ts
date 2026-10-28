import type {
  PptSummarySlide,
  PptSummaryOutline,
} from "@ontomato/contracts/ppt";
import { runAuxiliary } from "../../../platform/agent-runtime/runtime";
import { tApp } from "../../../i18n";

interface SummaryInput {
  title: string;
  report: string;
  userInstructions?: string;
  cover?: { title: string; subtitle: string };
  sections: Array<{
    id: string;
    heading: string;
    text: string;
    hasChart: boolean;
  }>;
}

export function getPptDefaultInstructions(): string {
  return tApp("analysis.delivery.ppt-summarizer.29")
    .split("- sourceSectionIds")[0]
    .trim();
}

export function buildPptSystemPrompt(instructions?: string): string {
  const original = tApp("analysis.delivery.ppt-summarizer.29");
  const contractStart = original.indexOf("- sourceSectionIds");
  return `${instructions?.trim() || getPptDefaultInstructions()}\n\n${original.slice(contractStart)}`;
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
  const candidate = fenced || text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

function normalizeOutline(
  value: unknown,
  input: SummaryInput,
): PptSummaryOutline | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const validIds = new Set(input.sections.map((section) => section.id));
  const slides = Array.isArray(raw.slides)
    ? raw.slides
        .map((slide): PptSummarySlide | null => {
          if (!slide || typeof slide !== "object") return null;
          const item = slide as Record<string, unknown>;
          const sourceSectionIds = Array.isArray(item.sourceSectionIds)
            ? item.sourceSectionIds.filter(
                (id): id is string =>
                  typeof id === "string" && validIds.has(id),
              )
            : [];
          const bullets = Array.isArray(item.bullets)
            ? item.bullets.filter(
                (bullet): bullet is string =>
                  typeof bullet === "string" && Boolean(bullet.trim()),
              )
            : [];
          const title = String(item.title || "").trim();
          const takeaway = String(item.takeaway || "").trim();
          if (!title || (!takeaway && bullets.length === 0)) return null;
          const visual = [
            "chart",
            "insight",
            "risk",
            "action",
            "metric",
          ].includes(String(item.visual))
            ? (String(item.visual) as PptSummarySlide["visual"])
            : "insight";
          return {
            title,
            takeaway: takeaway || bullets[0],
            bullets: bullets.slice(0, 4),
            sourceSectionIds: sourceSectionIds.slice(0, 2),
            visual,
          };
        })
        .filter((slide): slide is PptSummarySlide => !!slide)
    : [];
  if (!slides.length) return null;
  return {
    title: String(raw.title || input.title).trim() || input.title,
    subtitle: String(
      raw.subtitle || tApp("analysis.delivery.ppt-summarizer.28"),
    ).trim(),
    slides,
  };
}

export async function summarizeReportForPpt(
  input: SummaryInput,
  signal?: AbortSignal,
): Promise<PptSummaryOutline> {
  signal?.throwIfAborted();
  // Reduce bounded batches across all source sections; never truncate old turns.
  const pieces = input.sections.flatMap((section) => {
    const parts = [];
    for (
      let offset = 0;
      offset < section.text.length || offset === 0;
      offset += 4000
    ) {
      parts.push({
        ...section,
        text: section.text.slice(offset, offset + 4000),
      });
    }
    return parts;
  });
  if (JSON.stringify(pieces).length > 48000) {
    const reduced: SummaryInput["sections"] = [];
    let batch: SummaryInput["sections"] = [];
    let size = 0;
    const flush = async () => {
      if (!batch.length) return;
      const summary = await summarizeReportForPpt(
        { ...input, cover: undefined, report: "", sections: batch },
        signal,
      );
      reduced.push(
        ...summary.slides.map((slide) => ({
          id: slide.sourceSectionIds[0] || batch[0].id,
          heading: slide.title,
          text: [slide.takeaway, ...slide.bullets].join("\n"),
          hasChart: slide.visual === "chart",
        })),
      );
      batch = [];
      size = 0;
    };
    for (const piece of pieces) {
      const length = JSON.stringify(piece).length;
      if (size + length > 24000) await flush();
      batch.push(piece);
      size += length;
    }
    await flush();
    // A pathological model response must fail explicitly instead of recursing forever.
    if (JSON.stringify(reduced).length >= JSON.stringify(pieces).length)
      throw new Error("PPT summary did not reduce the source content");
    return summarizeReportForPpt(
      { ...input, report: "", sections: reduced },
      signal,
    );
  }
  input = { ...input, report: "", sections: pieces };
  const text = await runAuxiliary({
    systemPrompt: buildPptSystemPrompt(input.userInstructions),
    message: JSON.stringify(input),
    signal,
  });
  signal?.throwIfAborted();
  const outline = normalizeOutline(extractJson(text), input);
  if (!outline) throw new Error(tApp("analysis.delivery.ppt-summarizer.30"));
  if (input.cover) {
    if (input.cover.title.trim()) outline.title = input.cover.title.trim();
    if (input.cover.subtitle.trim())
      outline.subtitle = input.cover.subtitle.trim();
  }
  return outline;
}
