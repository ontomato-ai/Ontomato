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

/**
 * An agent's avatar, as its definition stores it in `icon`: an icon key and a background colour, written as JSON. The
 * colour is one swatch of the light or the dark palette; the two palettes correspond by index, so an avatar keeps its
 * swatch in either theme.
 */
export interface AgentAvatar {
  key: string;
  color: string;
}

const defaultAgentAvatar: AgentAvatar = { key: "Brain", color: lightAvatarColorOptions[0]! };

/** The avatar an agent's stored `icon` holds; none, or a value written some other way, is the default avatar. */
export function agentAvatar(icon: string | null): AgentAvatar {
  if (!icon) return defaultAgentAvatar;
  let stored: unknown;
  try {
    stored = JSON.parse(icon);
  } catch {
    return defaultAgentAvatar;
  }
  const { key, color } = (stored ?? {}) as Partial<Record<keyof AgentAvatar, unknown>>;
  return typeof key === "string" && typeof color === "string" ? { key, color } : defaultAgentAvatar;
}

/** The value an agent definition stores for an avatar. */
export function storedAgentAvatar(avatar: AgentAvatar): string {
  return JSON.stringify({ key: avatar.key, color: avatar.color });
}

/** The light and dark values of the swatch a stored colour belongs to; an unknown colour is the first swatch. */
export function avatarSwatch(color: string): { light: string; dark: string } {
  const index = Math.max(0, lightAvatarColorOptions.indexOf(color), darkAvatarColorOptions.indexOf(color));
  return { light: lightAvatarColorOptions[index]!, dark: darkAvatarColorOptions[index]! };
}

export function avatarIcon(key: string): Component {
  return lucideIconMap[key] ?? Brain;
}
