import { expect, it } from "vitest";
import { agentAvatar, avatarSwatch, darkAvatarColorOptions, lightAvatarColorOptions, storedAgentAvatar } from "../avatar";

/*
 * The agent settings write an avatar into the definition's `icon`, and every place that shows an agent reads it back:
 * the two sides agree on this one format, and a definition without one, or with a value written some other way, shows
 * the default avatar.
 */
it("reads back the avatar the settings store, and the default for anything else", () => {
  const stored = storedAgentAvatar({ key: "Database", color: darkAvatarColorOptions[3]! });
  expect(agentAvatar(stored)).toEqual({ key: "Database", color: darkAvatarColorOptions[3] });
  const fallback = { key: "Brain", color: lightAvatarColorOptions[0] };
  expect([null, "", "sparkles", "{\"key\":1}", "[]"].map((icon) => agentAvatar(icon))).toEqual(Array(5).fill(fallback));
});

it("keeps an avatar's swatch in either theme", () => {
  expect(avatarSwatch(darkAvatarColorOptions[3]!)).toEqual({ light: lightAvatarColorOptions[3], dark: darkAvatarColorOptions[3] });
  expect(avatarSwatch(lightAvatarColorOptions[5]!)).toEqual({ light: lightAvatarColorOptions[5], dark: darkAvatarColorOptions[5] });
  expect(avatarSwatch("#123456")).toEqual({ light: lightAvatarColorOptions[0], dark: darkAvatarColorOptions[0] });
});
