import type { ArtifactRendererOverride } from "../types";
import ChartRenderer from "./ChartRenderer.vue";
import HtmlRenderer from "./HtmlRenderer.vue";
import ImageRenderer from "./ImageRenderer.vue";
import MarkdownRenderer from "./MarkdownRenderer.vue";
import TableRenderer from "./TableRenderer.vue";

/** The shell's default renderers by extension, per the artifact Markdown contract. */
export const defaultArtifactRenderers: ArtifactRendererOverride[] = [
  { extensions: [".chart.json"], component: ChartRenderer },
  { extensions: [".csv", ".json"], component: TableRenderer },
  { extensions: [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"], component: ImageRenderer },
  { extensions: [".html", ".htm"], component: HtmlRenderer },
  { extensions: [".md"], component: MarkdownRenderer },
];
