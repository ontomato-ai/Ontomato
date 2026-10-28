import type { Component } from "vue";
import {
  Activity,
  BarChart3,
  Brain,
  Database,
  MessageSquare,
  Settings,
  Sparkles,
  Target,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-vue-next";
import { workbenchContent } from "../../../content";

const lucideIconMap: Record<string, Component> = {
  Brain,
  Sparkles,
  Activity,
  BarChart3,
  TrendingUp,
  Target,
  Database,
  Wallet,
  Users,
  Settings,
  MessageSquare,
};

export const avatarIconOptions = Object.entries(lucideIconMap).map(([key, icon]) => ({
  key,
  icon,
}));
export const lightAvatarColorOptions = [
  "#F1EFFF",
  "#EEF7FF",
  "#EFFFF8",
  "#F4F7FE",
  "#FFF4FB",
  "#FFF6ED",
];
export const darkAvatarColorOptions = [
  "#2c2850",
  "#1d3047",
  "#173b35",
  "#252a42",
  "#40223b",
  "#42331d",
];

export function displayAgentName(name: string | undefined, t: (key: string) => string): string {
  if (!name) return "";
  return workbenchContent().defaultAgentNames.includes(name) ? t("service.defaultAgentName") : name;
}

export function displayAgentDescription(
  desc: string | undefined,
  t: (key: string) => string
): string {
  if (!desc) return "";
  return workbenchContent().defaultAgentDescriptions.includes(desc)
    ? t("service.defaultAgentDescription")
    : desc;
}
