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

/** The stored avatar of an agent definition: an icon key and a background colour. */
export interface AgentAvatar {
  key: string;
  color: string;
}

export function avatarIcon(key: string): Component {
  return lucideIconMap[key] ?? Brain;
}

/** Keeps the chosen swatch when the theme changes: light and dark palettes correspond by index. */
export function themedAvatarColor(color: string, isDark: boolean): string {
  const from = isDark ? lightAvatarColorOptions : darkAvatarColorOptions;
  const to = isDark ? darkAvatarColorOptions : lightAvatarColorOptions;
  const index = from.indexOf(color);
  if (index >= 0) return to[index]!;
  return to.includes(color) ? color : to[0]!;
}
