import type { ShellFeatureDeclaration } from "@ontomato/agent-shell-ui";
import { AGENT_PAGE_PERMISSIONS } from "../agents/permissions";

/**
 * The agent platform's own entries in its column, before the recent conversations.
 *
 * The settings sit beside the conversation (the agent page is a pilot of page activation): an agent can be written in the
 * conversation, filled into the settings form by its draft and saved there. The dashboards are an application of their
 * own and the scheduled tasks are the platform's one list, so they are not listed here; an edition that later needs an
 * entry of its own passes it in.
 */
const agentSettingsFeature: ShellFeatureDeclaration = {
  id: "agents",
  label: "agents",
  icon: "agents",
  availability: "page",
  withConversation: true,
  pageSkill: { pageKey: "agent-settings", permissionCode: AGENT_PAGE_PERMISSIONS[0] },
};

export function workbenchFeatures(editionFeatures: readonly ShellFeatureDeclaration[]): ShellFeatureDeclaration[] {
  return [agentSettingsFeature, ...editionFeatures];
}
