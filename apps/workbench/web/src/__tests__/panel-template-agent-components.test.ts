import { createApp } from "vue";
import { describe, expect, it } from "vitest";
import { baseComponents } from "../../../../../packages/apps-sdk/src/base-components";
import { prepareTemplateComponents } from "../../../../../packages/apps-sdk/src/panel/template-components";

/*
 * A panel's HTML composes the SDK's components as tags: the ones its template names are registered before the first
 * draw. The agent avatar and the agent picker are the SDK's, and a panel's own list prefix and composer picker are
 * written with them (`<agent-avatar>`, `<agent-picker>`).
 *
 * What this rules out: a tag the panel template names staying unresolved, so the avatar or the picker draws nothing.
 */

async function registered(template: string) {
  const install = await prepareTemplateComponents(template, baseComponents);
  const app = createApp({});
  install(app);
  return (name: string) => Boolean(app.component(name));
}

describe("a panel's HTML composing the SDK's agent components", () => {
  it("registers the agent avatar a list prefix names", async () => {
    const component = await registered('<div><agent-avatar :icon="null" :size="22"></agent-avatar></div>');
    expect(component("AgentAvatar")).toBe(true);
  });

  it("registers the agent picker a composer names", async () => {
    const component = await registered('<div><agent-picker variant="home"></agent-picker></div>');
    expect(component("AgentPicker")).toBe(true);
  });
});
