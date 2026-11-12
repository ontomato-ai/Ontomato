import { describe, expect, it } from "vitest";
import { createI18n } from "vue-i18n";
import { englishMessages, managerMessageTree, type ManagerMessages } from "../i18n";
import { shellLabels, type GovernanceTranslate } from "../knowledge-governance/messages";

/** Every leaf of a message tree with its dotted key. */
function leaves(tree: object, prefix = ""): [string, string][] {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === "string" ? [[`${prefix}${key}`, value] as [string, string]] : leaves(value, `${prefix}${key}.`)
  );
}

/** What the Manager's own lookup produced before the move to vue-i18n: `{name}` replaced by its parameter. */
function interpolate(text: string, params: Record<string, string>) {
  return Object.entries(params).reduce((result, [name, value]) => result.split(`{${name}}`).join(value), text);
}

/**
 * Checks that a locale's Manager messages render through vue-i18n exactly as written (no linked-message, plural or
 * escape syntax by accident), parameters included. Governance plurals are checked separately.
 */
function expectMessagesRenderAsWritten(messages: ManagerMessages) {
  const i18n = createI18n({ legacy: false, locale: "x", messages: { x: managerMessageTree(messages) } as never });
  const { t: translate } = i18n.global as unknown as { t: (key: string, params?: Record<string, string>) => string };
  for (const [key, text] of leaves(managerMessageTree(messages))) {
    if (key.startsWith("governance.") && text.includes(" | ")) continue;
    const params = Object.fromEntries([...text.matchAll(/\{(\w+)\}/g)].map(([, name]) => [name, `<${name}>`]));
    expect(translate(key, params), key).toBe(interpolate(text, params));
  }
}

describe("Manager messages in the page's vue-i18n tree", () => {
  it("place the Manager's own words under ontology, governance under governance and the shared groups at the top", () => {
    const tree = managerMessageTree(englishMessages) as Record<string, Record<string, unknown>>;
    expect(tree.ontology).toBe(englishMessages.ontology);
    expect(tree.governance).toBe(englishMessages.governance);
    expect(tree.nav).toBe(englishMessages.shared.nav);
    expect(tree.common).toBe(englishMessages.shared.common);
  });

  it("every English message renders as written, with its parameters", () => {
    expectMessagesRenderAsWritten(englishMessages);
  });

  it("governance plurals and the elapsed label come out of vue-i18n as the agent shell expects", () => {
    const i18n = createI18n({ legacy: false, locale: "en", messages: { en: managerMessageTree(englishMessages) } as never });
    const labels = shellLabels((i18n.global as unknown as { t: GovernanceTranslate }).t);
    for (const count of [0, 1, 3]) {
      expect(labels.steps(count)).toContain(String(count));
      expect(labels.steps(count)).not.toContain("|");
    }
    // English takes a different form for one than for several.
    expect(labels.steps(1).replace("1", "#")).not.toBe(labels.steps(3).replace("3", "#"));
    expect(labels.elapsed("3s")).toContain("3s");
    expect(labels.greeting).toBe(englishMessages.governance.text.welcomeTitle);
  });
});
