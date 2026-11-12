import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import PptxGenJS from "pptxgenjs";
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import { z } from "zod";
import { chartBrandColors } from "@ontomato/contracts/chart-presentation";
import { datasetPayloadSchema } from "@ontomato/contracts/data-retrieval";
import { parseProductMarkdown } from "@ontomato/markdown";

const FONT_ROOT = "/usr/share/fonts/truetype";
const FONT_FILES = ["wqy/wqy-microhei.ttc", "dejavu/DejaVuSans.ttf"];
const FONT_FAMILY = "WenQuanYi Micro Hei";
const ARABIC_FONT = "DejaVu Sans";
const arabic = /[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]/;
const textStyle = (text) => ({ fontFace: arabic.test(text) ? ARABIC_FONT : FONT_FAMILY, rtlMode: arabic.test(text) });
const workspacePath = z.string().regex(/^outputs\//).refine(value => !value.split("/").includes(".."));
const heading = { title: z.string().min(1), takeaway: z.string().optional() };
const planSchema = z.object({
  report: workspacePath.refine(value => /^outputs\/reports\/[^/]+\/report\.md$/.test(value)),
  title: z.string().min(1),
  slides: z.array(z.discriminatedUnion("layout", [
    z.object({ ...heading, layout: z.literal("text"), bullets: z.array(z.string()).min(1) }).strict(),
    z.object({ ...heading, layout: z.literal("chart"), chart: workspacePath.refine(value => value.endsWith(".chart.json")) }).strict(),
    z.object({ ...heading, layout: z.literal("table"), dataset: workspacePath.refine(value => value.endsWith(".dataset.json")),
      range: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]).optional(),
      summary: z.string().min(1).optional() }).strict(),
  ])).min(1),
}).strict();

function references(nodes, found = new Set()) {
  for (const node of nodes) {
    if (node.type === "link") found.add(node.href);
    if (node.type === "image") found.add(node.src);
    for (const key of ["children", "items", "rows", "cells"])
      if (Array.isArray(node[key])) references(node[key], found);
    if (node.type === "table") references([node.header], found);
  }
  return found;
}

function addHeading(slide, entry, color) {
  slide.addText(entry.title, { x: 0.55, y: 0.35, w: 12.2, h: 0.6, fontSize: 26, bold: true,
    color, fit: "shrink", ...textStyle(entry.title) });
  if (entry.takeaway) slide.addText(entry.takeaway, { x: 0.55, y: 1.02, w: 12.2, h: 0.55,
    fontSize: 17, fit: "shrink", ...textStyle(entry.takeaway) });
}

function sourceNote(slide, text) {
  slide.addText(text, { x: 0.55, y: 6.7, w: 12.2, h: 0.55, fontSize: 10,
    fit: "shrink", ...textStyle(text) });
}

