import type { Component } from "vue";
import {
  BookOpen,
  CalendarClock,
  Circle,
  Database,
  ExternalLink,
  Network,
  ScanEye,
  Settings,
  ShieldCheck,
  Sliders,
  Sparkles,
  Table2,
  Waypoints,
} from "lucide-vue-next";

/** Applications name icons; the shell resolves a curated set so the rail does not pull in whole icon packs. */
const appIcons: Record<string, Component> = {
  /** 智能体平台 */
  agents: Sparkles,
  /** 运维诊断 */
  diagnosis: ScanEye,
  /** 知识治理 */
  knowledge: BookOpen,
  /** 对象浏览器 */
  objects: Network,
  /** 本体管理器 */
  ontology: Waypoints,
  /** 定时任务 */
  schedule: CalendarClock,
  /** 权限管理 */
  permissions: ShieldCheck,
  /** 系统设置 */
  settings: Settings,
  /** 数据治理平台 (external) */
  governance: Database,
  /** app-builder and other applications made later */
  builder: Sliders,
  pages: Table2,
};

export function appIcon(name: string): Component {
  return appIcons[name] ?? Circle;
}

/** An icon the shell was given: a component stays as it is, a name resolves through the curated set. */
export function resolveIcon(icon: string | Component): Component {
  return typeof icon === "string" ? appIcon(icon) : icon;
}

export { ExternalLink };
