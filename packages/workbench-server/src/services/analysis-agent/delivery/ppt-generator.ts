import type pptxgen from "pptxgenjs";
import { createRequire } from "node:module";
import { workbenchProduct } from "../../../product/installed";
import type { PptSummarySlide, PptSummaryOutline, PptGenerationOptions, PptSourceSection } from "@ontomato/contracts/ppt";
import { marked, type Tokens } from "marked";
import { renderChartHtmlToDataUrl } from "./chart-renderer";
import { summarizeReportForPpt } from "./ppt-summarizer";
import { createLogger } from "../../../logging/logger";

const logger = createLogger("ppt-generator");

// Use the Node entry explicitly: the package's ESM entry is wrapped by tsx in development.
const PptxGen = createRequire(import.meta.url)("pptxgenjs") as typeof pptxgen;

export function stripPptCharts(text: string): string {
  return text.replace(/```html\s*[\s\S]*?```/g, "").replace(/^\s*\[chart:[^\]\r\n]+\]\s*$/gm, "").trim();
}

function partialSourceWarning(section: PptSourceSection): string {
  return section.truncated
    ? `Incomplete source data (${section.heading || section.id}): ${section.truncationHint}`
    : "";
}

/** Column widths proportional to sqrt of the longest cell text, clamped to keep narrow columns readable. */
export function tableColumnWidths(columns: readonly string[], rows: readonly (readonly string[])[], totalWidth = 12.1): number[] {
  const weights = columns.map((column, index) => {
    let max = column.length;
    for (const row of rows) max = Math.max(max, String(row[index] ?? "").length);
    return Math.sqrt(Math.min(max, 400)) + 4;
  });
  const sum = weights.reduce((a, b) => a + b, 0);
  const widths = weights.map(weight => Math.max(.9, (weight / sum) * totalWidth));
  widths[widths.length - 1] += totalWidth - widths.reduce((a, b) => a + b, 0);
  return widths.map(width => +width.toFixed(2));
}

/** Render a native data table, paginating rows manually (pptxgenjs autoPage underestimates CJK text height). */
function addDataTable(deck: pptxgen, sectionTitle: string, table: {columns: string[]; rows: unknown[][]}) {
  const cellText = (value: unknown): string => {
    const text = typeof value === "object" && value !== null ? JSON.stringify(value) : String(value ?? "");
    return text.length > 600 ? `${text.slice(0, 600)}…` : text;
  };
  const columns = table.columns.map(cellText);
  const rows = table.rows.map(row => row.map(cellText));
  const allText = [columns, ...rows].flat().join("");
  const fontSize = allText.length > 4000 ? 8 : allText.length > 1200 ? 9 : 10;
  const colW = tableColumnWidths(columns, rows);
  const headerRow = columns.map(value => ({text: value, options: {bold: true, color: "172033", fill: {color: "EEF3FB"}}}));

  // Rough per-row height: full-width CJK glyph ≈ fontSize; add padding. Conservative enough for pagination.
  const rowHeight = (cells: readonly string[]): number => {
    let lines = 1;
    cells.forEach((text, index) => {
      const charsPerLine = Math.max(4, Math.floor((colW[index] ?? 2) / (fontSize / 72)));
      lines = Math.max(lines, Math.ceil(text.length / charsPerLine));
    });
    return lines * (fontSize / 72) * 1.35 + .1;
  };

  const availableHeight = 5.55; // table starts at y=1.3, footer sits at y≈7.08
  const chunks: string[][][] = [];
  let current: string[][] = [];
  let currentHeight = 0;
  for (const row of rows) {
    const height = rowHeight(row);
    if (current.length && currentHeight + height > availableHeight) {
      chunks.push(current);
      current = [];
      currentHeight = 0;
    }
    current.push(row);
    currentHeight += height;
  }
  if (current.length) chunks.push(current);

  for (const chunk of chunks) {
    const slide = deck.addSlide("REPORT");
    addSlideChrome(slide, deck.ShapeType, sectionTitle);
    slide.addText(sectionTitle, {x: .6, y: .4, w: 12, h: .7, fontSize: 24, fontFace: "Microsoft YaHei", color: "172033", fit: "shrink", margin: 0});
    slide.addTable([headerRow, ...chunk.map(row => row.map(value => ({text: value, options: {valign: "top" as const}})))], {
      x: .6,
      y: 1.3,
      colW,
      fontSize,
      border: {pt: .5, color: "D9DEE8"},
      color: "172033",
      fill: {color: "FFFFFF"},
      fontFace: "Microsoft YaHei",
      valign: "top",
      margin: .05,
      autoPage: false,
    });
  }
}


