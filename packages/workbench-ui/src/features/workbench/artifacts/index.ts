import type { ArtifactRendererRegistration } from "@ontomato/agent-shell-ui";
import ChartArtifact from "./ChartArtifact.vue";
import HtmlArtifact from "./HtmlArtifact.vue";
import ImageArtifact from "./ImageArtifact.vue";
import MarkdownArtifact from "./MarkdownArtifact.vue";
import TableArtifact from "./TableArtifact.vue";

/** Renderers the business workbench registers with the shell, chosen by file extension. */
export const businessArtifactRenderers: ArtifactRendererRegistration[] = [
  { extensions: [".chart.json"], component: ChartArtifact },
  { extensions: [".csv", ".json"], component: TableArtifact },
  { extensions: [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"], component: ImageArtifact },
  { extensions: [".html", ".htm"], component: HtmlArtifact },
  { extensions: [".md"], component: MarkdownArtifact },
];