async function main() {
  const [planFile, ...args] = process.argv.slice(2);
  if (!planFile || args.length && (args.length !== 2 || args[0] !== "--font-root"))
    throw new Error("Usage: node skills/assistant-report/scripts/render.cjs work/slides.json [--font-root /usr/share/fonts/truetype]");
  const plan = planSchema.parse(JSON.parse(fs.readFileSync(planFile, "utf8")));
  const referenced = references(parseProductMarkdown(fs.readFileSync(plan.report, "utf8")));
  const used = new Set(plan.slides.flatMap(entry => entry.layout === "chart" ? [entry.chart] : entry.layout === "table" ? [entry.dataset] : []));
  const missing = [...referenced].filter(file => (file.endsWith(".chart.json") || file.endsWith(".dataset.json")) && !used.has(file));
  if (missing.length) throw new Error(`Report sources missing from slides:\n${missing.join("\n")}`);
  const fontRoot = args[1] ?? FONT_ROOT;
  const fontBuffers = FONT_FILES.map(file => fs.readFileSync(path.join(fontRoot, file)));
  const skillRoot = path.resolve(__dirname, "..");
  const echarts = createRequire(path.join(skillRoot, "vendor/echarts.cjs"))(path.join(skillRoot, "vendor/echarts.cjs"));
  await initWasm(Buffer.from(fs.readFileSync(path.join(skillRoot, "vendor/resvg.wasm.b64"), "utf8"), "base64"));
  const theme = JSON.parse(fs.readFileSync(path.join(skillRoot, "resources/chart-theme.json"), "utf8"));
  const deck = new PptxGenJS();
  deck.layout = "LAYOUT_WIDE";
  deck.title = plan.title;
  deck.subject = plan.report;
  deck.author = "Ontomato";
  deck.theme = { headFontFace: FONT_FAMILY, bodyFontFace: FONT_FAMILY, lang: "zh-CN" };
  const ink = theme.textStyle.color.replace(/^#/, "");
  for (const entry of plan.slides) {
    const source = entry.layout === "chart" ? entry.chart : entry.layout === "table" ? entry.dataset : plan.report;
    if (source !== plan.report && !referenced.has(source)) throw new Error(`Source is not referenced by ${plan.report}: ${source}`);
    const slide = deck.addSlide();
    if (entry.layout === "text") {
      addHeading(slide, entry, ink);
      const body = entry.bullets.map(text => `• ${text}`).join("\n\n");
      slide.addText(body, { x: 0.7, y: 1.8, w: 11.9, h: 4.5, fontSize: 22, valign: "top", fit: "shrink", ...textStyle(body) });
      sourceNote(slide, source);
    } else if (entry.layout === "chart") {
      addHeading(slide, entry, ink);
      const option = chartBrandColors(JSON.parse(fs.readFileSync(source, "utf8")), theme);
      option.animation = false;
      option.textStyle = { fontFamily: FONT_FAMILY, ...option.textStyle };
      const chart = echarts.init(null, theme, { renderer: "svg", ssr: true, width: 1440, height: 560 });
      chart.setOption(option);
      const svg = chart.renderToSVGString();
      chart.dispose();
      const image = new Resvg(svg, { font: { fontBuffers, loadSystemFonts: false, defaultFontFamily: FONT_FAMILY,
        sansSerifFamily: FONT_FAMILY, serifFamily: FONT_FAMILY, monospaceFamily: ARABIC_FONT } });
      const png = image.render();
      slide.addImage({ data: `image/png;base64,${Buffer.from(png.asPng()).toString("base64")}`,
        x: 0.55, y: 1.8, w: 12.2, h: 4.74 });
      png.free();
      image.free();
      sourceNote(slide, source);
    } else {
      const data = datasetPayloadSchema.parse(JSON.parse(fs.readFileSync(source, "utf8")));
      const [start, end] = entry.range ?? [0, data.rows.length];
      if (start > end || end > data.rows.length) throw new Error(`Invalid table range: ${start}–${end}/${data.rows.length}`);
      if ((start !== 0 || end !== data.rows.length) && !entry.summary) throw new Error("A table subset must have an explicit summary label");
      const cell = value => value === null ? "null" : typeof value === "object" ? JSON.stringify(value) : String(value);
      const rows = [data.columns.map(column => ({ text: column.label, options: { bold: true, ...textStyle(column.label) } })),
        ...data.rows.slice(start, end).map(row => data.columns.map(column => {
          const text = cell(row[column.key]);
          return { text, options: textStyle(text) };
        }))];
      slide.addTable(rows, { x: 0.55, y: 1.8, w: 12.2, h: 4.7, fontFace: FONT_FAMILY, fontSize: 14,
        border: { type: "solid", color: "CCCCCC", pt: 0.5 }, margin: 0.08,
        autoPage: true, autoPageRepeatHeader: true, autoPageHeaderRows: 1, autoPageSlideStartY: 1.8 });
      const note = [source, `${start}–${end}/${data.rows.length}`, entry.summary,
        data.truncation && `${data.truncation.truncationHint} (rowLimit=${data.truncation.rowLimit})`].filter(Boolean).join(" · ");
      for (const page of [slide, ...slide.newAutoPagedSlides]) {
        addHeading(page, entry, ink);
        sourceNote(page, note);
      }
    }
  }
  const output = path.join(path.dirname(plan.report), "report.pptx");
  await deck.writeFile({ fileName: output });
  console.log(output);
}

main();
