import type { Component } from "vue";
import {
  AlarmClock,
  AppWindow,
  BookOpen,
  Bot,
  Boxes,
  Briefcase,
  Building2,
  Calendar,
  CalendarClock,
  ChartColumn,
  ChartNoAxesCombined,
  Circle,
  ClipboardList,
  Component as ComponentIcon,
  Database,
  ExternalLink,
  Folder,
  GitBranch,
  Globe,
  GraduationCap,
  Grid2X2,
  HeartPulse,
  House,
  Layers,
  LayoutDashboard,
  Link2,
  Microscope,
  MousePointerClick,
  Network,
  Package,
  PanelsTopLeft,
  Presentation,
  Puzzle,
  ScanEye,
  Settings,
  Shapes,
  Share2,
  ShieldCheck,
  ShoppingCart,
  Sliders,
  Sparkles,
  SquareFunction,
  Table2,
  Tags,
  UserCog,
  Users,
  Wallet,
  Waypoints,
  Workflow,
} from "lucide-vue-next";

/** Applications name icons; the shell resolves a curated set so the rail does not pull in whole icon packs. */
const appIcons: Record<string, Component> = {
  "app-window": AppWindow,
  users: Users,
  "user-cog": UserCog,
  microscope: Microscope,
  presentation: Presentation,
  "graduation-cap": GraduationCap,
  briefcase: Briefcase,
  "shopping-cart": ShoppingCart,
  package: Package,
  "clipboard-list": ClipboardList,
  chart: ChartNoAxesCombined,
  "chart-column": ChartColumn,
  wallet: Wallet,
  "heart-pulse": HeartPulse,
  building: Building2,
  "building-2": Building2,
  globe: Globe,
  calendar: Calendar,
  book: BookOpen,
  "book-open": BookOpen,
  folder: Folder,
  workflow: GitBranch,
  "git-branch": GitBranch,
  "visual-modeling": Workflow,
  database: Database,
  shield: ShieldCheck,
  "shield-check": ShieldCheck,
  "agent-builder": Bot,
  bot: Bot,
  gallery: Grid2X2,
  network: Network,
  boxes: Boxes,
  tags: Tags,
  link: Link2,
  function: SquareFunction,
  "mouse-pointer-click": MousePointerClick,
  "alarm-clock": AlarmClock,
  puzzle: Puzzle,
  "share-2": Share2,
  component: ComponentIcon,
  layers: Layers,
  "panels-top-left": PanelsTopLeft,
  shapes: Shapes,
  table: Table2,
  /** 个人工作台 */
  home: House,
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
  /** 看板 */
  dashboards: LayoutDashboard,
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