export function markdownSnippet(markdown: string, maxLength = 160): string {
  const lines = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s*[-*+]\s+/gm, "")
    .split("\n")
    .map(line => line.trim())
    .filter(line => line && !line.includes("|"));
  return lines.join("；").replace(/\s{2,}/g, " ").slice(0, maxLength);
}

export async function generatePpt(title: string, sections: readonly PptSourceSection[], options: PptGenerationOptions = {}, signal?: AbortSignal) {
  const outline = await summarizeReportForPpt({ title, ...options,
    report: "",
    sections: sections.map(section => ({id: section.id, heading: section.heading || section.content.match(/^#{1,3}\s+(.+)$/m)?.[1] || title,
      text: [partialSourceWarning(section), stripPptCharts(section.content)].filter(Boolean).join("\n\n"),
      hasChart: /```html/.test(section.content)})),
  }, signal);
  return buildPptDeck(title, sections, outline, options, signal);
}

function toDataUrl(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function buildIllustration(visual: PptSummarySlide["visual"], accent: string): string {
  const shapes = {
    insight: `<path d="M28 122h44V78h44v44h44V48h44v74h44" fill="none" stroke="${accent}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/><circle cx="94" cy="78" r="10" fill="${accent}"/><circle cx="182" cy="48" r="10" fill="${accent}"/>`,
    risk: `<path d="M128 25 232 210H24L128 25Z" fill="#FFF3E8" stroke="${accent}" stroke-width="10"/><path d="M128 82v58M128 169v3" stroke="${accent}" stroke-width="13" stroke-linecap="round"/>`,
    action: `<path d="M36 184 98 122l34 34 86-102" fill="none" stroke="${accent}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/><path d="m181 54 37 0-1 37" fill="none" stroke="${accent}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>`,
    metric: `<rect x="30" y="42" width="196" height="150" rx="18" fill="#EEF4FF" stroke="${accent}" stroke-width="9"/><path d="M64 151h31v-47h31v47h31V80h31v71" fill="none" stroke="${accent}" stroke-width="11" stroke-linejoin="round"/>`,
  } as const;
  return toDataUrl(
    `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="240" viewBox="0 0 256 240"><rect width="256" height="240" rx="28" fill="#F4F7FC"/>${shapes[visual === "chart" ? "insight" : visual]}</svg>`
  );
}

function addSlideChrome(
  slide: pptxgen.Slide,
  shapeType: typeof pptxgen.ShapeType,
  title: string
) {
  slide.background = { color: "F7F9FC" };
  slide.addShape(shapeType.rect, {
    x: 0,
    y: 0,
    w: 13.333,
    h: 0.12,
    line: { color: "2457D6", transparency: 100 },
    fill: { color: "2457D6" },
  });
  slide.addText(title, {
    x: 0.55,
    y: 7.08,
    w: 9.6,
    h: 0.2,
    fontFace: "Microsoft YaHei",
    fontSize: 8,
    color: "667085",
    margin: 0,
  });

}

export async function buildPptDeck(
  title: string, sections: readonly PptSourceSection[], outline: PptSummaryOutline,
  options: PptGenerationOptions = {}, signal?: AbortSignal,
  renderChart: (html: string) => Promise<string> = html => renderChartHtmlToDataUrl(html, 30000, {offline: true, signal})
): Promise<{ buffer: Buffer; warnings: string[] }> {
  const warnings: string[] = sections.map(partialSourceWarning).filter(Boolean);
  const sectionCharts = new Map<string, string>();
  const usedCharts = new Set<string>();
  for (const section of sections) {
    const chart = [...section.content.matchAll(/```html\s*\n([\s\S]*?)\n```/g)][0]?.[1];
    if (chart) sectionCharts.set(section.id, chart.trim());
  }
  const deck = new PptxGen();
  deck.layout = "LAYOUT_WIDE";
  deck.author = workbenchProduct().serviceDisplayName;
  deck.subject = title;
  deck.title = title;
  deck.company = workbenchProduct().serviceDisplayName;
  deck.theme = {
    headFontFace: "Microsoft YaHei",
    bodyFontFace: "Microsoft YaHei",
  };
  deck.defineSlideMaster({
    title: "REPORT",
    background: { color: "F7F9FC" },
    objects: [],
    slideNumber: { x: 12.1, y: 7.08, color: "667085", fontFace: "Arial", fontSize: 8 },
  });

  const totalSlides = outline.slides.length + 1;
  for (let index = 0; index < totalSlides; index += 1) {
    const draft = outline.slides[index - 1];
    const slide = deck.addSlide("REPORT");
    addSlideChrome(slide, deck.ShapeType, outline.title);
    if (index === 0) {
      slide.background = { color: "172033" };
      slide.addShape(deck.ShapeType.rect, {
        x: 0,
        y: 0,
        w: 13.333,
        h: 7.5,
        line: { color: "172033", transparency: 100 },
        fill: { color: "172033" },
      });
      if (options.coverImage && options.coverImageMode !== "background") {
        slide.addImage({ data: options.coverImage, x: 7.45, y: 1.05, w: 5.2, h: 5.35, transparency: 0 });
      } else if (options.coverImage) {
        slide.addImage({ data: options.coverImage, x: 0, y: 0, w: 13.333, h: 7.5, transparency: 42 });
        slide.addShape(deck.ShapeType.rect, {
          x: 0, y: 0, w: 13.333, h: 7.5,
          line: { color: "172033", transparency: 100 },
          fill: { color: "172033", transparency: 38 },
        });
      }
      slide.addShape(deck.ShapeType.rect, {
        x: 0.65,
        y: 0.82,
        w: 0.16,
        h: 5.65,
        line: { color: "5B8DEF", transparency: 100 },
        fill: { color: "5B8DEF" },
      });
      slide.addText(outline.title, {
        x: 1.2,
        y: 2.15,
        w: options.coverImage && options.coverImageMode !== "background" ? 5.8 : 10.6,
        h: 1.0,
        fontFace: "Microsoft YaHei",
        fontSize: outline.title.length > 24 ? 30 : 38,
        bold: true,
        color: "FFFFFF",
        fit: "shrink",
        margin: 0,
      });
      slide.addText(outline.subtitle, {
        x: 1.22,
        y: 3.42,
        w: options.coverImage && options.coverImageMode !== "background" ? 5.8 : 8.5,
        h: 1.2,
        fontFace: "Microsoft YaHei",
        fontSize: 17,
        color: "B8C5E0",
        fit: "shrink",
        margin: 0,
      });
      continue;
    }

    slide.addText(draft.title, {
      x: 0.6,
      y: 0.55,
      w: 11.4,
      h: 0.62,
      fontFace: "Microsoft YaHei",
      fontSize: draft.title.length > 28 ? 24 : 29,
      bold: true,
      color: "172033",
      breakLine: false,
      fit: "shrink",
      margin: 0,
    });
    slide.addShape(deck.ShapeType.line, {
      x: 0.6,
      y: 1.35,
      w: 1.2,
      h: 0,
      line: { color: "2457D6", width: 2.5 },
    });

    const chartHtml = draft.sourceSectionIds.map((id) => sectionCharts.get(id)).find(Boolean);
    let chartImage: {data: string; width: number; height: number} | null = null;
    if (chartHtml) {
      signal?.throwIfAborted();
      try { chartImage = { data: await renderChart(chartHtml), width: 1000, height: 500 }; }
      catch (error) {
        logger.error("PPT chart render failed on slide", {
          slide: draft.title,
          cause: error instanceof Error ? error.message : String(error),
        });
        warnings.push(`Chart could not be rendered: ${draft.title}`);
      }
      signal?.throwIfAborted();
    }
    if (chartHtml) usedCharts.add(chartHtml);
    const hasChart = Boolean(chartImage);
    const textWidth = hasChart ? 5.7 : 7.9;
    slide.addText(draft.takeaway, {
      x: 0.72,
      y: 1.72,
      w: textWidth,
      h: 1.0,
      fontFace: "Microsoft YaHei",
      fontSize: 22,
      bold: true,
      color: "2457D6",
      breakLine: false,
      fit: "shrink",
      valign: "top",
      margin: 0.02,
    });
    if (draft.bullets.length) {
      slide.addText(
        draft.bullets.map((bullet) => ({
          text: bullet,
          options: { bullet: { indent: 16 }, hanging: 4 },
        })),
        {
          x: 0.82,
          y: 3.0,
          w: textWidth,
          h: hasChart ? 3.0 : 3.35,
          fontFace: "Microsoft YaHei",
          fontSize: 16,
          color: "172033",
          breakLine: true,
          fit: "shrink",
          paraSpaceAfter: 12,
          margin: 0.03,
          valign: "top",
        }
      );
    }
    if (chartImage) {
      const maxWidth = 5.65;
      const maxHeight = 4.55;
      const ratio = chartImage.width / chartImage.height;
      const imageWidth = Math.min(maxWidth, maxHeight * ratio);
      const imageHeight = imageWidth / ratio;
      const imageX = 6.92 + (maxWidth - imageWidth) / 2;
      const imageY = 1.85 + (maxHeight - imageHeight) / 2;
      slide.addShape(deck.ShapeType.roundRect, {
        x: 6.75,
        y: 1.7,
        w: 5.95,
        h: 4.85,
        rectRadius: 0.05,
        line: { color: "D9DEE8", width: 0.7 },
        fill: { color: "FFFFFF" },
      });
      slide.addImage({
        data: chartImage.data,
        x: imageX,
        y: imageY,
        w: imageWidth,
        h: imageHeight,
        transparency: 0,
      });
    } else {
      slide.addImage({
        data: buildIllustration(draft.visual, index % 2 ? "2457D6" : "E8793D"),
        x: 9.35,
        y: 4.85,
        w: 2.2,
        h: 2.05,
        transparency: 6,
      });
    }
  }


  // Append every source chart and paginate native tables, even if the summary omits its section.
  for (const section of sections) {
    signal?.throwIfAborted();
    const plain = stripPptCharts(section.content);
    const sectionTitle = section.heading || plain.match(/^#{1,3}\s+(.+)$/m)?.[1]?.trim() || title;
    const description = markdownSnippet(plain.split("\n")
      .filter(line => { const trimmed = line.trim().replace(/^#+\s*/, ""); return trimmed && trimmed !== (section.heading || "").trim() && trimmed !== sectionTitle && trimmed !== title; })
      .join("\n"));
    for (const match of section.content.matchAll(/```html\s*\n([\s\S]*?)\n```/g)) {
      const html = match[1].trim();
      if (usedCharts.has(html)) continue;
      usedCharts.add(html);
      const slide = deck.addSlide("REPORT");
      addSlideChrome(slide, deck.ShapeType, outline.title);
      slide.addText(sectionTitle, {x: .6, y: .4, w: 12, h: .7, fontSize: 24, fontFace: "Microsoft YaHei", color: "172033", fit: "shrink", margin: 0});
      try { slide.addImage({ data: await renderChart(html), x: .8, y: 1.3, w: 11.6, h: 5.1 }); }
      catch (error) {
        logger.error("PPT chart render failed on appendix slide", {
          section: section.heading || section.id,
          cause: error instanceof Error ? error.message : String(error),
        });
        warnings.push(`Chart could not be rendered: ${section.heading || section.id}`);
        slide.addText("Chart unavailable. See the source data and explanation.", {x: 1, y: 2, w: 11, h: 1, fontSize: 20});
      }
      signal?.throwIfAborted();
      if (description) slide.addText(description, {x: .8, y: 6.5, w: 11.6, h: .45, fontSize: 10, fontFace: "Microsoft YaHei", color: "667085", fit: "shrink", margin: 0});
    }
    const tables = [...(section.tables || [])];
    for (const token of marked.lexer(plain)) {
      if (token.type === "table") {
        const table = token as Tokens.Table;
        tables.push({columns: table.header.map(cell => cell.text), rows: table.rows.map(row => row.map(cell => cell.text))});
      }
    }
    for (const table of tables) {
      if (!table.columns.length) continue;
      signal?.throwIfAborted();
      addDataTable(deck, sectionTitle, table);
    }
  }
  if (warnings.length) {
    const slide = deck.addSlide("REPORT");
    slide.addText("Export warnings", {x: .6, y: .4, w: 12, h: .7, fontSize: 24});
    slide.addText(warnings.join("\n"), {x: .7, y: 1.4, w: 12, h: 5.2, fontSize: 16, fit: "shrink"});
  }
  signal?.throwIfAborted();
  return { buffer: await deck.write({outputType: "nodebuffer"}) as Buffer, warnings };
}
