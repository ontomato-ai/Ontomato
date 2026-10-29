import type { Component } from "vue";
import {
  BookOpen,
  Bot,
  CalendarClock,
  ChartColumn,
  Circle,
  File,
  FileCode,
  FileText,
  Image,
  LayoutDashboard,
  Network,
  Puzzle,
  Settings2,
  Table2,
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
