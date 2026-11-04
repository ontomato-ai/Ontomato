import type { Component } from "vue";
import {
  Activity,
  BookOpen,
  Bot,
  CalendarClock,
  ChartColumn,
  Circle,
  File,
  FileCode,
  FileSearch,
  FileText,
  FlaskConical,
  ListChecks,
  Image,
  LayoutDashboard,
  Network,
  Puzzle,
  Settings2,
  SquareTerminal,
  Table2,
  Waypoints,
} from "lucide-vue-next";
import { fileKind } from "./artifacts";

/** Feature declarations name icons; the shell resolves a curated set to keep bundles small. */
const featureIcons: Record<string, Component> = {
  dashboard: LayoutDashboard,
  agents: Bot,
  skills: Puzzle,
  schedule: CalendarClock,
  graph: Network,
  settings: Settings2,
  knowledge: BookOpen,
  ontology: Waypoints,
  evidence: FileSearch,
  logs: Activity,
  test: FlaskConical,
  query: SquareTerminal,
  review: ListChecks,
};

export function featureIcon(name: string): Component {
  return featureIcons[name] ?? Circle;
}

export function artifactIcon(path: string): Component {
  switch (fileKind(path)) {
    case "chart":
      return ChartColumn;
    case "csv":
    case "json":
    case "xlsx":
      return Table2;
    case "png":
    case "jpg":
    case "jpeg":
    case "svg":
    case "webp":
      return Image;
    case "html":
      return FileCode;
    case "md":
    case "txt":
      return FileText;
    default:
      return File;
  }
}
